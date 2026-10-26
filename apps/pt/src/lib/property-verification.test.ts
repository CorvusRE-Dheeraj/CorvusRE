import { describe, expect, it } from "vitest";
import {
  compareToCounty,
  decide,
  fileSignals,
  sameAccount,
  sameAddress,
  sameOwner,
  type CadFacts,
} from "../../../../supabase/pt/functions/_shared/property-verification";

const cad: CadFacts = {
  ownerName: "SMITH JOHN & MARY",
  propertyAddress: "1800 MARKET PLACE BLVD, IRVING, TX 75063",
  accountNumber: "00000123456",
  landValue: 1_236_490,
  improvementValue: 3_283_510,
  totalValue: 4_520_000,
  valueYear: 2026,
  valueHistory: [
    { year: 2025, landValue: 1_100_000, improvementValue: 3_000_000, marketValue: 4_100_000 },
  ],
};

const real = {
  ownerName: "John Smith",
  address: "1800 Market Place Boulevard, Irving TX",
  accountNumber: "123456",
  taxYear: 2026,
  landValue: 1_236_490,
  improvementValue: 3_283_510,
  totalValue: 4_520_000,
};

const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

describe("matching helpers", () => {
  it("treats leading zeros and formatting as the same account", () => {
    expect(sameAccount("00000123456", "123-456")).toBe(true);
    expect(sameAccount("123456", "654321")).toBe(false);
  });
  it("matches owner names written differently", () => {
    expect(sameOwner("John Smith", "SMITH JOHN & MARY")).toBe(true);
    expect(sameOwner("Jane Doe", "SMITH JOHN & MARY")).toBe(false);
  });
  it("matches addresses by street number and name", () => {
    expect(sameAddress("1800 Market Place Blvd", "1800 MARKET PLACE BOULEVARD")).toBe(true);
    expect(sameAddress("1801 Market Place Blvd", "1800 MARKET PLACE BLVD")).toBe(false);
  });
  it("ignores a dropped direction prefix and handles addresses with no number", () => {
    expect(sameAddress("1020 GRIBBLE, SHERMAN", "1020 S GRIBBLE, SHERMAN")).toBe(true);
    expect(sameAddress("PARKER RD , WYLIE, TX 75098", "PARKER RD , WYLIE, TX 75098")).toBe(true);
    expect(sameAddress("PARKER RD, WYLIE", "ELM ST, WYLIE")).toBe(false);
  });
});

describe("compareToCounty", () => {
  it("passes a document that matches the county record", () => {
    expect(
      compareToCounty("The document", real, cad, { requireAll: true, checkSums: true }),
    ).toEqual([]);
  });

  it("flags every changed detail", () => {
    const fake = { ...real, ownerName: "Tester Person", totalValue: 3_900_000, landValue: 616_490 };
    const codes = compareToCounty("The document", fake, cad).map((f) => f.code);
    expect(codes).toEqual(["owner_mismatch", "land_value_mismatch", "total_value_mismatch"]);
  });

  it("compares an older notice with that year's county values", () => {
    const old = {
      ...real,
      taxYear: 2025,
      landValue: 1_100_000,
      improvementValue: 3_000_000,
      totalValue: 4_100_000,
    };
    expect(compareToCounty("The document", old, cad)).toEqual([]);
  });

  it("uses the current values when the county record states no year", () => {
    const noYear = { ...cad, valueYear: null, taxYear: null, valueHistory: [] };
    expect(compareToCounty("The saved property", real, noYear)).toEqual([]);
  });

  it("compares a saved property ahead of the county's values with its latest values", () => {
    const ahead = { ...real, taxYear: 2027 };
    expect(compareToCounty("The saved property", ahead, cad, { yearFallback: true })).toEqual([]);
    const wrong = { ...ahead, totalValue: 1 };
    expect(
      compareToCounty("The saved property", wrong, cad, { yearFallback: true }).map((f) => f.code),
    ).toEqual(["total_value_mismatch"]);
  });

  it("flags a year the county has no values for", () => {
    const codes = compareToCounty("The document", { ...real, taxYear: 2019 }, cad).map(
      (f) => f.code,
    );
    expect(codes).toEqual(["year_unconfirmed"]);
  });

  it("flags missing details on a document", () => {
    const codes = compareToCounty("The document", { taxYear: 2026 }, cad, { requireAll: true }).map(
      (f) => f.code,
    );
    expect(codes).toEqual([
      "missing_account_number",
      "missing_owner",
      "missing_property_address",
      "missing_values",
    ]);
  });

  it("flags figures that don't add up", () => {
    const codes = compareToCounty(
      "The document",
      { ...real, improvementValue: 3_283_000 },
      { ...cad, improvementValue: 3_283_000 },
      { checkSums: true },
    ).map((f) => f.code);
    expect(codes).toContain("values_dont_add_up");
  });
});

describe("fileSignals", () => {
  it("spots an AI tool in a PDF's producer", () => {
    const pdf = ascii("%PDF-1.7\n/Producer (ChatGPT export)\n%%EOF");
    expect(fileSignals(pdf, "application/pdf").map((f) => f.code)).toEqual(["file_ai_generated"]);
  });
  it("spots image editors and later edits", () => {
    const pdf = ascii("%PDF-1.7\n/Creator (Canva)\n%%EOF\n/Prev 123\n%%EOF");
    expect(fileSignals(pdf, "application/pdf").map((f) => f.code)).toEqual([
      "file_edited_tool",
      "file_modified_after_creation",
    ]);
  });
  it("doesn't count a linearized PDF's second end marker as an edit", () => {
    const pdf = ascii("%PDF-1.7\n/Linearized 1\n%%EOF\n/Producer (County Report Server)\n%%EOF");
    expect(fileSignals(pdf, "application/pdf")).toEqual([]);
  });
  it("spots AI labels in an image", () => {
    const png = ascii("\x89PNG....c2pa....trainedAlgorithmicMedia");
    expect(fileSignals(png, "image/png").map((f) => f.code)).toEqual(["file_ai_generated"]);
  });
});

describe("decide", () => {
  const flag = { code: "x", source: "county" as const, severity: "high" as const, message: "" };
  it("verifies only when nothing is flagged", () => {
    expect(decide([], false)).toBe("verified");
    expect(decide([flag], false)).toBe("needs_review");
  });
  it("lets an admin's own account through as a test", () => {
    expect(decide([flag], true)).toBe("test");
  });
});
