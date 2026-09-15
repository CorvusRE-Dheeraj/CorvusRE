// Deterministic age-life depreciation math for Module 5 — same convention as
// executive-summary.ts/site-condition.ts: real formulas, real inputs, never
// AI-computed. The AI only ever supplies effectiveAgeYears (grounded in
// uploaded photos) and the two obsolescence percentages (also photo/user-
// info-grounded); every dollar/percent figure downstream of those is
// computed here, not asked of the model.

export type EconomicLifeRange = { min: number; max: number; typical: number };

// General, publicly-documented industry ranges for commercial improvements
// (this app is Texas-commercial-only) — not a county-specific or precise
// figure, and not a fabricated fine-grained taxonomy off a messy raw CAD
// propertyType string. A small keyword heuristic covers the few genuinely
// unambiguous cases; everything else gets one honest general-commercial
// range. Real curved (Marshall & Swift / IAAO) depreciation tables are
// proprietary and not reproduced here — see computeDepreciation's own
// comment for the straight-line method this uses instead.
const GENERAL_COMMERCIAL: EconomicLifeRange = { min: 35, max: 45, typical: 40 };
const INDUSTRIAL: EconomicLifeRange = { min: 30, max: 40, typical: 35 };
const HOTEL: EconomicLifeRange = { min: 30, max: 40, typical: 35 };
const MULTIFAMILY: EconomicLifeRange = { min: 40, max: 50, typical: 45 };

export function getTypicalEconomicLife(propertyType: string | null | undefined): EconomicLifeRange {
  const t = (propertyType ?? "").toLowerCase();
  if (/industrial|warehouse|manufactur/.test(t)) return INDUSTRIAL;
  if (/hotel|motel|hospitality/.test(t)) return HOTEL;
  if (/apartment|multifamily|multi-family/.test(t)) return MULTIFAMILY;
  return GENERAL_COMMERCIAL;
}

export type DepreciationResult = {
  physicalDepreciationPct: number | null;
  totalDepreciationPct: number | null;
  conditionAdjustedValue: number | null;
  impactDollar: number | null;
  impactPct: number | null;
};

// Straight-line age-life ratio (physical = effective age / typical economic
// life) — the simplest, publicly-taught form of the age-life method. Real
// appraisal practice often uses a curved depreciation table instead
// (slower depreciation early, faster later), but those tables are
// proprietary (Marshall & Swift etc.) and not something to fabricate
// numbers for here — this app uses the honest, defensible straight-line
// version instead, clearly labeled as such in the UI.
//
// Total depreciation is additive across physical/functional/external
// (capped at 100%), and condition-adjusted value applies that one combined
// rate to the improvement value — both confirmed against a real reference
// example: 28% physical + 10% functional + 5% external = 43% total;
// $12,300,000 x (1 - 0.43) = $7,011,000.
export function computeDepreciation(
  effectiveAgeYears: number | null,
  economicLife: EconomicLifeRange,
  functionalObsolescencePct: number | null,
  externalObsolescencePct: number | null,
  improvementValue: number | null,
): DepreciationResult {
  if (effectiveAgeYears == null) {
    return {
      physicalDepreciationPct: null,
      totalDepreciationPct: null,
      conditionAdjustedValue: null,
      impactDollar: null,
      impactPct: null,
    };
  }
  const physicalDepreciationPct = Math.min(
    100,
    Math.round((effectiveAgeYears / economicLife.typical) * 100),
  );
  const totalDepreciationPct = Math.min(
    100,
    physicalDepreciationPct + (functionalObsolescencePct ?? 0) + (externalObsolescencePct ?? 0),
  );
  if (improvementValue == null) {
    return {
      physicalDepreciationPct,
      totalDepreciationPct,
      conditionAdjustedValue: null,
      impactDollar: null,
      impactPct: null,
    };
  }
  const conditionAdjustedValue = Math.round(improvementValue * (1 - totalDepreciationPct / 100));
  const impactDollar = conditionAdjustedValue - improvementValue;
  const impactPct =
    improvementValue > 0 ? Math.round((impactDollar / improvementValue) * 100) : null;
  return {
    physicalDepreciationPct,
    totalDepreciationPct,
    conditionAdjustedValue,
    impactDollar,
    impactPct,
  };
}
