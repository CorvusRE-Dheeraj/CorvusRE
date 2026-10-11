import { applyValueTrendAdjustment } from "./texas-tax-rates";

// Deterministic Module 1 ("protest opportunity" health) score — NO AI call.
// Same inputs always produce the same output, so opening the report or
// clicking Refresh never moves the gauge; it only changes when the underlying
// CAD data / comps / evidence actually change, and then by a bounded amount.
//
// Built from the same real signals the deterministic estimateSuccessProbability
// (src/lib/success-probability.ts) already uses: the comps valuation gap, the
// Comptroller ratio-study coefficient-of-dispersion excess, and this
// property's own value-jump-vs-trend anomaly. The AI (ai-health-score edge
// function) now only writes the narrative around these numbers.

export type HealthScoreSignals = {
  // CAD assessed figures.
  totalValue: number | null;
  landValue: number | null;
  improvementValue: number | null;
  // CAD year-by-year assessed value history (present for the JSON-API counties).
  valueHistory: { year: number; total: number }[];
  // Static Texas Comptroller ratio study for this county + property category.
  assessmentRatio: { medianPct: number; cod: number; codOverCeiling: number } | null;
  // From computeComparableStats — count of usable comps and the % gap between
  // the CAD value and the (adjusted) indicated value. Null when no comps.
  comps: { count: number; gapPct: number | null } | null;
  // CAD building size, when the county publishes it.
  buildingSqft: number | null;
  // How many protest-evidence documents the owner has uploaded.
  evidenceCount: number;
  // What that evidence says about value (see evidence-value.ts). valueGapPct > 0 means the
  // evidence says the county value is too high; < 0 means it supports the county value.
  // strength is 0..1 (how much confident, usable evidence there is). Absent = none read yet.
  evidence?: { valueGapPct: number | null; strength: number; otherNet?: number } | null;
};

export type HealthScoreComputed = {
  score: number;
  confidencePct: number;
  scoreBreakdown: { label: string; score: number; reason: string }[];
  dataSufficient: boolean;
};

const clamp = (lo: number, hi: number, n: number) => Math.max(lo, Math.min(hi, n));

