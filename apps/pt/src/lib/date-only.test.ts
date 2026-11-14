import { describe, expect, it } from "vitest";
import { isDatePast, parseDateOnly } from "./date-only";

describe("parseDateOnly", () => {
  it("reads a plain date as that local calendar day", () => {
    const d = parseDateOnly("2027-05-15");
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2027, 4, 15]);
    expect(d.toLocaleDateString("en-US")).toBe("5/15/2027");
  });
  it("leaves full timestamps alone", () => {
    expect(parseDateOnly("2026-10-28T15:00:00Z").toISOString()).toBe("2026-10-28T15:00:00.000Z");
  });
});

describe("isDatePast", () => {
  it("is not past during the deadline day itself", () => {
    expect(isDatePast("2027-05-15", new Date(2027, 4, 15, 0, 1))).toBe(false);
    expect(isDatePast("2027-05-15", new Date(2027, 4, 15, 23, 59))).toBe(false);
  });
  it("is past from the next day", () => {
    expect(isDatePast("2027-05-15", new Date(2027, 4, 16, 0, 0))).toBe(true);
  });
  it("compares timestamps exactly", () => {
    expect(isDatePast("2026-10-28T15:00:00Z", new Date("2026-10-28T16:00:00Z"))).toBe(true);
    expect(isDatePast("2026-10-28T15:00:00Z", new Date("2026-10-28T14:00:00Z"))).toBe(false);
  });
});
