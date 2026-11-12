import { supabase } from "./supabase";
import type { SignatureValue } from "@/components/SignaturePad";
import type { Tier, BppValueBracket } from "./billing";

// Business Personal Property tax accounts — distinct from public.properties (real
// estate): a business can render BPP for a location without owning the real estate
// itself, so this needs its own entity rather than being a filtered property view.
export type BppAccountRecord = {
  id: string;
  businessName: string;
  accountNumber: string | null;
  cad: string | null;
  locationAddress: string | null;
  createdAt: string;
  taxYear: number | null;
  renderedValue: number | null;
  priorValue: number | null;
  // The county's own assessed value, once they respond to the rendition —
  // null until then. A protest only becomes possible once this disagrees
  // with renderedValue (see bppNeedsProtest in this file).
  noticeValue: number | null;
  renditionDeadline: string | null;
  protestDeadline: string | null;
  renditionSignatureType: "draw" | "type" | "upload" | null;
  renditionSignatureData: string | null;
  renditionSignedAt: string | null;
  // the copy that was actually signed, in the documents bucket
  renditionDocumentPath?: string | null;
  renditionFiledAt: string | null;
  // the rendition's signing packet ID (CPT-XXXX-XXXX) — lib/signing-packets.ts
  signingTrackingId: string | null;
  estimatedSavings: number | null;
  // This account's own, real, independent Stripe subscription — see
  // cancel-bpp-subscription/create-bpp-checkout-session. Never client-
  // writable (see the column-level UPDATE grant in schema.sql); only the
  // stripe-webhook edge function (service role) ever sets these.
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
  planTier: Tier | null;
  valueBracket: BppValueBracket | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
  autoRefile: boolean;
  autoRefileAuthorizedAt: string | null;
  // This year's BPP tax bill, as the owner entered it (Pay Taxes → Add BPP).
  taxAmountDue: number | null;
  taxAmountPaid: number | null;
  paymentDueDate: string | null;
  paidAt: string | null;
};

type BppAccountRow = {
  id: string;
  business_name: string;
  account_number: string | null;
  cad: string | null;
  location_address: string | null;
  created_at: string;
  tax_year: number | null;
  rendered_value: number | null;
  prior_value: number | null;
  notice_value: number | null;
  rendition_deadline: string | null;
  protest_deadline: string | null;
  rendition_signature_type: "draw" | "type" | "upload" | null;
  rendition_signature_data: string | null;
  rendition_signed_at: string | null;
  rendition_document_path?: string | null;
  rendition_filed_at: string | null;
  signing_tracking_id: string | null;
  estimated_savings: number | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  plan_tier: Tier | null;
  value_bracket: BppValueBracket | null;
  cancel_at_period_end: boolean;
  cancel_at: string | null;
  auto_refile: boolean;
  auto_refile_authorized_at: string | null;
  tax_amount_due: number | null;
  tax_amount_paid: number | null;
  payment_due_date: string | null;
  paid_at: string | null;
};

const SELECT_COLUMNS =
  "id, business_name, account_number, cad, location_address, created_at, tax_year, rendered_value, prior_value, notice_value, rendition_deadline, protest_deadline, rendition_signature_type, rendition_signature_data, rendition_signed_at, rendition_document_path, rendition_filed_at, signing_tracking_id, estimated_savings, stripe_subscription_id, subscription_status, plan_tier, value_bracket, cancel_at_period_end, cancel_at, auto_refile, auto_refile_authorized_at, tax_amount_due, tax_amount_paid, payment_due_date, paid_at";

function fromRow(row: BppAccountRow): BppAccountRecord {
  return {
    id: row.id,
    businessName: row.business_name,
    accountNumber: row.account_number,
    cad: row.cad,
    locationAddress: row.location_address,
    createdAt: row.created_at,
    taxYear: row.tax_year,
    renderedValue: row.rendered_value,
    priorValue: row.prior_value,
    noticeValue: row.notice_value,
    renditionDeadline: row.rendition_deadline,
    protestDeadline: row.protest_deadline,
    renditionSignatureType: row.rendition_signature_type,
    renditionSignatureData: row.rendition_signature_data,
    renditionSignedAt: row.rendition_signed_at,
    renditionDocumentPath: row.rendition_document_path ?? null,
    renditionFiledAt: row.rendition_filed_at,
    signingTrackingId: row.signing_tracking_id,
    estimatedSavings: row.estimated_savings,
    stripeSubscriptionId: row.stripe_subscription_id,
    subscriptionStatus: row.subscription_status,
    planTier: row.plan_tier,
    valueBracket: row.value_bracket,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    cancelAt: row.cancel_at,
    autoRefile: row.auto_refile,
    autoRefileAuthorizedAt: row.auto_refile_authorized_at,
    taxAmountDue: row.tax_amount_due == null ? null : Number(row.tax_amount_due),
    taxAmountPaid: row.tax_amount_paid == null ? null : Number(row.tax_amount_paid),
    paymentDueDate: row.payment_due_date,
    paidAt: row.paid_at,
  };
}

