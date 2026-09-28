import { describe, it, expect } from "vitest";
import { fromReminder } from "./tax-calendar";
import type { Reminder } from "./reminders";

const baseReminder: Reminder = {
  id: "r1",
  propertyId: null,
  remindOn: "2026-01-01",
  note: "Call the CAD",
  done: false,
  missedAt: null,
  source: "manual",
  createdAt: "2025-12-01T00:00:00Z",
};

describe("fromReminder", () => {
  it("done reminder: resolved true, missed false — regardless of date", () => {
    const e = fromReminder({ ...baseReminder, done: true, remindOn: "2020-01-01" }, []);
    expect(e.resolved).toBe(true);
    expect(e.missed).toBe(false);
  });

  it("not done, date in the past, never explicitly marked: auto-missed, NOT resolved", () => {
    const e = fromReminder({ ...baseReminder, done: false, remindOn: "2020-01-01" }, []);
    expect(e.resolved).toBe(false);
    expect(e.missed).toBe(true);
  });

  it("not done, date in the future: neither resolved nor missed", () => {
    const e = fromReminder({ ...baseReminder, done: false, remindOn: "2099-01-01" }, []);
    expect(e.resolved).toBe(false);
    expect(e.missed).toBe(false);
  });

  it("explicitly marked missed BEFORE its date: missed true even though not overdue", () => {
    const e = fromReminder(
      { ...baseReminder, done: false, remindOn: "2099-01-01", missedAt: "2025-12-02T00:00:00Z" },
      [],
    );
    expect(e.resolved).toBe(false);
    expect(e.missed).toBe(true);
  });

  it("done always wins over an explicit missedAt", () => {
    const e = fromReminder(
      { ...baseReminder, done: true, remindOn: "2020-01-01", missedAt: "2025-12-02T00:00:00Z" },
      [],
    );
    expect(e.resolved).toBe(true);
    expect(e.missed).toBe(false);
  });
});
