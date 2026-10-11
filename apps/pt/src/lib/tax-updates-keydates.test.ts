import { describe, expect, it } from "vitest";
import { upcomingKeyDates } from "./tax-updates";

describe("upcomingKeyDates", () => {
  it("rolls into next year after the fall", () => {
    const d = upcomingKeyDates("2026-10-09");
    expect(d.map((x) => x.date)).toEqual(["2027-01-01", "2027-01-31", "2027-04-15"]);
    expect(d[0].daysAway).toBe(84);
  });
  it("includes a date that is today", () => {
    expect(upcomingKeyDates("2026-05-15")[0]).toMatchObject({ date: "2026-05-15", daysAway: 0 });
  });
  it("always returns something", () => {
    for (const day of ["2026-01-02", "2026-06-01", "2026-12-31"]) {
      expect(upcomingKeyDates(day).length).toBe(3);
    }
  });
});
