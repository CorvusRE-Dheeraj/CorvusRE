// The arbitration workflow's saved state and derivations (protests.arbitration,
// one jsonb). Deterministic: application status, costs and refund rules,
// deadlines, evidence checklist categories, award comparison — computed from
// what's on the case plus the Comptroller's published schedule
// (escalation-eval.ts bindingArbitrationFees). Nothing advances to "submitted",
// "deposit paid" or "confirmed" without the owner recording proof.
import type { PropertyRecord } from "./properties";
import type { ProtestRecord } from "./protests";
import type { DocumentRecord } from "./documents";
import { bindingArbitrationFees } from "./escalation-eval";
import { getEffectiveTaxRate } from "./texas-tax-rates";
import { addDaysIso, daysUntilIso, localDay } from "./local-day";

export const PTAS_URL = "https://www.texas.gov/living-in-texas/property-tax-arbitration/";
export const ARBITRATION_PAGE_URL = "https://comptroller.texas.gov/taxes/property-tax/arbitration/";
export const LBA_PAGE_URL =
  "https://comptroller.texas.gov/taxes/property-tax/arbitration/limited-binding.php";
export const AP219_URL = "https://comptroller.texas.gov/forms/ap-219.pdf";
export const AP241_URL = "https://comptroller.texas.gov/forms/ap-241.pdf";
export const WITHDRAWAL_FORM_URL = "https://comptroller.texas.gov/forms/50-830.pdf";
export const AGENT_FORM_URL = "https://comptroller.texas.gov/forms/50-791.pdf";

// ── Saved state ─────────────────────────────────────────────────────────
export type EvidenceCategory =
  | "comparables"
  | "appraisal"
  | "income"
  | "photos"
  | "condition"
  | "repairs"
  | "valuation"
  | "arb_order"
  | "other";

export type ArbEvidenceItem = {
  documentId: string;
  fileName: string;
  category: EvidenceCategory;
  // "reused" = from the ARB packet (the original stays untouched); "added" =
  // uploaded for arbitration
  source: "reused" | "added";
  addedAt: string;
};

export type ArbitrationData = {
  kind?: "regular" | "limited";
  orderReceivedDate?: string | null;
  assessment?: { text: string; at: string } | null;
  application?: {
    fields: Record<string, string>;
    startedAt: string;
    readyAt?: string | null;
  } | null;
  // external filing — each needs proof
  submittedAt?: string | null;
  submissionReference?: string | null;
  submissionDocumentId?: string | null;
  depositAmount?: number | null;
  depositPaidAt?: string | null;
  depositMethod?: string | null;
  depositReceiptDocumentId?: string | null;
  confirmedAt?: string | null;
  confirmationNumber?: string | null;
  confirmationDocumentId?: string | null;
  evidence?: {
    copiedAt: string;
    items: ArbEvidenceItem[];
    review?: {
      relevant: string[];
      useful: string[];
      gaps: string[];
      required: string[];
      at: string;
    } | null;
  } | null;
  settlement?: {
    startDate?: string | null;
    endDate?: string | null;
    status: "negotiating" | "offer_received" | "settled" | "not_settled";
    offers: {
      id: string;
      date: string;
      value: number | null;
      documentId: string | null;
      decision: "pending" | "accepted" | "rejected";
      note?: string;
    }[];
    withdrawnAt?: string | null;
    withdrawalDocumentId?: string | null;
  } | null;
  arbitrator?: {
    name?: string;
    email?: string;
    phone?: string;
    appointedAt?: string | null;
    hearingDate?: string | null;
    hearingTime?: string | null;
    location?: string | null;
    meetingLink?: string | null;
    instructions?: string | null;
    noticeDocumentId?: string | null;
  } | null;
  award?: { value: number; date: string | null; documentId: string | null; at: string } | null;
  post?: {
    rollCorrectedAt?: string | null;
    cadRecordDocumentId?: string | null;
    taxStatementDocumentId?: string | null;
    taxAdjustedAt?: string | null;
    refund?: {
      expected: number | null;
      status: "not_applicable" | "pending" | "received";
      amount?: number | null;
      receivedAt?: string | null;
    } | null;
  } | null;
};

