import { describe, expect, it } from "vitest";
import {
  documentIssues,
  nextOnboardingStep,
  onboardingPercent,
  propertyConflicts,
  slaState,
  toCsv,
  type DocumentInfo,
} from "./support-console";
import { supportJourney, STEP_LABELS } from "./journey-steps";
import type { PropertyRecord } from "./properties";
import type { ProtestRecord } from "./protests";

const NOW = Date.parse("2026-11-06T12:00:00Z");

describe("slaState", () => {
  it("counts down to the response deadline, then shows how overdue", () => {
    expect(
      slaState({ status: "open", dueAt: "2026-11-07T12:00:00Z", firstResponseAt: null }, NOW),
    ).toMatchObject({ tone: "ok", label: "Due in 1d" });
    expect(
      slaState({ status: "open", dueAt: "2026-11-06T13:00:00Z", firstResponseAt: null }, NOW),
    ).toMatchObject({ tone: "soon", label: "Due in 1h" });
    expect(
      slaState({ status: "open", dueAt: "2026-11-06T09:00:00Z", firstResponseAt: null }, NOW),
    ).toMatchObject({ tone: "overdue", label: "Overdue by 3h" });
  });
  it("is met once someone replied, and closed once resolved", () => {
    expect(
      slaState(
        {
          status: "in_progress",
          dueAt: "2026-11-01T00:00:00Z",
          firstResponseAt: "2026-10-31T00:00:00Z",
        },
        NOW,
      ).tone,
    ).toBe("met");
    expect(
      slaState({ status: "resolved", dueAt: "2026-11-01T00:00:00Z", firstResponseAt: null }, NOW)
        .tone,
    ).toBe("closed");
  });
});

describe("onboarding", () => {
  const steps = [
    { key: "terms", label: "Accept the Terms", done: true },
    { key: "phone", label: "Add a phone number", done: false },
    { key: "property", label: "Add a property", done: false },
  ];
  it("finds the next step and the percent done", () => {
    expect(nextOnboardingStep(steps)?.key).toBe("phone");
    expect(onboardingPercent({ onboardingDone: 1, onboardingTotal: 3 })).toBe(33);
    expect(onboardingPercent({ onboardingDone: 0, onboardingTotal: 0 })).toBe(0);
    expect(nextOnboardingStep(steps.map((s) => ({ ...s, done: true })))).toBeNull();
  });
});

const doc = (over: Partial<DocumentInfo>): DocumentInfo => ({
  id: "d1",
  propertyId: "p1",
  fileName: "notice.pdf",
  type: "appraisal_notice",
  category: null,
  uploadedAt: "2026-10-01T00:00:00Z",
  aiVerdict: "valid",
  aiNotes: null,
  verificationStatus: "verified",
  verificationFlags: [],
  editedFrom: null,
  duplicateOf: null,
  deletedAt: null,
  ...over,
});

describe("documentIssues", () => {
  it("flags unreadable files, partial extraction, conflicts and duplicates — never deleted ones", () => {
    const issues = documentIssues([
      doc({ id: "a", aiVerdict: "invalid", aiNotes: "Blank page" }),
      doc({ id: "b", aiVerdict: "issues", aiNotes: "Value cut off" }),
      doc({
        id: "c",
        verificationStatus: "needs_review",
        verificationFlags: [{ message: "Account number differs from the county record" }],
      }),
      doc({ id: "d", verificationStatus: "needs_review", verificationFlags: ["Looks edited"] }),
      doc({ id: "e", duplicateOf: "a" }),
      doc({ id: "f", aiVerdict: "invalid", deletedAt: "2026-10-02T00:00:00Z" }),
      doc({ id: "g" }),
    ]);
    expect(issues.map((i) => [i.documentId, i.kind])).toEqual([
      ["a", "unreadable"],
      ["b", "extraction"],
      ["c", "conflict"],
      ["d", "confirm"],
      ["e", "duplicate"],
    ]);
    expect(issues[2].detail).toContain("Account number differs");
  });

  it("propertyConflicts keeps only address / account / value / date disagreements", () => {
    expect(
      propertyConflicts({
        address: "x",
        verification_flags: [
          { message: "Total value differs from CAD ($500,000 vs $480,000)" },
          "Document may be AI-generated",
        ],
      }),
    ).toEqual(["Total value differs from CAD ($500,000 vs $480,000)"]);
  });
});

