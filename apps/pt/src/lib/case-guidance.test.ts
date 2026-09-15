import { describe, it, expect } from "vitest";
import { getCaseGuidance, type CaseStage } from "./case-guidance";
import type { PropertyRecord } from "./properties";
import type { ProtestRecord, ProtestStatus } from "./protests";
import type { CountyProtestInfo } from "./county-protest-info";

const property: PropertyRecord = {
  id: "prop-1",
  address: "123 Main St, Plano, TX 75023",
  cad: "Collin Central Appraisal District",
  accountNumber: "12345",
  ownerName: "Test Owner LLC",
  propertyType: "Commercial",
  landValue: 100000,
  improvementValue: 400000,
  totalValue: 500000,
  taxYear: 2026,
  protestDeadline: "2099-05-15",
  paymentDueDate: null,
  taxAmountDue: null,
  paidAt: null,
  estimatedSavings: null,
  savingsBasis: null,
  createdAt: "2026-01-01T00:00:00Z",
  valueHistory: null,
};

function protestWith(overrides: Partial<ProtestRecord>): ProtestRecord {
  return {
    id: "protest-1",
    propertyId: "prop-1",
    status: "requested",
    notes: null,
    requestedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    originalValue: 500000,
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
    taxYear: 2026,
    corvusGuidanceAckAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const countyInfo: CountyProtestInfo = {
  cad: "Collin Central Appraisal District",
  filingMethod: {
    online: { url: "https://www.collincad.org/file-a-protest", notes: null },
    mail: null,
    inPerson: null,
    email: { available: null, address: null, notes: null },
  },
  arbContact: { phone: "555-123-4567", email: "arb@example.org", office: null },
  informalReview: { howToRequest: "Call the CAD to request an informal review.", notes: null },
  sourceUrl: "https://www.collincad.org",
  verifiedAt: "2026-09-03",
};

const ALL_STATUSES: ProtestStatus[] = [
  "requested",
  "filed",
  "under_review",
  "offer_received",
  "hearing_scheduled",
  "decision_received",
  "appealing",
  "arbitrating",
  "resolved",
];

describe("getCaseGuidance", () => {
  it("maps every real ProtestStatus to a stage with no crash and no null-field reference", () => {
    for (const status of ALL_STATUSES) {
      const guidance = getCaseGuidance(property, protestWith({ status }), undefined, countyInfo);
      expect(guidance.stage).toBeTruthy();
      expect(guidance.stageLabel).toBeTruthy();
      expect(guidance.summary.length).toBeGreaterThan(0);
    }
  });

  it("stage 'prepare_file' includes a real deadline in the summary when the deadline is real and future", () => {
    const guidance = getCaseGuidance(
      property,
      protestWith({ status: "requested" }),
      undefined,
      countyInfo,
    );
    expect(guidance.stage).toBe<CaseStage>("prepare_file");
    expect(guidance.summary).toContain("May");
    expect(guidance.summary).toContain("2099");
  });

  it("never claims a signed Notice of Protest has been filed — it hasn't been delivered", () => {
    const guidance = getCaseGuidance(
      property,
      protestWith({ status: "requested" }),
      undefined,
      countyInfo,
      "2026-01-02T00:00:00Z",
    );
    expect(guidance.stage).toBe<CaseStage>("prepare_file");
    expect(guidance.summary.toLowerCase()).toContain("doesn't file it");
    expect(guidance.nextSteps[0].label.toLowerCase()).toContain("deliver");
  });

  it("still tells an unsigned case to review and sign, not to deliver", () => {
    const guidance = getCaseGuidance(
      property,
      protestWith({ status: "requested" }),
      undefined,
      countyInfo,
      null,
    );
    expect(guidance.summary).not.toContain("doesn't file it");
  });

  it("never mentions a deadline that has already passed", () => {
    const past = { ...property, protestDeadline: "2020-01-01" };
    const guidance = getCaseGuidance(
      past,
      protestWith({ status: "requested" }),
      undefined,
      countyInfo,
    );
    expect(guidance.summary).not.toContain("2020");
  });

  it("includes an evidence-upload step only when the real uploaded count is known to be zero", () => {
    const withNone = getCaseGuidance(property, protestWith({ status: "requested" }), 0, countyInfo);
    const withSome = getCaseGuidance(property, protestWith({ status: "requested" }), 3, countyInfo);
    const withUnknown = getCaseGuidance(
      property,
      protestWith({ status: "requested" }),
      undefined,
      countyInfo,
    );
    expect(withNone.nextSteps.some((s) => s.label.includes("Upload evidence"))).toBe(true);
    expect(withSome.nextSteps.some((s) => s.label.includes("Upload evidence"))).toBe(false);
    expect(withUnknown.nextSteps.some((s) => s.label.includes("Upload evidence"))).toBe(false);
  });

  it("degrades gracefully with countyInfo null (a county not yet researched)", () => {
    const guidance = getCaseGuidance(
      property,
      protestWith({ status: "hearing_scheduled" }),
      undefined,
      null,
    );
    expect(guidance.countyInfo).toBeNull();
    for (const step of guidance.nextSteps) {
      expect(step.detail).not.toContain("null");
      expect(step.detail).not.toContain("undefined");
    }
  });

  it("stage 'informal_review' names the real settlement offer value when present", () => {
    const guidance = getCaseGuidance(
      property,
      protestWith({ status: "offer_received", settlementOfferValue: 425000 }),
      undefined,
      countyInfo,
    );
    expect(guidance.stage).toBe<CaseStage>("informal_review");
    expect(guidance.summary).toContain("$425,000");
  });

  it("stage 'resolved' names the real final value when present", () => {
    const guidance = getCaseGuidance(
      property,
      protestWith({ status: "resolved", finalValue: 460000 }),
      undefined,
      countyInfo,
    );
    expect(guidance.summary).toContain("$460,000");
    expect(guidance.nextSteps).toHaveLength(0);
  });

  it("every action anchor references a real, already-existing section id", () => {
    const KNOWN_ANCHORS = new Set([
      "case-documents",
      "case-progress",
      "case-hearing-notice",
      "case-informal-review",
      "case-hearing-prep",
      "case-upload-evidence",
    ]);
    for (const status of ALL_STATUSES) {
      const guidance = getCaseGuidance(property, protestWith({ status }), undefined, countyInfo);
      for (const step of guidance.nextSteps) {
        if (
          step.action &&
          !step.action.anchor.startsWith("http") &&
          !step.action.anchor.startsWith("tel:") &&
          !step.action.anchor.startsWith("mailto:")
        ) {
          expect(KNOWN_ANCHORS.has(step.action.anchor)).toBe(true);
        }
      }
    }
  });
});
