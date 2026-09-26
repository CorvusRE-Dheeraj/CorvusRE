import type { SavingsEstimate } from "./savings-estimate";

// What an uploaded evidence document says about value, as read by the extract-evidence-value edge
// function and stored on documents.value_signal. Everything below is deterministic: the same
// stored signals always give the same numbers, so scores and savings move when the owner uploads
// (or removes) evidence and never on a plain page refresh.

export type ValueSignalKind =
  | "independent_appraisal"
  | "income_statement"
  | "repair_estimate"
  | "comparable_sales"
  | "condition_photos"
  | "lease_or_rent_roll"
  | "market_report"
  | "other_relevant"
  | "not_valuation_evidence";

export type ValueSignal = {
  kind: ValueSignalKind;
  valuationDate: string | null;
  indicatedValue: number | null;
  costToCure: number | null;
  netOperatingIncome: number | null;
  capRatePct: number | null;
  occupancyPct: number | null;
  sales: { address: string | null; price: number; date: string | null; sqft: number | null }[];
  conditionIssues: string[];
  confidence: "high" | "medium" | "low";
  summary: string;
  notes: string[];
  readAt: string;
};

export type EvidenceContribution = {
  label: string;
  detail: string;
  // The value this piece of evidence points to, when it points to one.
  value: number | null;
};

export type EvidenceAdjustment = {
  applied: boolean;
  // The value the estimate now rests on (blend of the base estimate and the evidence, less repairs).
  indicatedValue: number | null;
  // What the evidence alone points to, before blending with the base estimate.
  evidenceIndicatedValue: number | null;
  costToCure: number;
  // Percent by which the evidence says the county value is too high (negative = evidence supports it).
  valueGapPct: number | null;
  // 0..1: how much usable, confident evidence there is.
  strength: number;
  direction: "lowers" | "raises" | "supports" | "none";
  contributions: EvidenceContribution[];
  // Evidence that was uploaded and read but could not be used, with the reason.
  ignored: string[];
};

const CONF_WEIGHT = { high: 1, medium: 0.6, low: 0.25 } as const;
const money = (v: number) => `$${Math.round(v).toLocaleString()}`;
const clamp = (lo: number, hi: number, n: number) => Math.max(lo, Math.min(hi, n));

const NONE: EvidenceAdjustment = {
  applied: false,
  indicatedValue: null,
  evidenceIndicatedValue: null,
  costToCure: 0,
  valueGapPct: null,
  strength: 0,
  direction: "none",
  contributions: [],
  ignored: [],
};

// The base indicated value already behind the estimate (comps median, or the county/category
// model's reduction applied to the county value).
export function baseIndicatedValue(estimate: SavingsEstimate, cadValue: number): number | null {
  if (!estimate || cadValue <= 0) return null;
  if (estimate.basis === "comps") return Math.max(0, Math.round(estimate.compsMedian));
  return Math.max(0, Math.round(cadValue * (1 - estimate.reductionPct / 100)));
}

