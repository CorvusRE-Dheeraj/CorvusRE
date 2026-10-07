import type { ProtestRecord } from "./protests";
import type { WorksheetSummary } from "./valuation-worksheet";
import type { CadWeakness } from "../../../../supabase/pt/functions/_shared/cad-evidence-review";
import { weaknessCounts } from "../../../../supabase/pt/functions/_shared/cad-evidence-review";

// The Corvus decision card: what a commercial owner needs to decide at each
// point in the dispute — whether to protest and for how much, what the
// district's evidence gets wrong, whether to take an informal offer, and what
// the outcome was worth. Every number is derived from facts CorvusPT already
// has (county value, the six-approach valuation worksheet, the county-data
// health score, the effective tax rate, the case record); every estimate says
// how it was reached. Pure, so it's tested.

export type Stage = "assess" | "evidence" | "offer" | "result";
export type Verdict = "PROTEST" | "REVIEW" | "NO PROTEST";
export type Strength = "Strong" | "Moderate" | "Limited";

export type DecisionCardInput = {
  cadValue: number | null; // the county's appraised value this case started from
  effectiveTaxRate: number; // fraction, e.g. 0.022
  healthScore: number | null; // 0-100 county-data protest-strength score
  worksheet: WorksheetSummary | null; // saved six-approach valuation
  estimatedSavings: number | null; // intake estimate, used when there's no worksheet
  protest: ProtestRecord | null;
  cadReview: { weaknesses: CadWeakness[]; hearingResponse: string } | null;
  annualCost: number | null; // what Corvus costs for this property per year
  arbitration: {
    eligible: boolean | null;
    deadline: string | null;
    daysRemaining: number | null;
  } | null;
};

export type Range = { low: number; high: number };

export type DecisionCard = {
  stage: Stage;
  verdict: Verdict;
  strength: Strength;
  cadValue: number | null;
  supportable: Range | null;
  supportableBasis: string;
  openingPosition: number | null;
  likelySettlement: number | null;
  evidenceStrength: number | null;
  arguments: string[]; // strongest first
  savingsAtSettlement: number | null;
  evidence: {
    weaknessCount: number;
    lines: string[]; // "2 Comp location", …
    responseReady: boolean;
  } | null;
  offer: {
    offer: number;
    original: number;
    savingsAtOffer: number;
    arbRange: Range | null;
    decision: "Accept" | "Borderline" | "Proceed to ARB";
    reasoning: string;
    additionalSavings: Range | null;
  } | null;
  result: {
    finalValue: number;
    reduction: number;
    annualSavings: number;
    cost: number | null;
    netFirstYear: number | null;
    arbitrationEligible: boolean | null;
    arbitrationDeadline: string | null;
    arbitrationDaysLeft: number | null;
    furtherAppeal: "Worth reviewing" | "Low priority";
    furtherAppealReason: string;
  } | null;
};

// Opening a little below the supportable floor leaves room to negotiate.
export const OPENING_DISCOUNT = 0.015;
// Where in the supportable range a negotiated outcome is estimated to land:
// 70% of the way from the low end to the high end.
export const SETTLEMENT_POSITION = 0.7;

const roundTo = (n: number, step: number) => Math.round(n / step) * step;
const floorTo = (n: number, step: number) => Math.floor(n / step) * step;
const step = (v: number) => (v >= 1_000_000 ? 10_000 : 1_000);
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

function supportableRange(i: DecisionCardInput): {
  range: Range | null;
  basis: string;
  args: string[];
} {
  const cad = i.cadValue;
  const below = (i.worksheet?.approaches ?? [])
    .filter(
      (a) =>
        a.status === "indicated" &&
        a.indicatedValue != null &&
        cad != null &&
        a.indicatedValue < cad,
    )
    .sort((a, b) => (a.indicatedValue as number) - (b.indicatedValue as number));
  if (below.length >= 1 && cad != null) {
    const values = below.map((a) => a.indicatedValue as number);
    const low = values[0];
    const high =
      values.length > 1 ? values[values.length - 1] : Math.min(cad, roundTo(low * 1.07, step(low)));
    return {
      range: { low, high },
      basis:
        below.length > 1
          ? `Lowest to highest of the ${below.length} valuation approaches that come in under the county`
          : `${below[0].name}, with a 7% band above it`,
      args: below.slice(0, 2).map((a) => a.name),
    };
  }
  // No worksheet yet: the intake savings estimate implies one supportable value.
  if (cad != null && i.estimatedSavings && i.effectiveTaxRate > 0) {
    const point = cad - i.estimatedSavings / i.effectiveTaxRate;
    if (point > 0 && point < cad) {
      const low = roundTo(point * 0.97, step(point));
      const high = Math.min(cad, roundTo(point * 1.03, step(point)));
      return {
        range: { low, high },
        basis:
          "From your savings estimate — open the AI Report's Commercial Valuation for the full analysis",
        args: [],
      };
    }
  }
  return {
    range: null,
    basis: "Not enough data yet — open the AI Report to run the valuation approaches",
    args: [],
  };
}

