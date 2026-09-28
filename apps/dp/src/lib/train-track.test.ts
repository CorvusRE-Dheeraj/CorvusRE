import { describe, it, expect } from "vitest";
import { STATIONS, ROUTES, locateTrain, parallelTrackStop } from "./train-track";

const permit = (name: string, status: string, extra: { expiry_date?: string; review_round?: number } = {}) => ({
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
    const loc = locateTrain({ ...base, permits: [permit("Building Permit", "resubmitted", { review_round: 2 })] });
    expect(loc.station).toBe(19);
    expect(loc.reason).toContain("round 2");
  });

  it("parks at clearance when everything is approved and nothing expires soon", () => {
    const loc = locateTrain({
      ...base,
      permits: [permit("Building Permit", "approved", { expiry_date: "2027-09-01" })],
    });
    expect(loc.station).toBe(27);
  });

  it("watches expiry when an approved permit expires within 90 days", () => {
    const loc = locateTrain({
      ...base,
      permits: [permit("Building Permit", "approved", { expiry_date: "2026-10-28" })],
    });
    expect(loc.station).toBe(28);
    expect(loc.reason).toContain("30 days");
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
