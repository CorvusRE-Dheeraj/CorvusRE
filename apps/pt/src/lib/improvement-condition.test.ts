import { describe, it, expect } from "vitest";
import { getTypicalEconomicLife, computeDepreciation } from "./improvement-condition";

describe("getTypicalEconomicLife", () => {
  it("returns the general commercial range for an unrecognized/empty property type", () => {
    expect(getTypicalEconomicLife(null)).toEqual({ min: 35, max: 45, typical: 40 });
    expect(getTypicalEconomicLife("Office Building")).toEqual({ min: 35, max: 45, typical: 40 });
  });

  it("returns the shorter industrial range for warehouse/industrial types", () => {
    expect(getTypicalEconomicLife("Industrial Warehouse")).toEqual({
      min: 30,
      max: 40,
      typical: 35,
    });
    expect(getTypicalEconomicLife("Manufacturing Facility")).toEqual({
      min: 30,
      max: 40,
      typical: 35,
    });
  });

  it("returns the shorter hotel range for hotel/motel types", () => {
    expect(getTypicalEconomicLife("Hotel/Motel")).toEqual({ min: 30, max: 40, typical: 35 });
  });

  it("returns the longer multifamily range for apartment types", () => {
    expect(getTypicalEconomicLife("Apartment Complex")).toEqual({
      min: 40,
      max: 50,
      typical: 45,
    });
  });

  it("is case-insensitive", () => {
    expect(getTypicalEconomicLife("INDUSTRIAL")).toEqual({ min: 30, max: 40, typical: 35 });
  });
});

describe("computeDepreciation", () => {
  const generalCommercial = { min: 35, max: 45, typical: 40 };

  it("returns all-null when effective age is unknown", () => {
    const r = computeDepreciation(null, generalCommercial, 10, 5, 12_300_000);
    expect(r).toEqual({
      physicalDepreciationPct: null,
      totalDepreciationPct: null,
      conditionAdjustedValue: null,
      impactDollar: null,
      impactPct: null,
    });
  });

  it("matches the reference's own worked example: 28+10+5=43%, $12.3M x 0.57 = $7,011,000", () => {
    // Physical depreciation here is NOT reproduced as 28% from age 28/life 40
    // (that's 70% under the real straight-line formula) — this test instead
    // feeds a physical rate that already nets to the reference's 43% total,
    // confirming the additive-total and condition-adjusted-value math match
    // the reference exactly, per the plan's documented caveat about why the
    // physical-depreciation number itself isn't reproduced from age/life.
    const r = computeDepreciation(11.2, { min: 35, max: 45, typical: 40 }, 10, 5, 12_300_000);
    expect(r.physicalDepreciationPct).toBe(28);
    expect(r.totalDepreciationPct).toBe(43);
    expect(r.conditionAdjustedValue).toBe(7_011_000);
    expect(r.impactDollar).toBe(-5_289_000);
    expect(r.impactPct).toBe(-43);
  });

  it("computes a real straight-line physical depreciation ratio", () => {
    const r = computeDepreciation(20, generalCommercial, null, null, 1_000_000);
    expect(r.physicalDepreciationPct).toBe(50); // 20/40
    expect(r.totalDepreciationPct).toBe(50); // no functional/external given
    expect(r.conditionAdjustedValue).toBe(500_000);
  });

  it("caps total depreciation at 100%, never negative or over", () => {
    const r = computeDepreciation(100, generalCommercial, 80, 80, 1_000_000);
    expect(r.physicalDepreciationPct).toBe(100);
    expect(r.totalDepreciationPct).toBe(100);
    expect(r.conditionAdjustedValue).toBe(0);
  });

  it("returns null dollar figures when improvementValue is unknown but keeps the real percentages", () => {
    const r = computeDepreciation(20, generalCommercial, 5, 5, null);
    expect(r.physicalDepreciationPct).toBe(50);
    expect(r.totalDepreciationPct).toBe(60);
    expect(r.conditionAdjustedValue).toBeNull();
    expect(r.impactDollar).toBeNull();
    expect(r.impactPct).toBeNull();
  });
});
