import { describe, expect, it } from "vitest";
import { casePipeline, urgencyOf, type PipelineInput } from "./case-pipeline";
import type { ProtestRecord } from "./protests";

const protest = (over: Partial<ProtestRecord> = {}): ProtestRecord => ({
  id: "pr1",
  propertyId: "p1",
  status: "requested",
  notes: null,
  requestedAt: "2026-04-01T00:00:00Z",
  updatedAt: "2026-04-01T00:00:00Z",
  originalValue: 900000,
  settlementOfferValue: null,
  settlementOfferReceivedAt: null,
  hearingDate: null,
  hearingTime: null,
  hearingLocation: null,
  hearingMode: null,
  arbDecision: null,
  arbDecisionDate: null,
  finalValue: null,
  escalationPath: null,
  closedAt: null,
  taxYear: 2026,
  corvusGuidanceAckAt: null,
  informalStatus: "not_requested",
  informalReviewDate: null,
  informalAppraiserCategory: null,
  attendanceType: null,
  ...over,
});

const base: PipelineInput = {
  protest: null,
  notice: null,
  protestDeadline: "2026-05-15",
  cadName: "Denton CAD",
  managed: false,
  today: "2026-05-01",
};
const notice = (over: Partial<NonNullable<PipelineInput["notice"]>> = {}) => ({
  signedAt: null,
  submittedAt: null,
  filingConfirmedAt: null,
  additionalRequestedAt: null,
  rejectedAt: null,
  ...over,
});
const stateOf = (input: PipelineInput) =>
  Object.fromEntries(casePipeline(input).stages.map((s) => [s.id, s.state]));

describe("casePipeline", () => {
  it("starts at Case Readiness with no case, due by the protest deadline", () => {
    const { next, stages } = casePipeline(base);
    expect(stages[0]).toMatchObject({ id: "readiness", state: "current" });
    expect(next).toMatchObject({
      stage: "readiness",
      title: "Start your protest case",
      dueDate: "2026-05-15",
      urgency: "soon",
      target: { kind: "start" },
    });
  });

  it("asks to sign, then to file, the Notice of Protest", () => {
    const p = protest({ corvusGuidanceAckAt: "2026-04-02T00:00:00Z" });
    expect(casePipeline({ ...base, protest: p }).next.title).toBe(
      "Complete and sign your Notice of Protest (Form 50-132)",
    );
    const signed = casePipeline({
      ...base,
      protest: p,
      notice: notice({ signedAt: "2026-04-03" }),
    });
    expect(signed.next.title).toBe("File your signed Notice of Protest with Denton CAD");
  });

  it("requires proof the county received it before moving on", () => {
    const p = protest({ corvusGuidanceAckAt: "x" });
    const n = notice({ signedAt: "a", submittedAt: "2026-04-04T00:00:00Z" });
    const r = casePipeline({ ...base, protest: p, notice: n });
    expect(r.next.stage).toBe("confirm");
    expect(r.next.title).toBe("Confirm the county received your protest");
  });

  it("reopens Confirm Filing when the county asks for more or rejects it", () => {
    const p = protest({ status: "filed", corvusGuidanceAckAt: "x" });
    const n = notice({
      signedAt: "a",
      submittedAt: "2026-04-04T00:00:00Z",
      filingConfirmedAt: "2026-04-05T00:00:00Z",
      additionalRequestedAt: "2026-04-06T00:00:00Z",
    });
    expect(casePipeline({ ...base, protest: p, notice: n }).next.title).toBe(
      "The county asked for more information",
    );
  });

  it("puts Request CAD Evidence next after filing, due 14 days before the hearing", () => {
    const p = protest({ status: "filed", hearingDate: "2026-06-20" });
    const { next } = casePipeline({ ...base, protest: p });
    expect(next).toMatchObject({
      stage: "cad_evidence",
      dueDate: "2026-06-06",
      target: { kind: "anchor", anchor: "case-cad-evidence" },
    });
  });

  it("walks the informal review states", () => {
    const filed = { status: "filed" as const, cadEvidenceRequestedAt: "2026-05-02T00:00:00Z" };
    expect(casePipeline({ ...base, protest: protest(filed) }).next.title).toBe(
      "Request an informal review with the appraiser",
    );
    expect(
      casePipeline({
        ...base,
        protest: protest({
          ...filed,
          informalStatus: "proposed_value_received",
          settlementOfferValue: 820000,
        }),
      }).next.title,
    ).toBe("Review the county's offer of $820,000");
  });

  it("skips the ARB, decision and appeal when the informal offer is accepted", () => {
    const s = stateOf({
      ...base,
      protest: protest({ status: "resolved", informalStatus: "accepted", closedAt: "2026-06-01" }),
    });
    expect(s).toMatchObject({
      arb: "skipped",
      decision: "skipped",
      appeal: "skipped",
      close: "done",
    });
    expect(s.cad_evidence).toBe("skipped");
  });

  it("asks to mark a past hearing as held", () => {
    const p = protest({
      status: "hearing_scheduled",
      cadEvidenceRequestedAt: "x",
      informalStatus: "rejected",
      hearingDate: "2026-04-20",
    });
    expect(casePipeline({ ...base, protest: p }).next.title).toBe("Mark your ARB hearing as held");
  });

  it("counts the appeal window from the ARB decision", () => {
    const p = protest({
      status: "decision_received",
      cadEvidenceRequestedAt: "x",
      arbDecision: "partial",
      arbDecisionDate: "2026-07-01",
    });
    const { next } = casePipeline({ ...base, protest: p, today: "2026-08-28" });
    expect(next).toMatchObject({
      stage: "appeal",
      dueDate: "2026-08-30",
      urgency: "urgent",
      title: "Decide: accept the ARB's decision, or appeal it",
    });
  });

  it("says CorvusPT is acting for Expert/Managed cases, but keeps owner decisions", () => {
    const p = protest({ corvusGuidanceAckAt: "x" });
    expect(casePipeline({ ...base, protest: p, managed: true }).next).toMatchObject({
      owner: "corvus",
      title: "CorvusPT is filing your protest",
    });
    const offer = protest({
      status: "filed",
      cadEvidenceRequestedAt: "x",
      informalStatus: "proposed_value_received",
    });
    expect(casePipeline({ ...base, protest: offer, managed: true }).next.owner).toBe("you");
  });

  it("is closed when resolved", () => {
    const r = casePipeline({
      ...base,
      protest: protest({ status: "resolved", escalationPath: "accept", arbDecision: "denied" }),
    });
    expect(r.next.stage).toBeNull();
    expect(r.completed).toBe(9);
  });
});

describe("urgencyOf", () => {
  it("grades the due date", () => {
    expect(urgencyOf("2026-05-01", "2026-05-02")).toBe("overdue");
    expect(urgencyOf("2026-05-04", "2026-05-01")).toBe("urgent");
    expect(urgencyOf("2026-05-10", "2026-05-01")).toBe("soon");
    expect(urgencyOf("2026-07-01", "2026-05-01")).toBe("normal");
    expect(urgencyOf(null, "2026-05-01")).toBe("normal");
  });
});
