import { supabase } from "./supabase";
import { countyFromCad } from "./tax-rates-official";
import { lookupCadDirectory } from "./cad-directory";
import { classifyPropertyCategory, getEffectiveTaxRate } from "./texas-tax-rates";
import { CURRENT_TAX_YEAR } from "./tax-calendar";
import type { PropertyRecord } from "./properties";
import type { TaxBillRecord } from "./tax-bills";
import type { ProtestRecord } from "./protests";

// The Pay Taxes tab: per-property tax obligations, deadlines, county payment
// links and county-specific payment plans. County rules live in
// county_payment_plans / county_tax_settings (supabase/pt/pay-taxes.sql, admin-
// editable) — never assumed to be the same everywhere. Everything here is
// pure except the load/save helpers at the bottom.
//
// Official vs estimate: a tax amount from a tax statement (tax_bills.amount_due)
// is official; without one the amount is an estimate (value × the county's
// effective rate) and is always labelled as such.
// Paid vs verified: a payment the owner reports is "reported"; only a county
// source sets status_source = 'county' + verified_at. Clicking Pay Taxes never
// marks anything paid.

// ── County rules ────────────────────────────────────────────────────────────

export type PlanKind =
  "half" | "quarter" | "monthly" | "prepay" | "discount" | "disaster" | "other";
export type PlanPropertyType = "commercial" | "residential" | "bpp";

export type PlanScheduleStep = {
  label: string;
  pct: number;
  month: number; // 1-12
  day: number;
  yearOffset: number; // relative to the tax year
};

export type PaymentPlan = {
  county: string; // "Bexar", or "*" for statewide
  planKey: string;
  name: string;
  kind: PlanKind;
  propertyTypes: PlanPropertyType[]; // empty = any
  requirement: string | null;
  schedule: PlanScheduleStep[];
  enrollmentNote: string | null;
  status: "confirmed" | "to_confirm";
  sourceUrl: string | null;
  active: boolean;
};

export type CountyTaxSettings = {
  county: string;
  paymentPortalUrl: string | null;
  accountUrlTemplate: string | null;
  accountPattern: string | null;
  delinquencyMonthDay: string; // "02-01"
  notes: string | null;
  sourceUrl: string | null;
  updatedAt: string | null;
  // What the county tax office's own site says about the half-payment (split)
  // option — see scripts/build-tx-payment-plans.mjs. Optional so hand-built
  // settings (tests, the admin form) needn't carry it.
  halfPayment?: "offered" | "not_offered" | "unknown";
  halfPaymentQuote?: string | null;
  halfPaymentUrl?: string | null;
  otherOptions?: Record<string, { url: string; quote: string }>;
  rulesCheckedAt?: string | null;
};

export const REQUIREMENT_LABEL: Record<string, string> = {
  over65_disabled_dv_homestead:
    "Only for a residence homestead with an over-65, disabled or disabled-veteran exemption",
  disaster_damage: "Only for property damaged in a declared disaster area",
};

export const TO_CONFIRM = "Eligibility to be confirmed with County Tax Office";

// "bexar" / "Fort Bend Central Appraisal District" → "Bexar" / "Fort Bend"
export function countyName(cad: string | null | undefined): string | null {
  const c = countyFromCad(cad);
  if (!c) return null;
  return c.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function planPropertyType(propertyType: string | null | undefined): PlanPropertyType | null {
  if (propertyType && /business personal property|\bbpp\b/i.test(propertyType)) return "bpp";
  const cat = classifyPropertyCategory(propertyType);
  return cat === "unknown" ? null : cat;
}

// ── Dates ───────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

// Tax Code §1.06: a deadline on a Saturday, Sunday or legal holiday moves to
// the next business day (weekends only here — holidays vary).
export function nextBusinessDay(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (Date.parse(`${toIso}T12:00:00Z`) - Date.parse(`${fromIso}T12:00:00Z`)) / 86_400_000,
  );
}

