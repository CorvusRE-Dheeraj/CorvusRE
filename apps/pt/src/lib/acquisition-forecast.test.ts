import { describe, expect, it } from "vitest";
import { acquisitionForecast, type ForecastInput } from "./acquisition-forecast";
import { directivePhrases } from "../../../../supabase/pt/functions/_shared/advisory-tone";

const base: ForecastInput = {
  cad: null,
  propertyType: null,
  currentValue: 4_000_000,
  currentTaxYear: 2026,
  purchasePrice: 6_000_000,
  closingDate: "2026-10-01",
  holdYears: 5,
  growthPct: 3,
  taxRate: 0.02,
};

describe("acquisitionForecast", () => {
  const f = acquisitionForecast(base);

  it("keeps the closing year on the seller's value and prorates the buyer's share", () => {
    expect(f.closingYear.year).toBe(2026);
    expect(f.closingYear.tax).toBe(80_000);
    expect(f.closingYear.buyerDays).toBe(92); // Oct 1 – Dec 31
    expect(f.closingYear.buyerShare).toBe(20_164);
  });

  it("forecasts the first full year three ways, reappraised toward the price", () => {
    const y = f.years[0];
    expect(y.year).toBe(2027);
    expect(y.value.low).toBe(4_120_000); // trend only
    expect(y.value.likely).toBe(5_700_000); // 95% typical appraisal level
    expect(y.value.high).toBe(6_000_000);
    expect(f.firstYearChange.likely).toBe(114_000 - 80_000);
  });

  it("grows the values over the hold and totals the taxes", () => {
    expect(f.years).toHaveLength(5);
    expect(f.years[4].value.likely).toBe(Math.round((5_700_000 * 1.03 ** 4) / 1000) * 1000);
    expect(f.holdTotal.likely).toBe(f.years.reduce((s, y) => s + y.tax.likely, 0));
  });

  it("shows the effect on NOI", () => {
    const n = acquisitionForecast({ ...base, noi: 400_000 }).noiImpact!;
    expect(n.likely).toBe(400_000 - 34_000);
    expect(n.likelyPct).toBe(-8.5);
  });

  it("treats a price below the district's value as protest evidence", () => {
    const below = acquisitionForecast({ ...base, purchasePrice: 3_400_000 });
    expect(below.belowValue?.pct).toBe(15);
    expect(below.years[0].value.likely).toBe(3_400_000);
    expect(below.years[0].value.high).toBe(4_120_000);
    expect(directivePhrases(below.belowValue!.note)).toEqual([]);
  });

  it("uses the county average rate when no rate is given, and clamps the hold", () => {
    const g = acquisitionForecast({ ...base, taxRate: null, holdYears: 40 });
    expect(g.rate).toBeGreaterThan(0);
    expect(g.rateSource).not.toBe("Your rate");
    expect(g.years).toHaveLength(10);
  });
});

describe("ratio study", () => {
  it("reads the Comptroller median as a ratio and caps it at the price", () => {
    const denton = acquisitionForecast({
      ...base,
      cad: "Denton Central Appraisal District",
      propertyType: "F1 Commercial",
    });
    expect(denton.ratioPct).toBe(100); // 1.07 → 107%, capped at the price
    expect(denton.years[0].value.likely).toBe(6_000_000);
  });
});
