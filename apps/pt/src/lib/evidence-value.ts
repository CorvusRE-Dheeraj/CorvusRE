import type { SavingsEstimate } from "./savings-estimate";

// How much each uploaded evidence file should matter, and what it does to the AI Report.
//
// Each file is read once by the extract-evidence-value edge function, which reports what the file
// says AND how important it is (relevance, quality, independence, currentness, direction). The
// numbers below are deterministic maths over those stored readings: the same evidence always gives
// the same result, so nothing changes on a refresh — only when evidence is added or removed.
//
// The idea: a critical piece of evidence (an independent appraisal) moves the scores a lot, several
// strong pieces together move them very high (with diminishing returns), and a weak or peripheral
// piece moves them only slightly. Evidence that supports the county's value moves them down.

export type ValueSignalKind =
  | "independent_appraisal"
  | "income_statement"
  | "repair_estimate"
  | "comparable_sales"
  | "condition_photos"
  | "lease_or_rent_roll"
  | "market_report"
  | "zoning_or_land_use"
  | "site_survey_environmental"
  | "other_relevant"
  | "not_valuation_evidence";

export type ModuleKey = "value" | "comps" | "site" | "improvement" | "income" | "zoning";
export type Importance = "critical" | "strong" | "moderate" | "minor" | "negligible";

export type EvidenceAssessment = {
  relevance: number; // 0-100
  quality: number; // 0-100
  independence: "third_party_licensed" | "third_party" | "owner_prepared" | "unknown";
  currentness: "current" | "recent" | "stale" | "undated";
  supports: "protest" | "county_value" | "neutral";
  modules: ("comps" | "site" | "improvement" | "income" | "zoning")[];
  importance: Importance;
  rationale: string;
};

export type ValueSignal = {
  schemaVersion?: number;
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
  assessment?: EvidenceAssessment;
  summary: string;
  notes: string[];
  readAt: string;
};

// The stored reading format the app expects (older readings are re-read once).
export const VALUE_SIGNAL_SCHEMA_VERSION = 2;

export type EvidenceItem = { docId: string; fileName: string; signal: ValueSignal };

const money = (v: number) => `$${Math.round(v).toLocaleString()}`;
const clamp = (lo: number, hi: number, n: number) => Math.max(lo, Math.min(hi, n));

// ---------------------------------------------------------------- weights

// The most a kind of document can ever count for, whatever the model says — a photo can never be
// "critical", an appraisal can.
const KIND_CEILING: Record<ValueSignalKind, number> = {
  independent_appraisal: 1,
  income_statement: 0.85,
  comparable_sales: 0.85,
  repair_estimate: 0.75,
  lease_or_rent_roll: 0.6,
  zoning_or_land_use: 0.55,
  site_survey_environmental: 0.55,
  condition_photos: 0.5,
  market_report: 0.45,
  other_relevant: 0.3,
  not_valuation_evidence: 0,
};

const IMPORTANCE_FACTOR: Record<Importance, number> = {
  critical: 1,
  strong: 0.8,
  moderate: 0.55,
  minor: 0.3,
  negligible: 0.1,
};
const INDEPENDENCE_FACTOR = {
  third_party_licensed: 1,
  third_party: 0.9,
  owner_prepared: 0.65,
  unknown: 0.75,
} as const;
const CURRENT_FACTOR = { current: 1, recent: 0.9, stale: 0.5, undated: 0.7 } as const;
const CONFIDENCE_FACTOR = { high: 1, medium: 0.7, low: 0.35 } as const;

// Fallback importance for a reading made before the importance assessment existed.
const LEGACY_IMPORTANCE: Record<ValueSignalKind, Importance> = {
  independent_appraisal: "strong",
  income_statement: "moderate",
  comparable_sales: "moderate",
  repair_estimate: "moderate",
  lease_or_rent_roll: "minor",
  zoning_or_land_use: "minor",
  site_survey_environmental: "minor",
  condition_photos: "minor",
  market_report: "minor",
  other_relevant: "negligible",
  not_valuation_evidence: "negligible",
};

// 0..1: how much this one file should count.
export function evidenceWeight(s: ValueSignal): number {
  if (s.kind === "not_valuation_evidence") return 0;
  const a = s.assessment;
  const importance = a?.importance ?? LEGACY_IMPORTANCE[s.kind];
  const base = Math.min(KIND_CEILING[s.kind], IMPORTANCE_FACTOR[importance]);
  const quality = 0.6 + 0.4 * ((a?.quality ?? 50) / 100);
  const relevance = 0.4 + 0.6 * ((a?.relevance ?? 50) / 100);
  const independence = INDEPENDENCE_FACTOR[a?.independence ?? "unknown"];
  const current = CURRENT_FACTOR[a?.currentness ?? "undated"];
  const confidence = CONFIDENCE_FACTOR[s.confidence] ?? CONFIDENCE_FACTOR.low;
  return clamp(0, 1, base * quality * relevance * independence * current * confidence);
}

