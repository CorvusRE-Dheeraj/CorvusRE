import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./properties", () => ({
  addProperty: vi.fn(),
  findExistingProperty: vi.fn(),
}));
vi.mock("./cad-lookup", () => ({
  cadLookup: vi.fn(),
}));
// Records tax_bills writes for the Pay Taxes import tests below.
const billWrites: { op: string; row: Record<string, unknown> }[] = [];
vi.mock("./supabase", () => {
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "limit"]) c[m] = () => c;
    c.maybeSingle = () => Promise.resolve({ data: result, error: null });
    return c;
  };
  return {
    supabase: {
      from: () => ({
        select: () => chain(null),
        insert: (row: Record<string, unknown>) => {
          billWrites.push({ op: "insert", row });
          return Promise.resolve({ error: null });
        },
        update: (row: Record<string, unknown>) => ({
          eq: () => {
            billWrites.push({ op: "update", row });
            return Promise.resolve({ error: null });
          },
        }),
      }),
    },
  };
});

import {
  buildRows,
  enrichRow,
  commitRows,
  hasBill,
  parseDueDate,
  type ImportRow,
} from "./bulk-property-import";
import { addProperty, findExistingProperty } from "./properties";
import { cadLookup } from "./cad-lookup";
import type { ColumnMapping } from "./spreadsheet-import";

const mapping: ColumnMapping[] = [
  { header: "Address", field: "address", source: "alias" },
  { header: "County", field: "cad", source: "alias" },
  { header: "Value", field: "totalValue", source: "ai" },
];

beforeEach(() => {
  vi.mocked(addProperty).mockReset();
  vi.mocked(findExistingProperty).mockReset().mockResolvedValue(null);
  vi.mocked(cadLookup).mockReset();
});

describe("buildRows", () => {
  it("maps columns, parses currency numbers, flags a missing address", () => {
    const rows = buildRows(
      {
        headers: ["Address", "County", "Value"],
        rows: [
          ["100 Main St", "Dallas CAD", "$500,000"],
          ["", "Tarrant", "250000"],
          ["3 Oak Ave", "", "not a number"],
        ],
      },
      mapping,
    );
    expect(rows[0].values).toMatchObject({
      address: "100 Main St",
      cad: "Dallas CAD",
      totalValue: 500000,
    });
    expect(rows[0].status).toBe("ok");
    expect(rows[1].flags.some((f) => f.message === "No address.")).toBe(true);
    expect(rows[1].status).toBe("review");
    expect(rows[2].flags.some((f) => f.message.includes("isn't a number"))).toBe(true);
  });
});

function row(address: string, extra: Partial<ImportRow["values"]> = {}): ImportRow {
  return {
    rowNumber: 2,
    values: { address, ...extra },
    flags: [],
    status: "ok",
    include: true,
    existingId: null,
    cadOptions: null,
  };
}

describe("enrichRow", () => {
  it("marks a row that already exists as a duplicate", async () => {
    vi.mocked(findExistingProperty).mockResolvedValueOnce({ id: "existing-1" } as never);
    const r = await enrichRow("u1", row("100 Main St"));
    expect(r.status).toBe("duplicate");
    expect(r.existingId).toBe("existing-1");
  });

  it("fills blanks from a matched CAD record and flags a disagreement", async () => {
    vi.mocked(cadLookup).mockResolvedValueOnce({
      matched: true,
      record: {
        ownerName: "COUNTY OWNER LLC",
        propertyAddress: "100 Main St",
        cad: "Dallas Central Appraisal District",
        accountNumber: "123456",
        propertyType: "commercial",
        landValue: 100000,
        improvementValue: 400000,
        totalValue: 500000,
        taxYear: 2026,
      },
    } as never);
    const r = await enrichRow("u1", row("100 Main St", { ownerName: "MY LLC" }));
    expect(r.values.accountNumber).toBe("123456");
    expect(r.values.totalValue).toBe(500000);
    expect(r.flags.some((f) => f.message.includes("differs from the county record"))).toBe(true);
    expect(r.status).toBe("review");
  });

  it("offers a parcel picker when the address matches multiple CAD parcels", async () => {
    vi.mocked(cadLookup).mockResolvedValueOnce({
      matched: "multiple",
      options: [{ accountNumber: "A" }, { accountNumber: "B" }],
    } as never);
    const r = await enrichRow("u1", row("11400 Culebra, San Antonio"));
    expect(r.cadOptions).toHaveLength(2);
    expect(r.status).toBe("review");
  });

  it("keeps a no-match row importable", async () => {
    vi.mocked(cadLookup).mockResolvedValueOnce({ matched: false, nearby: [] } as never);
    const r = await enrichRow("u1", row("500 Rural Rd", { cad: "Loving CAD", accountNumber: "9" }));
    expect(r.status).toBe("review"); // a warn flag, still includable
    expect(r.flags.some((f) => f.message.includes("No county appraisal record"))).toBe(true);
  });
});

