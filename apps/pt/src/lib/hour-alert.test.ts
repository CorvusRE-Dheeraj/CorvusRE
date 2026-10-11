import { describe, expect, it } from "vitest";
import {
  alertTarget,
  centralToUtcMs,
  inAlertWindow,
  minutesLeft,
  parseClockTime,
} from "./hour-alert";

describe("parseClockTime", () => {
  it("reads common formats", () => {
    expect(parseClockTime("9:00 AM")).toEqual({ h: 9, m: 0 });
    expect(parseClockTime("1:30 pm")).toEqual({ h: 13, m: 30 });
    expect(parseClockTime("12:15 AM")).toEqual({ h: 0, m: 15 });
    expect(parseClockTime("12 PM")).toEqual({ h: 12, m: 0 });
    expect(parseClockTime("14:05")).toEqual({ h: 14, m: 5 });
    expect(parseClockTime("soon")).toBeNull();
    expect(parseClockTime(null)).toBeNull();
    expect(parseClockTime("25:00")).toBeNull();
  });
});

describe("centralToUtcMs", () => {
  it("applies Central Daylight and Standard offsets", () => {
    // 9:00 AM CDT (UTC−5) → 14:00 UTC; 9:00 AM CST (UTC−6) → 15:00 UTC
    expect(new Date(centralToUtcMs("2026-06-10", 9, 0)).toISOString()).toBe(
      "2026-06-10T14:00:00.000Z",
    );
    expect(new Date(centralToUtcMs("2026-12-10", 9, 0)).toISOString()).toBe(
      "2026-12-10T15:00:00.000Z",
    );
  });
});

describe("alertTarget", () => {
  it("uses the real start time for hearings and informal reviews", () => {
    const t = alertTarget("hearing:abc", "2026-06-10", "9:00 AM");
    expect(t?.kind).toBe("timed");
    expect(new Date(t!.dueMs).toISOString()).toBe("2026-06-10T14:00:00.000Z");
    expect(alertTarget("informal-review:x", "2026-06-10", "2:30 PM")?.kind).toBe("timed");
  });
  it("skips a hearing with no time on file", () => {
    expect(alertTarget("hearing:abc", "2026-06-10", null)).toBeNull();
  });
  it("treats date-only deadlines as closing at 5 PM Central", () => {
    const t = alertTarget("protest-deadline:p1", "2026-05-15", null);
    expect(t?.kind).toBe("close_of_day");
    expect(new Date(t!.dueMs).toISOString()).toBe("2026-05-15T22:00:00.000Z");
    expect(alertTarget("tax-due:bill:1", "2027-01-31", null)?.kind).toBe("close_of_day");
  });
  it("ignores things that are not deadlines", () => {
    expect(alertTarget("refund:1", "2026-05-15", null)).toBeNull();
    expect(alertTarget("reminder:1", "2026-05-15", null)).toBeNull();
  });
});

describe("inAlertWindow", () => {
  const due = Date.UTC(2026, 5, 10, 14, 0);
  it("is true only in the last hour", () => {
    expect(inAlertWindow(due, due - 61 * 60000)).toBe(false);
    expect(inAlertWindow(due, due - 60 * 60000)).toBe(true);
    expect(inAlertWindow(due, due - 5 * 60000)).toBe(true);
    expect(inAlertWindow(due, due)).toBe(false);
    expect(minutesLeft(due, due - 42 * 60000)).toBe(42);
  });
});
