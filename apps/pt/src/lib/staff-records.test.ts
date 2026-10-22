import { describe, expect, it } from "vitest";
import { ENTITY_DEPARTMENT, TRANSFER_TARGETS, canRespond, type Transfer } from "./staff-records";

const t = (over: Partial<Transfer>): Transfer => ({
  id: "t1",
  createdAt: "2026-10-22T00:00:00Z",
  entityType: "lead",
  entityId: "e1",
  entityLabel: "Zz Co",
  leadId: "l1",
  profileId: null,
  fromDepartment: "marketing",
  toDepartment: "support",
  fromOwner: "m1",
  toOwner: null,
  reason: "Needs onboarding",
  history: [],
  pendingActions: [],
  status: "pending",
  requestedBy: "m1",
  respondedBy: null,
  respondedAt: null,
  responseNote: null,
  pausedOutreach: true,
  ...over,
});

describe("handoff rules (mirror respond_transfer / transfer_allowed in SQL)", () => {
  it("a team handoff can be taken by anyone in the receiving team", () => {
    expect(canRespond(t({}), "s1", ["support"], false)).toBe(true);
    expect(canRespond(t({}), "o1", ["operations"], false)).toBe(false);
  });
  it("a named handoff only by that person (or a Super Admin)", () => {
    const named = t({ toOwner: "s2" });
    expect(canRespond(named, "s1", ["support"], false)).toBe(false);
    expect(canRespond(named, "s2", ["support"], false)).toBe(true);
    expect(canRespond(named, "boss", [], true)).toBe(true);
  });
  it("decided handoffs can't be answered again", () => {
    expect(canRespond(t({ status: "accepted" }), "s1", ["support"], false)).toBe(false);
  });
  it("items move only where they make sense", () => {
    expect(TRANSFER_TARGETS.case).toEqual(["operations"]);
    expect(TRANSFER_TARGETS.lead).toContain("support");
    expect(TRANSFER_TARGETS.escalation).toContain("operations");
    expect(ENTITY_DEPARTMENT.onboarding).toBe("support");
  });
});
