import { describe, expect, it } from "vitest";
import {
  analyzeCadEvidence,
  sanitizeExtraction,
  strongestPoints,
} from "../../../../supabase/pt/functions/_shared/cad-evidence-analysis";

// A district packet as the AI reads it: subject facts as stated, 4 comps.
const extraction = sanitizeExtraction({
  proposedValue: "$8,450,000",
  subjectAsStated: {
    buildingSqft: 60000,
    yearBuilt: 1998,
    acres: 6.2,
    propertyType: "Retail center",
  },
  comps: [
    {
      label: "Comp 1",
      kind: "sale",
      salePrice: 11200000,
      saleDate: "2025-01-15",
      buildingSqft: 58000,
      yearBuilt: 2015,
      propertyType: "Retail",
      adjustments: [
        { factor: "Time", pct: 1 },
        { factor: "Age/Condition", pct: -20 },
        { factor: "Location", pct: -10 },
      ],
      capRatePct: 8.5,
    },
    {
      label: "Comp 2",
      kind: "sale",
      salePrice: 5900000,
      saleDate: "2023-06-01",
      buildingSqft: 35000,
      yearBuilt: 1999,
      propertyType: "Retail",
      adjustments: [{ factor: "Time", pct: 2 }],
      capRatePct: 6,
    },
    {
      label: "Comp 3",
      kind: "sale",
      salePrice: 8700000,
      saleDate: "2026-03-01",
      buildingSqft: 61000,
      yearBuilt: 1996,
      propertyType: "Office building",
      adjustments: [],
      capRatePct: 7.75,
    },
    {
      label: "Comp 4",
      kind: "equity",
      appraisedValue: "7,900,000",
      buildingSqft: "59,500",
      distanceMi: 9,
    },
  ],
  income: { capRatePct: 7, vacancyPct: 5, expensePct: 25, marketRentPerSf: 19 },
});

const subject = {
  buildingSqft: 60000,
  yearBuilt: 1992,
  acres: 6.2,
  propertyType: "Retail center",
  capRatePct: 8.25,
};

describe("sanitizeExtraction", () => {
  it("parses money strings and keeps unknowns null", () => {
    expect(extraction.proposedValue).toBe(8_450_000);
    expect(extraction.comps[3]).toMatchObject({
      appraisedValue: 7_900_000,
      buildingSqft: 59_500,
      salePrice: null,
    });
    expect(extraction.comps).toHaveLength(4);
  });
});

describe("analyzeCadEvidence", () => {
  const a = analyzeCadEvidence(extraction, subject, 2026, { low: 6_900_000, high: 7_400_000 });
  const kinds = a.findings.map((f) => `${f.kind}:${f.comp ?? "-"}`);

  it("computes per-comp metrics", () => {
    const c2 = a.metrics.find((m) => m.label === "Comp 2")!;
    expect(c2.pricePerSf).toBeCloseTo(168.57, 1);
    expect(c2.sizeDiffPct).toBe(-41.7);
    expect(c2.saleMonthsBeforeValuation).toBe(31);
    const c1 = a.metrics.find((m) => m.label === "Comp 1")!;
    expect(c1).toMatchObject({ grossAdjPct: 31, netAdjPct: -29, ageDiffYears: 23 });
  });

  it("flags incorrect subject data, stale and post-date sales, size, age, type, distance and adjustments", () => {
    expect(kinds).toEqual(
      expect.arrayContaining([
        "subject_data:-", // 1998 stated vs 1992
        "stale_sale:Comp 2", // 31 months
        "post_date_sale:Comp 3", // March 2026, after Jan 1
        "size:Comp 2", // 42% smaller
        "age:Comp 1", // 23 years newer
        "property_type:Comp 3", // office vs retail
        "distance:Comp 4",
        "adjustments:Comp 1", // 31% gross
      ]),
    );
  });

  it("flags the cap-rate spread and a rate below the district's own comps", () => {
    const caps = a.findings.filter((f) => f.kind === "cap_rate").map((f) => f.title);
    expect(caps.some((t) => t.includes("from 6% to 8.5%"))).toBe(true);
    expect(
      caps.some((t) => t.includes("applied a 7% cap rate; its own comps' median is 7.8%")),
    ).toBe(true);
  });

  it("flags a time adjustment applied at different rates", () => {
    // Comp 1: 1% over 12 months; Comp 2: 2% over 31 months — same sign, 0.083 vs 0.065/mo, within 2x
    expect(kinds).not.toContain("inconsistent:-");
    const uneven = analyzeCadEvidence(
      sanitizeExtraction({
        comps: [
          {
            label: "Comp A",
            kind: "sale",
            saleDate: "2025-01-01",
            adjustments: [{ factor: "Time", pct: 12 }],
          },
          {
            label: "Comp B",
            kind: "sale",
            saleDate: "2024-01-01",
            adjustments: [{ factor: "Time", pct: 3 }],
          },
        ],
      }),
      subject,
      2026,
      null,
    );
    expect(uneven.findings.some((f) => f.kind === "inconsistent")).toBe(true);
  });

  it("compares the proposed value with Corvus's evidence", () => {
    expect(a.comparison).toMatchObject({
      proposedValue: 8_450_000,
      gapToHigh: 1_050_000,
      gapPct: 14.2,
    });
  });

  it("orders findings strongest first and picks 3-5 hearing points", () => {
    expect(a.findings[0].kind).toBe("subject_data");
    const points = strongestPoints(a, [
      {
        category: "location",
        finding: "Comp 1 is in a superior submarket (Legacy, Plano)",
        detail: "…",
      },
    ]);
    expect(points.length).toBeGreaterThanOrEqual(3);
    expect(points.length).toBeLessThanOrEqual(5);
    expect(points[0].title).toContain("year built");
    expect(points[0].source).toBe("calculated");
  });
});

describe("strongestPoints de-duplication", () => {
  it("keeps every wrong subject fact and drops an AI point that restates one", () => {
    const x = sanitizeExtraction({
      subjectAsStated: { buildingSqft: 64000, yearBuilt: 1998 },
      comps: [],
    });
    const a = analyzeCadEvidence(
      x,
      { ...subject, buildingSqft: 60000, yearBuilt: 1992 },
      2026,
      null,
    );
    const points = strongestPoints(a, [
      { category: "subject_data", finding: "Inaccurate subject size and year built", detail: "" },
      { category: "location", finding: "Comp 1 is in a superior submarket", detail: "" },
    ]);
    const titles = points.map((p) => p.title);
    expect(titles.some((t) => t.includes("64,000 SF"))).toBe(true);
    expect(titles.some((t) => t.includes("year built"))).toBe(true);
    expect(titles).not.toContain("Inaccurate subject size and year built");
    expect(titles).toContain("Comp 1 is in a superior submarket");
  });
});
