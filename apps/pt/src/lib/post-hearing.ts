import type { ProtestRecord } from "./protests";
import type { TaxBillRecord } from "./tax-bills";
import type { EscalationEvaluation, EscalationOptionId } from "./escalation-eval";
import type { ArbitrationEligibility } from "./arbitration";

// The post-hearing decision layer: once the ARB has ruled (or the case
// settled), everything the owner needs to close the year or escalate —
// the outcome, whether the tax bill actually reflects it, the appeal
// deadlines, arbitration eligibility, the economics of each appeal route,
// the documents still needed, and how this year compares with last year.
// Pure: the caller loads the records; every figure is derived from them.

export type PostHearingInput = {
  protest: ProtestRecord;
  priorValue: number | null; // the county's value before the protest
  effectiveTaxRate: number; // fraction
  taxBills: TaxBillRecord[]; // this property's bills, any year
  valueHistory: { year: number; total: number | null }[]; // county value by year
  priorProtests: ProtestRecord[]; // this property's other cases
  escalation: EscalationEvaluation | null;
  arbitration: ArbitrationEligibility | null;
  supportableLow: number | null; // floor of what the owner's evidence supports
  documentTypes: string[]; // document_type of every document on file for the property
  today: string; // YYYY-MM-DD
};

export type BillCheck =
  | { status: "awaiting_bill"; expectedBill: number | null; note: string }
  | {
      status: "matches" | "too_high" | "lower";
      billed: number;
      expectedBill: number;
      difference: number; // billed − expected
      billedValue: number | null;
      note: string;
    };

export type AppealRoute = {
  id: EscalationOptionId;
  title: string;
  eligible: boolean;
  deadline: string | null;
  daysLeft: number | null;
  cost: { min: number; max: number } | null;
  potentialSavings: number | null; // per year
  roi: number | null;
  recommended: boolean;
  basis: string;
};

export type RequiredDoc = { label: string; onFile: boolean; why: string };

export type PostHearing = {
  finalValue: number;
  priorValue: number | null;
  reduction: number | null;
  reductionPct: number | null;
  estimatedSavings: number | null; // per year
  bill: BillCheck;
  arbitration: {
    status: ArbitrationEligibility["status"];
    label: string;
    deadline: string | null;
    daysLeft: number | null;
    deposit: number | null;
    reasons: string[];
  } | null;
  routes: AppealRoute[]; // eligible value-changing routes first
  verdict: { headline: string; detail: string };
  documents: RequiredDoc[];
  priorYear: {
    year: number;
    value: number | null;
    change: number | null; // final − prior-year value
    changePct: number | null;
    priorOutcome: string | null; // last year's protest result, if any
    estimatedTaxChange: number | null;
  } | null;
};

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const days = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

// Bill-vs-expected tolerance — rounding, exemptions and rate rounding.
export const BILL_TOLERANCE = 0.02;
// Below this much a year still at stake, a further appeal rarely pays.
export const APPEAL_FLOOR = 2000;

const VALUE_ROUTES: EscalationOptionId[] = ["binding_arbitration", "district_court", "soah"];