// The day taxes become delinquent (Tax Code §31.02 — February 1 of the year
// after the tax year, unless the county's settings say otherwise).
export function delinquencyDate(taxYear: number, settings?: CountyTaxSettings | null): string {
  const [m, d] = (settings?.delinquencyMonthDay ?? "02-01").split("-").map(Number);
  return iso(taxYear + 1, m || 2, d || 1);
}

// The last day to pay without penalty: the day before delinquency, moved to
// the next business day when that falls on a weekend.
export function standardDueDate(taxYear: number, settings?: CountyTaxSettings | null): string {
  const delinquent = new Date(`${delinquencyDate(taxYear, settings)}T12:00:00Z`);
  delinquent.setUTCDate(delinquent.getUTCDate() - 1);
  return nextBusinessDay(delinquent.toISOString().slice(0, 10));
}

// ── Eligibility ─────────────────────────────────────────────────────────────

export type Installment = {
  label: string;
  dueDate: string;
  amount: number | null;
  paidAt?: string | null;
  amountPaid?: number | null;
};

export type PlanEligibility = {
  plan: PaymentPlan;
  status: "eligible" | "not_eligible" | "to_confirm";
  reason: string;
  installments: Installment[];
};

export function planInstallments(
  plan: PaymentPlan,
  taxYear: number,
  baseTax: number | null,
): Installment[] {
  let allocated = 0;
  return plan.schedule.map((s, i) => {
    let amount: number | null = null;
    if (baseTax != null) {
      // the last installment takes the rounding remainder
      amount =
        i === plan.schedule.length - 1
          ? Math.round((baseTax - allocated) * 100) / 100
          : Math.round(baseTax * s.pct) / 100;
      allocated += amount;
    }
    return {
      label: s.label,
      dueDate: nextBusinessDay(iso(taxYear + s.yearOffset, s.month, s.day)),
      amount,
    };
  });
}

export function plansForCounty(plans: PaymentPlan[], county: string | null): PaymentPlan[] {
  const c = county?.toLowerCase();
  return plans.filter(
    (p) => p.active && (p.county === "*" || (!!c && p.county.toLowerCase() === c)),
  );
}

// Whether a property can use each plan its county offers. Never marks a plan
// eligible on a condition CorvusPT can't check (an exemption, disaster damage,
// an unknown property type) — that's "to be confirmed with the county".
export function planEligibility(
  property: Pick<PropertyRecord, "cad" | "propertyType">,
  plans: PaymentPlan[],
  taxYear: number,
  baseTax: number | null,
): PlanEligibility[] {
  const type = planPropertyType(property.propertyType);
  const order = { eligible: 0, to_confirm: 1, not_eligible: 2 };
  const results: PlanEligibility[] = plansForCounty(plans, countyName(property.cad)).map((plan) => {
    const installments = planInstallments(plan, taxYear, baseTax);
    const restricted = plan.propertyTypes.length > 0;
    if (restricted && type && !plan.propertyTypes.includes(type)) {
      return {
        plan,
        status: "not_eligible" as const,
        reason:
          plan.requirement && REQUIREMENT_LABEL[plan.requirement]
            ? REQUIREMENT_LABEL[plan.requirement]
            : `Only for ${plan.propertyTypes.join(" / ")} property`,
        installments,
      };
    }
    if (plan.requirement || plan.status === "to_confirm" || (restricted && !type)) {
      const why = plan.requirement ? REQUIREMENT_LABEL[plan.requirement] : null;
      return {
        plan,
        status: "to_confirm" as const,
        reason: why ? `${why} — ${TO_CONFIRM.toLowerCase()}` : TO_CONFIRM,
        installments,
      };
    }
    return {
      plan,
      status: "eligible" as const,
      reason: plan.enrollmentNote ?? "Offered by this county to this kind of property",
      installments,
    };
  });
  // what the owner can use first
  return results.sort((a, b) => order[a.status] - order[b.status]);
}

// ── Payment links ───────────────────────────────────────────────────────────

export type PaymentLink = {
  url: string;
  // "account" = straight to this property's tax account; "portal" = the
  // county's payment page (search the account there); "website" = the tax
  // office's site from the Comptroller's directory
  kind: "account" | "portal" | "website";
  label: string;
};

