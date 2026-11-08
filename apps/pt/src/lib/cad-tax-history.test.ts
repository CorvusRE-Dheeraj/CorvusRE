import { describe, expect, it } from "vitest";
import { historyTaxFor, isFresh, type TaxHistory } from "./cad-tax-history";

const h: TaxHistory = {
  propertyId: "p1",
  accountNumber: "2781247",
  source: "collin_open_data",
  sourceUrl: null,
  retrievedAt: "2026-11-01T00:00:00Z",
  years: [
    {
      year: 2026,
      marketValue: 1,
      appraisedValue: 1,
      taxableValue: 1,
      rate: 1,
      tax: 10,
      exact: true,
    },
    {
      year: 2025,
      marketValue: 1,
      appraisedValue: 1,
      taxableValue: 1,
      rate: null,
      tax: null,
      exact: true,
    },
  ],
};

describe("cad tax history", () => {
  it("is fresh for 30 days and only for the same account number", () => {
    const now = Date.parse("2026-11-06T00:00:00Z");
    expect(isFresh(h, "2781247", now)).toBe(true);
    expect(isFresh(h, "999", now)).toBe(false);
    expect(isFresh(h, "2781247", Date.parse("2026-12-05T00:00:00Z"))).toBe(false);
    expect(isFresh(undefined, "2781247", now)).toBe(false);
  });
  it("retries an empty result after a day", () => {
    const empty = { ...h, years: [] };
    const retrieved = Date.parse(h.retrievedAt);
    expect(isFresh(empty, "2781247", retrieved + 6 * 3600_000)).toBe(true);
    expect(isFresh(empty, "2781247", retrieved + 25 * 3600_000)).toBe(false);
  });
  it("finds a year's tax only when it has one", () => {
    expect(historyTaxFor(h, 2026)?.tax).toBe(10);
    expect(historyTaxFor(h, 2025)).toBeNull();
    expect(historyTaxFor(undefined, 2026)).toBeNull();
  });
});
