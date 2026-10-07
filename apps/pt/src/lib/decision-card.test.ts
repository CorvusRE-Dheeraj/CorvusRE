import { describe, expect, it } from "vitest";
import { decisionCard, type DecisionCardInput } from "./decision-card";
import type { ProtestRecord } from "./protests";
import type { WorksheetSummary } from "./valuation-worksheet";

const worksheet: WorksheetSummary = {
  cadValue: 8_450_000,
  approaches: [
    {
      id: "equity",
      name: "Equal & Uniform",
      status: "indicated",
      indicatedValue: 6_900_000,
      steps: [],
    },
    {
      id: "income",
      name: "Income Approach",
      status: "indicated",
      indicatedValue: 7_400_000,
      steps: [],
    },
    { id: "cost", name: "Cost Approach", status: "needs_data", indicatedValue: null, steps: [] },
    {
      id: "sales",
      name: "Sales Comparison",
      status: "indicated",
      indicatedValue: 9_000_000,
      steps: [],
    },
  ],
  lowest: { name: "Equal & Uniform", value: 6_900_000 },
  computedAt: "2026-10-07T00:00:00Z",
};

const protest = (over: Partial<ProtestRecord> = {}): ProtestRecord =>
  ({
    id: "pr1",
    propertyId: "p1",
    status: "filed",
    originalValue: 8_450_000,
    settlementOfferValue: null,
    informalStatus: "not_requested",
    finalValue: null,
    arbDecision: null,
    ...over,
  }) as ProtestRecord;

const base: DecisionCardInput = {
  cadValue: 8_450_000,
  effectiveTaxRate: 0.022,
  healthScore: 82,
  worksheet,
  estimatedSavings: null,
  protest: null,
  cadReview: null,
  annualCost: 499,
  arbitration: null,
};

describe("decisionCard — assess", () => {
  it("recommends a strong protest with the supportable range, settlement and savings", () => {
    const c = decisionCard(base);
    expect(c).toMatchObject({
      stage: "assess",
      verdict: "PROTEST",
      strength: "Strong",
      supportable: { low: 6_900_000, high: 7_400_000 },
      openingPosition: 6_790_000,
      likelySettlement: 7_250_000,
      evidenceStrength: 82,
      savingsAtSettlement: 26_400,
    });
    // Approaches above the county value are not arguments.
    expect(c.arguments).toEqual(["Equal & Uniform", "Income Approach"]);
  });

  it("falls back to the savings estimate without a worksheet", () => {
    const c = decisionCard({ ...base, worksheet: null, estimatedSavings: 22_000 });
    // 22,000 / 2.2% = $1M over → ~$7.45M, ±3%
    expect(c.supportable).toEqual({ low: 7_230_000, high: 7_670_000 });
    expect(c.arguments).toEqual([]);
  });

  it("doesn't recommend protesting without evidence", () => {
    const c = decisionCard({ ...base, worksheet: null, healthScore: 20 });
    expect(c.verdict).toBe("NO PROTEST");
    expect(c.supportable).toBeNull();
  });
});

describe("decisionCard — CAD evidence", () => {
  it("summarizes the weaknesses found", () => {
    const c = decisionCard({
      ...base,
      protest: protest(),
      cadReview: {
        hearingResponse: "Point by point…",
        weaknesses: [
          { category: "location", finding: "Comp 1 better location", detail: "", item: null },
          { category: "location", finding: "Comp 2 better location", detail: "", item: null },
          { category: "size", finding: "Comp 3 is 42% smaller", detail: "", item: null },
          { category: "subject_data", finding: "Year built wrong", detail: "", item: null },
        ],
      },
    });
    expect(c.stage).toBe("evidence");
    expect(c.evidence).toEqual({
      weaknessCount: 4,
      lines: ["2 Comp location", "1 Comp size", "1 Your property's data"],
      responseReady: true,
    });
  });
});

describe("decisionCard — informal offer", () => {
  it("calls an offer just above the range borderline, with the extra savings at stake", () => {
    const c = decisionCard({
      ...base,
      protest: protest({
        informalStatus: "proposed_value_received",
        settlementOfferValue: 7_550_000,
      }),
    });
    expect(c.stage).toBe("offer");
    expect(c.offer).toMatchObject({
      decision: "Borderline",
      savingsAtOffer: 19_800,
      additionalSavings: { low: 3_300, high: 14_300 },
    });
  });

  it("accepts an offer at the floor and sends a high offer to the ARB", () => {
    const accept = decisionCard({
      ...base,
      protest: protest({
        informalStatus: "proposed_value_received",
        settlementOfferValue: 6_900_000,
      }),
    });
    expect(accept.offer?.decision).toBe("Accept");
    const arb = decisionCard({
      ...base,
      protest: protest({
        informalStatus: "proposed_value_received",
        settlementOfferValue: 8_200_000,
      }),
    });
    expect(arb.offer?.decision).toBe("Proceed to ARB");
  });
});

describe("decisionCard — result", () => {
  it("reports the reduction, savings and net first-year benefit", () => {
    const c = decisionCard({
      ...base,
      protest: protest({ status: "resolved", finalValue: 7_310_000, arbDecision: "partial" }),
      arbitration: { eligible: true, deadline: "2026-09-30", daysRemaining: 45 },
    });
    expect(c.stage).toBe("result");
    expect(c.result).toMatchObject({
      reduction: 1_140_000,
      annualSavings: 25_080,
      netFirstYear: 24_581,
      arbitrationEligible: true,
      arbitrationDaysLeft: 45,
      furtherAppeal: "Worth reviewing",
    });
  });

  it("calls further appeal low priority when the final value is near the floor", () => {
    const c = decisionCard({
      ...base,
      protest: protest({ status: "resolved", finalValue: 6_950_000, arbDecision: "approved" }),
    });
    expect(c.result?.furtherAppeal).toBe("Low priority");
  });
});
