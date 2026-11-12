import { describe, expect, it } from "vitest";
import {
  applicationStage,
  arbitrationCost,
  arbitrationDeadline,
  arbitrationNext,
  arbitrationUpcoming,
  awardComparison,
  categorize,
  copyEvidence,
  currentPhase,
} from "./arbitration-case";
import type { PropertyRecord } from "./properties";
import type { ProtestRecord } from "./protests";
import type { DocumentRecord } from "./documents";

const property = {
  id: "p1",
  address: "4601 Parkview Hills Ln",
  cad: "Tarrant Appraisal District",
  propertyType: "Commercial",
  totalValue: 2_500_000,
} as unknown as PropertyRecord;
const protest = (over: Partial<ProtestRecord> = {}) =>
  ({
    id: "x1",
    status: "decision_received",
    arbDecision: "denied",
    arbDecisionDate: "2026-11-01",
    originalValue: 2_600_000,
    finalValue: 2_500_000,
    escalationPath: "arbitration",
    arbitrationFiledAt: null,
    ...over,
  }) as unknown as ProtestRecord;

describe("arbitration application status", () => {
  it("only advances with recorded proof", () => {
    expect(applicationStage(protest(), {})).toBe("not_started");
    expect(applicationStage(protest(), { application: { fields: {}, startedAt: "x" } })).toBe(
      "in_progress",
    );
    expect(
      applicationStage(protest(), { application: { fields: {}, startedAt: "x", readyAt: "y" } }),
    ).toBe("ready");
    expect(applicationStage(protest(), { submittedAt: "z" })).toBe("deposit_pending");
    expect(applicationStage(protest(), { submittedAt: "z", depositPaidAt: "d" })).toBe(
      "deposit_paid",
    );
    expect(applicationStage(protest(), { confirmedAt: "c" })).toBe("confirmed");
    // an older case that only recorded "filed"
    expect(applicationStage(protest({ arbitrationFiledAt: "f" }), {})).toBe("deposit_pending");
  });

  it("names the next step in order", () => {
    expect(arbitrationNext(protest(), {}).label).toBe("Start Arbitration Application");
    expect(
      arbitrationNext(protest(), { application: { fields: {}, startedAt: "x", readyAt: "y" } })
        .popup,
    ).toBe("status");
    expect(arbitrationNext(protest(), { confirmedAt: "c" }).label).toBe(
      "Reuse Evidence for Arbitration",
    );
    expect(arbitrationNext(protest({ arbDecision: null }), {}).label).toBe("Check Eligibility");
    expect(
      currentPhase(protest(), { award: { value: 1, date: null, documentId: null, at: "a" } }),
    ).toBe("final");
  });
});

describe("arbitration cost, deadline and award", () => {
  it("uses the Comptroller schedule and the effective tax rate", () => {
    const c = arbitrationCost(property, protest(), 2_300_000);
    expect(c.deposit).toBe(1_050); // non-homestead $2M–$3M
    expect(c.arbitratorFee).toBe(1_000);
    expect(c.refundIfCloser).toBe(1_000);
    expect(c.savings).toBeGreaterThan(0);
    expect(c.roi).toBeCloseTo(c.savings! / 1_050, 1);
  });

  it("counts 60 days from receipt when it's known, else from the order", () => {
    expect(arbitrationDeadline(protest(), {}).deadline).toBe("2026-12-31");
    const d = arbitrationDeadline(protest(), { orderReceivedDate: "2026-11-05" });
    expect(d.deadline).toBe("2027-01-04");
    expect(d.basis).toBe("received");
  });

  it("says whether the award is closer to the owner's value", () => {
    expect(awardComparison(2_350_000, 2_300_000, 2_500_000).closerToOwner).toBe(true);
    expect(awardComparison(2_450_000, 2_300_000, 2_500_000).closerToOwner).toBe(false);
    expect(awardComparison(2_450_000, null, 2_500_000).closerToOwner).toBeNull();
  });

  it("lists the filing deadline until submitted, then settlement and hearing dates", () => {
    const now = new Date("2026-11-12T12:00:00");
    expect(arbitrationUpcoming(protest(), {}, now)[0].label).toMatch(/due/);
    const later = arbitrationUpcoming(
      protest(),
      {
        confirmedAt: "c",
        settlement: { endDate: "2027-01-20", status: "negotiating", offers: [] },
        arbitrator: { hearingDate: "2027-02-10", hearingTime: "9:00 AM" },
      },
      now,
    );
    expect(later.map((x) => x.label)).toEqual([
      "Settlement period ends",
      "Arbitration hearing at 9:00 AM",
    ]);
  });
});

describe("arbitration evidence copy", () => {
  it("copies the ARB packet as a separate list and sorts documents into categories", () => {
    const docs = [
      { id: "d1", fileName: "Comparable sales grid.pdf", documentType: null },
      { id: "d2", fileName: "roof photo.jpg", documentType: null },
      { id: "d3", fileName: "2025 rent roll.xlsx", documentType: "Income statement" },
    ] as unknown as DocumentRecord[];
    const copy = copyEvidence(docs, "2026-11-12T00:00:00Z");
    expect(copy.items.map((i) => [i.documentId, i.category, i.source])).toEqual([
      ["d1", "comparables", "reused"],
      ["d2", "photos", "reused"],
      ["d3", "income", "reused"],
    ]);
    // the original array is untouched
    expect(docs).toHaveLength(3);
    expect(categorize({ fileName: "Order Determining Protest.pdf", documentType: null })).toBe(
      "arb_order",
    );
  });
});