export function paymentLink(
  property: Pick<PropertyRecord, "cad" | "accountNumber">,
  settings: CountyTaxSettings | null,
): PaymentLink | null {
  const account = property.accountNumber?.trim();
  if (settings?.accountUrlTemplate && account) {
    let fits = true;
    try {
      fits = !settings.accountPattern || new RegExp(settings.accountPattern).test(account);
    } catch {
      fits = false;
    }
    if (fits)
      return {
        url: settings.accountUrlTemplate.replace("{account}", encodeURIComponent(account)),
        kind: "account",
        label: "Your tax account",
      };
  }
  if (settings?.paymentPortalUrl)
    return { url: settings.paymentPortalUrl, kind: "portal", label: "County tax payment portal" };
  const website = lookupCadDirectory(property.cad)?.taxOffice?.website;
  if (website)
    return {
      url: website.startsWith("http") ? website : `https://${website}`,
      kind: "website",
      label: "County Tax Assessor-Collector",
    };
  return null;
}

// ── Status ──────────────────────────────────────────────────────────────────

export type PayStatus = "unpaid" | "initiated" | "partial" | "paid" | "overdue" | "verifying";

export const PAY_STATUS_LABEL: Record<PayStatus, string> = {
  unpaid: "Unpaid",
  initiated: "Payment Initiated",
  partial: "Partially Paid",
  paid: "Paid",
  overdue: "Overdue",
  verifying: "Under Verification",
};

export type PayTaxBill = TaxBillRecord & {
  status?: PayStatus | null;
  statusSource?: "user" | "county";
  verifiedAt?: string | null;
  planKey?: string | null;
  installments?: Installment[];
  noticeIssuedAt?: string | null;
  authorityBreakdown?: { name: string; rate?: number | null; amount?: number | null }[];
  billKind?: "statement" | "revised";
  source?: string | null;
  sourceUrl?: string | null;
  retrievedAt?: string | null;
  receiptDocumentId?: string | null;
  updatedAt?: string | null;
};

// What a bill's status is today. A stored status is the owner's own report;
// "paid" also follows from a recorded payment covering the amount. Anything
// unpaid on or after the delinquency date is overdue — and so is an unpaid
// installment past its own due date.
export function billStatus(
  bill: PayTaxBill | null,
  todayIso: string,
  delinquency: string | null,
): PayStatus {
  if (!bill) return delinquency && todayIso >= delinquency ? "overdue" : "unpaid";
  const paid =
    bill.amountPaid ??
    (bill.installments ?? []).reduce(
      (s, i) => s + (i.paidAt ? (i.amountPaid ?? i.amount ?? 0) : 0),
      0,
    );
  const due = bill.amountDue;
  if (bill.status === "paid" || (bill.paidAt && (due == null || paid >= due - 0.005)))
    return "paid";
  const lateInstallment = (bill.installments ?? []).some((i) => !i.paidAt && i.dueDate < todayIso);
  const pastDelinquency = !!delinquency && todayIso >= delinquency;
  if ((pastDelinquency && !bill.planKey) || lateInstallment) return "overdue";
  if (bill.status === "verifying" || bill.status === "initiated") return bill.status;
  if (bill.status === "partial" || paid > 0) return "partial";
  return "unpaid";
}

// ── Penalties (Tax Code §33.01) ─────────────────────────────────────────────

// Penalty + interest on a delinquent amount in its `monthsLate`-th month
// (1 = February): penalty 6% in February, +1% a month through June, 12% from
// July 1; interest 1% a month. Collection-attorney fees (up to 20%, from
// July 1) are county-specific and not included.
export function penaltyAndInterestPct(monthsLate: number): number {
  if (monthsLate <= 0) return 0;
  const penalty = monthsLate >= 6 ? 12 : 5 + monthsLate;
  const interest = monthsLate;
  return penalty + interest;
}

// ── Dashboard rows ──────────────────────────────────────────────────────────

