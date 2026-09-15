import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getPropertyProtestStatus } from "./portfolio-status";
import type { PropertyRecord } from "./properties";
import type { ProtestRecord } from "./protests";

function property(overrides: Partial<PropertyRecord> = {}): PropertyRecord {
  return {
    id: "p1",
    address: "123 Main St",
    cad: null,
    accountNumber: null,
    ownerName: null,
    propertyType: null,
    landValue: null,
    improvementValue: null,
    totalValue: null,
    taxYear: null,
    protestDeadline: null,
    paymentDueDate: null,
    taxAmountDue: null,
    paidAt: null,
    estimatedSavings: null,
    savingsBasis: null,
    createdAt: "2024-01-01T00:00:00Z",
    valueHistory: null,
    ...overrides,
  };
}

function protest(overrides: Partial<ProtestRecord> = {}): ProtestRecord {
  return {
    id: "pr1",
    propertyId: "p1",
    status: "requested",
    notes: null,
    requestedAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    originalValue: null,
    settlementOfferValue: null,
    settlementOfferReceivedAt: null,
    hearingDate: null,
    hearingTime: null,
    hearingLocation: null,
    hearingMode: null,
    informalStatus: "not_requested",
    informalReviewDate: null,
    informalAppraiserCategory: null,
    attendanceType: null,
    arbDecision: null,
    arbDecisionDate: null,
    finalValue: null,
    escalationPath: null,
    closedAt: null,
    taxYear: null,
    corvusGuidanceAckAt: null,
    ...overrides,
  };
}

describe("getPropertyProtestStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-01T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns resolved when the property's protest is resolved", () => {
    const result = getPropertyProtestStatus(property(), [protest({ status: "resolved" })]);
    expect(result).toEqual({ status: "resolved", label: "Resolved", daysLeft: null });
  });

  it("returns in_progress with the human label for any other active protest status", () => {
    const result = getPropertyProtestStatus(property(), [protest({ status: "hearing_scheduled" })]);
    expect(result.status).toBe("in_progress");
    expect(result.label).toBe("Hearing Scheduled");
    expect(result.daysLeft).toBeNull();
  });

  it("ignores a protest belonging to a different property", () => {
    const result = getPropertyProtestStatus(property({ id: "p1" }), [
      protest({ propertyId: "p2", status: "resolved" }),
    ]);
    expect(result.status).not.toBe("resolved");
  });

  it("returns on_track with no deadline when there's no protest and no deadline on file", () => {
    const result = getPropertyProtestStatus(property(), []);
    expect(result).toEqual({ status: "on_track", label: "No deadline on file", daysLeft: null });
  });

  it("returns needs_action inside the 14-day window", () => {
    const result = getPropertyProtestStatus(
      property({ protestDeadline: "2024-06-10T00:00:00Z" }), // 9 days out
      [],
    );
    expect(result.status).toBe("needs_action");
    expect(result.daysLeft).toBe(9);
    expect(result.label).toBe("9 days left");
  });

  it("labels a same-day deadline as Due today", () => {
    const result = getPropertyProtestStatus(
      property({ protestDeadline: "2024-06-01T00:00:00Z" }),
      [],
    );
    expect(result.status).toBe("needs_action");
    expect(result.daysLeft).toBe(0);
    expect(result.label).toBe("Due today");
  });

  it("labels a past deadline as Deadline passed", () => {
    const result = getPropertyProtestStatus(
      property({ protestDeadline: "2024-05-01T00:00:00Z" }),
      [],
    );
    expect(result.status).toBe("needs_action");
    expect(result.daysLeft).toBeLessThan(0);
    expect(result.label).toBe("Deadline passed");
  });

  it("returns on_track outside the 14-day window", () => {
    const result = getPropertyProtestStatus(
      property({ protestDeadline: "2024-07-01T00:00:00Z" }), // 30 days out
      [],
    );
    expect(result.status).toBe("on_track");
    expect(result.daysLeft).toBe(30);
  });

  it("prefers an active protest's status over a looming deadline", () => {
    const result = getPropertyProtestStatus(property({ protestDeadline: "2024-06-02T00:00:00Z" }), [
      protest({ status: "filed" }),
    ]);
    expect(result.status).toBe("in_progress");
    expect(result.label).toBe("Filed");
  });
});
