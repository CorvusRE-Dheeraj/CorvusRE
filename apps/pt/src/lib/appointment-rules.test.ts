import { describe, expect, it } from "vitest";
import {
  centralToUtcMs,
  federalHolidays,
  holidayName,
  openSlotsForDate,
  openSlotsInRange,
  respectsGap,
  slotProblem,
} from "./appointment-rules";

// A fixed "now": Mon 2026-09-14, 9:00 AM Central.
const NOW = centralToUtcMs("2026-09-14", 9, 0);

describe("federal holidays", () => {
  it("computes the 2026 dates, with weekend observance", () => {
    const h = Object.fromEntries(federalHolidays(2026).map((x) => [x.name, x.date]));
    expect(h["Thanksgiving"]).toBe("2026-11-26");
    expect(h["Labor Day"]).toBe("2026-09-07");
    expect(h["Memorial Day"]).toBe("2026-05-25");
    expect(h["Independence Day"]).toBe("2026-07-03"); // Jul 4 is a Saturday → Friday
    expect(h["Christmas Day"]).toBe("2026-12-25");
    expect(holidayName("2026-11-26")).toBe("Thanksgiving");
    expect(holidayName("2026-11-27")).toBeNull();
  });
});

describe("notice, weekdays and hours", () => {
  it("closes same-day and next-day, opens from two days out", () => {
    expect(slotProblem("2026-09-14", "10:00", [], [], NOW)).toMatch(/2 days/);
    expect(slotProblem("2026-09-15", "10:00", [], [], NOW)).toMatch(/2 days/);
    expect(slotProblem("2026-09-16", "10:00", [], [], NOW)).toBeNull();
  });
  it("skips weekends and offers 10, 11, 12 and 1 only", () => {
    expect(slotProblem("2026-09-19", "10:00", [], [], NOW)).toMatch(/Monday to Friday/);
    expect(openSlotsForDate("2026-09-16", [], [], NOW)).toEqual([
      "10:00",
      "11:00",
      "12:00",
      "13:00",
    ]);
    expect(slotProblem("2026-09-16", "14:00", [], [], NOW)).toMatch(/isn't one of/);
    expect(slotProblem("2026-09-16", "09:00", [], [], NOW)).toMatch(/isn't one of/);
  });
  it("shows nothing on a holiday, and stops 60 days out", () => {
    expect(openSlotsForDate("2026-11-26", [], [], NOW)).toEqual([]);
    expect(slotProblem("2026-12-01", "10:00", [], [], NOW)).toMatch(/too far/);
  });
});

describe("gaps and double booking", () => {
  const at = (date: string, h: number) => ({ startMs: centralToUtcMs(date, h, 0) });
  it("needs 2 hours between the end of one visit and the start of the next", () => {
    const booked = [at("2026-09-16", 10)];
    // 10:00–11:00 booked → next can start at 1:00 PM (2h after 11:00) or later
    expect(openSlotsForDate("2026-09-16", booked, [], NOW)).toEqual(["13:00"]);
    expect(respectsGap(centralToUtcMs("2026-09-16", 12), booked)).toBe(false);
    expect(respectsGap(centralToUtcMs("2026-09-16", 13), booked)).toBe(true);
  });
  it("never double-books the same slot", () => {
    expect(slotProblem("2026-09-16", "10:00", [at("2026-09-16", 10)], [], NOW)).toMatch(/taken/);
  });
  it("a middle booking leaves nothing else that day", () => {
    expect(openSlotsForDate("2026-09-16", [at("2026-09-16", 11)], [], NOW)).toEqual([]);
  });
});

describe("admin blocks", () => {
  it("hides a blocked day or a blocked slot", () => {
    expect(openSlotsForDate("2026-09-16", [], [{ date: "2026-09-16", slot: null }], NOW)).toEqual(
      [],
    );
    expect(
      openSlotsForDate("2026-09-16", [], [{ date: "2026-09-16", slot: "11:00" }], NOW),
    ).toEqual(["10:00", "12:00", "13:00"]);
  });
  it("lists only days that have something open", () => {
    const days = openSlotsInRange(
      "2026-09-14",
      "2026-09-22",
      [],
      [{ date: "2026-09-17", slot: null }],
      NOW,
    );
    expect(Object.keys(days)).toEqual(["2026-09-16", "2026-09-18", "2026-09-21", "2026-09-22"]);
  });
});
