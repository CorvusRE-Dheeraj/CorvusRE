import { describe, expect, it } from "vitest";
import { addDaysIso, daysUntilIso, formatDay, isoDay, localDay } from "./local-day";

describe("local-day", () => {
  it("parses plain days and timestamps as the same local day", () => {
    expect(isoDay(localDay("2026-10-19")!)).toBe("2026-10-19");
    expect(isoDay(localDay("2026-10-19T00:00:00+00:00")!)).toBe("2026-10-19");
  });
  it("returns null for anything that isn't a day", () => {
    for (const v of ["", null, undefined, "garbage", "2026-13-45", "19/10/2026"])
      expect(localDay(v)).toBeNull();
  });
  it("adds days across month ends and DST", () => {
    expect(addDaysIso("2026-09-10", 60)).toBe("2026-11-09");
    expect(addDaysIso("2026-10-31T05:00:00Z", 1)).toBe("2026-11-01");
    expect(addDaysIso("nope", 5)).toBeNull();
  });
  it("counts days from today", () => {
    const now = new Date("2026-10-17T15:00:00");
    expect(daysUntilIso("2026-10-20", now)).toBe(3);
    expect(daysUntilIso("2026-10-16", now)).toBe(-1);
    expect(daysUntilIso("", now)).toBeNull();
  });
  it("formats with a fallback", () => {
    expect(formatDay("2026-10-19")).toBe("Oct 19, 2026");
    expect(formatDay("bad")).toBe("—");
  });
});