export async function listBppAccounts(userId: string): Promise<BppAccountRecord[]> {
  const { data, error } = await supabase
    .from("bpp_accounts")
    .select(SELECT_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as BppAccountRow[]).map(fromRow);
}

export async function getBppAccount(id: string): Promise<BppAccountRecord | null> {
  const { data, error } = await supabase
    .from("bpp_accounts")
    .select(SELECT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? fromRow(data as BppAccountRow) : null;
}

// April 15 statutory rendition deadline (extendable, but this app doesn't
// track a per-account extension) — this year's if it hasn't passed yet,
// otherwise next year's. Also used by tax-calendar.ts as the calendar's
// fallback event date for an account that has no renditionDeadline of its
// own yet (e.g. one added before this existed).
export function nextBppRenditionDeadline(from: Date = new Date()): string {
  const year = from.getFullYear();
  const thisYearDeadline = new Date(Date.UTC(year, 3, 15));
  const deadline =
    from <= thisYearDeadline ? thisYearDeadline : new Date(Date.UTC(year + 1, 3, 15));
  return deadline.toISOString().slice(0, 10);
}

export async function addBppAccount(
  userId: string,
  account: {
    businessName: string;
    accountNumber?: string;
    cad?: string;
    locationAddress?: string;
    taxYear?: number;
    renderedValue?: number;
    priorValue?: number;
    noticeValue?: number;
    protestDeadline?: string;
    estimatedSavings?: number;
    taxAmountDue?: number;
    taxAmountPaid?: number;
    paymentDueDate?: string;
  },
): Promise<BppAccountRecord> {
  const { data, error } = await supabase
    .from("bpp_accounts")
    .insert({
      tax_amount_due: account.taxAmountDue ?? null,
      tax_amount_paid: account.taxAmountPaid ?? null,
      payment_due_date: account.paymentDueDate ?? null,
      user_id: userId,
      business_name: account.businessName,
      account_number: account.accountNumber ?? null,
      cad: account.cad ?? null,
      location_address: account.locationAddress ?? null,
      tax_year: account.taxYear ?? null,
      rendered_value: account.renderedValue ?? null,
      prior_value: account.priorValue ?? null,
      notice_value: account.noticeValue ?? null,
      rendition_deadline: nextBppRenditionDeadline(),
      protest_deadline: account.protestDeadline ?? null,
      estimated_savings: account.estimatedSavings ?? null,
    })
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw error;
  return fromRow(data as BppAccountRow);
}

export async function updateBppAccount(
  id: string,
  patch: {
    businessName?: string;
    accountNumber?: string;
    cad?: string;
    locationAddress?: string;
    taxYear?: number;
    renderedValue?: number;
    priorValue?: number;
    noticeValue?: number;
    protestDeadline?: string;
    estimatedSavings?: number;
  },
): Promise<BppAccountRecord> {
  const update: Record<string, unknown> = {};
  if (patch.businessName !== undefined) update.business_name = patch.businessName;
  if (patch.accountNumber !== undefined) update.account_number = patch.accountNumber;
  if (patch.cad !== undefined) update.cad = patch.cad;
  if (patch.locationAddress !== undefined) update.location_address = patch.locationAddress;
  if (patch.taxYear !== undefined) update.tax_year = patch.taxYear;
  if (patch.renderedValue !== undefined) update.rendered_value = patch.renderedValue;
  if (patch.priorValue !== undefined) update.prior_value = patch.priorValue;
  if (patch.noticeValue !== undefined) update.notice_value = patch.noticeValue;
  if (patch.protestDeadline !== undefined) update.protest_deadline = patch.protestDeadline;
  if (patch.estimatedSavings !== undefined) update.estimated_savings = patch.estimatedSavings;
  const { data, error } = await supabase
    .from("bpp_accounts")
    .update(update)
    .eq("id", id)
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw error;
  return fromRow(data as BppAccountRow);
}

// Signs Form 50-144 (see PdfFormEditor / protest-documents.ts) — a rendition
// is filed with the county directly by the owner (there's no ARB process for
// it), so this just records the sign-off; markRenditionFiled below records
// the county actually has it.
// Puts the signed copy in the documents bucket under the owner's folder
// (BPP accounts aren't properties, so it's not a Documents row).
async function storeSignedCopy(id: string, file: File): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in again.");
  const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const path = `${user.id}/bpp/${id}/${Date.now()}-${safe}`;
  const { error } = await supabase.storage
    .from("documents")
    .upload(path, file, { contentType: file.type || "application/octet-stream" });
  if (error) throw error;
  return path;
}