export function computeHealthScore(s: HealthScoreSignals): HealthScoreComputed {
  if (s.totalValue == null) {
    return { score: 0, confidencePct: 25, scoreBreakdown: [], dataSufficient: false };
  }

  const history = s.valueHistory
    .filter((h) => h && typeof h.total === "number" && h.total > 0)
    .map((h) => ({ year: h.year, value: h.total }));
  const trend = applyValueTrendAdjustment(0, history);
  const histYears = history.length;
  const gap = s.comps?.gapPct ?? null; // >0 => comps say the CAD value is high
  const cod = s.assessmentRatio?.codOverCeiling ?? 0;
  const compCount = s.comps?.count ?? 0;

  // --- score: 0-100, higher = stronger protest opportunity -----------------
  let score = 45; // neutral: "nothing here yet says much either way"

  if (gap != null) {
    // A positive gap (overvalued vs comps) lifts the score; a negative gap
    // (fairly / under-assessed) pulls it down, but less steeply.
    score += gap > 0 ? Math.min(30, gap * 1.4) : Math.max(-22, gap * 1.1);
  }

  // County assessments are non-uniform for this property type (Comptroller COD
  // above the IAAO ceiling) — an equity angle independent of this property's
  // own numbers.
  score += Math.min(12, cod * 0.8);

  // This year's assessed value jumped beyond the property's own trailing trend.
  if (trend.jumpTriggered) {
    const jumpPts = trend.jumpPct != null ? Math.round(trend.jumpPct * 100) : 12;
    score += Math.min(12, jumpPts / 3);
  } else if (trend.trailingCagrPct != null && trend.trailingCagrPct > 0.08) {
    // No single-year anomaly, but a steep sustained multi-year climb.
    score += Math.min(6, (trend.trailingCagrPct - 0.08) * 60);
  }

  // What the owner's uploaded evidence says. Evidence that shows the value is too high raises
  // the score, evidence that supports the county's value lowers it, and more confident evidence
  // moves it further. Deterministic: it only changes when the stored evidence readings change.
  const ev = s.evidence;
  if (ev && ev.otherNet) {
    // Condition / site / zoning evidence: nudges the score by how important it is.
    score += ev.otherNet * 8;
  }
  if (ev && ev.strength > 0 && ev.valueGapPct != null) {
    const pts =
      ev.valueGapPct > 0 ? Math.min(22, ev.valueGapPct * 1.6) : Math.max(-18, ev.valueGapPct * 1.2);
    score += pts * (0.35 + 0.65 * ev.strength);
  }

  score = clamp(15, 90, Math.round(score));

  // --- confidencePct: pure data-completeness tally ------------------------
  let c = 25;
  if (s.totalValue != null) c += 15;
  if (s.landValue != null && s.improvementValue != null) c += 10;
  if (histYears >= 2) c += 15;
  if (s.assessmentRatio) c += 10;
  if (compCount >= 3) c += 15;
  if (compCount >= 6) c += 5;
  if (s.buildingSqft != null) c += 10;
  if (s.evidenceCount >= 1) c += 5;
  if (ev && ev.strength > 0) c += Math.round(ev.strength * 10);
  const confidencePct = clamp(25, 92, Math.round(c));

  // --- scoreBreakdown: labelled 0-100 sub-scores over the same signals ----
  // Only labels the data can actually speak to (mirrors the edge function's
  // BREAKDOWN_LABELS allow-list). Each entry's `reason` is a plain-language
  // sentence built from the exact same variable the score above used for
  // that same factor — never a separate computation, so the sentence and
  // the number can never say two different things.
  const scoreBreakdown: { label: string; score: number; reason: string }[] = [
    {
      label: "CAD Valuation",
      score: clamp(0, 100, Math.round(50 + (gap ?? 0) * 1.6 + cod * 1.2)),
      reason:
        gap != null && cod > 0
          ? `Comps suggest ${gap > 0 ? "an overvaluation" : "you're fairly valued"} of about ${Math.abs(Math.round(gap))}%, and assessments in this area vary more than the state standard allows.`
          : gap != null
            ? `Comparable properties indicate your assessed value may be ${gap > 0 ? `${Math.round(gap)}% too high` : `close to or under market (${Math.round(Math.abs(gap))}% below comps)`}.`
            : cod > 0
              ? "Assessments for similar properties in this area vary more than the state's own uniformity standard allows — an equity issue independent of your own value."
              : "Not enough comparable-sales or equity data yet to assess this factor confidently.",
    },
  ];
  if (compCount >= 3) {
    scoreBreakdown.push({
      label: "Comparable Properties",
      score: clamp(0, 100, Math.round(50 + (gap ?? 0) * 1.8)),
      reason: `Based on ${compCount} comparable ${compCount === 1 ? "property" : "properties"}, your assessed value is ${
        gap != null && gap > 0
          ? `about ${Math.round(gap)}% above the indicated market value.`
          : gap != null
            ? `about ${Math.round(Math.abs(gap))}% at or below the indicated market value.`
            : "roughly in line with the indicated market value."
      }`,
    });
  } else if (compCount > 0) {
    scoreBreakdown.push({
      label: "Comparable Properties",
      score: 40,
      reason: `Only ${compCount} comparable ${compCount === 1 ? "property was" : "properties were"} found — too few to weigh heavily on their own.`,
    });
  }
  if (trend.jumpTriggered) {
    const jp = trend.jumpPct != null ? Math.round(trend.jumpPct * 100) : 12;
    scoreBreakdown.push({
      label: "Historical Valuation",
      score: clamp(0, 100, Math.round(60 + jp / 2)),
      reason: `Your assessed value jumped about ${jp}% this year — well beyond your property's own trailing trend.`,
    });
  } else if (histYears >= 2) {
    scoreBreakdown.push({
      label: "Historical Valuation",
      score: 45,
      reason:
        trend.trailingCagrPct != null && trend.trailingCagrPct > 0.08
          ? `No single-year jump, but your value has climbed an average of ${Math.round(trend.trailingCagrPct * 100)}%/year over ${histYears} years — a notably steep sustained pace.`
          : `No unusual jump or sustained climb across ${histYears} years of history — this factor is currently neutral.`,
    });
  }

  if (ev && ev.strength > 0 && ev.valueGapPct != null) {
    scoreBreakdown.push({
      label: "Owner Evidence",
      score: clamp(0, 100, Math.round(50 + ev.valueGapPct * 2.2)),
      reason: `The evidence you've uploaded indicates your property may be ${
        ev.valueGapPct > 0
          ? `overvalued by about ${Math.round(ev.valueGapPct)}%`
          : `fairly valued (about ${Math.round(Math.abs(ev.valueGapPct))}% at or below assessment)`
      }, weighted at ${Math.round(ev.strength * 100)}% confidence based on what was uploaded.`,
    });
  }

  const dataSufficient = confidencePct >= 45 && (compCount >= 3 || histYears >= 2);

  return { score, confidencePct, scoreBreakdown, dataSufficient };
}