export type PayTaxesRow = {
  property: PropertyRecord;
  county: string | null;
  taxYear: number;
  bill: PayTaxBill | null;
  history: PayTaxBill[]; // newest first, up to 5 tax years
  totalTax: number | null;
  totalTaxIsEstimate: boolean;
  amountPaid: number;
  outstanding: number | null;
  dueDate: string;
  dueDateIsStandard: boolean; // no bill on file — the statutory deadline
  delinquency: string;
  status: PayStatus;
  verified: boolean;
  noticeAvailable: boolean;
  noticeIsNew: boolean;
  plans: PlanEligibility[];
  halfPay: PlanEligibility | null;
  enrolledPlan: PlanEligibility | null;
  nextInstallment: Installment | null;
  link: PaymentLink | null;
  settings: CountyTaxSettings | null;
  protest: ProtestRecord | null;
  flags: {
    upcoming: boolean;
    unpaid: boolean;
    overdue: boolean;
    newNotice: boolean;
    halfPayEligible: boolean;
    enrolled: boolean;
  };
};

const UPCOMING_DAYS = 30;
const NEW_NOTICE_DAYS = 30;

export function buildPayTaxesRow(input: {
  property: PropertyRecord;
  bills: PayTaxBill[];
  plans: PaymentPlan[];
  settings: CountyTaxSettings[];
  protests: ProtestRecord[];
  todayIso: string;
  taxYear?: number;
}): PayTaxesRow {
  const { property, todayIso } = input;
  const county = countyName(property.cad);
  const settings =
    input.settings.find((s) => s.county.toLowerCase() === county?.toLowerCase()) ?? null;
  const history = input.bills
    .filter((b) => b.propertyId === property.id)
    .sort(
      (a, b) =>
        (b.taxYear ?? 0) - (a.taxYear ?? 0) ||
        // a revised statement replaces the original for the same year
        (b.billKind === "revised" ? 1 : 0) - (a.billKind === "revised" ? 1 : 0) ||
        b.createdAt.localeCompare(a.createdAt),
    );
  const byYear = new Map<number, PayTaxBill>();
  for (const b of history)
    if (b.taxYear != null && !byYear.has(b.taxYear)) byYear.set(b.taxYear, b);
  const taxYear = input.taxYear ?? property.taxYear ?? CURRENT_TAX_YEAR;
  const bill = byYear.get(taxYear) ?? (history[0]?.taxYear == null ? (history[0] ?? null) : null);

  const official = bill?.amountDue ?? null;
  const snapshot = !bill && property.taxAmountDue != null ? property.taxAmountDue : null;
  const estimate =
    official == null && snapshot == null && property.totalValue
      ? Math.round(property.totalValue * getEffectiveTaxRate(property.cad))
      : null;
  const totalTax = official ?? snapshot ?? estimate;
  const amountPaid =
    bill?.amountPaid ??
    (bill?.installments ?? []).reduce(
      (s, i) => s + (i.paidAt ? (i.amountPaid ?? i.amount ?? 0) : 0),
      0,
    );

  const delinquency = bill?.penaltyDate ?? delinquencyDate(taxYear, settings);
  const standardDue = standardDueDate(taxYear, settings);
  const dueDate = bill?.dueDate ?? (!bill ? property.paymentDueDate : null) ?? standardDue;
  const status = billStatus(bill, todayIso, delinquency);

  const plans = planEligibility(property, input.plans, taxYear, totalTax);
  const halfPay = plans.find((p) => p.plan.kind === "half") ?? null;
  const enrolledPlan = bill?.planKey
    ? (plans.find((p) => p.plan.planKey === bill.planKey) ?? null)
    : null;
  const installments: Installment[] = enrolledPlan
    ? enrolledPlan.installments.map((i) => {
        const saved = bill?.installments?.find((s) => s.label === i.label);
        return { ...i, ...(saved ?? {}) };
      })
    : [];
  const nextInstallment = installments.find((i) => !i.paidAt) ?? null;
  const nextDue = nextInstallment?.dueDate ?? dueDate;

  const noticeDate =
    bill?.noticeIssuedAt ?? (bill?.sourceDocumentId ? bill.createdAt.slice(0, 10) : null);
  const noticeAvailable =
    !!bill && (!!bill.sourceDocumentId || !!bill.sourceUrl || !!bill.noticeIssuedAt);
  const noticeIsNew = !!noticeDate && daysBetween(noticeDate, todayIso) <= NEW_NOTICE_DAYS;

  const protest =
    input.protests
      .filter((p) => p.propertyId === property.id)
      .sort((a, b) => (b.requestedAt ?? "").localeCompare(a.requestedAt ?? ""))[0] ?? null;

  const open = status !== "paid";
  const daysToDue = daysBetween(todayIso, nextDue);
  return {
    property,
    county,
    taxYear,
    bill,
    history: [...byYear.values()].slice(0, 5),
    totalTax,
    totalTaxIsEstimate: official == null && snapshot == null,
    amountPaid,
    outstanding:
      totalTax != null ? Math.max(0, Math.round((totalTax - amountPaid) * 100) / 100) : null,
    dueDate: nextDue,
    dueDateIsStandard: !bill?.dueDate && !(!bill && property.paymentDueDate) && !nextInstallment,
    delinquency,
    status,
    verified: bill?.statusSource === "county" && !!bill.verifiedAt,
    noticeAvailable,
    noticeIsNew,
    plans,
    halfPay,
    enrolledPlan: enrolledPlan ? { ...enrolledPlan, installments } : null,
    nextInstallment,
    link: paymentLink(property, settings),
    settings,
    protest,
    flags: {
      upcoming: open && daysToDue >= 0 && daysToDue <= UPCOMING_DAYS,
      unpaid: open,
      overdue: status === "overdue",
      newNotice: noticeIsNew,
      halfPayEligible: halfPay?.status === "eligible",
      enrolled: !!enrolledPlan,
    },
  };
}

