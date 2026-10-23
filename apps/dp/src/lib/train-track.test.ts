import { describe, it, expect } from "vitest";
import {
  STATIONS,
  ROUTES,
  locateTrain,
  parallelTrackStop,
  wagonCargo,
  lineProgress,
} from "./train-track";

const permit = (
  name: string,
  status: string,
  extra: { expiry_date?: string; review_round?: number } = {},
) => ({
  name,
  status,
  expiry_date: extra.expiry_date ?? null,
  review_round: extra.review_round ?? 1,
});

const item = (kind: string, done: boolean, required = true) => ({ kind, done, required });

const base = { hasAnalysis: true, checklist: [], comments: [], today: new Date(2026, 8, 28) };

describe("track data", () => {
  it("numbers stations 1..29 with no gaps", () => {
    expect(STATIONS.map((s) => s.n)).toEqual(Array.from({ length: 29 }, (_, i) => i + 1));
  });

  it("puts every station on exactly one route", () => {
    const onRoutes = ROUTES.flatMap((r) => r.stations).sort((a, b) => a - b);
    expect(onRoutes).toEqual(STATIONS.map((s) => s.n));
  });

  it("explains every station that isn't fully live", () => {
    for (const s of STATIONS.filter((x) => x.availability !== "live")) {
      expect(s.availabilityNote, `station ${s.n}`).toBeTruthy();
    }
  });
});

describe("locateTrain", () => {
  it("starts at intake when nothing is saved", () => {
    expect(locateTrain({ ...base, hasAnalysis: false, permits: [] }).station).toBe(1);
  });

  it("waits at pre-application until required pre-app items are done", () => {
    const loc = locateTrain({
      ...base,
      permits: [permit("Building Permit", "identified")],
      checklist: [item("pre_app", true), item("pre_app", false), item("pre_app", false, false)],
    });
    expect(loc.station).toBe(12);
    expect(loc.reason).toContain("1 of 2");
  });

  it("moves to the application package once pre-app is done", () => {
    const loc = locateTrain({
      ...base,
      permits: [permit("Building Permit", "preparing")],
      checklist: [item("pre_app", true), item("submission", false)],
    });
    expect(loc.station).toBe(16);
  });

  it("is submission-ready when the package is complete but nothing is filed", () => {
    const loc = locateTrain({
      ...base,
      permits: [permit("Building Permit", "preparing")],
      checklist: [item("pre_app", true), item("submission", true)],
    });
    expect(loc.station).toBe(17);
  });

  it("follows the least advanced permit when several are in flight", () => {
    const loc = locateTrain({
      ...base,
      permits: [permit("Building Permit", "approved"), permit("Grading Permit", "under_review")],
    });
    expect(loc.station).toBe(19);
    expect(loc.reason).toContain("Grading Permit");
  });

  it("walks the comment loop from the real review comments", () => {
    const permits = [permit("Site Development Permit", "comments")];
    expect(locateTrain({ ...base, permits, comments: [] }).station).toBe(20);
    expect(
      locateTrain({ ...base, permits, comments: [{ status: "open", responsible: "" }] }).station,
    ).toBe(21);
    expect(
      locateTrain({ ...base, permits, comments: [{ status: "in_progress", responsible: "Civil" }] })
        .station,
    ).toBe(22);
    expect(
      locateTrain({ ...base, permits, comments: [{ status: "addressed", responsible: "Civil" }] })
        .station,
    ).toBe(24);
  });

  it("goes back under review after a resubmission", () => {
    const loc = locateTrain({
      ...base,
      permits: [permit("Building Permit", "resubmitted", { review_round: 2 })],
    });
    expect(loc.station).toBe(19);
    expect(loc.reason).toContain("round 2");
  });

  it("waits at requirements until the first pre-app item is ticked", () => {
    const loc = locateTrain({
      ...base,
      permits: [permit("Building Permit", "identified")],
      checklist: [item("pre_app", false), item("pre_app", false, false)],
    });
    expect(loc.station).toBe(9);
    expect(loc.reason).toContain("pre-application");
  });

  it("reaches the end of the line when every permit is approved", () => {
    const loc = locateTrain({
      ...base,
      permits: [permit("Building Permit", "approved", { expiry_date: "2027-09-01" })],
    });
    expect(loc.station).toBe(29);
    expect(loc.reason).toContain("complete");
  });

  it("still calls out an expiry inside 90 days at the end of the line", () => {
    const loc = locateTrain({
      ...base,
      permits: [permit("Building Permit", "approved", { expiry_date: "2026-10-28" })],
    });
    expect(loc.station).toBe(29);
    expect(loc.reason).toContain("30 days");
  });
});

