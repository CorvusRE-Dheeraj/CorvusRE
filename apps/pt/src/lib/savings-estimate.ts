import { getComps, type CompProperty } from "./cad-comps";
import {
  getEffectiveTaxRate,
  classifyPropertyCategory,
  getBaseReductionPct,
  applyValueTrendAdjustment,
  getAssessmentRatioInfo,
  applyAssessmentRatioAdjustment,
  type AssessmentRatioInfo,
} from "./texas-tax-rates";

export type SavingsEstimate =
  | {
      basis: "comps";
      amount: number;
      compsCount: number;
      compsMedian: number;
      effectiveTaxRatePct: number;
    }
  | {
      basis: "formula";
      amount: number;
      reductionPct: number;
      effectiveTaxRatePct: number;
      rationale: string;
    }
  | null;

export type SavingsEstimateInput = {
  cad?: string | null;
  accountNumber?: string | null;
  address?: string | null;
  propertyType?: string | null;
  landValue?: number | null;
  improvementValue?: number | null;
  totalValue?: number | null;
  taxYear?: number | null;
  valueHistory?: Array<{
    year: number;
    appraisedValue?: number | null;
    marketValue?: number | null;
  }> | null;
};

// Two-tier cascade — both fully deterministic, no AI call anywhere. Same
// inputs always produce the same output, so re-validating the same property
// (including a page refresh) never shows a different number.
//
// 1. "comps" — real comparable-property data (TrueProdigy, currently Denton/
//    Montgomery/Tarrant/Travis only — see getComps), filtered by BOTH value
//    magnitude (0.5x-2x the subject) and real geographic distance (within 1
//    mile, using the lat/lng both the subject and comps carry) before a
//    median is trusted, then only the 3-5 closest qualifying comps are used.
//    This is also the exact method Texas Tax Code 41.43(b)(3) recognizes for
//    an equal-and-uniform protest: appraised value vs. the median appraised
//    value of a reasonable number of comparable properties.
// 2. "formula" — reached whenever comps don't apply (wrong county, or nothing
//    passed the filters). Three real, sourced layers, applied in order:
//      a. A per-county/per-category base reduction rate from real 2025 (and
//         where available, 3-year blended) protest outcome data — residential
//         and commercial differ sharply and are looked up separately.
//      b. A small, bounded nudge from the Texas Comptroller's own published
//         assessment-ratio data (coefficient of dispersion) for that county
//         and category — real evidence of how uniformly assessments there
//         actually hold up, not a guess.
//      c. A further boost if this property's own assessed value jumped more
//         than its OWN historical trend supports — using up to 10 years of
//         real per-property CAD history (not a flat threshold applied to
//         every property the same way).
//    Always produces a number when a totalValue exists — this tier also
//    covers what an "always show something" baseline used to do, since a
//    deterministic formula never errors out the way a network AI call could.
//
// The effective tax rate is never guessed per-property: both tiers use
// getEffectiveTaxRate(cad), a real county-level rate (or the statewide average
// for counties without a specific entry) — see texas-tax-rates.ts for sourcing.
//
// Returns null when there's no real assessed value to estimate from at all
// — including a literal $0 (a new/unassessed parcel still mid-reappraisal,
// not a genuine "confirmed zero savings opportunity"; the formula tier
// below would otherwise happily compute totalValue * reductionPct * rate =
// 0 * anything = 0 and present it as a real finding it isn't).
export async function estimateSavings(property: SavingsEstimateInput): Promise<SavingsEstimate> {
  if (!property.totalValue) return null;
  const totalValue = property.totalValue;
  const rate = getEffectiveTaxRate(property.cad);

  if (property.cad && property.accountNumber) {
    try {
      const compsResult = await getComps({
        cad: property.cad,
        accountNumber: property.accountNumber,
      });
      const subject = compsResult.subject;
      // Without the subject's own coordinates there's no way to judge "nearby" —
      // fall through to the formula tier rather than trusting an undated,
      // unlocated median.
      if (subject) {
        const qualifying = getQualifyingComps(subject, compsResult.comps, totalValue).slice(0, 5);
        if (qualifying.length >= 3) {
          const values = qualifying.map((c) => c.marketValue).sort((a, b) => a - b);
          const median = values[Math.floor(values.length / 2)];
          const overvaluation = totalValue - median;
          if (overvaluation > 0) {
            return {
              basis: "comps",
              amount: Math.round(overvaluation * rate),
              compsCount: qualifying.length,
              compsMedian: median,
              effectiveTaxRatePct: Math.round(rate * 1000) / 10,
            };
          }
        }
      }
    } catch (err) {
      console.error("Comps lookup for savings estimate failed:", err);
    }
  }

  const category = classifyPropertyCategory(property.propertyType);
  const countyBaseReductionPct = getBaseReductionPct(property.cad, category);
  const ratioInfo = getAssessmentRatioInfo(property.cad, category);
  const ratioAdjustedPct = applyAssessmentRatioAdjustment(countyBaseReductionPct, ratioInfo);
  const history = (property.valueHistory ?? [])
    .map((h) => ({ year: h.year, value: h.appraisedValue ?? h.marketValue ?? null }))
    .filter((h): h is { year: number; value: number } => h.value != null);
  const trend = applyValueTrendAdjustment(ratioAdjustedPct, history);

  return {
    basis: "formula",
    amount: Math.round(totalValue * trend.reductionPct * rate),
    reductionPct: Math.round(trend.reductionPct * 1000) / 10,
    effectiveTaxRatePct: Math.round(rate * 1000) / 10,
    rationale: buildRationale(category, property.cad, ratioInfo, trend),
  };
}