// ── Portfolio ───────────────────────────────────────────────────────────────

export type HalfPayItem = {
  row: PayTaxesRow;
  firstHalf: Installment;
  // the first half has already been paid
  paid: boolean;
};

export type PortfolioSummary = {
  properties: number;
  totalTax: number;
  totalPaid: number;
  outstanding: number;
  estimatedCount: number;
  upcoming: number;
  overdue: number;
  newNotices: number;
  halfPayEligible: number;
  enrolled: number;
  // every property that can use a half-payment plan this tax year, with its
  // first-half amount and date — the November 30 total
  halfPay: { items: HalfPayItem[]; total: number; dueDates: string[] };
};

export function portfolioSummary(rows: PayTaxesRow[]): PortfolioSummary {
  const items: HalfPayItem[] = [];
  for (const row of rows) {
    if (row.halfPay?.status !== "eligible") continue;
    const enrolledFirst =
      row.enrolledPlan?.plan.kind === "half" ? row.enrolledPlan.installments[0] : null;
    const firstHalf = enrolledFirst ?? row.halfPay.installments[0];
    if (!firstHalf) continue;
    items.push({ row, firstHalf, paid: !!enrolledFirst?.paidAt || row.status === "paid" });
  }
  const sum = (xs: (number | null)[]) =>
    Math.round(xs.reduce<number>((s, x) => s + (x ?? 0), 0) * 100) / 100;
  return {
    properties: rows.length,
    totalTax: sum(rows.map((r) => r.totalTax)),
    totalPaid: sum(rows.map((r) => r.amountPaid)),
    outstanding: sum(rows.map((r) => (r.status === "paid" ? 0 : r.outstanding))),
    estimatedCount: rows.filter((r) => r.totalTaxIsEstimate && r.totalTax != null).length,
    upcoming: rows.filter((r) => r.flags.upcoming).length,
    overdue: rows.filter((r) => r.flags.overdue).length,
    newNotices: rows.filter((r) => r.flags.newNotice).length,
    halfPayEligible: rows.filter((r) => r.flags.halfPayEligible).length,
    enrolled: rows.filter((r) => r.flags.enrolled).length,
    halfPay: {
      items,
      total: sum(items.filter((i) => !i.paid).map((i) => i.firstHalf.amount)),
      dueDates: [...new Set(items.map((i) => i.firstHalf.dueDate))].sort(),
    },
  };
}

