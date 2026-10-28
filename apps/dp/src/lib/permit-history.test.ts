import { describe, expect, it } from "vitest";
import {
  cityClock,
  elapsedDays,
  engineerWindow,
  historyCsv,
  historyTotals,
  laneStepState,
  permitRounds,
  permitStage,
  roundStage,
  type Round,
  type RoundComment,
  type SubmissionRow,
} from "./permit-history";

const NOW = new Date("2026-10-23T15:00:00Z");
const permit = { id: "pb", project_id: "p1", permit_key: "building" };

const sub = (round: number, extra: Partial<SubmissionRow> = {}): SubmissionRow => ({
  id: `s${round}`,
  project_id: "p1",
  permit_id: "pb",
  round,
  submitted_at: null,
  review_started_at: null,
  expected_at: null,
  expected_basis: null,
  city_returned_at: null,
  outcome: "under_review",
  method: null,
  confirmation: null,
  package_version: null,
  submitted_by: null,
  qa_passed_at: null,
  notes: null,
  ...extra,
});
const comment = (id: string, extra: Partial<RoundComment> = {}): RoundComment => ({
  id,
  project_id: "p1",
  permit_key: "building",
  original: id,
  plain_language: null,
  responsible: null,
  status: "open",
  priority: "medium",
  round: 1,
  discipline: null,
  assigned_at: null,
  due_at: null,
  responded_at: null,
  verified_at: null,
  ...extra,
});
const round = (s: SubmissionRow, comments: RoundComment[] = []): Round => ({ ...s, comments });

describe("clocks", () => {
  // Round Rock building permit, round 1, from the v4 reference
  const r1 = round(
    sub(1, {
      submitted_at: "2026-08-17T14:00:00Z",
      city_returned_at: "2026-09-04T16:00:00Z",
      outcome: "comments",
      qa_passed_at: "2026-09-11T15:00:00Z",
    }),
    [
      comment("B-1.01", {
        assigned_at: "2026-09-04T19:00:00Z",
        responded_at: "2026-09-09T20:00:00Z",
      }),
      comment("B-1.02", {
        assigned_at: "2026-09-04T19:00:00Z",
        responded_at: "2026-09-10T20:00:00Z",
      }),
    ],
  );

  it("city time runs from filing to the city's response", () => {
    expect(cityClock(r1, NOW).value).toBeCloseTo(18.08, 2);
    expect(cityClock(r1, NOW).state).toBe("Completed");
  });

  it("engineer time is one window: first assignment to last response (not summed)", () => {
    const e = engineerWindow(r1, NOW);
    expect(e.value).toBeCloseTo(6.04, 2);
    expect(e.state).toBe("Completed");
  });

  it("open intervals run to now and say so", () => {
    const open = round(sub(3, { submitted_at: "2026-10-07T14:00:00Z" }));
    expect(cityClock(open, NOW).state).toBe("Ongoing");
    expect(cityClock(open, NOW).value).toBeCloseTo(16.04, 2);
    expect(engineerWindow(open, NOW).state).toBe("Not started");
    const partly = round(
      sub(1, { submitted_at: "2026-09-15T15:00:00Z", city_returned_at: "2026-10-09T16:00:00Z" }),
      [
        comment("a", { assigned_at: "2026-10-10T19:00:00Z" }),
        comment("b", { assigned_at: "2026-10-10T19:00:00Z", responded_at: "2026-10-16T20:00:00Z" }),
      ],
    );
    expect(engineerWindow(partly, NOW).state).toBe("Ongoing");
    expect(engineerWindow(partly, NOW).end).toBeNull();
  });

  it("unassigned comments don't start the engineer clock; no comments → not required", () => {
    const r = round(sub(1, { city_returned_at: "2026-10-01T00:00:00Z" }), [comment("x")]);
    expect(engineerWindow(r, NOW).state).toBe("Not assigned");
    expect(
      engineerWindow(
        round(sub(1, { city_returned_at: "2026-10-01T00:00:00Z", outcome: "approved" })),
        NOW,
      ).state,
    ).toBe("Not required");
  });

  it("missing or reversed dates give no number", () => {
    expect(elapsedDays(null, null, NOW)).toBeNull();
    expect(elapsedDays("2026-10-10T00:00:00Z", "2026-10-01T00:00:00Z", NOW)).toBeNull();
  });
});

