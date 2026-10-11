import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: {} }));
vi.mock("./edge-functions", () => ({ invokeEdgeFunction: vi.fn() }));

const { moduleSourceFacts } = await import("./module-source-facts");
type Snapshot = Parameters<typeof moduleSourceFacts>[1] & object;

const snapshot: Snapshot = {
  fetchedAt: "2026-10-06T12:00:00Z",
  cad: {
    ownerName: "MAIN STREET HOLDINGS LLC",
    accountNumber: "00000123456000000",
    propertyType: "Commercial",
    landValue: 1_200_000,
    improvementValue: 3_000_000,
    totalValue: 4_200_000,
    taxYear: 2025,
    legalDescription: null,
    subdivision: null,
    buildingSqft: 24_000,
    yearBuilt: 1998,
    buildingClass: null,
    lotSizeSqft: null,
    lotSizeAcres: null,
    valueHistory: [],
    deeds: [],
  },
  siteGis: null,
  recordUrl: null,
  attom: {
    attomId: "1",
    apn: null,
    address: null,
    lat: null,
    lng: null,
    propertyType: null,
    yearBuilt: 2004,
    buildingSqft: null,
    lotSizeAcres: null,
    lotSizeSqft: null,
    assessedLand: null,
    assessedImprovement: null,
    assessedTotal: 4_200_000,
    marketTotal: null,
    taxAmount: 92_400,
    taxYear: 2025,
    ownerName: null,
    lastSaleAmount: 3_100_000,
    lastSaleDate: "2019-06-14",
  },
  regrid: {
    parcelNumber: null,
    ownerName: null,
    address: null,
    county: null,
    landUse: "Office",
    zoning: "CA-1(A)",
    zoningDescription: null,
    lotSizeAcres: 1.25,
    lotSizeSqft: null,
    landValue: null,
    improvementValue: null,
    totalValue: null,
    lastSaleAmount: null,
    lastSaleDate: null,
    lat: null,
    lng: null,
    geometry: { type: "Polygon", coordinates: [] },
    regridPath: null,
  },
  sources: [],
};

describe("moduleSourceFacts — sources per step", () => {
  it("gives the comps module sales and the $/SF basis, not zoning", () => {
    const f = moduleSourceFacts("comps", snapshot).join("\n");
    expect(f).toMatch(/Last sale price: \$3,100,000 \(per ATTOM\)/);
    expect(f).toMatch(/Assessed value per building SF: \$175\.00/);
    expect(f).not.toMatch(/Zoning/);
  });

  it("gives the zoning module Regrid's zoning and parcel boundary", () => {
    const f = moduleSourceFacts("zoning", snapshot).join("\n");
    expect(f).toMatch(/Zoning: CA-1\(A\) \(per Regrid\)/);
    expect(f).toMatch(/Parcel boundary is on file/);
  });

  it("flags a source disagreement where the module relies on that fact", () => {
    const f = moduleSourceFacts("improvement", snapshot).join("\n");
    expect(f).toMatch(
      /Year built: 1998 \(per County appraisal district\) — sources disagree \(2004 per ATTOM\)/,
    );
  });

  it("adds the tax rate only to modules whose argument uses it", () => {
    expect(moduleSourceFacts("strategy", snapshot).join("\n")).toMatch(/Effective tax rate: 2\.2%/);
    expect(moduleSourceFacts("site", snapshot).join("\n")).not.toMatch(/tax rate/i);
  });

  it("gives Evidence and the Executive report everything", () => {
    const evidence = moduleSourceFacts("evidence", snapshot);
    const executive = moduleSourceFacts("executive", snapshot);
    expect(evidence.length).toBeGreaterThan(moduleSourceFacts("comps", snapshot).length);
    expect(executive).toEqual(evidence);
  });

  it("returns nothing without base data, or for a module it doesn't feed", () => {
    expect(moduleSourceFacts("comps", null)).toEqual([]);
    expect(moduleSourceFacts("not-a-module", snapshot)).toEqual([]);
  });
});
