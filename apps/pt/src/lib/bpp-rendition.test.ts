import { describe, expect, it } from "vitest";
import {
  assetsFromAi,
  assetsFromGrid,
  bppColumnMapping,
  cadForCounty,
  candidateIssues,
  candidatesFromGrid,
  countyOf,
  effectiveRenditionDeadline,
  extractJson,
  matchPropertyByAddress,
  newCandidate,
  normalizeCounty,
  renditionEmailLink,
  renditionMissing,
  renditionStatus,
  scheduleAFields,
} from "./bpp-rendition";
import type { BppAccountRecord, RenditionAsset } from "./bpp-accounts";

const account = (over: Partial<BppAccountRecord> = {}) =>
  ({
    id: "b1",
    businessName: "Acme Coffee LLC",
    accountNumber: "BPP-123",
    cad: "Bexar Appraisal District",
    locationAddress: "1234 Main St, San Antonio, TX 78205",
    taxYear: 2026,
    renderedValue: null,
    renditionDeadline: "2027-04-15",
    renditionSignedAt: null,
    renditionFiledAt: null,
    extensionGrantedUntil: null,
    renditionValues: null,
    ...over,
  }) as unknown as BppAccountRecord;

const asset = (over: Partial<RenditionAsset>): RenditionAsset => ({
  id: Math.random().toString(36),
  description: "Item",
  category: "Furniture & fixtures",
  year: 2022,
  cost: 1000,
  marketValue: null,
  source: "manual",
  approved: true,
  ...over,
});

describe("counties", () => {
  it("maps between county names and appraisal districts", () => {
    expect(cadForCounty("bexar")).toMatch(/^Bexar .*Appraisal District$/);
    expect(countyOf("Bexar Appraisal District")).toBe("Bexar");
    expect(normalizeCounty("Fort Bend County")).toBe("Fort Bend");
    expect(normalizeCounty("Dallas CAD")).toBe("Dallas");
  });
});

describe("rendition status and what's missing", () => {
  it("only reaches submitted when the owner records it", () => {
    expect(renditionStatus(account())).toBe("not_started");
    expect(renditionStatus(account({ renditionValues: { fields: {} } }))).toBe("in_progress");
    expect(renditionStatus(account({ renditionSignedAt: "x" }))).toBe("signed");
    expect(renditionStatus(account({ renditionSignedAt: "x", renditionFiledAt: "y" }))).toBe(
      "submitted",
    );
  });

  it("flags unapproved AI assets and the certification", () => {
    const m = renditionMissing(account(), { fields: {}, assets: [asset({ approved: false })] });
    expect(m.some((x) => /Review the assets/.test(x))).toBe(true);
    expect(m.some((x) => /certification/.test(x))).toBe(true);
  });

  it("uses a granted extension, never a request alone", () => {
    expect(effectiveRenditionDeadline(account({ extensionRequestedAt: "2027-04-01" })).date).toBe(
      "2027-04-15",
    );
    expect(effectiveRenditionDeadline(account({ extensionGrantedUntil: "2027-05-15" }))).toEqual({
      date: "2027-05-15",
      basis: "extension",
    });
  });
});

describe("Schedule A from the asset schedule", () => {
  it("groups approved assets into three rows, folding the rest into Other", () => {
    const f = scheduleAFields([
      asset({ category: "Machinery", cost: 50_000, year: 2020 }),
      asset({ category: "Machinery", cost: 10_000, year: 2023 }),
      asset({ category: "Computers", cost: 8_000 }),
      asset({ category: "Vehicles", cost: 3_000 }),
      asset({ category: "Supplies", cost: 500 }),
      asset({ category: "Ignored", cost: 99_999, approved: false }),
    ]);
    expect(f["ScA:General Property Description by TypeCategoryRow1"]).toBe("Machinery");
    expect(f["ScA:Estimate of Quantity of Each TypeRow1"]).toBe("2");
    expect(f["ScA:Good Faith Estimate of Market ValueRow1"]).toBe("60,000");
    expect(f["ScA:Year AcquiredRow1"]).toBe("2020–2023");
    expect(f["ScA:General Property Description by TypeCategoryRow3"]).toBe(
      "Other: Vehicles, Supplies",
    );
    expect(f["ScA:Good Faith Estimate of Market ValueRow3"]).toBe("3,500");
    expect(f["Total market value of your property"]).toBe("$20,000 or more");
  });
});

