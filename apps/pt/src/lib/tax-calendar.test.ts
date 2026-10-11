import { describe, it, expect } from "vitest";
import { fromReminder, fromProperty } from "./tax-calendar";
import type { Reminder } from "./reminders";
import type { PropertyRecord } from "./properties";

const baseProperty: PropertyRecord = {
  id: "prop-1",
  address: "PARKER RD, WYLIE, TX 75098",
  cad: "Collin Central Appraisal District",
  accountNumber: "R999",
  ownerName: null,
  propertyType: "Commercial",
  landValue: 500_000,
  improvementValue: 1_000_000,
  totalValue: 1_500_000,
  taxYear: 2026,
  protestDeadline: "2099-09-30", // always in the future, so date-based resolution never fires
  paymentDueDate: null,
  taxAmountDue: null,
  paidAt: null,
  estimatedSavings: null,
  savingsBasis: null,
  createdAt: "2026-01-01T00:00:00Z",
  valueHistory: null,
};

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

describe("fromProperty — protest_deadline", () => {
  it("still-open deadline: not resolved, plain title, no days-left override", () => {
    const [deadline] = fromProperty(baseProperty, new Set(), new Set());
    expect(deadline.resolved).toBe(false);
    expect(deadline.title).toBe("Protest deadline — PARKER RD, WYLIE, TX 75098");
    expect(deadline.resolvedLabel).toBeUndefined();
  });

  it("settled current-cycle protest: resolved true even though the deadline date is still ahead", () => {
    const [deadline] = fromProperty(baseProperty, new Set(), new Set(["prop-1"]));
    expect(deadline.resolved).toBe(true);
    expect(deadline.title).toBe("Protest settled — PARKER RD, WYLIE, TX 75098");
    expect(deadline.resolvedLabel).toBe("Settled");
    expect(deadline.resolvedNote).toMatch(/case closed/i);
  });

  it("a resolved protest on a DIFFERENT property doesn't settle this one", () => {
    const [deadline] = fromProperty(baseProperty, new Set(), new Set(["some-other-property"]));
    expect(deadline.resolved).toBe(false);
    expect(deadline.title).toBe("Protest deadline — PARKER RD, WYLIE, TX 75098");
  });

  it("past deadline with no protest at all: still resolved via the plain date fallback", () => {
    const [deadline] = fromProperty(
      { ...baseProperty, protestDeadline: "2020-01-01" },
      new Set(),
      new Set(),
    );
    expect(deadline.resolved).toBe(true);
    expect(deadline.resolvedLabel).toBeUndefined(); // generic "Done", not "Settled" — no real case to point to
  });
});
