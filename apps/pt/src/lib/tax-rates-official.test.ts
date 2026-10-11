import { describe, expect, it } from "vitest";
import rawRates from "../data/tx-tax-rates.json";
import {
  cityFromAddress,
  countyFromCad,
  lookupInRates,
  type RatesFile,
} from "./tax-rates-official";

const rates = rawRates as unknown as RatesFile;

describe("countyFromCad / cityFromAddress", () => {
  it("reads the county from cad-lookup's appraisal-district name", () => {
    expect(countyFromCad("Dallas Central Appraisal District")).toBe("dallas");
    expect(countyFromCad("Tarrant Appraisal District")).toBe("tarrant");
    expect(countyFromCad("Fort Bend Central Appraisal District")).toBe("fort bend");
    expect(countyFromCad(null)).toBeNull();
  });

  it("reads the city from a Texas address", () => {
    expect(cityFromAddress("19730 Bulverde Rd, San Antonio, TX 78259")).toBe("san antonio");
    expect(cityFromAddress("123 Main St, Dallas, Texas 75201")).toBe("dallas");
    expect(cityFromAddress("123 Main St")).toBeNull();
  });
});

describe("lookupInRates (2025 Comptroller data)", () => {
  it("returns the official county and city rates as fractions", () => {
    // Per the Comptroller's 2025 file: Dallas County 0.2155, City of Dallas 0.6988 per $100.
    const r = lookupInRates(
      rates,
      "Dallas Central Appraisal District",
      "123 Main St, Dallas, TX 75201",
    )!;
    expect(r.year).toBe(2025);
    expect(r.county.rate).toBeCloseTo(0.002155, 6);
    expect(r.city?.rate).toBeCloseTo(0.006988, 6);
    expect(r.knownRate).toBeCloseTo(0.009143, 6);
    expect(r.schoolDistricts!.count).toBeGreaterThan(0);
    expect(r.schoolDistricts!.min).toBeLessThanOrEqual(r.schoolDistricts!.max);
  });

  it("gives the county rate alone when the city isn't a city in that county", () => {
    const r = lookupInRates(
      rates,
      "Dallas Central Appraisal District",
      "1 Rural Rd, Nowhereville, TX 75000",
    )!;
    expect(r.city).toBeNull();
    expect(r.knownRate).toBeCloseTo(r.county.rate, 9);
  });

  it("returns null for an unknown county", () => {
    expect(lookupInRates(rates, "Atlantis Appraisal District", "x, Atlantis, TX")).toBeNull();
  });
});
