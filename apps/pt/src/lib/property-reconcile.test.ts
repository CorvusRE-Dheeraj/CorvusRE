import { describe, expect, it } from "vitest";
import { reconcileProperty, type CadFacts } from "./property-reconcile";
import type { AttomProperty, RegridParcel } from "./property-sources";

const cad: CadFacts = {
  ownerName: "MAIN STREET HOLDINGS LLC",
  accountNumber: "00000123456000000",
  propertyType: "Commercial",
  landValue: 1_200_000,
  improvementValue: 3_000_000,
  totalValue: 4_200_000,
  taxYear: 2025,
  buildingSqft: 24_000,
  yearBuilt: 1998,
  lotSizeAcres: null,
  lotSizeSqft: null,
  deeds: [{ date: "2019-06-14" }],
};

const attom = (over: Partial<AttomProperty> = {}): AttomProperty => ({
  attomId: "1",
  apn: "00000123456000000",
  address: null,
  lat: null,
  lng: null,
  propertyType: "COMMERCIAL",
  yearBuilt: 1998,
  buildingSqft: 24_500,
  lotSizeAcres: 1.25,
  lotSizeSqft: null,
  assessedLand: 1_200_000,
  assessedImprovement: 3_000_000,
  assessedTotal: 4_200_000,
  marketTotal: null,
  taxAmount: 92_400,
  taxYear: 2025,
  ownerName: "Main Street Holdings, LLC",
  lastSaleAmount: null,
  lastSaleDate: "2019-06-14",
  ...over,
});

const regrid = (over: Partial<RegridParcel> = {}): RegridParcel => ({
  parcelNumber: "00000123456000000",
  ownerName: "MAIN STREET HOLDINGS LLC",
  address: null,
  county: "dallas",
  landUse: "Office",
  zoning: "CA-1(A)",
  zoningDescription: null,
  lotSizeAcres: 1.247,
  lotSizeSqft: null,
  landValue: null,
  improvementValue: null,
  totalValue: 3_900_000,
  lastSaleAmount: null,
  lastSaleDate: null,
  lat: null,
  lng: null,
  geometry: null,
  regridPath: null,
  ...over,
});

const factOf = (r: ReturnType<typeof reconcileProperty>, key: string) =>
  r.facts.find((f) => f.key === key)!;

describe("reconcileProperty", () => {
  it("prefers the county record for assessed values and Regrid for parcel facts", () => {
    const r = reconcileProperty({ cad, attom: attom(), regrid: regrid(), officialRates: null });
    expect(factOf(r, "totalValue")).toMatchObject({
      value: 4_200_000,
      source: "County appraisal district",
    });
    expect(factOf(r, "lotAcres")).toMatchObject({ value: 1.247, source: "Regrid" });
    expect(factOf(r, "zoning")).toMatchObject({ value: "CA-1(A)", source: "Regrid" });
    expect(factOf(r, "annualTax")).toMatchObject({ value: 92_400, source: "ATTOM" });
  });

  it("agrees when sources match within tolerance — no false conflicts", () => {
    const r = reconcileProperty({ cad, attom: attom(), regrid: regrid(), officialRates: null });
    // 24,000 vs 24,500 SF is within 5%; owner formatting differs but names match;
    // Regrid's 3.9M (unknown year) is shown, never flagged.
    expect(r.conflicts).toEqual([]);
  });

  it("flags a same-year assessed value disagreement", () => {
    const r = reconcileProperty({
      cad,
      attom: attom({ assessedTotal: 3_500_000 }),
      regrid: null,
      officialRates: null,
    });
    expect(factOf(r, "totalValue").conflict).toBe(true);
    expect(r.conflicts[0]).toMatch(/Assessed total value/);
  });

  it("doesn't flag values from different tax years", () => {
    const r = reconcileProperty({
      cad,
      attom: attom({ assessedTotal: 3_500_000, taxYear: 2024 }),
      regrid: null,
      officialRates: null,
    });
    expect(factOf(r, "totalValue").conflict).toBe(false);
  });

  it("flags owners with nothing in common, and a different year built", () => {
    const r = reconcileProperty({
      cad,
      attom: attom({ ownerName: "JONES FAMILY TRUST", yearBuilt: 2004 }),
      regrid: null,
      officialRates: null,
    });
    expect(factOf(r, "owner").conflict).toBe(true);
    expect(factOf(r, "yearBuilt").conflict).toBe(true);
  });

  it("uses ATTOM's billed tax for an actual effective rate, else the Comptroller's partial rate", () => {
    const actual = reconcileProperty({ cad, attom: attom(), regrid: null, officialRates: null });
    expect(actual.taxRate).toMatchObject({ kind: "actual", taxYear: 2025 });
    expect(actual.taxRate!.rate).toBeCloseTo(92_400 / 4_200_000, 6);

    const partial = reconcileProperty({
      cad,
      attom: null,
      regrid: null,
      officialRates: {
        year: 2025,
        sourceUrl: "x",
        county: { name: "Dallas", rate: 0.002155 },
        city: { name: "Dallas", rate: 0.006988 },
        schoolDistricts: null,
        knownRate: 0.009143,
      },
    });
    expect(partial.taxRate).toMatchObject({ kind: "partial", rate: 0.009143, year: 2025 });
  });

  it("works with the county record alone", () => {
    const r = reconcileProperty({ cad, attom: null, regrid: null, officialRates: null });
    expect(factOf(r, "totalValue").source).toBe("County appraisal district");
    expect(factOf(r, "zoning").value).toBeNull();
    expect(r.taxRate).toBeNull();
  });
});
