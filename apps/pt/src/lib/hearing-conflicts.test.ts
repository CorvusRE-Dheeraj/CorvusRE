import { describe, it, expect } from "vitest";
import { findHearingConflicts } from "./hearing-conflicts";
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
    status: "hearing_scheduled",
    notes: null,
    requestedAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    originalValue: null,
    settlementOfferValue: null,
    settlementOfferReceivedAt: null,
    hearingDate: "2024-06-20",
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

describe("findHearingConflicts", () => {
  it("returns nothing when there's only one hearing on a day", () => {
    const groups = findHearingConflicts(
      [protest({ id: "pr1", propertyId: "p1" })],
      [property({ id: "p1" })],
    );
    expect(groups).toEqual([]);
  });

  it("ignores hearings on different days", () => {
    const groups = findHearingConflicts(
      [
        protest({ id: "pr1", propertyId: "p1", hearingDate: "2024-06-20" }),
        protest({ id: "pr2", propertyId: "p2", hearingDate: "2024-06-21" }),
      ],
      [property({ id: "p1" }), property({ id: "p2" })],
    );
    expect(groups).toEqual([]);
  });

  it("flags two hearings the same day at different real locations as requiring travel", () => {
    const groups = findHearingConflicts(
      [
        protest({
          id: "pr1",
          propertyId: "p1",
          hearingDate: "2024-06-20",
          hearingLocation: "100 County Way, Plano, TX",
          hearingMode: "In Person",
        }),
        protest({
          id: "pr2",
          propertyId: "p2",
          hearingDate: "2024-06-20",
          hearingLocation: "200 Courthouse Sq, McKinney, TX",
          hearingMode: "In Person",
        }),
      ],
      [property({ id: "p1", address: "1 A St" }), property({ id: "p2", address: "2 B St" })],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].requiresTravel).toBe(true);
    expect(groups[0].directionsUrl).toContain("google.com/maps/dir");
    expect(groups[0].directionsUrl).toContain("100+County+Way");
    expect(groups[0].hearings).toHaveLength(2);
  });

  it("does not flag travel when both hearings share the same real location", () => {
    const groups = findHearingConflicts(
      [
        protest({
          id: "pr1",
          propertyId: "p1",
          hearingDate: "2024-06-20",
          hearingLocation: "100 County Way, Plano, TX",
        }),
        protest({
          id: "pr2",
          propertyId: "p2",
          hearingDate: "2024-06-20",
          hearingLocation: "100 County Way, Plano, TX",
        }),
      ],
      [property({ id: "p1" }), property({ id: "p2" })],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].requiresTravel).toBe(false);
    expect(groups[0].directionsUrl).toBeNull();
  });

  it("notes when a hearing can be attended remotely", () => {
    const groups = findHearingConflicts(
      [
        protest({
          id: "pr1",
          propertyId: "p1",
          hearingDate: "2024-06-20",
          hearingLocation: "100 County Way, Plano, TX",
          hearingMode: "In Person",
        }),
        protest({
          id: "pr2",
          propertyId: "p2",
          hearingDate: "2024-06-20",
          hearingMode: "Phone",
        }),
      ],
      [property({ id: "p1", address: "1 A St" }), property({ id: "p2", address: "2 B St" })],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].guidance.some((g) => g.includes("attended remotely"))).toBe(true);
  });
});
