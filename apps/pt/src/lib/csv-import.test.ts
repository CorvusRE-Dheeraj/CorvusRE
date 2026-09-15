import { describe, it, expect } from "vitest";
import { parsePropertiesCsv } from "./csv-import";

describe("parsePropertiesCsv", () => {
  it("parses a well-formed row with all fields", () => {
    const csv =
      "address,cad,accountNumber,ownerName,propertyType,landValue,improvementValue,totalValue,taxYear\n" +
      "123 Main St,Dallas CAD,ACCT-1,Acme LLC,commercial,100000,300000,400000,2026";

    const { rows, errors } = parsePropertiesCsv(csv);

    expect(errors).toEqual([]);
    expect(rows).toEqual([
      {
        rowNumber: 2,
        address: "123 Main St",
        cad: "Dallas CAD",
        accountNumber: "ACCT-1",
        ownerName: "Acme LLC",
        propertyType: "commercial",
        landValue: 100000,
        improvementValue: 300000,
        totalValue: 400000,
        taxYear: 2026,
      },
    ]);
  });

  it("handles a quoted field containing an embedded comma", () => {
    const csv = 'address,cad\n"1234 Main St, Suite 100",Travis CAD';

    const { rows, errors } = parsePropertiesCsv(csv);

    expect(errors).toEqual([]);
    expect(rows[0].address).toBe("1234 Main St, Suite 100");
    expect(rows[0].cad).toBe("Travis CAD");
  });

  it("matches headers case-insensitively and in any order", () => {
    const csv = "TOTALVALUE,Address\n500000,42 Elm St";

    const { rows, errors } = parsePropertiesCsv(csv);

    expect(errors).toEqual([]);
    expect(rows[0]).toEqual({ rowNumber: 2, address: "42 Elm St", totalValue: 500000 });
  });

  it("tolerates currency-formatted numbers", () => {
    const csv = 'address,totalValue\n1 First Ave,"$450,000.00"';

    const { rows, errors } = parsePropertiesCsv(csv);

    expect(errors).toEqual([]);
    expect(rows[0].totalValue).toBe(450000);
  });

  it("flags a row missing an address instead of silently dropping it", () => {
    const csv = "address,totalValue\n,500000";

    const { rows, errors } = parsePropertiesCsv(csv);

    expect(rows).toEqual([]);
    expect(errors).toEqual([{ rowNumber: 2, reason: "Missing address." }]);
  });

  it("flags a row with an unparseable number and excludes it from rows", () => {
    const csv = "address,totalValue\n5 Oak Dr,not-a-number";

    const { rows, errors } = parsePropertiesCsv(csv);

    expect(rows).toEqual([]);
    expect(errors).toEqual([
      { rowNumber: 2, reason: '"not-a-number" in column "totalValue" isn\'t a number.' },
    ]);
  });

  it("errors out cleanly when there's no address column", () => {
    const csv = "cad,totalValue\nDallas CAD,500000";

    const { rows, errors } = parsePropertiesCsv(csv);

    expect(rows).toEqual([]);
    expect(errors).toEqual([
      { rowNumber: 1, reason: 'No "address" column found in the header row.' },
    ]);
  });

  it("errors out cleanly on an empty file", () => {
    const { rows, errors } = parsePropertiesCsv("");

    expect(rows).toEqual([]);
    expect(errors).toEqual([{ rowNumber: 1, reason: "The file is empty." }]);
  });

  it("processes multiple rows independently, mixing valid rows and errors", () => {
    const csv = "address,totalValue\n1 A St,100000\n,200000\n3 C St,300000";

    const { rows, errors } = parsePropertiesCsv(csv);

    expect(rows.map((r) => r.address)).toEqual(["1 A St", "3 C St"]);
    expect(errors).toEqual([{ rowNumber: 3, reason: "Missing address." }]);
  });
});
