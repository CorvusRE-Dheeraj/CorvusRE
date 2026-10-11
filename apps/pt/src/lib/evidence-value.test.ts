import { describe, expect, it } from "vitest";
import {
  applyEvidenceToEstimate,
  baseIndicatedValue,
  computeEvidenceAdjustment,
  computeModuleEffects,
  evidenceWeight,
  type EvidenceAssessment,
  type EvidenceItem,
  type ValueSignal,
} from "./evidence-value";
import type { SavingsEstimate } from "./savings-estimate";

const assess = (over: Partial<EvidenceAssessment> = {}): EvidenceAssessment => ({
  relevance: 90,
  quality: 90,
  independence: "third_party_licensed",
  currentness: "current",
  supports: "protest",
  modules: [],
  importance: "critical",
  rationale: "test",
  ...over,
});

const sig = (over: Partial<ValueSignal> = {}): ValueSignal => ({
  schemaVersion: 2,
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
  assessment: assess(),
  summary: "",
  notes: [],
  readAt: "2026-09-26T00:00:00Z",
  ...over,
});

const item = (over: Partial<ValueSignal> = {}, id = "d1"): EvidenceItem => ({
  docId: id,
  fileName: `${id}.pdf`,
  signal: sig(over),
});

const V = 1_000_000;
const base: SavingsEstimate = {
  basis: "formula",
  amount: 1800,
  reductionPct: 10,
  effectiveTaxRatePct: 2,
  rationale: "model",
};

const adjust = (items: EvidenceItem[], baseIndicated: number | null = 900_000) =>
  computeEvidenceAdjustment({ cadValue: V, baseIndicated, baseBasis: "formula", items });

describe("evidence importance", () => {
  it("does nothing without usable evidence", () => {
    const adj = adjust([item({ kind: "not_valuation_evidence" })]);
    expect(adj.applied).toBe(false);
    expect(applyEvidenceToEstimate(base, V, 2, adj)).toBe(base);
  });

  it("a critical appraisal counts for far more than a minor one", () => {
    const critical = evidenceWeight(sig({ indicatedValue: 700_000 }));
    const minor = evidenceWeight(
      sig({ indicatedValue: 700_000, assessment: assess({ importance: "minor", quality: 30 }) }),
    );
    expect(critical).toBeGreaterThan(minor * 2);
  });

  it("a critical appraisal moves the savings much more than a weak one", () => {
    const strongAdj = adjust([item({ indicatedValue: 600_000 })]);
    const weakAdj = adjust([
      item({
        indicatedValue: 600_000,
        assessment: assess({ importance: "minor", quality: 25, independence: "owner_prepared" }),
        confidence: "low",
      }),
    ]);
    const s = applyEvidenceToEstimate(base, V, 2, strongAdj);
    const w = applyEvidenceToEstimate(base, V, 2, weakAdj);
    expect(s && s.amount).toBeGreaterThan((w && w.amount) ?? 0);
    expect(weakAdj.moduleUplift.comps).toBeLessThan(strongAdj.moduleUplift.comps);
  });

  it("several important pieces together push the scores higher, with diminishing returns", () => {
    const one = computeModuleEffects([item({ kind: "comparable_sales" })], V).comps.net;
    const three = computeModuleEffects(
      [
        item({ kind: "comparable_sales" }, "a"),
        item({ kind: "comparable_sales" }, "b"),
        item({ kind: "independent_appraisal", indicatedValue: 700_000 }, "c"),
      ],
      V,
    ).comps.net;
    expect(three).toBeGreaterThan(one);
    expect(three).toBeLessThan(1);
  });

  it("a kind's ceiling caps the model: condition photos can never count as critical", () => {
    expect(evidenceWeight(sig({ kind: "condition_photos" }))).toBeLessThanOrEqual(0.5);
  });

  it("evidence that supports the county value lowers the scores and the savings", () => {
    const adj = adjust([item({ indicatedValue: 1_100_000 })]);
    expect(adj.direction).toBe("raises");
    expect(adj.moduleUplift.value).toBeLessThan(0);
    const next = applyEvidenceToEstimate(base, V, 2, adj);
    expect(next && next.amount).toBeLessThan(base.amount);
  });

  it("condition evidence raises the improvement analysis", () => {
    const adj = adjust([
      item({ kind: "condition_photos", assessment: assess({ importance: "moderate" }) }),
    ]);
    expect(adj.moduleUplift.improvement).toBeGreaterThan(0);
  });

  it("does not deduct repairs again when an appraisal is present", () => {
    const both = adjust(
      [
        item({ indicatedValue: 700_000 }),
        item({ kind: "repair_estimate", costToCure: 50_000 }, "r"),
      ],
      null,
    );
    const only = adjust([item({ indicatedValue: 700_000 })], null);
    expect(both.indicatedValue).toBe(only.indicatedValue);
  });

  it("repairs lower the value when there is no appraisal", () => {
    const adj = adjust([item({ kind: "repair_estimate", costToCure: 100_000 })], 900_000);
    expect(adj.indicatedValue).toBeLessThan(900_000);
  });

  it("turns NOI and a cap rate into a value", () => {
    const adj = adjust(
      [item({ kind: "income_statement", netOperatingIncome: 60_000, capRatePct: 8 })],
      null,
    );
    expect(adj.evidenceIndicatedValue).toBe(750_000);
  });

  it("reports what each file alone did", () => {
    const adj = adjust([
      item({ indicatedValue: 700_000 }, "a"),
      item({ kind: "comparable_sales" }, "b"),
    ]);
    const a = adj.contributions.find((c) => c.docId === "a");
    expect(a && a.effects.length).toBeGreaterThan(0);
    expect(a && a.importance).toBe("Critical");
  });

  it("never estimates a value above the county value or below 40% of it", () => {
    expect(adjust([item({ indicatedValue: 2_000_000 })], null).indicatedValue).toBe(V);
    expect(adjust([item({ indicatedValue: 350_000 })], null).indicatedValue).toBe(400_000);
  });

  it("is deterministic", () => {
    const items = [
      item({ indicatedValue: 750_000 }, "a"),
      item({ kind: "repair_estimate", costToCure: 20_000 }, "b"),
    ];
    expect(adjust(items)).toEqual(adjust(items));
  });

  it("baseIndicatedValue reads the estimate", () => {
    expect(baseIndicatedValue(base, V)).toBe(900_000);
  });
});

describe("applyPoints", () => {
  it("adds points in full at low scores and tapers near the top", async () => {
    const { applyPoints } = await import("./evidence-value");
    expect(applyPoints(50, 20)).toBe(60);
    expect(applyPoints(90, 20)).toBeLessThan(93);
    expect(applyPoints(60, -20)).toBeGreaterThanOrEqual(5);
    expect(applyPoints(96, 30)).toBeLessThanOrEqual(98);
    expect(applyPoints(50, 0)).toBe(50);
  });
});
