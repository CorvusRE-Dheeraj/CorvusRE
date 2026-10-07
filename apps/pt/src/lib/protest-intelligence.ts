import {
  APPROACH_WEIGHT,
  decisionCard,
  type DecisionCard,
  type DecisionCardInput,
} from "./decision-card";
import type { WorksheetSummary } from "./valuation-worksheet";
import { WEAKNESS_LABEL } from "../../../../supabase/pt/functions/_shared/cad-evidence-review";

// Protest Intelligence: the nine questions a commercial owner actually needs
// answered, each from the case's own facts (decision-card.ts does the math).
// No chatbot — a fixed, explainable answer per question, every time.

export type ApproachId = WorksheetSummary["approaches"][number]["id"];

export type ArgumentStrength = {
  id: ApproachId;
  name: string;
  value: number | null;
  gapPct: number | null; // how far below the county, %
  strength: "Strong" | "Moderate" | "Weak" | "Supports county" | "Not run";
  why: string;
};

export type Answer = {
  id: "should" | "why" | "defend" | "evidence" | "strength" | "cad" | "accept" | "ask" | "appeal";
  question: string;
  headline: string;
  points: string[];
  tone: "good" | "caution" | "neutral";
};

export type ProtestIntelligence = {
  card: DecisionCard;
  arguments: ArgumentStrength[];
  answers: Answer[];
};

export type IntelligenceInput = DecisionCardInput & {
  // The county-data score's own reasons (property_ai_scores.factors).
  scoreFactors: string[];
  // Protest-evidence documents on file for this property.
  evidenceDocuments: string[];
  // The value the district's evidence argues for, once reviewed.
  cadArguesFor: number | null;
};

const WHY: Record<ApproachId, string> = {
  equity:
    "Built from the county's own appraisal roll — Texas caps your value at the median of comparable appraisals (Tax Code §41.43(b)(3)), so it's hard for the ARB to dismiss.",
  income:
    "Built from your property's actual income — persuasive for income-producing property when the rent roll and P&L are complete.",
  sales: "Real sales of comparable properties — strong when the sales are verified and recent.",
  land: "Targets the land value on its own — useful when the county's land rate is out of line with nearby parcels.",
  impairments:
    "Deducts what a buyer would pay to fix problems — holds up when backed by contractor bids or inspection reports.",
  cost: "Relies on a replacement-cost estimate — best as supporting evidence, not the lead argument.",
};