export function importanceLabel(weight: number): "Critical" | "Strong" | "Moderate" | "Minor" {
  if (weight >= 0.6) return "Critical";
  if (weight >= 0.4) return "Strong";
  if (weight >= 0.2) return "Moderate";
  return "Minor";
}

// How much a file informs each analysis (0..1): what its kind naturally covers, plus anything the
// model tagged.
function affinities(s: ValueSignal): Record<ModuleKey, number> {
  const a: Record<ModuleKey, number> = {
    value: 0,
    comps: 0,
    site: 0,
    improvement: 0,
    income: 0,
    zoning: 0,
  };
  switch (s.kind) {
    case "independent_appraisal":
      a.value = 1;
      a.comps = 0.8;
      a.income = 0.4;
      break;
    case "income_statement":
    case "lease_or_rent_roll":
      a.income = 1;
      a.value = 0.8;
      break;
    case "comparable_sales":
      a.comps = 1;
      a.value = 0.8;
      break;
    case "repair_estimate":
      a.improvement = 1;
      a.value = 0.7;
      break;
    case "condition_photos":
      a.improvement = 1;
      a.site = 0.3;
      break;
    case "market_report":
      a.comps = 0.6;
      a.value = 0.4;
      break;
    case "zoning_or_land_use":
      a.zoning = 1;
      break;
    case "site_survey_environmental":
      a.site = 1;
      break;
    default:
      break;
  }
  for (const m of s.assessment?.modules ?? []) a[m] = Math.max(a[m], 0.6);
  // Anything that speaks to a specific analysis also speaks, a little, to overall value.
  if (a.value === 0 && Object.values(a).some((v) => v > 0)) a.value = 0.3;
  return a;
}

// +1 the evidence says the county value is too high / the property is worth less, -1 it supports the
// county value, 0 neutral. A stated value is compared with the county's value directly.
function directionOf(s: ValueSignal, cadValue: number): -1 | 0 | 1 {
  const stated =
    s.indicatedValue ??
    (s.netOperatingIncome != null && s.capRatePct
      ? s.netOperatingIncome / (s.capRatePct / 100)
      : null);
  if (stated != null && cadValue > 0) {
    if (stated < cadValue * 0.98) return 1;
    if (stated > cadValue * 1.02) return -1;
    return 0;
  }
  if (s.kind === "repair_estimate" && s.costToCure) return 1;
  const sup = s.assessment?.supports;
  return sup === "protest" ? 1 : sup === "county_value" ? -1 : 0;
}

// ---------------------------------------------------------------- module effects

export type ModuleEffect = { pos: number; neg: number; net: number };
export const EFFECT_MODULES: ModuleKey[] = [
  "value",
  "comps",
  "site",
  "improvement",
  "income",
  "zoning",
];

function combine(parts: number[]): number {
  return 1 - parts.reduce((acc, p) => acc * (1 - clamp(0, 0.99, p)), 1);
}

// For each analysis: how strongly the evidence pushes it toward "worth protesting" (pos) and toward
// "the county is right" (neg), each with diminishing returns as more evidence piles up. net = pos - neg.
export function computeModuleEffects(
  items: EvidenceItem[],
  cadValue: number,
): Record<ModuleKey, ModuleEffect> {
  const out = {} as Record<ModuleKey, ModuleEffect>;
  const prepared = items.map((it) => ({
    w: evidenceWeight(it.signal),
    aff: affinities(it.signal),
    dir: directionOf(it.signal, cadValue),
  }));
  for (const m of EFFECT_MODULES) {
    const pos = combine(prepared.filter((p) => p.dir > 0).map((p) => p.w * p.aff[m]));
    const neg = combine(prepared.filter((p) => p.dir < 0).map((p) => p.w * p.aff[m]));
    out[m] = { pos, neg, net: pos - neg };
  }
  return out;
}

// Points added to (or taken off) a module's 0-100 score at full evidence strength.
export const MAX_MODULE_POINTS = 30;
export const pointsFor = (net: number) => Math.round(net * MAX_MODULE_POINTS);