describe("commitRows", () => {
  it("adds only included, non-duplicate rows", async () => {
    vi.mocked(addProperty).mockImplementation((_u, p) =>
      Promise.resolve({ id: `p-${p.address}`, address: p.address } as never),
    );
    const rows: ImportRow[] = [
      row("A"),
      { ...row("B"), include: false },
      { ...row("C"), status: "duplicate" },
      row("D"),
    ];
    const res = await commitRows("u1", rows);
    expect(res.imported.map((p) => p.address)).toEqual(["A", "D"]);
    expect(res.duplicates).toBe(1); // the C row
    expect(addProperty).toHaveBeenCalledTimes(2);
  });
});

describe("Pay Taxes bill columns", () => {
  it("reads due dates in the usual formats", () => {
    expect(parseDueDate("2027-01-31")).toBe("2027-01-31");
    expect(parseDueDate("01/31/2027")).toBe("2027-01-31");
    expect(parseDueDate("1/31/27")).toBe("2027-01-31");
    expect(parseDueDate("Jan 31, 2027")).toBe("2027-01-31");
    expect(parseDueDate("31")).toBeNull();
    expect(parseDueDate("soon")).toBeNull();
  });

  it("builds rows with amount due, due date and amount paid", () => {
    const rows = buildRows(
      {
        headers: ["Address", "Amount Due", "Due Date", "Paid"],
        rows: [["100 Main St, Austin, TX", "$12,500.50", "01/31/2027", "6,250"]],
      },
      [
        { header: "Address", field: "address", source: "alias" },
        { header: "Amount Due", field: "taxAmountDue", source: "alias" },
        { header: "Due Date", field: "paymentDueDate", source: "alias" },
        { header: "Paid", field: "taxAmountPaid", source: "alias" },
      ],
    );
    expect(rows[0].values).toMatchObject({
      taxAmountDue: 12500.5,
      paymentDueDate: "2027-01-31",
      taxAmountPaid: 6250,
    });
    expect(hasBill(rows[0].values)).toBe(true);
  });

  it("records the bill for a property already in the account instead of skipping it", async () => {
    billWrites.length = 0;
    vi.mocked(findExistingProperty).mockResolvedValue({ id: "p-1" } as never);
    const row: ImportRow = {
      rowNumber: 2,
      values: { address: "100 Main St", taxYear: 2026, taxAmountDue: 9000, taxAmountPaid: 4500 },
      flags: [],
      status: "duplicate",
      include: true,
      existingId: "p-1",
      cadOptions: null,
    };
    const r = await commitRows("u-1", [row]);
    expect(r).toMatchObject({ imported: [], bills: 1, failed: 0 });
    expect(addProperty).not.toHaveBeenCalledWith("u-1", expect.anything());
    expect(billWrites[0]).toMatchObject({
      op: "insert",
      row: {
        property_id: "p-1",
        tax_year: 2026,
        amount_due: 9000,
        amount_paid: 4500,
        status: "partial",
        status_source: "user",
      },
    });
  });
});
