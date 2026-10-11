import {
  APPROACH_WEIGHT,
  decisionCard,
  OFFER_LABEL,
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
    "Built from the county's own appraisal roll — Texas caps your value at the median of comparable appraisals (Tax Code §41.43(b)(3)), so ARBs often find it difficult to dismiss.",
  income:
    "Built from your property's actual income — persuasive for income-producing property when the rent roll and P&L are complete.",
  sales: "Real sales of comparable properties — strong when the sales are verified and recent.",
  land: "Targets the land value on its own — useful when the county's land rate is out of line with nearby parcels.",
  impairments:
    "Deducts what a buyer would pay to fix problems — holds up when backed by contractor bids or inspection reports.",
  cost: "Relies on a replacement-cost estimate — generally carries more weight as supporting evidence than as the lead argument.",
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
    question: "Is there a protest opportunity?",
    headline:
      card.verdict === "PROTEST"
        ? `Corvus AI identifies a potential protest opportunity — ${card.strength.toLowerCase()} case`
        : card.verdict === "REVIEW"
          ? "A possible opportunity — Corvus AI needs more evidence to assess it"
          : "Corvus AI hasn't identified a clear opportunity on the evidence so far",
    points: [
      ...(card.savingsAtSettlement != null && card.likelySettlement != null
        ? [
            `Corvus AI estimates about ${usd(card.savingsAtSettlement)} a year in tax savings if the value settles near ${m(card.likelySettlement)}.`,
          ]
        : []),
      ...(card.verdict !== "PROTEST" && !range
        ? [
            "Running the valuation approaches in the property's report would show what value the evidence may support.",
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
    question: "What value does the evidence support?",
    headline: range ? `${m(range.low)}–${m(range.high)}` : "Not established yet",
    points: range
      ? [
          card.supportableBasis + ".",
          ...(card.openingPosition != null
            ? [
                `A potential opening position to consider: ${m(card.openingPosition)} — just below that range, which would leave room to negotiate.`,
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
    question: "What evidence supports it?",
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
            "No protest evidence uploaded yet — a rent roll, P&L, photos, repair bids and comparable sales can each add support.",
          ]),
      ...(notRun.length > 0
        ? [`Not run yet: ${notRun.join(", ")} — adding the data could strengthen the analysis.`]
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
        ? `Corvus AI rates ${winning[0].name} strongest${winning[1] ? `, then ${winning[1].name}` : ""}`
        : "No argument below the county's value yet",
    points: [],
    tone: winning.some((a) => a.strength === "Strong") ? "good" : "caution",
  });

  // 6. What will the CAD probably argue?
  const lead = winning[0];
  const support = args.filter((a) => a.strength === "Supports county");
  answers.push({
    id: "cad",
    question: "What might the district argue?",
    headline:
      i.cadReview && i.cadArguesFor != null
        ? `Its evidence points to ${m(i.cadArguesFor)}`
        : lead
          ? `Possibly, against the ${lead.name}: ${CAD_REBUTTAL[lead.id]}`
          : "Likely that its value is supported by the market",
    points: [
      ...(i.cadReview
        ? [
            `Corvus AI found ${i.cadReview.weaknesses.length} weakness${i.cadReview.weaknesses.length === 1 ? "" : "es"} in its evidence${
              i.cadReview.weaknesses.length
                ? `: ${[...new Set(i.cadReview.weaknesses.map((w) => WEAKNESS_LABEL[w.category].toLowerCase()))].slice(0, 4).join(", ")}`
                : ""
            }.`,
          ]
        : [
            "Owners may request the district's evidence (Tax Code §41.461) to see its actual case before the hearing.",
          ]),
      ...support.map(
        (a) =>
          `The ${a.name}${a.value != null ? ` (${m(a.value)})` : ""} supports the county's value — the district may point to it.`,
      ),
      ...(winning[1] ? [`Against the ${winning[1].name}: ${CAD_REBUTTAL[winning[1].id]}.`] : []),
    ],
    tone: "neutral",
  });

  // 7. What should I accept informally?
  const acceptUpTo = card.likelySettlement;
  const judgmentUpTo = range ? Math.round(range.high * 1.05) : null;
  answers.push({
    id: "accept",
    question: "How might an informal offer compare?",
    headline:
      card.offer != null
        ? `The ${m(card.offer.offer)} offer: ${OFFER_LABEL[card.offer.decision].toLowerCase()}`
        : acceptUpTo != null
          ? `Corvus AI's estimated likely outcome: ${m(acceptUpTo)} or lower`
          : "Estimated once Corvus AI has a supportable range",
    points: [
      ...(card.offer ? [card.offer.reasoning] : []),
      ...(acceptUpTo != null && judgmentUpTo != null
        ? [
            `At or below ${m(acceptUpTo)}: within Corvus AI's estimated outcome — by its analysis, an ARB hearing may not do better.`,
            `${m(acceptUpTo)}–${m(judgmentUpTo)}: a judgment call between certainty now and possible further savings at the ARB.`,
            `Above ${m(judgmentUpTo)}: above the range the evidence supports — a formal ARB hearing is an option to consider.`,
          ]
        : []),
    ],
    tone: card.offer?.decision === "Accept" ? "good" : card.offer ? "caution" : "neutral",
  });

  // 8. What should I ask the ARB for?
  answers.push({
    id: "ask",
    question: "What value could be presented to the ARB?",
    headline:
      range && lead?.value != null
        ? `Corvus AI estimates ${m(Math.max(range.low, lead.value))} as a potential value to consider, based on the ${lead.name}`
        : range
          ? `Corvus AI estimates ${m(range.low)} as a potential value to consider`
          : "Estimated once Corvus AI has a supportable range",
    points: [
      ...(lead
        ? [
            `By Corvus AI's ranking, ${lead.name} is the strongest argument${winning[1] ? `, with ${winning[1].name} as corroboration` : ""}.`,
          ]
        : []),
      ...(i.cadReview?.hearingResponse
        ? ["Corvus AI has drafted a hearing response to the district's evidence for your review."]
        : []),
      ...(card.likelySettlement != null
        ? [`Corvus AI estimates a realistic outcome around ${m(card.likelySettlement)}.`]
        : []),
    ],
    tone: range ? "good" : "neutral",
  });

  // 9. Is further appeal economically rational?
  let appealHeadline: string;
  const appealPoints: string[] = [];
  if (card.result) {
    appealHeadline =
      card.result.furtherAppeal === "Worth reviewing"
        ? "Worth reviewing"
        : "Lower priority by the numbers";
    appealPoints.push(card.result.furtherAppealReason);
    if (card.result.arbitrationEligible != null) {
      appealPoints.push(
        card.result.arbitrationEligible
          ? `Binding arbitration appears available${card.result.arbitrationDeadline ? ` — the filing deadline is ${card.result.arbitrationDeadline}` : ""}.`
          : "Binding arbitration doesn't appear available for this property; district court is the remaining route.",
      );
    }
  } else if (range && rate > 0) {
    const threshold = Math.round(range.low + APPEAL_MIN_ANNUAL_SAVINGS / rate);
    appealHeadline = `Worth reviewing if the ARB's value is above ${m(threshold)}`;
    appealPoints.push(
      `Below that, Corvus AI estimates less than ${usd(APPEAL_MIN_ANNUAL_SAVINGS)} a year would still be at stake — often less than an arbitration deposit or attorney fees.`,
      "The appeal deadline is 60 days from receiving the ARB's order (Tax Code §41A.03, §42.21).",
    );
  } else {
    appealHeadline = "Assessed after the ARB's order";
    appealPoints.push(
      "Corvus AI will compare the ARB's value with the range it estimates the evidence supports.",
    );
  }
  answers.push({
    id: "appeal",
    question: "How do the further-appeal economics look?",
    headline: appealHeadline,
    points: appealPoints,
    tone: card.result?.furtherAppeal === "Worth reviewing" ? "good" : "neutral",
  });

  return { card, arguments: args, answers };
}