export type EvidenceContribution = {
  docId: string | null;
  fileName: string | null;
  label: string;
  detail: string;
  // The value this piece of evidence points to, when it points to one.
  value: number | null;
  importance: "Critical" | "Strong" | "Moderate" | "Minor";
  weightPct: number;
  direction: "lowers value" | "supports county value" | "neutral";
  // What this file alone did to each analysis's score (leave-one-out), in points.
  effects: { module: ModuleKey; points: number }[];
  reason: string;
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
  // 0..1: how much important, trustworthy evidence there is overall.
  strength: number;
  // -1..1: the net push of non-valuation evidence (condition, site, zoning) on the score.
  otherNet: number;
  direction: "lowers" | "raises" | "supports" | "none";
  contributions: EvidenceContribution[];
  // Points to add to each analysis's score.
  moduleUplift: Record<ModuleKey, number>;
  // Evidence that was uploaded and read but could not be used, with the reason.
  ignored: string[];
};

const ZERO_UPLIFT: Record<ModuleKey, number> = {
  value: 0,
  comps: 0,
  site: 0,
  improvement: 0,
  income: 0,
  zoning: 0,
};

const NONE: EvidenceAdjustment = {
  applied: false,
  indicatedValue: null,
  evidenceIndicatedValue: null,
  costToCure: 0,
  valueGapPct: null,
  strength: 0,
  otherNet: 0,
  direction: "none",
  contributions: [],
  moduleUplift: ZERO_UPLIFT,
  ignored: [],
};

const MODULE_LABEL: Record<ModuleKey, string> = {
  value: "Protest score",
  comps: "Comparable sales",
  site: "Site condition",
  improvement: "Improvement condition",
  income: "Income approach",
  zoning: "Zoning",
};
export const moduleLabel = (m: ModuleKey) => MODULE_LABEL[m];

// The base indicated value already behind the estimate (comps median, or the county/category
// model's reduction applied to the county value).
export function baseIndicatedValue(estimate: SavingsEstimate, cadValue: number): number | null {
  if (!estimate || cadValue <= 0) return null;
  if (estimate.basis === "comps") return Math.max(0, Math.round(estimate.compsMedian));
  return Math.max(0, Math.round(cadValue * (1 - estimate.reductionPct / 100)));
}

const KIND_LABEL: Record<ValueSignalKind, string> = {
  independent_appraisal: "Independent appraisal",
  income_statement: "Income statement",
  repair_estimate: "Repair estimate",
  comparable_sales: "Comparable sales",
  condition_photos: "Condition photos",
  lease_or_rent_roll: "Lease / rent roll",
  market_report: "Market report",
  zoning_or_land_use: "Zoning / land use document",
  site_survey_environmental: "Site / survey / environmental report",
  other_relevant: "Other document",
  not_valuation_evidence: "Not valuation evidence",
};