// ── Application status ──────────────────────────────────────────────────
export const APP_STAGES = [
  { id: "not_started", label: "Not Started" },
  { id: "in_progress", label: "In Progress" },
  { id: "ready", label: "Ready for Filing" },
  { id: "submitted", label: "Submitted to Comptroller" },
  { id: "deposit_pending", label: "Deposit Payment Pending" },
  { id: "deposit_paid", label: "Deposit Paid" },
  { id: "confirmed", label: "Application Confirmed" },
] as const;
export type AppStage = (typeof APP_STAGES)[number]["id"];

export function applicationStage(protest: ProtestRecord, d: ArbitrationData): AppStage {
  if (d.confirmedAt) return "confirmed";
  if (d.depositPaidAt) return "deposit_paid";
  // an older case recorded only "filed"
  if (d.submittedAt || protest.arbitrationFiledAt) return "deposit_pending";
  if (d.application?.readyAt) return "ready";
  if (d.application) return "in_progress";
  return "not_started";
}

// ── Whole-case stages ───────────────────────────────────────────────────
export const ARB_PHASES = [
  { id: "eligibility", label: "Eligibility" },
  { id: "application", label: "Application" },
  { id: "deposit", label: "Deposit & confirmation" },
  { id: "settlement", label: "Settlement period" },
  { id: "hearing", label: "Arbitration hearing" },
  { id: "award", label: "Award" },
  { id: "final", label: "Roll correction & refund" },
] as const;
export type ArbPhase = (typeof ARB_PHASES)[number]["id"];

export function currentPhase(protest: ProtestRecord, d: ArbitrationData): ArbPhase {
  const stage = applicationStage(protest, d);
  if (d.award || (protest.status === "resolved" && protest.escalationPath === "arbitration"))
    // award recorded: roll correction, tax adjustment and refund remain
    return "final";
  if (d.settlement?.withdrawnAt || d.settlement?.status === "settled") return "award";
  if (d.arbitrator?.hearingDate) return "hearing";
  if (stage === "confirmed") return d.arbitrator?.name ? "hearing" : "settlement";
  if (stage === "deposit_pending" || stage === "deposit_paid") return "deposit";
  if (protest.arbDecision === "denied" || protest.arbDecision === "partial") return "application";
  return "eligibility";
}

export function phaseStates(protest: ProtestRecord, d: ArbitrationData) {
  const cur = currentPhase(protest, d);
  const idx = ARB_PHASES.findIndex((p) => p.id === cur);
  const closed = protest.status === "resolved";
  return ARB_PHASES.map((p, i) => ({
    ...p,
    state:
      (closed && i <= idx) || i < idx
        ? ("done" as const)
        : i === idx
          ? ("current" as const)
          : ("upcoming" as const),
  }));
}

// ── Deadline, costs, ROI ────────────────────────────────────────────────
export function arbitrationDeadline(protest: ProtestRecord, d: ArbitrationData, now = new Date()) {
  const received = localDay(d.orderReceivedDate) ? d.orderReceivedDate! : null;
  const order = localDay(protest.arbDecisionDate) ? protest.arbDecisionDate! : null;
  const from = received ?? order;
  const deadline = addDaysIso(from, 60);
  return {
    deadline,
    daysRemaining: daysUntilIso(deadline, now),
    basis: received ? ("received" as const) : order ? ("order" as const) : ("unknown" as const),
  };
}

export function homesteadLikely(property: PropertyRecord): boolean {
  return /residence|homestead|single.?family|\bsfr\b/i.test(property.propertyType ?? "");
}

