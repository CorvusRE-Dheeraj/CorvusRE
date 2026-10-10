import { describe, expect, it } from "vitest";
import {
  argumentStrengths,
  protestIntelligence,
  type IntelligenceInput,
} from "./protest-intelligence";
import type { ProtestRecord } from "./protests";
import type { WorksheetSummary } from "./valuation-worksheet";

const worksheet: WorksheetSummary = {
  cadValue: 8_450_000,
  approaches: [
    {
      id: "income",
      name: "Income Approach",
      status: "indicated",
      indicatedValue: 7_400_000,
      steps: [],
    },
    {
      id: "sales",
      name: "Sales Comparison",
      status: "indicated",
      indicatedValue: 9_000_000,
      steps: [],
    },
    {
      id: "equity",
      name: "Equal & Uniform",
      status: "indicated",
      indicatedValue: 6_900_000,
      steps: [],
    },
    { id: "cost", name: "Cost Approach", status: "needs_data", indicatedValue: null, steps: [] },
    {
      id: "land",
      name: "Land / Improvement Analysis",
      status: "supports_cad",
      indicatedValue: null,
      steps: [],
    },
    {
      id: "impairments",
      name: "Property-Specific Impairments",
      status: "indicated",
      indicatedValue: 8_300_000,
      steps: [],
    },
  ],
  lowest: { name: "Equal & Uniform", value: 6_900_000 },
  computedAt: "",
};

const base: IntelligenceInput = {
  cadValue: 8_450_000,
  effectiveTaxRate: 0.022,
  healthScore: 82,
  worksheet,
  estimatedSavings: null,
  protest: null,
  cadReview: null,
  annualCost: 3_588,
  arbitration: null,
  scoreFactors: ["Assessed 18% above comparable properties", "Value up 22% in two years"],
  evidenceDocuments: ["Rent Roll 2026.pdf", "P&L 2025.pdf"],
  cadArguesFor: null,
};

const answer = (pi: ReturnType<typeof protestIntelligence>, id: string) =>
  pi.answers.find((a) => a.id === id)!;

describe("argumentStrengths", () => {
  it("ranks arguments by weighted gap, with non-arguments last", () => {
    const a = argumentStrengths(worksheet, 8_450_000);
    expect(a.map((x) => [x.name, x.strength])).toEqual([
      ["Equal & Uniform", "Strong"], // 18.3% under, full weight
      ["Income Approach", "Strong"], // 12.4% under
      ["Property-Specific Impairments", "Weak"], // 1.8% under
      ["Sales Comparison", "Supports county"],
      ["Land / Improvement Analysis", "Supports county"],
      ["Cost Approach", "Not run"],
    ]);
    expect(a[0].gapPct).toBe(18.3);
  });
});

describe("protestIntelligence", () => {
  const pi = protestIntelligence(base);

  it("answers all nine questions in order", () => {
    expect(pi.answers.map((a) => a.question)).toEqual([
      "Is there a protest opportunity?",
      "Why?",
      "What value does the evidence support?",
      "What evidence supports it?",
      "How strong is each argument?",
      "What might the district argue?",
      "How might an informal offer compare?",
      "What value could be presented to the ARB?",
      "How do the further-appeal economics look?",
    ]);
  });

  it("identifies the protest opportunity and explains why", () => {
    expect(answer(pi, "should").headline).toBe(
      "Corvus AI identifies a potential protest opportunity — strong case",
    );
    expect(answer(pi, "should").points[0]).toContain("$26,400");
    expect(answer(pi, "why").headline).toBe(
      "3 of 6 valuation approaches put the value below the county's $8.45M",
    );
    expect(answer(pi, "why").points).toContain("Assessed 18% above comparable properties");
  });

  it("gives the defensible range, evidence and lead argument", () => {
    expect(answer(pi, "defend").headline).toBe("$6.9M–$7.4M");
    expect(answer(pi, "evidence").points[0]).toContain("Rent Roll 2026.pdf");
    expect(answer(pi, "evidence").points[1]).toContain("Cost Approach");
    expect(answer(pi, "strength").headline).toBe(
      "Corvus AI rates Equal & Uniform strongest, then Income Approach",
    );
  });

  it("anticipates the CAD's case, including the owner's own weak spots", () => {
    const cad = answer(pi, "cad");
    expect(cad.headline).toMatch(/^Possibly, against the Equal & Uniform: that your comparables/);
    expect(
      cad.points.some((p) => p.includes("Sales Comparison") && p.includes("supports the county")),
    ).toBe(true);
  });

  it("sets informal-acceptance bands and the ARB ask", () => {
    expect(answer(pi, "accept").headline).toMatch(/^Corvus AI's estimated likely outcome: \$\d/);
    expect(answer(pi, "accept").points).toHaveLength(3);
    expect(answer(pi, "ask").headline).toBe(
      "Corvus AI estimates $6.9M as a potential value to consider, based on the Equal & Uniform",
    );
  });

  it("frames further appeal by the dollars still at stake", () => {
    // $6.9M + $2,000 / 2.2% ≈ $6.99M
    expect(answer(pi, "appeal").headline).toBe(
      "Worth reviewing if the ARB's value is above $6.99M",
    );
  });

  it("uses the CAD's reviewed evidence when there is one", () => {
    const withReview = protestIntelligence({
      ...base,
      protest: { id: "p", status: "hearing_scheduled", originalValue: 8_450_000 } as ProtestRecord,
      cadReview: {
        hearingResponse: "…",
        weaknesses: [
          { category: "size", finding: "Comp 2 is 42% smaller", detail: "", item: null },
        ],
      },
      cadArguesFor: 8_600_000,
    });
    const cad = answer(withReview, "cad");
    expect(cad.headline).toBe("Its evidence points to $8.6M");
    expect(cad.points[0]).toContain("1 weakness");
    expect(answer(withReview, "ask").points).toContain(
      "Corvus AI has drafted a hearing response to the district's evidence for your review.",
    );
  });
});