// ── Load / save ─────────────────────────────────────────────────────────────

type PlanRow = {
  county: string;
  plan_key: string;
  name: string;
  kind: PlanKind;
  property_types: string[] | null;
  requirement: string | null;
  schedule: PlanScheduleStep[] | null;
  enrollment_note: string | null;
  status: "confirmed" | "to_confirm";
  source_url: string | null;
  active: boolean;
};

const planFromRow = (r: PlanRow): PaymentPlan => ({
  county: r.county,
  planKey: r.plan_key,
  name: r.name,
  kind: r.kind,
  propertyTypes: (r.property_types ?? []) as PlanPropertyType[],
  requirement: r.requirement,
  schedule: r.schedule ?? [],
  enrollmentNote: r.enrollment_note,
  status: r.status,
  sourceUrl: r.source_url,
  active: r.active,
});

export async function listPaymentPlans(): Promise<PaymentPlan[]> {
  const { data, error } = await supabase
    .from("county_payment_plans")
    .select(
      "county, plan_key, name, kind, property_types, requirement, schedule, enrollment_note, status, source_url, active",
    )
    .order("county");
  if (error) throw error;
  return ((data ?? []) as PlanRow[]).map(planFromRow);
}

export async function listCountyTaxSettings(): Promise<CountyTaxSettings[]> {
  const { data, error } = await supabase
    .from("county_tax_settings")
    .select(
      "county, payment_portal_url, account_url_template, account_pattern, delinquency_month_day, notes, source_url, updated_at, half_payment, half_payment_quote, half_payment_url, other_options, rules_checked_at",
    )
    .order("county");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    county: r.county as string,
    paymentPortalUrl: r.payment_portal_url as string | null,
    accountUrlTemplate: r.account_url_template as string | null,
    accountPattern: r.account_pattern as string | null,
    delinquencyMonthDay: (r.delinquency_month_day as string) ?? "02-01",
    notes: r.notes as string | null,
    sourceUrl: r.source_url as string | null,
    updatedAt: r.updated_at as string | null,
    halfPayment: (r.half_payment as CountyTaxSettings["halfPayment"]) ?? "unknown",
    halfPaymentQuote: r.half_payment_quote as string | null,
    halfPaymentUrl: r.half_payment_url as string | null,
    otherOptions: (r.other_options as CountyTaxSettings["otherOptions"]) ?? {},
    rulesCheckedAt: r.rules_checked_at as string | null,
  }));
}

export async function savePaymentPlan(plan: PaymentPlan, userId: string): Promise<void> {
  const { error } = await supabase.from("county_payment_plans").upsert(
    {
      county: plan.county.trim(),
      plan_key: plan.planKey.trim(),
      name: plan.name.trim(),
      kind: plan.kind,
      property_types: plan.propertyTypes,
      requirement: plan.requirement || null,
      schedule: plan.schedule,
      enrollment_note: plan.enrollmentNote || null,
      status: plan.status,
      source_url: plan.sourceUrl || null,
      active: plan.active,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    },
    { onConflict: "county,plan_key" },
  );
  if (error) throw error;
}

export async function saveCountyTaxSettings(s: CountyTaxSettings, userId: string): Promise<void> {
  const { error } = await supabase.from("county_tax_settings").upsert({
    county: s.county.trim(),
    payment_portal_url: s.paymentPortalUrl || null,
    account_url_template: s.accountUrlTemplate || null,
    account_pattern: s.accountPattern || null,
    delinquency_month_day: s.delinquencyMonthDay || "02-01",
    notes: s.notes || null,
    source_url: s.sourceUrl || null,
    ...(s.halfPayment
      ? {
          half_payment: s.halfPayment,
          half_payment_quote: s.halfPaymentQuote || null,
          half_payment_url: s.halfPaymentUrl || null,
        }
      : {}),
    updated_at: new Date().toISOString(),
    updated_by: userId,
  });
  if (error) throw error;
}

type PayBillRow = Record<string, unknown>;