describe("linear six-stage progression", () => {
  const analysis = {
    jurisdiction: { authority: "City of Denton" },
    zoning: { code: "C-2", label: "Commercial" },
    permits: [{}],
    fees: { totalLow: 1000, totalHigh: 2000 },
    constraints: { utilities: [], criticalWarnings: [] },
  };
  const STAGES = ["Intake", "Requirements", "Pre-App", "Submission", "Review", "Approval"];
  const stage = (routeName: string) => routeName.split(/ [+/] /)[0];

  // One real-data state per step; step i should have the first i stages as
  // wagons and the train on stage i (the last step: all six, at the end).
  const steps: Parameters<typeof locateTrain>[0][] = [
    { ...base, hasAnalysis: false, permits: [] },
    { ...base, permits: [permit("P", "identified")], checklist: [item("pre_app", false)] },
    {
      ...base,
      permits: [permit("P", "preparing")],
      checklist: [item("pre_app", true), item("submission", false)],
    },
    { ...base, permits: [permit("P", "submitted")] },
    { ...base, permits: [permit("P", "under_review")] },
    { ...base, permits: [permit("P", "approved")] },
  ];

  it("grows one wagon per completed stage, in order, with the train on the next stage", () => {
    steps.forEach((input, i) => {
      const { station } = locateTrain(input);
      const wagons = wagonCargo({ ...input, trainAt: station, analysis }).map((w) =>
        stage(w.route),
      );
      const at = stage(ROUTES.find((r) => r.stations.includes(station))!.name);
      const done = i === steps.length - 1 ? STAGES.length : i;
      expect(wagons).toEqual(STAGES.slice(0, done));
      expect(at).toBe(STAGES[Math.min(i, STAGES.length - 1)]);
    });
  });
});

describe("parallelTrackStop", () => {
  it("maps permit statuses onto the 4-stop parallel track", () => {
    expect(parallelTrackStop("preparing")).toBe(-1);
    expect(parallelTrackStop("submitted")).toBe(0);
    expect(parallelTrackStop("resubmitted")).toBe(1);
    expect(parallelTrackStop("comments")).toBe(2);
    expect(parallelTrackStop("approved")).toBe(3);
  });
});

describe("wagonCargo", () => {
  const analysis = {
    jurisdiction: { authority: "City of Denton" },
    zoning: { code: "C-2", label: "Commercial" },
    permits: [{}, {}],
    fees: { totalLow: 12500, totalHigh: 1_250_000 },
    constraints: { utilities: [{}, {}, {}], criticalWarnings: ["Floodplain"] },
  };
  const permits = [{ status: "submitted" }, { status: "preparing" }];
  const checklist = [item("pre_app", true), item("pre_app", false), item("submission", false)];

  it("has no wagons before an analysis exists", () => {
    expect(
      wagonCargo({ trainAt: 1, analysis: null, permits: [], checklist: [], comments: [] }),
    ).toEqual([]);
  });

  it("adds one wagon per completed route only, never the current one", () => {
    const colors = (trainAt: number) =>
      wagonCargo({ trainAt, analysis, permits, checklist, comments: [] }).map((w) => w.color);
    expect(colors(1)).toEqual([]);
    expect(colors(4)).toEqual([]);
    expect(colors(7)).toEqual(["blue"]);
    expect(colors(12)).toEqual(["blue", "purple"]);
    expect(colors(18)).toEqual(["blue", "purple", "orange"]);
    expect(colors(19)).toEqual(["blue", "purple", "orange", "teal"]);
    expect(colors(27)).toEqual(["blue", "purple", "orange", "teal", "green"]);
    expect(colors(29)).toEqual(["blue", "purple", "orange", "teal", "green", "gray"]);
    expect(
      wagonCargo({ trainAt: 19, analysis, permits, checklist, comments: [] }).map((w) => w.loading),
    ).toEqual([false, false, false, false]);
  });

  it("fills crates with the project's real data", () => {
    const [intake, reqs, preApp] = wagonCargo({
      trainAt: 18,
      analysis,
      permits,
      checklist,
      comments: [],
    });
    expect(intake.crates).toEqual(["City of Denton", "Zoning C-2", "2 permits found"]);
    expect(reqs.crates).toEqual(["1 checklist item", "3 utilities checked", "1 site warning"]);
    expect(preApp.crates).toEqual(["Pre-app 1/2", "Fees $13k–$1.3M", "Package 0/1"]);
  });

  it("counts filed permits once the train has passed submission", () => {
    const wagons = wagonCargo({ trainAt: 19, analysis, permits, checklist, comments: [] });
    expect(wagons.at(-1)!.crates).toEqual(["1 of 2 permits filed"]);
  });
});

describe("lineProgress", () => {
  it("runs 0 at the first station to 100 at the last", () => {
    expect(lineProgress(1)).toBe(0);
    expect(lineProgress(29)).toBe(100);
    expect(lineProgress(15)).toBe(50);
  });
});