describe("stages", () => {
  const returned = {
    submitted_at: "2026-09-01T00:00:00Z",
    city_returned_at: "2026-09-20T00:00:00Z",
    outcome: "comments" as const,
  };
  it("walks the review loop 19 → 24 and exits at 27 on approval", () => {
    expect(roundStage(round(sub(1, { submitted_at: "2026-09-01T00:00:00Z" })))).toBe(19);
    expect(roundStage(round(sub(1, returned)))).toBe(20);
    expect(roundStage(round(sub(1, returned), [comment("a")]))).toBe(21);
    expect(roundStage(round(sub(1, returned), [comment("a", { assigned_at: "x" })]))).toBe(22);
    expect(
      roundStage(round(sub(1, returned), [comment("a", { assigned_at: "x", responded_at: "y" })])),
    ).toBe(23);
    expect(
      roundStage(
        round(sub(1, { ...returned, qa_passed_at: "z" }), [
          comment("a", { assigned_at: "x", responded_at: "y" }),
        ]),
      ),
    ).toBe(24);
    expect(roundStage(round(sub(2, { ...returned, outcome: "approved" })))).toBe(27);
  });

  it("before the first filing the stage comes from preparation", () => {
    expect(permitStage({ status: "identified" }, [])).toBe(9);
    expect(permitStage({ status: "preparing" }, [])).toBe(16);
  });

  it("lane steps", () => {
    const rounds = [round(sub(1, returned), [comment("a")])];
    expect(laneStepState(21, rounds, "submitted")).toBe("done");
    expect(laneStepState(21, rounds, "review")).toBe("done");
    expect(laneStepState(21, rounds, "comments")).toBe("current");
    expect(laneStepState(21, rounds, "approved")).toBe("");
    expect(laneStepState(9, [], "submitted")).toBe("");
  });
});

describe("permitRounds", () => {
  it("gives each round only its own permit's comments; unnumbered ones go to the latest round", () => {
    const rounds = permitRounds(
      permit,
      [sub(2), sub(1), { ...sub(1), id: "other", permit_id: "px" }],
      [
        comment("r1", { round: 1 }),
        comment("legacy", { round: null }),
        comment("other-project", { project_id: "p2", round: 1 }),
        comment("other-permit", { permit_key: "site", round: 1 }),
      ],
    );
    expect(rounds.map((r) => r.round)).toEqual([1, 2]);
    expect(rounds[0].comments.map((c) => c.id)).toEqual(["r1"]);
    expect(rounds[1].comments.map((c) => c.id)).toEqual(["legacy"]);
  });
});

describe("history", () => {
  const rounds = [
    round(
      sub(1, {
        submitted_at: "2026-09-01T00:00:00Z",
        city_returned_at: "2026-09-11T00:00:00Z",
        outcome: "comments",
      }),
      [comment("a", { assigned_at: "2026-09-11T00:00:00Z", responded_at: "2026-09-14T00:00:00Z" })],
    ),
    round(sub(2, { submitted_at: "2026-10-20T15:00:00Z" })),
  ];
  it("totals completed time only, counting open clocks", () => {
    expect(historyTotals(rounds, NOW)).toEqual({
      rounds: 2,
      cityDone: 10,
      engineerDone: 3,
      open: 1,
    });
  });
  it("exports one CSV row per round, quoted", () => {
    const csv = historyCsv([{ project: 'Main "St"', permit: "Building", rounds }], NOW).split(
      "\r\n",
    );
    expect(csv).toHaveLength(3);
    expect(csv[1]).toContain('"Main ""St"""');
    expect(csv[1]).toContain('"10.0"');
    expect(csv[1]).toContain('"2026-10-20T15:00:00Z"'); // next submission
    expect(csv[2]).toContain('"Ongoing"');
  });
});