const payBillFromRow = (r: PayBillRow): PayTaxBill => ({
  id: r.id as string,
  propertyId: r.property_id as string,
  taxYear: r.tax_year as number | null,
  taxableValue: r.taxable_value as number | null,
  taxRate: r.tax_rate as number | null,
  amountDue: r.amount_due as number | null,
  dueDate: r.due_date as string | null,
  penaltyDate: r.penalty_date as string | null,
  sourceDocumentId: r.source_document_id as string | null,
  amountPaid: r.amount_paid as number | null,
  paidAt: r.paid_at as string | null,
  paymentConfirmation: r.payment_confirmation as string | null,
  refundAmount: r.refund_amount as number | null,
  refundExpectedAt: r.refund_expected_at as string | null,
  refundReceivedAt: r.refund_received_at as string | null,
  notes: r.notes as string | null,
  createdAt: r.created_at as string,
  status: (r.status as PayStatus | null) ?? null,
  statusSource: (r.status_source as "user" | "county") ?? "user",
  verifiedAt: r.verified_at as string | null,
  planKey: r.plan_key as string | null,
  installments: (r.installments as Installment[] | null) ?? [],
  noticeIssuedAt: r.notice_issued_at as string | null,
  authorityBreakdown: (r.authority_breakdown as PayTaxBill["authorityBreakdown"]) ?? [],
  billKind: (r.bill_kind as "statement" | "revised") ?? "statement",
  source: r.source as string | null,
  sourceUrl: r.source_url as string | null,
  retrievedAt: r.retrieved_at as string | null,
  receiptDocumentId: r.receipt_document_id as string | null,
  updatedAt: r.updated_at as string | null,
});

export async function listPayTaxBills(userId: string): Promise<PayTaxBill[]> {
  const { data, error } = await supabase
    .from("tax_bills")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as PayBillRow[]).map(payBillFromRow);
}

// The owner's own payment report for a bill — never sets status_source /
// verified_at (that's only a county source).
export async function reportPayment(
  billId: string,
  report: {
    status: PayStatus;
    amountPaid?: number | null;
    paidAt?: string | null;
    confirmation?: string | null;
    receiptDocumentId?: string | null;
  },
): Promise<void> {
  const update: Record<string, unknown> = {
    status: report.status,
    updated_at: new Date().toISOString(),
  };
  if (report.amountPaid !== undefined) update.amount_paid = report.amountPaid;
  if (report.paidAt !== undefined) update.paid_at = report.paidAt;
  if (report.confirmation !== undefined) update.payment_confirmation = report.confirmation;
  if (report.receiptDocumentId !== undefined) update.receipt_document_id = report.receiptDocumentId;
  const { error } = await supabase.from("tax_bills").update(update).eq("id", billId);
  if (error) throw error;
}

// Choosing a plan stores its installment schedule on the bill, so each
// installment is tracked (and reminded about) on its own.
export async function enrollInPlan(billId: string, plan: PlanEligibility | null): Promise<void> {
  const { error } = await supabase
    .from("tax_bills")
    .update({
      plan_key: plan?.plan.planKey ?? null,
      installments: plan
        ? plan.installments.map((i) => ({ ...i, paidAt: null, amountPaid: null }))
        : [],
      updated_at: new Date().toISOString(),
    })
    .eq("id", billId);
  if (error) throw error;
}

export async function saveInstallments(billId: string, installments: Installment[]): Promise<void> {
  const paidAll = installments.length > 0 && installments.every((i) => i.paidAt);
  const paidAny = installments.some((i) => i.paidAt);
  const amountPaid = installments.reduce(
    (s, i) => s + (i.paidAt ? (i.amountPaid ?? i.amount ?? 0) : 0),
    0,
  );
  const { error } = await supabase
    .from("tax_bills")
    .update({
      installments,
      amount_paid: paidAny ? Math.round(amountPaid * 100) / 100 : null,
      status: paidAll ? "paid" : paidAny ? "partial" : "unpaid",
      paid_at: paidAll ? installments[installments.length - 1].paidAt : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", billId);
  if (error) throw error;
}