const EARTH_RADIUS_MILES = 3958.8;

function distanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(a));
}

// Shared by estimateSavings above and estimateSuccessProbability
// (success-probability.ts) — both need the exact same real, filtered set of
// comparable properties (value magnitude 0.5x-2x the subject, within 1 real
// mile), since they represent the same underlying equal-and-uniform
// evidence for a given property; only what each does with that evidence
// differs.
export function getQualifyingComps(
  subject: { latitude: number; longitude: number },
  comps: CompProperty[],
  totalValue: number,
): Array<CompProperty & { marketValue: number; distanceMiles: number }> {
  return comps
    .filter((c): c is CompProperty & { marketValue: number } => c.marketValue != null)
    .filter((c) => c.marketValue >= totalValue * 0.5 && c.marketValue <= totalValue * 2)
    .map((c) => ({
      ...c,
      distanceMiles: distanceMiles(subject.latitude, subject.longitude, c.latitude, c.longitude),
    }))
    .filter((c) => c.distanceMiles <= 1)
    .sort((a, b) => a.distanceMiles - b.distanceMiles);
}

function countyName(cad?: string | null): string {
  if (!cad) return "your county";
  return cad.replace(/\s*(Central\s+)?Appraisal District$/i, "");
}

function buildRationale(
  category: ReturnType<typeof classifyPropertyCategory>,
  cad: string | null | undefined,
  ratioInfo: AssessmentRatioInfo,
  trend: { jumpTriggered: boolean; jumpPct: number | null; trailingCagrPct: number | null },
): string {
  const categoryLabel = category === "unknown" ? "properties like this" : `${category} properties`;
  let text = `Based on real 2025 Texas protest outcomes for ${categoryLabel} in ${countyName(cad)}`;
  // Only worth mentioning when it actually moved the number — a COD within the
  // IAAO standard contributes no adjustment (see applyAssessmentRatioAdjustment),
  // so citing it there would imply it mattered when it didn't.
  if (ratioInfo && ratioInfo.codOverCeiling > 0) {
    text += `, where the Texas Comptroller's own ratio study measures a ${ratioInfo.cod.toFixed(1)}% coefficient of dispersion — above the IAAO's standard ceiling for this property type, the statistical basis for an equal-and-uniform protest`;
  }
  text += ".";
  if (trend.jumpTriggered && trend.jumpPct != null) {
    const vsTrend =
      trend.trailingCagrPct != null
        ? ` — well above this property's own ~${Math.round(trend.trailingCagrPct * 100)}%/year historical trend`
        : "";
    text += ` Your assessed value jumped ${Math.round(trend.jumpPct * 100)}% this year${vsTrend}, which published protest-outcome data links to larger successful reductions.`;
  }
  return text;
}