export function computeEvidenceAdjustment(args: {
  cadValue: number | null;
  baseIndicated: number | null;
  baseBasis: "comps" | "formula" | null;
  subjectSqft?: number | null;
  signals: ValueSignal[];
}): EvidenceAdjustment {
  const V = args.cadValue ?? 0;
  if (V <= 0) return NONE;

  const candidates: { value: number; weight: number; c: EvidenceContribution }[] = [];
  let repairs = 0;
  const contributions: EvidenceContribution[] = [];
  const ignored: string[] = [];

  const repairCandidates: { cost: number; applied: number; confidence: string }[] = [];
  for (const s of args.signals) {
    if (s.kind === "not_valuation_evidence") continue;
    const cw = CONF_WEIGHT[s.confidence] ?? CONF_WEIGHT.low;

    if (s.indicatedValue != null && s.kind !== "repair_estimate") {
      const isAppraisal = s.kind === "independent_appraisal";
      const w = (isAppraisal ? 0.8 : 0.3) * cw;
      const c: EvidenceContribution = {
        label: isAppraisal ? "Independent appraisal" : "Value opinion",
        detail: `Concludes ${money(s.indicatedValue)} (${s.confidence} confidence).`,
        value: s.indicatedValue,
      };
      candidates.push({ value: s.indicatedValue, weight: w, c });
      contributions.push(c);
    }

    if (
      (s.kind === "income_statement" || s.kind === "lease_or_rent_roll") &&
      s.netOperatingIncome != null &&
      s.capRatePct != null &&
      s.capRatePct > 0
    ) {
      const v = s.netOperatingIncome / (s.capRatePct / 100);
      const c: EvidenceContribution = {
        label: "Income statement",
        detail: `NOI ${money(s.netOperatingIncome)} at a ${s.capRatePct}% cap rate indicates ${money(v)}.`,
        value: v,
      };
      candidates.push({ value: v, weight: 0.5 * cw, c });
      contributions.push(c);
    } else if (
      (s.kind === "income_statement" || s.kind === "lease_or_rent_roll") &&
      s.netOperatingIncome != null
    ) {
      ignored.push(
        `${s.kind === "income_statement" ? "Income statement" : "Rent roll"}: NOI ${money(s.netOperatingIncome)} found, but no cap rate, so it cannot be turned into a value here (Module 7 uses it).`,
      );
    }

    if (s.sales.length >= 2 && args.subjectSqft && args.subjectSqft > 0) {
      const ppsf = s.sales
        .filter((x) => x.sqft && x.sqft > 0)
        .map((x) => x.price / (x.sqft as number))
        .sort((a, b) => a - b);
      if (ppsf.length >= 2) {
        const median = ppsf[Math.floor(ppsf.length / 2)];
        const v = median * args.subjectSqft;
        const c: EvidenceContribution = {
          label: "Comparable sales",
          detail: `${ppsf.length} sales at a median ${money(median)}/sqft indicate ${money(v)}.`,
          value: v,
        };
        candidates.push({ value: v, weight: 0.4 * cw, c });
        contributions.push(c);
      }
    }

    if (s.costToCure != null && s.costToCure > 0) {
      const applied = Math.min(s.costToCure, V * 0.2) * cw;
      repairCandidates.push({ cost: s.costToCure, applied, confidence: s.confidence });
    }

    for (const n of s.notes ?? []) ignored.push(n);
  }

  // An independent appraisal already values the property in its current condition, so a repair
  // estimate is not deducted again on top of it (that would count the same defects twice).
  const hasAppraisal = args.signals.some(
    (s) => s.kind === "independent_appraisal" && s.indicatedValue != null,
  );
  for (const r of repairCandidates) {
    if (hasAppraisal) {
      contributions.push({
        label: "Repair estimate",
        detail: `${money(r.cost)} noted. The appraisal already reflects the property's condition, so it is not deducted again.`,
        value: null,
      });
    } else {
      repairs += r.applied;
      contributions.push({
        label: "Repair estimate",
        detail: `${money(r.cost)} to repair (${r.confidence} confidence) reduces value by ${money(r.applied)}.`,
        value: null,
      });
    }
  }

  if (candidates.length === 0 && repairs === 0) return { ...NONE, contributions, ignored };

  const evidenceWeight = candidates.reduce((a, c) => a + c.weight, 0);
  const evidenceAvg =
    evidenceWeight > 0
      ? candidates.reduce((a, c) => a + c.value * c.weight, 0) / evidenceWeight
      : null;
  const evidenceIndicated = evidenceAvg != null ? Math.max(0, evidenceAvg - repairs) : null;

  const baseWeight = args.baseIndicated != null ? (args.baseBasis === "comps" ? 0.5 : 0.3) : 0;
  let blended: number;
  if (evidenceAvg != null) {
    blended =
      ((args.baseIndicated ?? 0) * baseWeight + evidenceAvg * evidenceWeight) /
        (baseWeight + evidenceWeight) -
      repairs;
  } else {
    blended = (args.baseIndicated ?? V) - repairs;
  }
  // Never above the county value (no negative savings) and never absurdly low.
  blended = clamp(V * 0.4, V, Math.round(blended));

  const reference = args.baseIndicated ?? V;
  const delta = (reference - blended) / V;
  const direction: EvidenceAdjustment["direction"] =
    delta > 0.005 ? "lowers" : delta < -0.005 ? "raises" : "supports";

  const strength = clamp(0, 1, evidenceWeight + (repairs > 0 ? 0.3 : 0));
  const gapBase = evidenceIndicated ?? Math.max(0, V - repairs);

  return {
    applied: true,
    indicatedValue: blended,
    evidenceIndicatedValue: evidenceIndicated,
    costToCure: Math.round(repairs),
    valueGapPct: Math.round(((V - gapBase) / V) * 1000) / 10,
    strength,
    direction,
    contributions,
    ignored,
  };
}

// Re-states a savings estimate using the evidence-adjusted indicated value. Returned in the
// existing "formula" shape so every place that reads the estimate (headline, Module 9, module
// prompts) picks it up without any other change. Returns the original estimate when there is no
// usable evidence.
export function applyEvidenceToEstimate(
  base: SavingsEstimate,
  cadValue: number,
  ratePct: number,
  adj: EvidenceAdjustment,
): SavingsEstimate {
  if (!adj.applied || adj.indicatedValue == null || cadValue <= 0) return base;
  const reduction = Math.max(0, cadValue - adj.indicatedValue);
  const rate = ratePct / 100;
  const parts = adj.contributions.map((c) => c.label.toLowerCase());
  const uniq = Array.from(new Set(parts)).join(", ");
  return {
    basis: "formula",
    amount: Math.round(reduction * rate),
    reductionPct: Math.round((reduction / cadValue) * 1000) / 10,
    effectiveTaxRatePct: ratePct,
    rationale:
      reduction > 0
        ? `Adjusted for the evidence you uploaded (${uniq}), which points to a value of about ${money(adj.indicatedValue)}.`
        : `The evidence you uploaded (${uniq}) supports the county's value, so no reduction is estimated.`,
  };
}
