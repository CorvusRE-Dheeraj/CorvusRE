import { describe, expect, it } from "vitest";
import {
  costApproach,
  equalUniformApproach,
  impairmentsApproach,
  incomeApproach,
  landImprovementAnalysis,
  reconcile,
  salesComparisonApproach,
} from "./commercial-valuation";
import { computeIncomeApproach } from "./income-approach";
import type { ComparableStats, RankedComp } from "./comps-analysis";

const income = computeIncomeApproach(
  {
    grossPotentialIncome: 1_000_000,
    otherIncome: 0,
    vacancyPct: 10,
    operatingExpenses: 300_000,
    noiStated: null,
    rentableSqft: 60_000,
    capRatePct: 8,
    capRateSource: "appraisal",
    documentKinds: ["Rent Roll"],
  },
  7_000_000,
);

const comp = (over: Partial<RankedComp>): RankedComp =>
  ({
    pid: 1,
    address: "x",
    latitude: 0,
    longitude: 0,
    marketValue: 1_000_000,
    ownerName: null,
    distanceMi: 0.2,
    similarity: 80,
    breakdown: {} as RankedComp["breakdown"],
    flags: [],
    key: String(Math.random()),
    ...over,
  }) as RankedComp;

describe("incomeApproach", () => {
  it("runs NOI → expenses → cap rate → value", () => {
    const r = incomeApproach(income);
    // EGI 900,000 − 300,000 = NOI 600,000 ÷ 8% = 7,500,000
    expect(r).toMatchObject({ status: "indicated", indicatedValue: 7_500_000 });
    expect(r.steps.at(-1)).toBe("= Indicated value $7,500,000");
  });
  it("recomputes live from what-if vacancy, normalized expenses and cap rate", () => {
    const r = incomeApproach(income, { vacancyPct: 15, expenseRatioPct: 40, capRatePct: 9 });
    // EGI 850,000; expenses 340,000; NOI 510,000 ÷ 9% = 5,666,667
    expect(r.indicatedValue).toBe(5_666_667);
  });
  it("lists what's missing", () => {
    const empty = computeIncomeApproach(
      {
        grossPotentialIncome: null,
        otherIncome: null,
        vacancyPct: null,
        operatingExpenses: null,
        noiStated: null,
        rentableSqft: null,
        capRatePct: null,
        capRateSource: null,
        documentKinds: [],
      },
      null,
    );
    const r = incomeApproach(empty);
    expect(r.status).toBe("needs_data");
    expect(r.missing.length).toBe(4);
  });
});

describe("salesComparisonApproach", () => {
  it("uses only real user-added sales, by $/SF", () => {
    const r = salesComparisonApproach(
      [
        comp({ userAdded: true, salePrice: 6_000_000, buildingSqft: 60_000, saleVerified: true }),
        comp({ userAdded: true, salePrice: 4_400_000, buildingSqft: 40_000 }),
        comp({ userAdded: true, salePrice: 9_000_000, buildingSqft: 75_000 }),
        comp({ marketValue: 99_000_000 }), // CAD comp: not a sale
      ],
      { buildingSqft: 60_000 },
    );
    // $/SF 100, 110, 120 → median 110 × 60,000
    expect(r).toMatchObject({ status: "indicated", indicatedValue: 6_600_000 });
  });
  it("needs sales when there are none", () => {
    expect(salesComparisonApproach([comp({})], { buildingSqft: 60_000 }).status).toBe("needs_data");
  });
});

describe("equalUniformApproach", () => {
  it("uses the adjusted median of appraised values", () => {
    const stats = {
      indicated: { min: 5_000_000, median: 6_000_000, max: 8_000_000 },
      adjustedIndicated: { value: 5_800_000, min: 5_200_000, max: 6_300_000 },
      limitedData: false,
      ranked: [comp({}), comp({}), comp({})],
    } as unknown as ComparableStats;
    expect(equalUniformApproach(stats)).toMatchObject({
      status: "indicated",
      indicatedValue: 5_800_000,
    });
  });
  it("needs comps when the data is thin", () => {
    expect(equalUniformApproach(null).status).toBe("needs_data");
  });
});

describe("costApproach", () => {
  it("adds land to depreciated replacement cost", () => {
    const r = costApproach({
      landValue: 1_500_000,
      buildingSqft: 60_000,
      yearBuilt: 2006,
      costPerSqft: 150,
      economicLifeYears: 50,
      currentYear: 2026,
    });
    // RCN 9,000,000; 20/50 = 40% → 5,400,000 + 1,500,000
    expect(r).toMatchObject({ status: "indicated", indicatedValue: 6_900_000 });
  });
  it("asks for the replacement cost instead of guessing it", () => {
    const r = costApproach({
      landValue: 1,
      buildingSqft: 1,
      yearBuilt: 2000,
      costPerSqft: null,
      economicLifeYears: 50,
      currentYear: 2026,
    });
    expect(r.status).toBe("needs_data");
    expect(r.missing[0]).toMatch(/Replacement cost per SF/);
  });
});

describe("landImprovementAnalysis", () => {
  const comps = [1, 2, 3].map(() => comp({ landValue: 400_000, legalAcreage: 1 }));
  it("re-prices over-assessed land at the nearby rate", () => {
    const r = landImprovementAnalysis({
      landValue: 2_000_000,
      improvementValue: 5_000_000,
      totalValue: 7_000_000,
      acres: 4,
      buildingSqft: 60_000,
      comps,
    });
    expect(r).toMatchObject({ status: "indicated", indicatedValue: 6_600_000, landSharePct: 28.6 });
  });
  it("supports the county when land is at or below the nearby rate", () => {
    const r = landImprovementAnalysis({
      landValue: 1_200_000,
      improvementValue: 5_000_000,
      totalValue: 6_200_000,
      acres: 4,
      buildingSqft: null,
      comps,
    });
    expect(r.status).toBe("supports_cad");
  });
});

describe("impairments and reconciliation", () => {
  it("subtracts cost to cure and picks the lowest supported value", () => {
    const imp = impairmentsApproach(
      7_000_000,
      [
        { id: "a", label: "Roof replacement", costToCure: 400_000 },
        { id: "b", label: "Parking lot", costToCure: 100_000 },
      ],
      ["In a FEMA flood zone"],
    );
    expect(imp.indicatedValue).toBe(6_500_000);
    const r = reconcile([incomeApproach(income), imp], 7_000_000);
    expect(r.lowest).toMatchObject({ id: "impairments", value: 6_500_000 });
    expect(r.belowCad).toBe(1);
  });
});
