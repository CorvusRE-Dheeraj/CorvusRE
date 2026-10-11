import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: {} }));
vi.mock("./edge-functions", () => ({ invokeEdgeFunction: vi.fn() }));

const { buildBaseDataMarkdown, reconcileSnapshot } = await import("./property-base-data");
const { buildTextPdf } = await import("./pdf-text");
type Snapshot = Parameters<typeof buildBaseDataMarkdown>[0];

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
    yearBuilt: 2004, // disagrees with the county on purpose
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
    lastSaleAmount: null,
    lastSaleDate: null,
  },
  regrid: null,
  sourceStatus: { attom: "ok", regrid: "not_configured" },
  officialRates: {
    year: 2025,
    sourceUrl: "https://comptroller.texas.gov/taxes/property-tax/docs/2025-total-rates-levies.xlsx",
    county: { name: "Dallas", rate: 0.002155 },
    city: { name: "Dallas", rate: 0.006988 },
    schoolDistricts: { count: 14, min: 0.008, max: 0.0125 },
    knownRate: 0.009143,
  },
  sources: ["county appraisal district", "ATTOM property data", "Texas Comptroller tax rates"],
};

describe("base data document", () => {
  it("leads with the reconciled facts, flags disagreements, and lists every source's status", () => {
    const md = buildBaseDataMarkdown(snapshot, {
      address: "123 Main St, Dallas, TX 75201",
      cad: "Dallas Central Appraisal District",
    });
    expect(md).toMatch(/## Verified property facts/);
    expect(md).toMatch(
      /Year built: 1998 \(County appraisal district\) — also reported: 2004 \(ATTOM\) \[sources disagree\]/,
    );
    expect(md).toMatch(/Where sources disagree/);
    expect(md).toMatch(/Effective tax rate \(ATTOM billed tax ÷ assessed value, 2025\): 2\.2%/);
    expect(md).toMatch(/## Official tax rates \(Texas Comptroller, 2025\)/);
    expect(md).toMatch(/- Regrid: not connected yet/);
  });

  it("still renders an older snapshot stored before the new sources existed", () => {
    const { attom: _a, regrid: _r, sourceStatus: _s, officialRates: _o, ...old } = snapshot;
    const md = buildBaseDataMarkdown(old, { address: "x", cad: null });
    expect(md).toMatch(/Verified property facts/);
    expect(md).not.toMatch(/Data sources checked/);
    expect(reconcileSnapshot(old).taxRate).toBeNull();
  });

  it("renders to a PDF — every character must be encodable in the PDF's standard font", async () => {
    const md = buildBaseDataMarkdown(snapshot, {
      address: "123 Main St, Dallas, TX 75201",
      cad: "Dallas Central Appraisal District",
    });
    const bytes = await buildTextPdf("Property Base Data", md);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