export type ArbitrationCost = {
  value: number | null;
  homestead: boolean;
  deposit: number | null;
  arbitratorFee: number | null;
  retained: number;
  savings: number | null; // one year, ARB value − requested value at the effective rate
  roi: number | null; // savings ÷ deposit
  refundIfCloser: number | null; // deposit − $50
  costIfNot: number | null; // the deposit (arbitrator fee + $50 kept)
  taxRate: number;
};

export function arbitrationCost(
  property: PropertyRecord,
  protest: ProtestRecord,
  requestedValue: number | null,
): ArbitrationCost {
  const value = protest.finalValue ?? protest.originalValue ?? property.totalValue ?? null;
  const homestead = homesteadLikely(property);
  const fees = value != null ? bindingArbitrationFees(value, homestead) : null;
  const taxRate = getEffectiveTaxRate(property.cad);
  const arbValue = protest.finalValue ?? null;
  const gap =
    arbValue != null && requestedValue != null ? Math.max(0, arbValue - requestedValue) : null;
  const savings = gap != null ? Math.round(gap * taxRate) : null;
  return {
    value,
    homestead,
    deposit: fees?.deposit ?? null,
    arbitratorFee: fees?.arbitratorFee ?? null,
    retained: 50,
    savings,
    roi: savings != null && fees ? Math.round((savings / fees.deposit) * 10) / 10 : null,
    refundIfCloser: fees ? fees.deposit - 50 : null,
    costIfNot: fees?.deposit ?? null,
    taxRate,
  };
}

// The award against the two positions: closer to the owner's value means
// the deposit comes back less $50 (Tax Code §41A.10).
export function awardComparison(award: number, requested: number | null, arbValue: number | null) {
  const closerToOwner =
    requested != null && arbValue != null
      ? Math.abs(award - requested) < Math.abs(award - arbValue)
      : null;
  return {
    closerToOwner,
    reductionFromArb: arbValue != null ? Math.max(0, arbValue - award) : null,
  };
}

// ── Evidence ────────────────────────────────────────────────────────────
export const CATEGORY_LABEL: Record<EvidenceCategory, string> = {
  comparables: "Comparable sales",
  appraisal: "Appraisal reports",
  income: "Income & expense statements",
  photos: "Property photographs",
  condition: "Condition reports",
  repairs: "Repair records & estimates",
  valuation: "Valuation calculations",
  arb_order: "ARB order & hearing documents",
  other: "Other",
};

export function categorize(
  doc: Pick<DocumentRecord, "fileName" | "documentType">,
): EvidenceCategory {
  const t = `${doc.documentType ?? ""} ${doc.fileName}`.toLowerCase();
  if (/order determining|arb (order|decision)|hearing notice|decision/.test(t)) return "arb_order";
  if (/\bcomp|sales? (grid|comparison)|comparable/.test(t)) return "comparables";
  if (/apprais/.test(t)) return "appraisal";
  if (/income|expense|rent roll|p&l|profit|operating statement/.test(t)) return "income";
  if (/photo|\.(jpe?g|png|heic|webp)$/.test(t)) return "photos";
  if (/condition|inspection|engineer/.test(t)) return "condition";
  if (/repair|estimate|invoice|contractor|bid/.test(t)) return "repairs";
  if (/valuation|worksheet|calculation|analysis|report/.test(t)) return "valuation";
  return "other";
}

// The ARB packet copied for arbitration — the original list is untouched.
export function copyEvidence(docs: DocumentRecord[], now = new Date().toISOString()) {
  return {
    copiedAt: now,
    items: docs.map((d) => ({
      documentId: d.id,
      fileName: d.fileName,
      category: categorize(d),
      source: "reused" as const,
      addedAt: now,
    })),
    review: null,
  };
}