export function decisionCard(i: DecisionCardInput): DecisionCard {
  const p = i.protest;
  const cad = p?.originalValue ?? i.cadValue;
  const rate = i.effectiveTaxRate;
  const { range, basis, args } = supportableRange({ ...i, cadValue: cad });

  const opening = range ? floorTo(range.low * (1 - OPENING_DISCOUNT), step(range.low)) : null;
  const likely = range
    ? roundTo(range.low + (range.high - range.low) * SETTLEMENT_POSITION, step(range.low))
    : null;
  const savingsAtSettlement =
    cad != null && likely != null && likely < cad ? Math.round((cad - likely) * rate) : null;

  const score = i.healthScore;
  const strength: Strength =
    score == null ? "Limited" : score >= 70 ? "Strong" : score >= 40 ? "Moderate" : "Limited";
  const verdict: Verdict =
    range && cad != null && range.high < cad && strength !== "Limited"
      ? "PROTEST"
      : range || (score != null && score >= 40)
        ? "REVIEW"
        : "NO PROTEST";

  const card: DecisionCard = {
    stage: "assess",
    verdict,
    strength,
    cadValue: cad ?? null,
    supportable: range,
    supportableBasis: basis,
    openingPosition: opening,
    likelySettlement: likely,
    evidenceStrength: score,
    arguments: args,
    savingsAtSettlement,
    evidence: null,
    offer: null,
    result: null,
  };

  if (i.cadReview) {
    const counts = weaknessCounts(i.cadReview.weaknesses);
    card.stage = "evidence";
    card.evidence = {
      weaknessCount: i.cadReview.weaknesses.length,
      lines: counts.map((c) => `${c.count} ${c.label}`),
      responseReady: !!i.cadReview.hearingResponse,
    };
  }

  const offerValue = p?.settlementOfferValue ?? null;
  if (p && offerValue != null && cad != null && p.informalStatus === "proposed_value_received") {
    card.stage = "offer";
    const savingsAtOffer = Math.round(Math.max(0, cad - offerValue) * rate);
    let decision: "Accept" | "Borderline" | "Proceed to ARB" = "Borderline";
    let reasoning =
      "Corvus doesn't have a supportable range for this property yet — weigh the offer against your evidence.";
    let additional: Range | null = null;
    if (range) {
      additional = {
        low: Math.round(Math.max(0, offerValue - range.high) * rate),
        high: Math.round(Math.max(0, offerValue - range.low) * rate),
      };
      if (offerValue <= range.low) {
        decision = "Accept";
        reasoning =
          "The offer is at or below the low end of what your evidence supports — an ARB hearing is unlikely to do better.";
      } else if (offerValue > range.high * 1.05) {
        decision = "Proceed to ARB";
        reasoning = `The offer is well above what your evidence supports. Going to the ARB could save another ${usd(additional.low)}–${usd(additional.high)} a year.`;
      } else {
        reasoning = `Proceeding may produce an additional ~${usd(additional.low)}–${usd(additional.high)} in annual savings, but outcome uncertainty increases.`;
      }
    }
    card.offer = {
      offer: offerValue,
      original: cad,
      savingsAtOffer,
      arbRange: range,
      decision,
      reasoning,
      additionalSavings: additional,
    };
  }

  const finalValue = p?.finalValue ?? null;
  if (
    p &&
    finalValue != null &&
    cad != null &&
    (p.status === "resolved" || p.arbDecision != null)
  ) {
    card.stage = "result";
    const reduction = Math.max(0, cad - finalValue);
    const annualSavings = Math.round(reduction * rate);
    const remaining = range ? Math.max(0, finalValue - range.low) * rate : 0;
    // Binding arbitration needs a deposit (refundable mostly when you win);
    // under ~$2,000 a year of further savings it rarely pays.
    const worth = remaining >= 2000;
    card.result = {
      finalValue,
      reduction,
      annualSavings,
      cost: i.annualCost,
      netFirstYear: i.annualCost != null ? annualSavings - i.annualCost : null,
      arbitrationEligible: i.arbitration?.eligible ?? null,
      arbitrationDeadline: i.arbitration?.deadline ?? null,
      arbitrationDaysLeft: i.arbitration?.daysRemaining ?? null,
      furtherAppeal: worth ? "Worth reviewing" : "Low priority",
      furtherAppealReason: range
        ? worth
          ? `The final value is still above your supportable floor — up to ~${usd(remaining)} a year more is at stake.`
          : "The final value is at or close to what your evidence supports."
        : "No supportable range on file to compare against.",
    };
  }
  return card;
}