export async function signRendition(
  id: string,
  signature: SignatureValue,
  // the ID printed on the signed PDF (lib/signing-packets.ts)
  trackingId?: string,
  // the signed PDF itself, kept so it can be downloaded again
  signedPdf?: File,
): Promise<BppAccountRecord> {
  const path = signedPdf ? await storeSignedCopy(id, signedPdf).catch(() => null) : null;
  const { data, error } = await supabase
    .from("bpp_accounts")
    .update({
      rendition_signature_type: signature.type,
      rendition_signature_data: signature.data,
      rendition_signed_at: new Date().toISOString(),
      ...(path ? { rendition_document_path: path } : {}),
      ...(trackingId ? { signing_tracking_id: trackingId } : {}),
    })
    .eq("id", id)
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw error;
  return fromRow(data as BppAccountRow);
}

// Signed on paper: the owner printed the rendition, signed it by hand and
// uploads the scan. Counts as signed (signature_type "upload").
export async function recordRenditionPaperSigned(
  id: string,
  scan: File,
): Promise<BppAccountRecord> {
  const path = await storeSignedCopy(id, scan);
  const { data, error } = await supabase
    .from("bpp_accounts")
    .update({
      rendition_signature_type: "upload",
      rendition_signature_data: null,
      rendition_signed_at: new Date().toISOString(),
      rendition_document_path: path,
    })
    .eq("id", id)
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw error;
  return fromRow(data as BppAccountRow);
}

// A short-lived link to the signed copy.
export async function signedRenditionUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from("documents").createSignedUrl(path, 300);
  if (error) throw error;
  return data.signedUrl;
}

export async function markRenditionFiled(id: string): Promise<BppAccountRecord> {
  const { data, error } = await supabase
    .from("bpp_accounts")
    .update({ rendition_filed_at: new Date().toISOString() })
    .eq("id", id)
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw error;
  return fromRow(data as BppAccountRow);
}

// Opt-in year-over-year auto-refile — see the matching setAutoRefile() in
// properties.ts for the full reasoning (same consent-timestamp convention).
export async function setBppAutoRefile(id: string, enabled: boolean): Promise<BppAccountRecord> {
  const { data, error } = await supabase
    .from("bpp_accounts")
    .update({
      auto_refile: enabled,
      auto_refile_authorized_at: enabled ? new Date().toISOString() : null,
    })
    .eq("id", id)
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw error;
  return fromRow(data as BppAccountRow);
}

export async function deleteBppAccount(id: string): Promise<void> {
  const { error } = await supabase.from("bpp_accounts").delete().eq("id", id);
  if (error) throw error;
}

// A protest only makes sense once the county's own notice_value actually
// disagrees with what was rendered — otherwise there's nothing to contest
// yet (still waiting on the county's response to the rendition).
export function bppNeedsProtest(
  account: Pick<BppAccountRecord, "renderedValue" | "noticeValue">,
): boolean {
  return (
    account.noticeValue != null &&
    account.renderedValue != null &&
    account.noticeValue !== account.renderedValue
  );
}

// Pay Taxes: the owner's own record of this year's BPP tax bill. `paid`
// marks it paid today (or clears that); amounts/dates left undefined are kept.
export async function updateBppTaxBill(
  id: string,
  patch: {
    taxAmountDue?: number | null;
    taxAmountPaid?: number | null;
    paymentDueDate?: string | null;
    paid?: boolean;
  },
): Promise<BppAccountRecord> {
  const update: Record<string, unknown> = {};
  if (patch.taxAmountDue !== undefined) update.tax_amount_due = patch.taxAmountDue;
  if (patch.taxAmountPaid !== undefined) update.tax_amount_paid = patch.taxAmountPaid;
  if (patch.paymentDueDate !== undefined) update.payment_due_date = patch.paymentDueDate;
  if (patch.paid !== undefined) update.paid_at = patch.paid ? new Date().toISOString() : null;
  const { data, error } = await supabase
    .from("bpp_accounts")
    .update(update)
    .eq("id", id)
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw error;
  return fromRow(data as BppAccountRow);
}
