import { supabase } from "./supabase";
import { getEffectiveTaxRate } from "./texas-tax-rates";
import { markPropertyPaid, updatePropertyBillSnapshot, type PropertyRecord } from "./properties";

// Per-tax-year bill/payment/refund history for a property — closes the loop on the
// savings estimate shown at intake (src/lib/savings-estimate.ts), which otherwise
// never gets compared against what the county actually billed. See the tax_bills
// table in supabase/schema.sql for the RLS policies this relies on.
export type TaxBillRecord = {
  id: string;
  propertyId: string;
  taxYear: number | null;
  taxableValue: number | null;
  taxRate: number | null;
  amountDue: number | null;
  dueDate: string | null;
  penaltyDate: string | null;
  sourceDocumentId: string | null;
  amountPaid: number | null;
  paidAt: string | null;
  paymentConfirmation: string | null;
  refundAmount: number | null;
  refundExpectedAt: string | null;
  refundReceivedAt: string | null;
  notes: string | null;
  createdAt: string;
};

type TaxBillRow = {
  id: string;
  property_id: string;
  tax_year: number | null;
  taxable_value: number | null;
  tax_rate: number | null;
  amount_due: number | null;
  due_date: string | null;
  penalty_date: string | null;
  source_document_id: string | null;
  amount_paid: number | null;
  paid_at: string | null;
  payment_confirmation: string | null;
  refund_amount: number | null;
  refund_expected_at: string | null;
  refund_received_at: string | null;
  notes: string | null;
  created_at: string;
};

function fromRow(row: TaxBillRow): TaxBillRecord {
  return {
    id: row.id,
    propertyId: row.property_id,
    taxYear: row.tax_year,
    taxableValue: row.taxable_value,
    taxRate: row.tax_rate,
    amountDue: row.amount_due,
    dueDate: row.due_date,
    penaltyDate: row.penalty_date,
    sourceDocumentId: row.source_document_id,
    amountPaid: row.amount_paid,
    paidAt: row.paid_at,
    paymentConfirmation: row.payment_confirmation,
    refundAmount: row.refund_amount,
    refundExpectedAt: row.refund_expected_at,
    refundReceivedAt: row.refund_received_at,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

const SELECT_COLUMNS =
  "id, property_id, tax_year, taxable_value, tax_rate, amount_due, due_date, penalty_date, source_document_id, amount_paid, paid_at, payment_confirmation, refund_amount, refund_expected_at, refund_received_at, notes, created_at";

export async function listTaxBills(userId: string): Promise<TaxBillRecord[]> {
  const { data, error } = await supabase
    .from("tax_bills")
    .select(SELECT_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as TaxBillRow[]).map(fromRow);
}

export async function addTaxBill(
  userId: string,
  propertyId: string,
  fields: {
    taxYear?: number;
    taxableValue?: number;
    taxRate?: number;
    amountDue?: number;
    dueDate?: string;
    penaltyDate?: string;
    notes?: string;
  },
  sourceDocumentId?: string,
): Promise<TaxBillRecord> {
  const { data, error } = await supabase
    .from("tax_bills")
    .insert({
      user_id: userId,
      property_id: propertyId,
      tax_year: fields.taxYear ?? null,
      taxable_value: fields.taxableValue ?? null,
      tax_rate: fields.taxRate ?? null,
      amount_due: fields.amountDue ?? null,
      due_date: fields.dueDate ?? null,
      penalty_date: fields.penaltyDate ?? null,
      source_document_id: sourceDocumentId ?? null,
      notes: fields.notes ?? null,
    })
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw error;
  const created = fromRow(data as TaxBillRow);

  // Best-effort — the bill itself is already saved regardless of whether this sync
  // succeeds. See updatePropertyBillSnapshot for why this exists.
  if (fields.dueDate !== undefined || fields.amountDue !== undefined) {
    updatePropertyBillSnapshot(propertyId, {
      paymentDueDate: fields.dueDate,
      taxAmountDue: fields.amountDue,
    }).catch((err) => console.error("Failed to sync tax bill onto property snapshot:", err));
  }

  return created;
}

export async function recordPayment(
  id: string,
  propertyId: string,
  payment: { amountPaid: number; paidAt: string; confirmation?: string },
): Promise<TaxBillRecord> {
  const { data, error } = await supabase
    .from("tax_bills")
    .update({
      amount_paid: payment.amountPaid,
      paid_at: payment.paidAt,
      payment_confirmation: payment.confirmation ?? null,
    })
    .eq("id", id)
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw error;

  // Reuses the existing "I paid this" flag on properties (no live payment
  // integration exists — see markPropertyPaid) so the Deadlines page reflects it.
  markPropertyPaid(propertyId).catch((err) =>
    console.error("Failed to sync paid status onto property:", err),
  );

  return fromRow(data as TaxBillRow);
}

export async function recordRefund(
  id: string,
  refund: { amount?: number; expectedAt?: string; receivedAt?: string },
): Promise<TaxBillRecord> {
  const { data, error } = await supabase
    .from("tax_bills")
    .update({
      refund_amount: refund.amount ?? null,
      refund_expected_at: refund.expectedAt ?? null,
      refund_received_at: refund.receivedAt ?? null,
    })
    .eq("id", id)
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw error;
  return fromRow(data as TaxBillRow);
}

export async function deleteTaxBill(id: string): Promise<void> {
  const { error } = await supabase.from("tax_bills").delete().eq("id", id);
  if (error) throw error;
}

export type SavingsReconciliation = {
  expectedWithoutProtest: number;
  actualSavings: number;
  estimatedSavings: number | null;
  variance: number | null;
  variancePct: number | null;
  flagged: boolean;
};

// Compares the savings estimate computed at intake (property.estimatedSavings — see
// src/lib/savings-estimate.ts) against what the county actually billed. Both sides are
// real numbers: the "expected without protest" baseline uses the same CAD assessed
// value and real per-county effective tax rate (texas-tax-rates.ts) the estimate
// itself was built from, not a guess. Returns null when there isn't enough data yet
// (no bill amount, or no assessed value on file) rather than fabricating a comparison.
export function reconcileSavings(
  bill: TaxBillRecord,
  property: PropertyRecord,
): SavingsReconciliation | null {
  if (property.totalValue == null || bill.amountDue == null) return null;
  const rate = getEffectiveTaxRate(property.cad);
  const expectedWithoutProtest = property.totalValue * rate;
  const actualSavings = expectedWithoutProtest - bill.amountDue;
  const estimatedSavings = property.estimatedSavings;
  const variance = estimatedSavings != null ? actualSavings - estimatedSavings : null;
  const variancePct = variance != null && estimatedSavings ? variance / estimatedSavings : null;
  return {
    expectedWithoutProtest: Math.round(expectedWithoutProtest),
    actualSavings: Math.round(actualSavings),
    estimatedSavings,
    variance: variance != null ? Math.round(variance) : null,
    variancePct,
    flagged: variancePct != null && Math.abs(variancePct) > 0.5,
  };
}
