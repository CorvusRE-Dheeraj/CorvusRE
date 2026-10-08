import { describe, expect, it } from "vitest";
import {
  buildRows,
  markInFileDuplicates,
  sanityFlags,
  type ImportRow,
} from "./bulk-property-import";
import type { ColumnMapping } from "./spreadsheet-import";

const mapping: ColumnMapping[] = [
  { header: "Address", field: "address", source: "alias" },
  { header: "Account", field: "accountNumber", source: "alias" },
  { header: "County", field: "cad", source: "alias" },
  { header: "Value", field: "totalValue", source: "alias" },
];

describe("sanityFlags", () => {
  it("flags values that parsed but look wrong", () => {
    const f = sanityFlags(
      {
        address: "Commerce Plaza",
        totalValue: 12,
        taxYear: 1987,
        landValue: 100,
        improvementValue: 100,
      },
      2026,
    ).map((x) => x.message);
    expect(f).toEqual([
      "Doesn't start with a street number — check it's a full street address.",
      "Total value $12 looks unusual.",
      "Tax year 1987 looks unusual.",
      "Land plus improvement value doesn't add up to the total.",
    ]);
    expect(
      sanityFlags(
        {
          address: "1200 Commerce St",
          totalValue: 2_400_000,
          landValue: 600_000,
          improvementValue: 1_800_000,
        },
        2026,
      ),
    ).toEqual([]);
  });
});

describe("markInFileDuplicates", () => {
  it("keeps the first of repeated addresses and accounts", () => {
    const rows = buildRows(
      {
        headers: ["Address", "Account", "County", "Value"],
        rows: [
          ["1200 Commerce Street, Austin, TX 78701", "T1", "Travis CAD", "2400000"],
          ["1200 COMMERCE ST, AUSTIN TX 78701", "", "", ""],
          ["88 Lamar Blvd, Austin, TX 78704", "T2", "Travis CAD", "3100000"],
          ["88 Lamar Boulevard Unit A, Austin", "T2", "Travis CAD", "3100000"],
        ],
      },
      mapping,
    );
    const out = markInFileDuplicates(rows);
    expect(out.map((r) => r.status)).toEqual(["ok", "duplicate", "ok", "duplicate"]);
    expect(out[1].flags.at(-1)!.message).toBe(
      "Same property as row 2 in this file — only that one is added.",
    );
    expect(out[3].flags.at(-1)!.message).toContain("row 4");
  });

  it("leaves distinct properties alone", () => {
    const r = (address: string): ImportRow => ({
      rowNumber: 2,
      values: { address },
      flags: [],
      status: "ok",
      include: true,
      existingId: null,
      cadOptions: null,
    });
    expect(
      markInFileDuplicates([
        r("1 Main St, Austin, TX 78701"),
        r("2 Main St, Austin, TX 78701"),
      ]).map((x) => x.status),
    ).toEqual(["ok", "ok"]);
  });
});
