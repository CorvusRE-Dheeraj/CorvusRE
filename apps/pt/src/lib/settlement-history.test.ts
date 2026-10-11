import { describe, expect, it } from "vitest";
import { classForProperty, compareOffer, type SettlementBenchmark } from "./settlement-history";
import { directivePhrases } from "../../../../supabase/pt/functions/_shared/advisory-tone";

const cell = {
  taxYear: 2025,
  protests: 18412,
  reducedPct: 86.9,
  medianCutPct: 6.7,
  p25CutPct: 1.9,
  p75CutPct: 14.1,
  medianCutWhenReducedPct: 8.4,
  heardShare: 0.85,
};
const harris: SettlementBenchmark = {
  kind: "outcomes",
  cad: "Harris Central Appraisal District",
  label: "Commercial, $1M–$5M",
  latest: cell,
  byRepresentation: { agent: null, owner: null },
  byStage: { informal: null, formal: null },
  trend: [],
  source: "Harris CAD",
};

describe("classForProperty", () => {
  it("reads a state code when the type has one, else the category", () => {
    expect(classForProperty("F1 Commercial")).toBe("commercial");
    expect(classForProperty("B2 Multifamily")).toBe("multifamily");
    expect(classForProperty("Single Family Residence")).toBe("residential");
    expect(classForProperty(null)).toBe("commercial");
  });
});

describe("compareOffer", () => {
  it("places an offer among similar outcomes", () => {
    expect(compareOffer(harris, 2_000_000, 1_960_000)).toContain(
      "2% reduction. Similar commercial, $1M–$5M protests in 2025 settled at a median 6.7% (middle half 1.9–14.1%) — the offer is within the middle half",
    );
    expect(compareOffer(harris, 2_000_000, 1_990_000)).toContain("below the middle half");
    expect(compareOffer(harris, 2_000_000, 1_600_000)).toContain("above the middle half");
  });

  it("falls back to the county's published average", () => {
    const line = compareOffer(
      { kind: "published_average", cad: "Travis CAD", averageCutPct: 5, label: "Commercial" },
      1_000_000,
      950_000,
    )!;
    expect(line).toBe(
      "This offer is a 5% reduction; the county's published average reduction is about 5%.",
    );
    expect(directivePhrases(line)).toEqual([]);
  });
});