// What the district typically says against each kind of argument.
const CAD_REBUTTAL: Record<ApproachId, string> = {
  equity:
    "that your comparables aren't truly comparable — different location, size, age or condition — or need adjustments",
  income:
    "that your actual income understates market rent, your vacancy or expenses are above market, or your cap rate is too high",
  sales: "that your sales are dated, not arm's-length, or need location and size adjustments",
  land: "that your land comps differ in frontage, zoning, access or utilities",
  impairments:
    "that the cost-to-cure figures aren't supported by bids or are already reflected in the value",
  cost: "that your replacement cost per SF is too low or your depreciation too high",
};

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const m = (n: number) =>
  Math.abs(n) >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`
    : Math.abs(n) >= 1_000
      ? `$${Math.round(n / 1_000)}K`
      : usd(n);

export function argumentStrengths(
  worksheet: WorksheetSummary | null,
  cad: number | null,
): ArgumentStrength[] {
  const order: Record<ArgumentStrength["strength"], number> = {
    Strong: 0,
    Moderate: 1,
    Weak: 2,
    "Supports county": 3,
    "Not run": 4,
  };
  return (worksheet?.approaches ?? [])
    .map((a): ArgumentStrength & { score: number } => {
      const base = { id: a.id, name: a.name, why: WHY[a.id] };
      if (a.status === "needs_data" || (a.indicatedValue == null && a.status !== "supports_cad")) {
        return { ...base, value: null, gapPct: null, strength: "Not run", score: -1 };
      }
      if (
        a.status === "supports_cad" ||
        a.indicatedValue == null ||
        cad == null ||
        a.indicatedValue >= cad
      ) {
        return {
          ...base,
          value: a.indicatedValue,
          gapPct:
            cad && a.indicatedValue != null
              ? Math.round(((cad - a.indicatedValue) / cad) * 1000) / 10
              : null,
          strength: "Supports county",
          score: -0.5,
        };
      }
      const gap = (cad - a.indicatedValue) / cad;
      const eff = gap * (APPROACH_WEIGHT[a.id] ?? 0.5);
      return {
        ...base,
        value: a.indicatedValue,
        gapPct: Math.round(gap * 1000) / 10,
        strength: eff >= 0.1 ? "Strong" : eff >= 0.04 ? "Moderate" : "Weak",
        score: eff,
      };
    })
    .sort((a, b) => order[a.strength] - order[b.strength] || b.score - a.score)
    .map(({ score: _score, ...rest }) => rest);
}

// The annual savings below which a further appeal rarely pays for itself.
export const APPEAL_MIN_ANNUAL_SAVINGS = 2000;

export function protestIntelligence(i: IntelligenceInput): ProtestIntelligence {
  const card = decisionCard(i);
  const cad = card.cadValue;
  const rate = i.effectiveTaxRate;
  const args = argumentStrengths(i.worksheet, cad);
  const winning = args.filter(
    (a) => a.strength === "Strong" || a.strength === "Moderate" || a.strength === "Weak",
  );
  const range = card.supportable;
  const answers: Answer[] = [];

  // 1. Should I protest?
  answers.push({
    id: "should",
    question: "Should I protest?",
    headline:
      card.verdict === "PROTEST"
        ? `Yes — ${card.strength.toLowerCase()} case`
        : card.verdict === "REVIEW"
          ? "Possibly — the case needs more evidence"
          : "Not on the evidence so far",
    points: [
      ...(card.savingsAtSettlement != null && card.likelySettlement != null
        ? [
            `About ${usd(card.savingsAtSettlement)} a year in tax savings at a likely ${m(card.likelySettlement)} settlement.`,
          ]
        : []),
      ...(card.verdict !== "PROTEST" && !range
        ? [
            "Run the valuation approaches in the property's report to see what value you can defend.",
          ]
        : []),
    ],
    tone: card.verdict === "PROTEST" ? "good" : card.verdict === "REVIEW" ? "caution" : "neutral",
  });

  // 2. Why?
  const below = winning.length;
  answers.push({
    id: "why",
    question: "Why?",
    headline:
      below > 0 && cad != null
        ? `${below} of ${args.length} valuation approaches put the value below the county's ${m(cad)}`
        : "The county-data signals are the main basis so far",
    points: [
      ...i.scoreFactors.slice(0, 3),
      ...(card.evidenceStrength != null
        ? [`County-data protest score: ${card.evidenceStrength}/100.`]
        : []),
    ],
    tone: below > 0 ? "good" : "neutral",
  });

  // 3. What value can I defend?
  answers.push({
    id: "defend",
    question: "What value can I defend?",
    headline: range ? `${m(range.low)}–${m(range.high)}` : "Not established yet",
    points: range
      ? [
          card.supportableBasis + ".",
          ...(card.openingPosition != null
            ? [
                `Open negotiations at ${m(card.openingPosition)} — just below that range, leaving room to settle.`,
              ]
            : []),
        ]
      : [card.supportableBasis + "."],
    tone: range ? "good" : "neutral",
  });

  // 4. What evidence proves it?
  const proving = winning.filter((a) => a.strength !== "Weak");
  const notRun = args.filter((a) => a.strength === "Not run").map((a) => a.name);
  answers.push({
    id: "evidence",
    question: "What evidence proves it?",
    headline:
      proving.length > 0
        ? proving.map((a) => `${a.name} (${a.value != null ? m(a.value) : "—"})`).join(", ")
        : i.evidenceDocuments.length > 0
          ? `${i.evidenceDocuments.length} evidence document${i.evidenceDocuments.length === 1 ? "" : "s"} on file`
          : "No supporting analysis yet",
    points: [
      ...(i.evidenceDocuments.length > 0
        ? [
            `On file: ${i.evidenceDocuments.slice(0, 4).join(", ")}${i.evidenceDocuments.length > 4 ? ` and ${i.evidenceDocuments.length - 4} more` : ""}.`,
          ]
        : [
            "No protest evidence uploaded yet — rent roll, P&L, photos, repair bids and comparable sales all help.",
          ]),
      ...(notRun.length > 0
        ? [`Not run yet: ${notRun.join(", ")} — add the data to strengthen the case.`]
        : []),
    ],
    tone: proving.length > 0 ? "good" : "caution",
  });

  // 5. How strong is each argument? (the list itself renders from `arguments`)
  answers.push({
    id: "strength",
    question: "How strong is each argument?",
    headline:
      winning.length > 0
        ? `Lead with ${winning[0].name}${winning[1] ? `; support with ${winning[1].name}` : ""}`
        : "No argument below the county's value yet",
    points: [],
    tone: winning.some((a) => a.strength === "Strong") ? "good" : "caution",
  });

  // 6. What will the CAD probably argue?
  const lead = winning[0];
  const support = args.filter((a) => a.strength === "Supports county");
  answers.push({
    id: "cad",
    question: "What will the CAD probably argue?",
    headline:
      i.cadReview && i.cadArguesFor != null
        ? `Its evidence argues for ${m(i.cadArguesFor)}`
        : lead
          ? `Against your ${lead.name}: ${CAD_REBUTTAL[lead.id]}`
          : "That its value is supported by the market",
    points: [
      ...(i.cadReview
        ? [
            `Corvus found ${i.cadReview.weaknesses.length} weakness${i.cadReview.weaknesses.length === 1 ? "" : "es"} in its evidence${
              i.cadReview.weaknesses.length
                ? `: ${[...new Set(i.cadReview.weaknesses.map((w) => WEAKNESS_LABEL[w.category].toLowerCase()))].slice(0, 4).join(", ")}`
                : ""
            }.`,
          ]
        : [
            "Request the district's evidence (Tax Code §41.461) to see its actual case before the hearing.",
          ]),
      ...support.map(
        (a) =>
          `Your own ${a.name}${a.value != null ? ` (${m(a.value)})` : ""} supports the county's value — expect the district to point to it.`,
      ),
      ...(winning[1] ? [`Against your ${winning[1].name}: ${CAD_REBUTTAL[winning[1].id]}.`] : []),
    ],
    tone: "neutral",
  });

  // 7. What should I accept informally?
  const acceptUpTo = card.likelySettlement;
  const judgmentUpTo = range ? Math.round(range.high * 1.05) : null;
  answers.push({
    id: "accept",
    question: "What should I accept informally?",
    headline:
      card.offer != null
        ? `${card.offer.decision}: the ${m(card.offer.offer)} offer`
        : acceptUpTo != null
          ? `Accept ${m(acceptUpTo)} or lower`
          : "Set once you have a supportable range",
    points: [
      ...(card.offer ? [card.offer.reasoning] : []),
      ...(acceptUpTo != null && judgmentUpTo != null
        ? [
            `At or below ${m(acceptUpTo)}: accept — an ARB hearing is unlikely to do better.`,
            `${m(acceptUpTo)}–${m(judgmentUpTo)}: a judgment call between certainty now and more savings at the ARB.`,
            `Above ${m(judgmentUpTo)}: decline and go to the ARB.`,
          ]
        : []),
    ],
    tone: card.offer?.decision === "Accept" ? "good" : card.offer ? "caution" : "neutral",
  });

  // 8. What should I ask the ARB for?
  answers.push({
    id: "ask",
    question: "What should I ask the ARB for?",
    headline:
      range && lead?.value != null
        ? `${m(Math.max(range.low, lead.value))}, on your ${lead.name}`
        : range
          ? m(range.low)
          : "Set once you have a supportable range",
    points: [
      ...(lead
        ? [
            `Present ${lead.name} first${winning[1] ? `, then ${winning[1].name} as corroboration` : ""}.`,
          ]
        : []),
      ...(i.cadReview?.hearingResponse
        ? ["Rebut the district's evidence with Corvus's drafted hearing response."]
        : []),
      ...(card.likelySettlement != null
        ? [`A realistic outcome is around ${m(card.likelySettlement)}.`]
        : []),
    ],
    tone: range ? "good" : "neutral",
  });

  // 9. Is further appeal economically rational?
  let appealHeadline: string;
  const appealPoints: string[] = [];
  if (card.result) {
    appealHeadline =
      card.result.furtherAppeal === "Worth reviewing" ? "Worth reviewing" : "Probably not";
    appealPoints.push(card.result.furtherAppealReason);
    if (card.result.arbitrationEligible != null) {
      appealPoints.push(
        card.result.arbitrationEligible
          ? `Binding arbitration is available${card.result.arbitrationDeadline ? ` — file by ${card.result.arbitrationDeadline}` : ""}.`
          : "Binding arbitration isn't available for this property; district court is the remaining route.",
      );
    }
  } else if (range && rate > 0) {
    const threshold = Math.round(range.low + APPEAL_MIN_ANNUAL_SAVINGS / rate);
    appealHeadline = `Only if the ARB leaves you above ${m(threshold)}`;
    appealPoints.push(
      `Below that, less than ${usd(APPEAL_MIN_ANNUAL_SAVINGS)} a year is still at stake — rarely worth an arbitration deposit or attorney fees.`,
      "Decide within 60 days of receiving the ARB's order (Tax Code §41A.03, §42.21).",
    );
  } else {
    appealHeadline = "Decide after the ARB's order";
    appealPoints.push("Corvus will compare the ARB's value to what your evidence supports.");
  }
  answers.push({
    id: "appeal",
    question: "Is further appeal economically rational?",
    headline: appealHeadline,
    points: appealPoints,
    tone: card.result?.furtherAppeal === "Worth reviewing" ? "good" : "neutral",
  });

  return { card, arguments: args, answers };
}
