import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: {} }));

import {
  nextStatus,
  planIssueReminders,
  providerSearchTypes,
  upcomingIssueDates,
  type PropertyIssue,
} from "./property-issues";

const issue = (over: Partial<PropertyIssue> = {}): PropertyIssue => ({
  id: "i1",
  userId: "u1",
  propertyId: "p1",
  source: "manual",
  externalRef: null,
  category: "grass",
  title: "High grass",
  description: null,
  issuedOn: null,
  deadline: null,
  inspectionDate: null,
  courtDate: null,
  fineAmount: null,
  fineDue: null,
  requiredAction: null,
  authority: null,
  authorityContact: null,
  consequences: null,
  guidance: null,
  costEstimate: null,
  providerTypes: [],
  status: "action_required",
  sourceDocumentId: null,
  resolvedAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  ...over,
});

describe("planIssueReminders", () => {
  it("adds a 3-day heads-up and a day-of reminder for each future date", () => {
    const plan = planIssueReminders(
      issue({ deadline: "2026-10-20", inspectionDate: "2026-10-22" }),
      "2026-10-06",
    );
    expect(plan.map((p) => p.remindOn)).toEqual([
      "2026-10-17",
      "2026-10-20",
      "2026-10-19",
      "2026-10-22",
    ]);
    expect(plan[0].note).toBe("Property issue: deadline in 3 days — High grass");
  });

  it("skips past dates and a heads-up that would already be past", () => {
    const plan = planIssueReminders(
      issue({ deadline: "2026-10-01", courtDate: "2026-10-08" }),
      "2026-10-06",
    );
    expect(plan).toEqual([
      { remindOn: "2026-10-08", note: "Property issue: court date today — High grass" },
    ]);
  });

  it("plans nothing once resolved", () => {
    expect(
      planIssueReminders(issue({ deadline: "2026-12-01", status: "resolved" }), "2026-10-06"),
    ).toEqual([]);
  });
});

describe("upcomingIssueDates", () => {
  it("lists open issues' future dates soonest first", () => {
    const list = upcomingIssueDates(
      [
        issue({ id: "a", deadline: "2026-11-01" }),
        issue({ id: "b", fineDue: "2026-10-10", deadline: "2026-09-01" }),
        issue({ id: "c", deadline: "2026-10-07", status: "resolved" }),
      ],
      "2026-10-06",
    );
    expect(list.map((d) => [d.issue.id, d.kind, d.date])).toEqual([
      ["b", "Fine due", "2026-10-10"],
      ["a", "Deadline", "2026-11-01"],
    ]);
  });
});

describe("providerSearchTypes", () => {
  it("uses the AI's provider types, else a default for the category", () => {
    expect(providerSearchTypes(issue({ providerTypes: ["lot clearing"] }))).toEqual([
      "lot clearing",
    ]);
    expect(providerSearchTypes(issue({ category: "dumping" }))).toEqual(["junk removal service"]);
  });
});

describe("nextStatus", () => {
  it("walks the flow and stops at resolved", () => {
    expect(nextStatus("new")).toBe("action_required");
    expect(nextStatus("inspection_pending")).toBe("resolved");
    expect(nextStatus("resolved")).toBeNull();
  });
});
