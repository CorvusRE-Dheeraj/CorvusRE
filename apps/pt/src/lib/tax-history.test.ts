import { describe, expect, it } from "vitest";
import {
  buildTaxHistory,
  classifyIncrease,
  describeTrigger,
  detectTaxIncreaseTriggers,
} from "./tax-history";

const vh = (year: number, appraisedValue: number) => ({
  year,
  appraisedValue,
  marketValue: appraisedValue,
  landValue: null,
  improvementValue: null,
});
const bill = (taxYear: number, amountDue: number, taxableValue: number | null = null) => ({
  taxYear,
  amountDue,
  taxableValue,
  createdAt: `${taxYear + 1}-01-01T00:00:00Z`,
});

describe("classifyIncrease — the 10 / 20 / 30% triggers", () => {
  it("maps each threshold to its level", () => {
    expect(classifyIncrease(9.94)).toBeNull();
    expect(classifyIncrease(10)).toBe("noticeable");
    expect(classifyIncrease(19.9)).toBe("noticeable");
    expect(classifyIncrease(20)).toBe("significant");
    expect(classifyIncrease(30)).toBe("major");
    expect(classifyIncrease(85)).toBe("major");
  });

  it("never triggers on a decrease or a missing value", () => {
    expect(classifyIncrease(-25)).toBeNull();
    expect(classifyIncrease(null)).toBeNull();
  });
});

describe("buildTaxHistory", () => {
  const rows = buildTaxHistory({
    valueHistory: [
      vh(2021, 2_000_000),
      vh(2022, 2_100_000),
      vh(2023, 2_200_000),
      vh(2024, 2_300_000),
      vh(2025, 2_500_000),
    ],
    currentYear: 2026,
    currentAppraised: 3_250_000,
    taxBills: [bill(2024, 46_000, 2_300_000), bill(2025, 50_000, 2_500_000)],
    estimateRate: 0.02,
  });

  it("gives one row per year, newest first, 5+ years", () => {
    expect(rows.map((r) => r.year)).toEqual([2026, 2025, 2024, 2023, 2022, 2021]);
  });

  it("uses the tax bill when there is one and labels other years as estimates", () => {
    const y2025 = rows.find((r) => r.year === 2025)!;
    expect(y2025).toMatchObject({ taxes: 50_000, taxesBasis: "bill", taxable: 2_500_000 });
    const y2026 = rows.find((r) => r.year === 2026)!;
    expect(y2026.taxesBasis).toBe("estimate");
    expect(y2026.taxes).toBeCloseTo(65_000, 0);
  });

  it("computes year-over-year change, but never across a bill/estimate mix", () => {
    const y2026 = rows.find((r) => r.year === 2026)!;
    expect(y2026.appraisedChange).toMatchObject({ dollar: 750_000 });
    expect(y2026.appraisedChange!.pct).toBeCloseTo(30, 5);
    expect(y2026.taxesChange).toBeNull(); // 2026 estimate vs 2025 bill
    const y2025 = rows.find((r) => r.year === 2025)!;
    expect(y2025.taxesChange!.pct).toBeCloseTo((4_000 / 46_000) * 100, 5); // bill vs bill
  });

  it("never bridges a gap year", () => {
    const gap = buildTaxHistory({
      valueHistory: [vh(2022, 1_000_000), vh(2024, 1_500_000)],
      currentYear: null,
      currentAppraised: null,
      taxBills: [],
      estimateRate: null,
    });
    expect(gap.find((r) => r.year === 2024)!.appraisedChange).toBeNull();
    expect(detectTaxIncreaseTriggers(gap)).toEqual([]);
  });
});

describe("detectTaxIncreaseTriggers", () => {
  it("flags the example: $2.5M -> $3.25M is a 30% major increase, with the dollar change", () => {
    const rows = buildTaxHistory({
      valueHistory: [vh(2025, 2_500_000)],
      currentYear: 2026,
      currentAppraised: 3_250_000,
      taxBills: [],
      estimateRate: 0.02,
    });
    const [t] = detectTaxIncreaseTriggers(rows);
    expect(t).toMatchObject({
      metric: "appraised",
      level: "major",
      fromYear: 2025,
      toYear: 2026,
      from: 2_500_000,
      to: 3_250_000,
      dollarIncrease: 750_000,
    });
    expect(describeTrigger(t)).toBe(
      "30% increase detected (Major increase — needs review): appraised value went from $2,500,000 (2025) to $3,250,000 (2026), up $750,000.",
    );
  });

  it("triggers on taxes only from real bills, and ranks the biggest first", () => {
    const rows = buildTaxHistory({
      valueHistory: [vh(2024, 1_000_000), vh(2025, 1_120_000)],
      currentYear: null,
      currentAppraised: null,
      taxBills: [bill(2024, 20_000, 900_000), bill(2025, 26_000, 1_100_000)],
      estimateRate: 0.02,
    });
    const triggers = detectTaxIncreaseTriggers(rows);
    expect(triggers.map((t) => [t.metric, t.level])).toEqual([
      ["taxes", "major"], // +30%
      ["taxable", "significant"], // +22%
      ["appraised", "noticeable"], // +12%
    ]);
  });

  it("stays quiet below 10%", () => {
    const rows = buildTaxHistory({
      valueHistory: [vh(2024, 1_000_000), vh(2025, 1_090_000)],
      currentYear: null,
      currentAppraised: null,
      taxBills: [],
      estimateRate: 0.02,
    });
    expect(detectTaxIncreaseTriggers(rows)).toEqual([]);
  });
});
