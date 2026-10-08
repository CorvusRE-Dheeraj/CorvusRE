import { describe, expect, it } from "vitest";
import {
  fieldText,
  itemsToGrid,
  signState,
  TITLE_COLUMN,
  verifyState,
} from "../../../../supabase/pt/functions/_shared/podio-grid";

describe("fieldText", () => {
  it("reads each Podio field type", () => {
    expect(fieldText({ type: "text", values: [{ value: "<p>1200 Commerce St&nbsp;</p>" }] })).toBe(
      "1200 Commerce St",
    );
    expect(fieldText({ type: "money", values: [{ value: "2400000.0000", currency: "USD" }] })).toBe(
      "2400000",
    );
    expect(
      fieldText({
        type: "location",
        values: [{ value: "1200 commerce", formatted: "1200 Commerce St, Austin, TX 78701, USA" }],
      }),
    ).toBe("1200 Commerce St, Austin, TX 78701, USA");
    expect(
      fieldText({
        type: "category",
        values: [{ value: { text: "Retail" } }, { value: { text: "Office" } }],
      }),
    ).toBe("Retail, Office");
    expect(fieldText({ type: "contact", values: [{ value: { name: "Olivia Owner" } }] })).toBe(
      "Olivia Owner",
    );
    expect(fieldText({ type: "date", values: [{ start_date: "2026-05-15" }] })).toBe("2026-05-15");
    expect(fieldText({ type: "app", values: [{ value: { title: "Travis CAD" } }] })).toBe(
      "Travis CAD",
    );
    expect(fieldText({ type: "text", values: [] })).toBe("");
  });
});

describe("itemsToGrid", () => {
  it("turns items into a header row and one row per item", () => {
    const g = itemsToGrid([
      {
        title: "1200 Commerce",
        fields: [
          {
            label: "Address",
            type: "location",
            values: [{ formatted: "1200 Commerce St, Austin, TX" }],
          },
          { label: "Account #", type: "text", values: [{ value: "T1" }] },
        ],
      },
      {
        title: "88 Lamar",
        fields: [
          {
            label: "Address",
            type: "location",
            values: [{ formatted: "88 Lamar Blvd, Austin, TX" }],
          },
          { label: "Value", type: "money", values: [{ value: "3100000.0000" }] },
        ],
      },
      { title: "", fields: [] },
    ]);
    expect(g.headers).toEqual([TITLE_COLUMN, "Address", "Account #", "Value"]);
    expect(g.rows).toEqual([
      ["1200 Commerce", "1200 Commerce St, Austin, TX", "T1", ""],
      ["88 Lamar", "88 Lamar Blvd, Austin, TX", "", "3100000"],
    ]);
  });
});

describe("OAuth state", () => {
  it("round-trips, and rejects tampering, stale states and open redirects", async () => {
    const s = await signState("user-1", "/corvuspt/dashboard/properties", "secret", 1_000_000);
    expect(await verifyState(s, "secret", 1_000_000 + 60_000)).toEqual({
      userId: "user-1",
      returnPath: "/corvuspt/dashboard/properties",
    });
    expect(await verifyState(s.replace("user-1", "user-2"), "secret", 1_000_000)).toBeNull();
    expect(await verifyState(s, "other", 1_000_000)).toBeNull();
    expect(await verifyState(s, "secret", 1_000_000 + 60 * 60_000)).toBeNull();
    const evil = await signState("user-1", "//evil.com", "secret", 1_000_000);
    expect(await verifyState(evil, "secret", 1_000_000)).toBeNull();
  });
});