describe("reading assets", () => {
  it("reads a fixed-asset spreadsheet without AI and skips totals", () => {
    const a = assetsFromGrid(
      {
        headers: ["Asset Description", "Asset Class", "Placed in Service", "Original Cost", "NBV"],
        rows: [
          ["Espresso machine", "Equipment", "03/15/2021", "$12,500.00", "8,000"],
          ["Total", "", "", "12,500", ""],
        ],
      },
      "fa.xlsx",
    )!;
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({
      description: "Espresso machine",
      year: 2021,
      cost: 12500,
      marketValue: 8000,
      approved: false,
    });
    expect(assetsFromGrid({ headers: ["foo"], rows: [["x"]] }, "x")).toBeNull();
  });

  it("parses fenced AI JSON and leaves every asset unapproved", () => {
    const a = assetsFromAi(
      'Here:\n```json\n[{"description":"Oven","cost":"4,000","year":2019}]\n```',
      "inv.pdf",
    );
    expect(a[0]).toMatchObject({
      description: "Oven",
      cost: 4000,
      year: 2019,
      approved: false,
      source: "inv.pdf",
    });
    expect(extractJson<{ a: number }>('x {"a": 1} y')).toEqual({ a: 1 });
    expect(extractJson("no json")).toBeNull();
  });
});

describe("adding accounts", () => {
  it("maps CSV headers and normalizes counties", () => {
    const grid = {
      headers: [
        "Business Name",
        "Property/Business Address",
        "County",
        "CAD Account Number",
        "Tax Year",
      ],
      rows: [["Acme", "1 Elm St, Dallas, TX", "Dallas County", "", "2026"]],
    };
    const map = bppColumnMapping(grid.headers);
    expect(map).toEqual(["businessName", "locationAddress", "county", "accountNumber", "taxYear"]);
    const [c] = candidatesFromGrid(grid, map, "csv");
    expect(c).toMatchObject({
      businessName: "Acme",
      county: "Dallas",
      taxYear: 2026,
      source: "csv",
    });
  });

  it("flags duplicates against saved accounts and within the batch, and incomplete rows", () => {
    const saved = [account()];
    const a = newCandidate("manual", {
      businessName: "Acme Coffee",
      locationAddress: "1234 Main St",
      county: "Bexar",
      taxYear: 2026,
    });
    const b = newCandidate("csv", { businessName: "New Co", accountNumber: "77", taxYear: 2026 });
    const c = newCandidate("csv", { businessName: "Other", accountNumber: "77", taxYear: 2026 });
    const iss = candidateIssues(saved, [a, b, c]);
    expect(iss.get(a.key)!.duplicate).toBe("saved");
    expect(iss.get(b.key)!.duplicate).toBeNull();
    expect(iss.get(b.key)!.missing).toEqual(["address", "county"]);
    expect(iss.get(c.key)!.duplicate).toBe("batch");
  });

  it("links to the property at the same street address", () => {
    const props = [
      { id: "p1", address: "1234 Main Street, San Antonio, TX" },
      { id: "p2", address: "1234 Main St., San Antonio" },
    ];
    expect(matchPropertyByAddress(props, "1234 Main St, San Antonio, TX 78205")?.id).toBe("p2");
    expect(matchPropertyByAddress(props, "")).toBeNull();
  });

  it("starts the rendition email without sending anything", () => {
    const link = renditionEmailLink("bpp@example.org", account());
    expect(link.startsWith("mailto:bpp%40example.org?subject=")).toBe(true);
    expect(decodeURIComponent(link)).toContain("Account number: BPP-123");
  });
});
