import { describe, it, expect } from "vitest";
import { computeHealthScore, type HealthScoreSignals } from "./health-score";

function signals(over: Partial<HealthScoreSignals> = {}): HealthScoreSignals {
  return {
    totalValue: 3_000_000,
    landValue: 800_000,
    improvementValue: 2_200_000,
    valueHistory: [
      { year: 2024, total: 2_400_000 },
      { year: 2025, total: 2_700_000 },
      { year: 2026, total: 3_000_000 },
    ],
    assessmentRatio: { medianPct: 1, cod: 17.9, codOverCeiling: 3.6 },
    comps: { count: 5, gapPct: 12 },
    buildingSqft: 6_997,
    evidenceCount: 0,
    ...over,
  };
}

describe("computeHealthScore", () => {
  it("is fully deterministic — same input, same output every call", () => {
    const s = signals();
    const a = computeHealthScore(s);
    const b = computeHealthScore(s);
    const c = computeHealthScore(signals());
    expect(a).toEqual(b);
    expect(a).toEqual(c);
  });

  it("returns an empty low-confidence result when there is no CAD value", () => {
    const r = computeHealthScore(signals({ totalValue: null }));
    expect(r.score).toBe(0);
    expect(r.confidencePct).toBe(25);
    expect(r.dataSufficient).toBe(false);
    expect(r.scoreBreakdown).toEqual([]);
  });

  it("clamps the score to 15..90", () => {
    const high = computeHealthScore(
      signals({
        comps: { count: 8, gapPct: 60 },
        assessmentRatio: { medianPct: 1, cod: 40, codOverCeiling: 30 },
      }),
    );
    expect(high.score).toBeLessThanOrEqual(90);
    const low = computeHealthScore(
      signals({ comps: { count: 5, gapPct: -40 }, assessmentRatio: null, valueHistory: [] }),
    );
    expect(low.score).toBeGreaterThanOrEqual(15);
  });

  it("a bigger comps overvaluation gap raises the score, a negative gap lowers it", () => {
    const base = computeHealthScore(signals({ comps: { count: 5, gapPct: 0 } })).score;
    const over = computeHealthScore(signals({ comps: { count: 5, gapPct: 20 } })).score;
    const under = computeHealthScore(signals({ comps: { count: 5, gapPct: -15 } })).score;
    expect(over).toBeGreaterThan(base);
    expect(under).toBeLessThan(base);
  });

  it("a single input change moves the score only a bounded amount, never drastically", () => {
    const before = computeHealthScore(signals({ comps: { count: 5, gapPct: 10 } })).score;
    const after = computeHealthScore(signals({ comps: { count: 5, gapPct: 12 } })).score;
    expect(Math.abs(after - before)).toBeLessThanOrEqual(4);
  });

  it("confidence is a data-completeness tally — more real data, higher confidence", () => {
    const thin = computeHealthScore(
      signals({
        landValue: null,
        improvementValue: null,
        valueHistory: [],
        assessmentRatio: null,
        comps: null,
        buildingSqft: null,
      }),
    );
    const full = computeHealthScore(signals({ evidenceCount: 2 }));
    expect(thin.confidencePct).toBeLessThan(full.confidencePct);
    expect(thin.confidencePct).toBeGreaterThanOrEqual(25);
    expect(full.confidencePct).toBeLessThanOrEqual(92);
  });

  it("only includes breakdown labels the data can speak to", () => {
    const withComps = computeHealthScore(signals());
    expect(withComps.scoreBreakdown.map((b) => b.label)).toContain("Comparable Properties");

    const noComps = computeHealthScore(signals({ comps: null }));
    expect(noComps.scoreBreakdown.map((b) => b.label)).not.toContain("Comparable Properties");
    expect(noComps.scoreBreakdown.map((b) => b.label)).toContain("CAD Valuation");
  });
});

describe("computeHealthScore — owner evidence", () => {
  it("is unchanged when no evidence has been read", () => {
    expect(computeHealthScore(signals({ evidence: null }))).toEqual(computeHealthScore(signals()));
  });

  it("raises the score when evidence shows the county value is too high", () => {
    const base = computeHealthScore(signals()).score;
    const withEvidence = computeHealthScore(
      signals({ evidence: { valueGapPct: 15, strength: 0.8 } }),
    );
    expect(withEvidence.score).toBeGreaterThan(base);
    expect(withEvidence.scoreBreakdown.some((b) => b.label === "Owner Evidence")).toBe(true);
  });

  it("lowers the score when evidence supports the county value", () => {
    const base = computeHealthScore(signals()).score;
    const supporting = computeHealthScore(
      signals({ evidence: { valueGapPct: -10, strength: 0.8 } }),
    ).score;
    expect(supporting).toBeLessThan(base);
  });

  it("stronger evidence moves the score further", () => {
    const weak = computeHealthScore(signals({ evidence: { valueGapPct: 12, strength: 0.2 } }));
    const strong = computeHealthScore(signals({ evidence: { valueGapPct: 12, strength: 1 } }));
    expect(strong.score).toBeGreaterThanOrEqual(weak.score);
  });

  // Added per direct user research — CorvusPT's own beta testers,
  // independently, in every one of 3 real feedback sessions, asked for the
  // score to "show the math" instead of just stating a number. Every entry
  // must carry a real, non-empty sentence, and that sentence must actually
  // reflect the numbers behind it, not just exist.
  describe("scoreBreakdown reasons", () => {
    it("every breakdown entry has a non-empty reason", () => {
      const r = computeHealthScore(signals());
      expect(r.scoreBreakdown.length).toBeGreaterThan(0);
      for (const b of r.scoreBreakdown) {
        expect(b.reason).toBeTruthy();
        expect(b.reason.length).toBeGreaterThan(10);
      }
    });

    it("the Comparable Properties reason cites the real comp count and direction", () => {
      const r = computeHealthScore(signals({ comps: { count: 5, gapPct: 12 } }));
      const entry = r.scoreBreakdown.find((b) => b.label === "Comparable Properties")!;
      expect(entry.reason).toContain("5");
      expect(entry.reason).toMatch(/above/i);
    });

    it("flips direction in the reason when comps say the property is under-assessed", () => {
      const r = computeHealthScore(signals({ comps: { count: 4, gapPct: -15 } }));
      const entry = r.scoreBreakdown.find((b) => b.label === "Comparable Properties")!;
      expect(entry.reason).not.toMatch(/above/i);
    });

    it("the Historical Valuation reason cites the real jump percentage", () => {
      const r = computeHealthScore(
        signals({
          valueHistory: [
            { year: 2024, total: 2_000_000 },
            { year: 2025, total: 2_100_000 },
            { year: 2026, total: 3_000_000 },
          ],
        }),
      );
      const entry = r.scoreBreakdown.find((b) => b.label === "Historical Valuation");
      expect(entry).toBeDefined();
      expect(entry!.reason).toMatch(/\d+%/);
    });

    it("the Owner Evidence reason cites the real evidence gap and confidence", () => {
      const r = computeHealthScore(signals({ evidence: { valueGapPct: 18, strength: 0.6 } }));
      const entry = r.scoreBreakdown.find((b) => b.label === "Owner Evidence")!;
      expect(entry.reason).toContain("18");
      expect(entry.reason).toContain("60");
    });
  });
});