export function computeEvidenceAdjustment(args: {
  cadValue: number | null;
  baseIndicated: number | null;
  baseBasis: "comps" | "formula" | null;
  subjectSqft?: number | null;
  items: EvidenceItem[];
}): EvidenceAdjustment {
  const V = args.cadValue ?? 0;
  const items = args.items.filter((i) => i.signal.kind !== "not_valuation_evidence");
  if (V <= 0 || items.length === 0) return NONE;

  const effects = computeModuleEffects(items, V);
  const moduleUplift = { ...ZERO_UPLIFT };
  for (const m of EFFECT_MODULES) moduleUplift[m] = pointsFor(effects[m].net);

  const candidates: { value: number; weight: number }[] = [];
  const repairCandidates: { cost: number; applied: number }[] = [];
  const detail: { detail: string; value: number | null }[] = items.map(() => ({
    detail: "",
    value: null,
  }));
  const ignored: string[] = [];
  const hasAppraisal = items.some(
    (i) => i.signal.kind === "independent_appraisal" && i.signal.indicatedValue != null,
  );

  items.forEach((it, idx) => {
    const s = it.signal;
    const w = evidenceWeight(s);
    detail[idx].detail = s.summary || KIND_LABEL[s.kind];

    if (s.indicatedValue != null && s.kind !== "repair_estimate") {
      candidates.push({ value: s.indicatedValue, weight: w });
      detail[idx] = { detail: `Concludes ${money(s.indicatedValue)}.`, value: s.indicatedValue };
    }
    if (
      (s.kind === "income_statement" || s.kind === "lease_or_rent_roll") &&
      s.netOperatingIncome != null &&
      s.capRatePct != null &&
      s.capRatePct > 0
    ) {
      const v = s.netOperatingIncome / (s.capRatePct / 100);
      candidates.push({ value: v, weight: w });
      detail[idx] = {
        detail: `NOI ${money(s.netOperatingIncome)} at a ${s.capRatePct}% cap rate indicates ${money(v)}.`,
        value: v,
      };
    } else if (
      (s.kind === "income_statement" || s.kind === "lease_or_rent_roll") &&
      s.netOperatingIncome != null
    ) {
      ignored.push(
        `${KIND_LABEL[s.kind]}: NOI ${money(s.netOperatingIncome)} found, but no cap rate, so it cannot be turned into a value here (Module 7 uses it).`,
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
        candidates.push({ value: v, weight: w });
        detail[idx] = {
          detail: `${ppsf.length} sales at a median ${money(median)}/sqft indicate ${money(v)}.`,
          value: v,
        };
      }
    }
    if (s.costToCure != null && s.costToCure > 0) {
      repairCandidates.push({
        cost: s.costToCure,
        applied: Math.min(s.costToCure, V * 0.2) * Math.max(w, 0.2),
      });
      detail[idx] = {
        detail: hasAppraisal
          ? `${money(s.costToCure)} to repair noted. The appraisal already reflects condition, so it is not deducted again.`
          : `${money(s.costToCure)} to repair.`,
        value: null,
      };
    }
    for (const n of s.notes ?? []) ignored.push(n);
  });

  let repairs = 0;
  if (!hasAppraisal) for (const r of repairCandidates) repairs += r.applied;

  const candidateWeight = candidates.reduce((a, c) => a + c.weight, 0);
  const evidenceAvg =
    candidateWeight > 0
      ? candidates.reduce((a, c) => a + c.value * c.weight, 0) / candidateWeight
      : null;
  const evidenceIndicated = evidenceAvg != null ? Math.max(0, evidenceAvg - repairs) : null;

  const baseWeight = args.baseIndicated != null ? (args.baseBasis === "comps" ? 0.5 : 0.3) : 0;
  let blended: number;
  if (evidenceAvg != null) {
    blended =
      ((args.baseIndicated ?? 0) * baseWeight + evidenceAvg * candidateWeight) /
        (baseWeight + candidateWeight) -
      repairs;
  } else {
    blended = (args.baseIndicated ?? V) - repairs;
  }
  blended = clamp(V * 0.4, V, Math.round(blended));

  const reference = args.baseIndicated ?? V;
  const delta = (reference - blended) / V;
  const direction: EvidenceAdjustment["direction"] =
    delta > 0.005 ? "lowers" : delta < -0.005 ? "raises" : "supports";

  const gapBase = evidenceIndicated ?? Math.max(0, V - repairs);
  const valueEvidence = items.map((it) => evidenceWeight(it.signal) * affinities(it.signal).value);
  const strength = combine(valueEvidence);

  // Non-valuation evidence (condition, site, zoning) nudges the score too.
  const otherWeights = items.map((it) => {
    const a = affinities(it.signal);
    return evidenceWeight(it.signal) * Math.max(a.improvement, a.site, a.zoning);
  });
  const otherPos = combine(
    items.map((it, i) => (directionOf(it.signal, V) > 0 ? otherWeights[i] : 0)),
  );
  const otherNeg = combine(
    items.map((it, i) => (directionOf(it.signal, V) < 0 ? otherWeights[i] : 0)),
  );

  // Per-file effect on each analysis (leave-one-out).
  const contributions: EvidenceContribution[] = items.map((it, idx) => {
    const without = computeModuleEffects(
      items.filter((_, j) => j !== idx),
      V,
    );
    const eff: { module: ModuleKey; points: number }[] = [];
    for (const m of EFFECT_MODULES) {
      const pts = pointsFor(effects[m].net) - pointsFor(without[m].net);
      if (pts !== 0) eff.push({ module: m, points: pts });
    }
    const w = evidenceWeight(it.signal);
    const dir = directionOf(it.signal, V);
    return {
      docId: it.docId,
      fileName: it.fileName,
      label: KIND_LABEL[it.signal.kind],
      detail: detail[idx].detail,
      value: detail[idx].value,
      importance: importanceLabel(w),
      weightPct: Math.round(w * 100),
      direction: dir > 0 ? "lowers value" : dir < 0 ? "supports county value" : "neutral",
      effects: eff,
      reason: it.signal.assessment?.rationale ?? "",
    };
  });

  return {
    applied: true,
    indicatedValue: blended,
    evidenceIndicatedValue: evidenceIndicated,
    costToCure: Math.round(repairs),
    valueGapPct:
      candidates.length > 0 || repairs > 0 ? Math.round(((V - gapBase) / V) * 1000) / 10 : null,
    strength,
    otherNet: otherPos - otherNeg,
    direction,
    contributions,
    moduleUplift,
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
  const uniq = Array.from(new Set(adj.contributions.map((c) => c.label.toLowerCase()))).join(", ");
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