// Commonly useful evidence by property type — what the checklist recommends
// when nothing of that kind is in the packet.
export function recommendedCategories(property: PropertyRecord): EvidenceCategory[] {
  const commercial = !homesteadLikely(property);
  return commercial
    ? ["comparables", "income", "appraisal", "photos", "condition", "valuation", "arb_order"]
    : ["comparables", "photos", "condition", "repairs", "appraisal", "arb_order"];
}

// ── Upcoming deadlines ──────────────────────────────────────────────────
export function arbitrationUpcoming(
  protest: ProtestRecord,
  d: ArbitrationData,
  now = new Date(),
): { date: string; label: string; days: number | null }[] {
  const out: { date: string; label: string }[] = [];
  const stage = applicationStage(protest, d);
  const dl = arbitrationDeadline(protest, d, now).deadline;
  if (dl && (stage === "not_started" || stage === "in_progress" || stage === "ready"))
    out.push({ date: dl, label: "Arbitration request due (60 days)" });
  if (d.settlement?.endDate && !d.settlement.withdrawnAt && d.settlement.status !== "settled")
    out.push({ date: d.settlement.endDate, label: "Settlement period ends" });
  if (d.arbitrator?.hearingDate && !d.award)
    out.push({
      date: d.arbitrator.hearingDate,
      label: `Arbitration hearing${d.arbitrator.hearingTime ? ` at ${d.arbitrator.hearingTime}` : ""}`,
    });
  return out
    .map((x) => ({ ...x, days: daysUntilIso(x.date, now) }))
    .filter((x) => x.days == null || x.days >= 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// The one next action, in the order a person needs it.
export function arbitrationNext(
  protest: ProtestRecord,
  d: ArbitrationData,
): {
  label: string;
  popup:
    | "eligibility"
    | "application"
    | "status"
    | "evidence"
    | "settlement"
    | "arbitrator"
    | "hearing"
    | "award"
    | "final";
} {
  const stage = applicationStage(protest, d);
  if (protest.status === "resolved" || d.award)
    return { label: "Track roll correction & refund", popup: "final" };
  if (protest.arbDecision !== "denied" && protest.arbDecision !== "partial")
    return { label: "Check Eligibility", popup: "eligibility" };
  if (stage === "not_started" || stage === "in_progress")
    return {
      label:
        stage === "in_progress"
          ? "Continue Arbitration Application"
          : "Start Arbitration Application",
      popup: "application",
    };
  if (stage === "ready") return { label: "Record submission to the Comptroller", popup: "status" };
  if (stage === "deposit_pending") return { label: "Record deposit payment", popup: "status" };
  if (stage === "deposit_paid")
    return { label: "Record application confirmation", popup: "status" };
  if (!d.evidence) return { label: "Reuse Evidence for Arbitration", popup: "evidence" };
  if (!d.arbitrator?.hearingDate) return { label: "Add Arbitrator Details", popup: "arbitrator" };
  return { label: "Prepare for Arbitration Hearing", popup: "hearing" };
}

export const newId = () => `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// An .ics for the hearing (all-day when there's no time).
export function hearingIcs(
  title: string,
  date: string,
  time: string | null,
  location: string | null,
): string {
  const d = date.replace(/-/g, "");
  const m = time?.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  let start = `DTSTART;VALUE=DATE:${d}`;
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[3]?.toLowerCase() === "pm") h += 12;
    if (!m[3] && Number(m[1]) >= 12) h = Number(m[1]);
    start = `DTSTART:${d}T${String(h).padStart(2, "0")}${m[2]}00`;
  }
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CorvusPT//Arbitration//EN",
    "BEGIN:VEVENT",
    `UID:${d}-${Math.random().toString(36).slice(2)}@corvuspt`,
    start,
    `SUMMARY:${title.replace(/[,;]/g, " ")}`,
    location ? `LOCATION:${location.replace(/[,;]/g, " ")}` : "",
    "BEGIN:VALARM",
    "TRIGGER:-P1D",
    "ACTION:DISPLAY",
    "DESCRIPTION:Arbitration hearing tomorrow",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}