describe("toCsv", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(
      toCsv(
        ["a", "b"],
        [
          ["x,y", 'say "hi"'],
          [1, null],
        ],
      ),
    ).toBe('a,b\n"x,y","say ""hi"""\n1,');
  });
});

// ── the Journey Map, as Support sees it ─────────────────────────────────────

function property(over: Partial<PropertyRecord> = {}): PropertyRecord {
  return {
    id: "p1",
    address: "19730 Bulverde Rd",
    cad: "Bexar Appraisal District",
    accountNumber: "1149803",
    ownerName: "OWNER LLC",
    propertyType: "Commercial",
    landValue: null,
    improvementValue: null,
    totalValue: 1_000_000,
    taxYear: 2026,
    protestDeadline: "2026-11-20",
    paymentDueDate: null,
    taxAmountDue: null,
    paidAt: null,
    estimatedSavings: null,
    savingsBasis: null,
    createdAt: "2026-01-01T00:00:00Z",
    valueHistory: null,
    subscriptionStatus: "active",
    verificationStatus: "verified",
    ...over,
  } as PropertyRecord;
}

function protest(over: Partial<ProtestRecord> = {}): ProtestRecord {
  return {
    id: "pr1",
    propertyId: "p1",
    status: "requested",
    notes: null,
    requestedAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
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
    taxYear: 2026,
    corvusGuidanceAckAt: null,
    ...over,
  } as ProtestRecord;
}

describe("supportJourney", () => {
  it("uses the Journey Map's own steps and maps the protest status onto them", () => {
    const j = supportJourney({
      property: property(),
      protest: protest({ status: "filed" }),
      documents: 1,
      packetSigned: true,
      today: "2026-11-06",
    });
    expect(j.steps.map((s) => s.label)).toEqual([...STEP_LABELS]);
    expect(j.stage).toBe("Track");
    expect(j.steps.filter((s) => s.done).length).toBe(8);
  });

  it("a requested protest without a signed packet is flagged as a deadline risk, with the next action", () => {
    const j = supportJourney({
      property: property(),
      protest: protest(),
      documents: 1,
      packetSigned: false,
      today: "2026-11-06",
    });
    expect(j.stage).toBe("Submit");
    expect(j.outstanding).toContain("Signed engagement packet");
    expect(
      j.flags.some((f) => f.severity === "medium" && /engagement packet isn't signed/.test(f.text)),
    ).toBe(true);
    expect(j.nextAction).toMatch(/sign the engagement packet/);
  });

  it("a held property is a blocked step and comes first in the next action", () => {
    const j = supportJourney({
      property: property({ verificationStatus: "needs_review" }),
      protest: null,
      documents: 0,
      packetSigned: false,
      today: "2026-11-06",
    });
    expect(j.flags[0]).toMatchObject({ severity: "high" });
    expect(j.flags[0].text).toMatch(/held for verification/);
    expect(j.nextAction).toMatch(/Operations/);
    expect(j.deadlines[0]).toMatchObject({ label: "Protest deadline", verified: false });
  });

  it("no account number blocks 'Find Property'", () => {
    const j = supportJourney({
      property: property({ accountNumber: null }),
      protest: null,
      documents: 0,
      packetSigned: false,
      today: "2026-11-06",
    });
    expect(j.stage).toBe("Find Property");
    expect(j.outstanding).toContain("CAD account number");
  });

  it("parallel activities: hearing, tax payment, packet — informal review only when requested", () => {
    const j = supportJourney({
      property: property(),
      protest: protest({
        status: "hearing_scheduled",
        hearingDate: "2026-11-10",
        informalStatus: "scheduled",
        informalReviewDate: "2026-11-08",
      } as Partial<ProtestRecord>),
      documents: 0,
      packetSigned: true,
      bill: { dueDate: "2027-01-31", status: "unpaid", amountDue: 20000 },
      today: "2026-11-06",
    });
    expect(j.parallel.map((x) => x.label)).toEqual([
      "Property verification",
      "Informal review",
      "ARB hearing",
      "Tax payment",
      "Engagement packet",
    ]);
    expect(j.flags.some((f) => /ARB hearing in 4 days and no evidence/.test(f.text))).toBe(true);
    expect(j.deadlines.map((d) => d.label)).toEqual([
      "Informal review",
      "ARB hearing",
      "Protest deadline",
      "Tax payment due",
    ]);
  });
});