export function postHearing(i: PostHearingInput): PostHearing | null {
  const p = i.protest;
  const finalValue = p.finalValue;
  if (finalValue == null) return null;
  const prior = i.priorValue;
  const reduction = prior != null ? Math.max(0, prior - finalValue) : null;
  const rate = i.effectiveTaxRate;
  const year = p.taxYear;

  // Actual bill reconciliation.
  const bill = i.taxBills.find((b) => b.taxYear === year) ?? null;
  // A bill's rate may be stored per $100 of value (2.25) or as a fraction
  // (0.0225); no real rate is over 10% of value, so above 0.1 it's per $100.
  const billRate =
    bill?.taxRate != null && bill.taxRate > 0
      ? bill.taxRate > 0.1
        ? bill.taxRate / 100
        : bill.taxRate
      : rate;
  const expectedBill = Math.round(finalValue * billRate);
  let billCheck: BillCheck;
  if (!bill || bill.amountDue == null) {
    billCheck = {
      status: "awaiting_bill",
      expectedBill,
      note: `Texas tax bills usually arrive in October. Corvus AI estimates about ${usd(expectedBill)} at the final value — once it's added, Corvus will compare the two.`,
    };
  } else {
    const diff = bill.amountDue - expectedBill;
    const valueTooHigh =
      bill.taxableValue != null && bill.taxableValue > finalValue * (1 + BILL_TOLERANCE);
    const status =
      valueTooHigh || diff > expectedBill * BILL_TOLERANCE
        ? "too_high"
        : diff < -expectedBill * BILL_TOLERANCE
          ? "lower"
          : "matches";
    billCheck = {
      status,
      billed: bill.amountDue,
      expectedBill,
      difference: Math.round(diff),
      billedValue: bill.taxableValue,
      note:
        status === "too_high"
          ? valueTooHigh
            ? `The bill is based on ${usd(bill.taxableValue as number)}, not the final ${usd(finalValue)}. The tax office can issue a corrected bill; if it's already paid, Corvus AI estimates a refund of about ${usd(Math.max(0, diff))}.`
            : `The bill is ${usd(diff)} more than the final value implies — the rate or exemptions may differ from what Corvus AI has on file; the tax office can confirm.`
          : status === "lower"
            ? "The bill is lower than the final value implies — likely an exemption or a lower rate."
            : "The bill reflects the final value.",
    };
  }

  // Appeal routes from the escalation evaluation.
  const routes: AppealRoute[] = (i.escalation?.options ?? [])
    .filter((o) => VALUE_ROUTES.includes(o.id))
    .map((o) => ({
      id: o.id,
      title: o.title,
      eligible: o.eligible,
      deadline: o.deadline.date,
      daysLeft: o.deadline.date ? days(i.today, o.deadline.date) : null,
      cost: o.estimatedCost ? { min: o.estimatedCost.min, max: o.estimatedCost.max } : null,
      potentialSavings: o.potentialAdditionalSavings.amount,
      roi: o.estimatedRoi.ratio,
      recommended: o.recommended,
      basis: o.eligible ? o.estimatedRoi.basis : o.eligibilityBasis,
    }))
    .sort(
      (a, b) =>
        Number(b.eligible) - Number(a.eligible) || Number(b.recommended) - Number(a.recommended),
    );

  // The economics, in one line.
  const atStake =
    i.supportableLow != null ? Math.max(0, finalValue - i.supportableLow) * rate : null;
  const open = routes.filter((r) => r.eligible && (r.daysLeft == null || r.daysLeft >= 0));
  let verdict: PostHearing["verdict"];
  if (p.arbDecision === "approved" || p.informalStatus === "accepted") {
    verdict = {
      headline: "The requested value was granted",
      detail: "Corvus AI doesn't see a value-related reason for further appeal.",
    };
  } else if (open.length === 0) {
    verdict = {
      headline: "No appeal route is open",
      detail: "The deadlines have passed or no route applies to this property.",
    };
  } else if (atStake == null) {
    verdict = {
      headline: "The routes are compared below",
      detail:
        "Running the property's Commercial Valuation would let Corvus AI estimate what further appeal could save.",
    };
  } else if (atStake < APPEAL_FLOOR) {
    verdict = {
      headline: "Further appeal looks less likely to pay",
      detail: `Corvus AI estimates the final value is within ~${usd(atStake)} a year of what the evidence supports — less than an appeal usually costs.`,
    };
  } else {
    const best = open.find((r) => r.recommended) ?? open[0];
    verdict = {
      headline: `An option to consider: ${best.title}`,
      detail: `Corvus AI estimates up to ~${usd(atStake)} a year is still at stake${best.cost ? ` for about ${usd(best.cost.min)}${best.cost.max !== best.cost.min ? `–${usd(best.cost.max)}` : ""} up front` : ""}${best.deadline ? `; the deadline is ${longDate(best.deadline)}` : ""}.`,
    };
  }

  // Documents still needed.
  const has = (re: RegExp) => i.documentTypes.some((t) => re.test(t));
  const documents: RequiredDoc[] = [
    {
      label: "ARB Order Determining Protest",
      onFile: has(/decision/i) || p.arbDecision != null,
      why: "Starts the 60-day appeal clock and is required for any appeal.",
    },
    {
      label: `${year ?? "This year's"} tax statement`,
      onFile: !!bill,
      why: "Confirms the bill reflects the final value.",
    },
  ];
  const arbOpen = i.arbitration?.status === "eligible";
  if (arbOpen) {
    documents.push(
      {
        label: "Request for Binding Arbitration (Comptroller Form AP-219)",
        onFile: !!p.arbitrationFiledAt || has(/escalation/i),
        why: "Filed with the appraisal district within 60 days of the ARB order.",
      },
      {
        label: `Arbitration deposit${i.arbitration?.deposit != null ? ` (${usd(i.arbitration.deposit)})` : ""}`,
        onFile: !!p.arbitrationFiledAt,
        why: "Paid with the request; largely refunded if the arbitrator rules closer to your value.",
      },
    );
  }
  if (open.some((r) => r.id === "district_court")) {
    documents.push({
      label: "Proof the undisputed tax was paid before delinquency",
      onFile: !!bill?.paidAt,
      why: "Required to keep a district court appeal alive (Tax Code §42.08).",
    });
  }

  // Prior-year comparison.
  let priorYear: PostHearing["priorYear"] = null;
  if (year != null) {
    const py = year - 1;
    const pv = i.valueHistory.find((h) => h.year === py)?.total ?? null;
    const lastCase = i.priorProtests.find((x) => x.taxYear === py && x.id !== p.id) ?? null;
    const lastFinal = lastCase?.finalValue ?? pv;
    priorYear = {
      year: py,
      value: lastFinal,
      change: lastFinal != null ? finalValue - lastFinal : null,
      changePct: lastFinal ? Math.round(((finalValue - lastFinal) / lastFinal) * 1000) / 10 : null,
      priorOutcome:
        lastCase?.finalValue != null && lastCase.originalValue != null
          ? `Protested: ${usd(lastCase.originalValue)} → ${usd(lastCase.finalValue)}`
          : lastCase
            ? "Protested — outcome not recorded"
            : null,
      estimatedTaxChange: lastFinal != null ? Math.round((finalValue - lastFinal) * rate) : null,
    };
  }

  return {
    finalValue,
    priorValue: prior,
    reduction,
    reductionPct: reduction != null && prior ? Math.round((reduction / prior) * 1000) / 10 : null,
    estimatedSavings: reduction != null ? Math.round(reduction * rate) : null,
    bill: billCheck,
    arbitration: i.arbitration
      ? {
          status: i.arbitration.status,
          label: i.arbitration.label,
          deadline: i.arbitration.deadline,
          daysLeft: i.arbitration.daysRemaining,
          deposit: i.arbitration.deposit,
          reasons: i.arbitration.reasons,
        }
      : null,
    routes,
    verdict,
    documents,
    priorYear,
  };
}
