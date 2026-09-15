import { describe, it, expect } from "vitest";
import { computePortfolioSavings } from "./portfolio-savings";
import type { PropertyRecord } from "./properties";
import type { ProtestRecord } from "./protests";
import type { BppAccountRecord } from "./bpp-accounts";
import { STATEWIDE_AVERAGE_EFFECTIVE_TAX_RATE } from "./texas-tax-rates";

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

function bppAccount(overrides: Partial<BppAccountRecord> = {}): BppAccountRecord {
  return {
    id: "b1",
    businessName: "Acme LLC",
    accountNumber: null,
    cad: null,
    locationAddress: null,
    createdAt: "2024-01-01T00:00:00Z",
    taxYear: null,
    renderedValue: null,
    priorValue: null,
    noticeValue: null,
    renditionDeadline: null,
    protestDeadline: null,
    renditionSignatureType: null,
    renditionSignatureData: null,
    renditionSignedAt: null,
    renditionFiledAt: null,
    estimatedSavings: null,
    stripeSubscriptionId: null,
    subscriptionStatus: null,
    planTier: null,
    valueBracket: null,
    cancelAtPeriodEnd: false,
    cancelAt: null,
    ...overrides,
  };
}

function protest(overrides: Partial<ProtestRecord> = {}): ProtestRecord {
  return {
    id: "pr1",
    propertyId: "p1",
    status: "resolved",
    notes: null,
    requestedAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    originalValue: 500_000,
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
    finalValue: 450_000,
    escalationPath: null,
    closedAt: "2024-11-01T00:00:00Z",
    taxYear: 2024,
    corvusGuidanceAckAt: null,
    ...overrides,
  };
}

describe("computePortfolioSavings", () => {
  it("sums actual savings for resolved property cases", () => {
    const result = computePortfolioSavings([protest()], [property({ cad: "Collin" })], []);
    expect(result.resolvedCaseCount).toBe(1);
    expect(result.entries[0].valueReduction).toBe(50_000);
    expect(result.lifetimeSavings).toBeGreaterThan(0);
  });

  it("includes resolved BPP protests", () => {
    const result = computePortfolioSavings(
      [
        protest({
          id: "pr-bpp",
          propertyId: null,
          bppAccountId: "b1",
          originalValue: 200_000,
          finalValue: 150_000,
        }),
      ],
      [],
      [bppAccount({ cad: "Dallas" })],
    );
    expect(result.resolvedCaseCount).toBe(1);
    expect(result.entries[0].subjectKind).toBe("bpp");
    expect(result.entries[0].subjectLabel).toBe("Acme LLC");
    expect(result.entries[0].valueReduction).toBe(50_000);
  });

  it("excludes cases that aren't actually resolved yet", () => {
    const result = computePortfolioSavings(
      [protest({ status: "decision_received" })],
      [property()],
      [],
    );
    expect(result.resolvedCaseCount).toBe(0);
    expect(result.lifetimeSavings).toBe(0);
  });

  it("excludes a resolved case missing original or final value", () => {
    const result = computePortfolioSavings([protest({ finalValue: null })], [property()], []);
    expect(result.resolvedCaseCount).toBe(0);
  });

  it("falls back to the statewide average rate when the subject has no cad on file", () => {
    const result = computePortfolioSavings([protest()], [property({ cad: null })], []);
    expect(result.entries[0].actualSavings).toBe(
      Math.round(50_000 * STATEWIDE_AVERAGE_EFFECTIVE_TAX_RATE),
    );
  });

  it("groups totals by tax year and sorts entries by closedAt descending", () => {
    const result = computePortfolioSavings(
      [
        protest({ id: "a", taxYear: 2023, closedAt: "2023-12-01T00:00:00Z" }),
        protest({ id: "b", taxYear: 2024, closedAt: "2024-12-01T00:00:00Z" }),
      ],
      [property()],
      [],
    );
    expect(result.byYear.map((y) => y.year)).toEqual([2023, 2024]);
    expect(result.entries[0].protestId).toBe("b");
    expect(result.entries[1].protestId).toBe("a");
  });

  it("skips a protest whose subject record can no longer be found", () => {
    const result = computePortfolioSavings(
      [protest({ propertyId: "missing" })],
      [property({ id: "p1" })],
      [],
    );
    expect(result.resolvedCaseCount).toBe(0);
  });
});
