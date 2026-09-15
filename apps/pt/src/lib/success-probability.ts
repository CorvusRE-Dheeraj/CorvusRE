import { getComps } from "./cad-comps";
import { getQualifyingComps, type SavingsEstimateInput } from "./savings-estimate";
import {
  classifyPropertyCategory,
  getAssessmentRatioInfo,
  applyValueTrendAdjustment,
} from "./texas-tax-rates";

export type SuccessProbabilityEstimate = {
  probabilityPct: number;
  basis: "comps" | "formula";
  rationale: string;
} | null;

// Deterministic confidence score, no AI call — same inputs always produce
// the same output. Unlike COUNTY_REDUCTION_PCT in texas-tax-rates.ts, Texas
// doesn't publish a per-county "probability of winning" statistic with
// anywhere near the same rigor (no residential/commercial breakout exists
// in any source found), so rather than inventing a precise-looking number,
// this is honestly a derived confidence score: a real per-county base win
// rate, adjusted by the same real evidence signals estimateSavings already
// computes for the reduction amount (comps strength, Comptroller
// assessment-ratio COD excess, and this property's own value-jump
// anomaly) — the same underlying evidence, read as "how strong is this
// case" rather than "how big would the reduction be."
//
// Base rates sourced from Ballard Property Tax Protest's per-county
// informal-hearing success-rate ranges
// (ballardpropertytaxprotest.com/post/property-tax-protest-success-rates-texas),
// using each range's midpoint — informal hearings resolve the large
// majority of Texas protests per every source checked, so that stage's
// rate is the most representative single "did this protest succeed"
// figure available per county. Denton reuses the same real 86% win-rate
// figure already cited for its base reduction % above (texas-tax-rates.ts).
const COUNTY_WIN_RATE_PCT: Partial<Record<string, number>> = {
  "Collin Central Appraisal District": 80,
  "Tarrant Appraisal District": 75,
  "Harris Central Appraisal District": 80,
  "Travis Central Appraisal District": 75,
  "Bexar Appraisal District": 90,
  "Denton Central Appraisal District": 86,
};

// Statewide fallback for any county without a specific figure above (Fort
// Bend, Williamson, Montgomery, Grayson) — the midpoint of "60-80% of
// protests statewide result in a reduction," corroborated across multiple
// independent 2025 sources (Ballard; Texas Law Help; O'Connor's ARB
// overview) rather than any single one.
const STATEWIDE_WIN_RATE_PCT = 70;

function getBaseWinRatePct(cad?: string | null): number {
  if (cad && cad in COUNTY_WIN_RATE_PCT) return COUNTY_WIN_RATE_PCT[cad]!;
  return STATEWIDE_WIN_RATE_PCT;
}

// This is a confidence estimate built from real but incomplete signals, not
// a guarantee — bounded so it never claims near-certainty or
// near-impossibility regardless of how the adjustments below stack up.
const MIN_PROBABILITY_PCT = 35;
const MAX_PROBABILITY_PCT = 95;

// 3+ real, nearby, value-filtered comparable properties supporting an
// equal-and-uniform overvaluation (see getQualifyingComps) is concrete
// case-specific evidence beyond the county base rate — weighted more than
// the smaller adjustments below since it's the strongest single signal
// available.
const COMPS_BASIS_BOOST_PCT = 7;

// Same real Comptroller ratio-study COD-over-IAAO-ceiling signal used for
// the reduction estimate (see applyAssessmentRatioAdjustment in
// texas-tax-rates.ts) — scaled and capped separately here since this
// adjusts a win probability, not a reduction magnitude.
const COD_PROBABILITY_PER_POINT = 0.4;
const COD_PROBABILITY_CAP_PCT = 6;

// Same real value-jump-vs-own-historical-trend anomaly used for the
// reduction estimate (see applyValueTrendAdjustment) — a property whose
// assessed value jumped well beyond its own trend is concrete evidence of
// likely over-assessment this year.
const VALUE_JUMP_BOOST_PCT = 5;

export async function estimateSuccessProbability(
  property: SavingsEstimateInput,
): Promise<SuccessProbabilityEstimate> {
  if (property.totalValue == null) return null;
  const totalValue = property.totalValue;
  const category = classifyPropertyCategory(property.propertyType);
  const baseWinRatePct = getBaseWinRatePct(property.cad);

  let pct = baseWinRatePct;
  let basis: "comps" | "formula" = "formula";
  let compsNote = "";

  if (property.cad && property.accountNumber) {
    try {
      const compsResult = await getComps({
        cad: property.cad,
        accountNumber: property.accountNumber,
      });
      const subject = compsResult.subject;
      if (subject) {
        const qualifying = getQualifyingComps(subject, compsResult.comps, totalValue).slice(0, 5);
        if (qualifying.length >= 3) {
          basis = "comps";
          pct += COMPS_BASIS_BOOST_PCT;
          compsNote = ` Strengthened by ${qualifying.length} real nearby comparable properties supporting an equal-and-uniform case.`;
        }
      }
    } catch (err) {
      console.error("Comps lookup for success-probability estimate failed:", err);
    }
  }

  const ratioInfo = getAssessmentRatioInfo(property.cad, category);
  let codNote = "";
  if (ratioInfo && ratioInfo.codOverCeiling > 0) {
    pct += Math.min(COD_PROBABILITY_CAP_PCT, ratioInfo.codOverCeiling * COD_PROBABILITY_PER_POINT);
    codNote = ` The county's own Comptroller ratio study shows a ${ratioInfo.cod.toFixed(1)}% coefficient of dispersion, above the IAAO standard for this property type.`;
  }

  const history = (property.valueHistory ?? [])
    .map((h) => ({ year: h.year, value: h.appraisedValue ?? h.marketValue ?? null }))
    .filter((h): h is { year: number; value: number } => h.value != null);
  // baseReductionPct is passed as 0 here — this call is only used for its
  // jumpTriggered/jumpPct detection, not the reductionPct it also returns
  // (that's estimateSavings' concern, not this function's).
  const trend = applyValueTrendAdjustment(0, history);
  let trendNote = "";
  if (trend.jumpTriggered) {
    pct += VALUE_JUMP_BOOST_PCT;
    const jumpPctText =
      trend.jumpPct != null ? `${Math.round(trend.jumpPct * 100)}%` : "significantly";
    trendNote = ` Your assessed value jumped ${jumpPctText} this year, beyond its own historical trend.`;
  }

  pct = Math.max(MIN_PROBABILITY_PCT, Math.min(MAX_PROBABILITY_PCT, pct));

  return {
    probabilityPct: Math.round(pct),
    basis,
    rationale:
      buildRationale(category, property.cad, baseWinRatePct) + compsNote + codNote + trendNote,
  };
}

function countyName(cad?: string | null): string {
  if (!cad) return "your county";
  return cad.replace(/\s*(Central\s+)?Appraisal District$/i, "");
}

function buildRationale(
  category: ReturnType<typeof classifyPropertyCategory>,
  cad: string | null | undefined,
  baseWinRatePct: number,
): string {
  const categoryLabel =
    category === "unknown"
      ? "Properties"
      : `${category[0].toUpperCase()}${category.slice(1)} properties`;
  return `${categoryLabel} in ${countyName(cad)} that protest see a reduction roughly ${Math.round(baseWinRatePct)}% of the time.`;
}
