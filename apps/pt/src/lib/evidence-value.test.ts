import { describe, expect, it } from "vitest";
import {
  applyEvidenceToEstimate,
  baseIndicatedValue,
  computeEvidenceAdjustment,
  type ValueSignal,
} from "./evidence-value";
import type { SavingsEstimate } from "./savings-estimate";

const sig = (over: Partial<ValueSignal>): ValueSignal => ({
  kind: "independent_appraisal",
  valuationDate: null,
  indicatedValue: null,
  costToCure: null,
  netOperatingIncome: null,
  capRatePct: null,
  occupancyPct: null,
  sales: [],
  conditionIssues: [],
  confidence: "high",
  summary: "",
  notes: [],
  readAt: "2026-09-26T00:00:00Z",
  ...over,
});

const V = 1_000_000;
const base: SavingsEstimate = {
  basis: "formula",
  amount: 1800,
  reductionPct: 10,
  effectiveTaxRatePct: 2,
  rationale: "model",
};

describe("evidence-value", () => {
  it("does nothing without usable evidence", () => {
    const adj = computeEvidenceAdjustment({
      cadValue: V,
      baseIndicated: 900_000,
      baseBasis: "formula",
      signals: [sig({ kind: "not_valuation_evidence" })],
    });
    expect(adj.applied).toBe(false);
    expect(applyEvidenceToEstimate(base, V, 2, adj)).toBe(base);
  });

  it("a lower appraisal increases the savings", () => {
    const adj = computeEvidenceAdjustment({
      cadValue: V,
      baseIndicated: baseIndicatedValue(base, V),
      baseBasis: "formula",
      signals: [sig({ indicatedValue: 700_000 })],
    });
    expect(adj.applied).toBe(true);
    expect(adj.direction).toBe("lowers");
    const next = applyEvidenceToEstimate(base, V, 2, adj);
    expect(next && next.amount).toBeGreaterThan(base.amount);
  });

  it("an appraisal at or above the county value reduces the savings, down to zero", () => {
    const adj = computeEvidenceAdjustment({
      cadValue: V,
      baseIndicated: 900_000,
      baseBasis: "formula",
      signals: [sig({ indicatedValue: 1_050_000 })],
    });
    expect(adj.direction).toBe("raises");
    const next = applyEvidenceToEstimate(base, V, 2, adj);
    expect(next && next.amount).toBeLessThan(base.amount);
    expect(next && next.amount).toBeGreaterThanOrEqual(0);
  });

  it("repair costs lower the value", () => {
    const adj = computeEvidenceAdjustment({
      cadValue: V,
      baseIndicated: 900_000,
      baseBasis: "formula",
      signals: [sig({ kind: "repair_estimate", costToCure: 100_000 })],
    });
    expect(adj.indicatedValue).toBe(800_000);
    expect(adj.costToCure).toBe(100_000);
  });

  it("low confidence counts for less than high confidence", () => {
    const run = (confidence: ValueSignal["confidence"]) =>
      computeEvidenceAdjustment({
        cadValue: V,
        baseIndicated: 900_000,
        baseBasis: "formula",
        signals: [sig({ indicatedValue: 600_000, confidence })],
      }).indicatedValue as number;
    expect(run("high")).toBeLessThan(run("low"));
  });

  it("turns NOI and a cap rate into a value", () => {
    const adj = computeEvidenceAdjustment({
      cadValue: V,
      baseIndicated: null,
      baseBasis: null,
      signals: [sig({ kind: "income_statement", netOperatingIncome: 60_000, capRatePct: 8 })],
    });
    expect(adj.evidenceIndicatedValue).toBe(750_000);
  });

  it("is deterministic: the same evidence gives the same result", () => {
    const args = {
      cadValue: V,
      baseIndicated: 900_000,
      baseBasis: "comps" as const,
      signals: [
        sig({ indicatedValue: 750_000 }),
        sig({ kind: "repair_estimate", costToCure: 20_000 }),
      ],
    };
    expect(computeEvidenceAdjustment(args)).toEqual(computeEvidenceAdjustment(args));
  });

  it("never estimates a value above the county value or below 40% of it", () => {
    const hi = computeEvidenceAdjustment({
      cadValue: V,
      baseIndicated: null,
      baseBasis: null,
      signals: [sig({ indicatedValue: 2_000_000 })],
    });
    expect(hi.indicatedValue).toBe(V);
    const lo = computeEvidenceAdjustment({
      cadValue: V,
      baseIndicated: null,
      baseBasis: null,
      signals: [sig({ indicatedValue: 350_000 })],
    });
    expect(lo.indicatedValue).toBe(400_000);
  });
});

describe("evidence-value — repairs alongside an appraisal", () => {
  it("does not deduct repairs again when an appraisal is present", () => {
    const withBoth = computeEvidenceAdjustment({
      cadValue: V,
      baseIndicated: null,
      baseBasis: null,
      signals: [
        sig({ indicatedValue: 700_000 }),
        sig({ kind: "repair_estimate", costToCure: 50_000 }),
      ],
    });
    const appraisalOnly = computeEvidenceAdjustment({
      cadValue: V,
      baseIndicated: null,
      baseBasis: null,
      signals: [sig({ indicatedValue: 700_000 })],
    });
    expect(withBoth.indicatedValue).toBe(appraisalOnly.indicatedValue);
    expect(withBoth.contributions.some((c) => c.label === "Repair estimate")).toBe(true);
  });
});
