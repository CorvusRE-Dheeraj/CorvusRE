import { describe, expect, it } from "vitest";
import { generateDesignBrief } from "./design";
import type { DesignRequestRow } from "./design-requests";
import {
  designChecklist,
  designRoadmap,
  designSchedule,
  designSiteAnalysis,
  addWeeks,
} from "./design-workspace";

function row(over: Partial<DesignRequestRow> = {}): DesignRequestRow {
  return {
    id: "d1",
    user_id: "u1",
    address: "950 E Ralph Hall Pkwy",
    city: "Rockwall",
    county: "Rockwall",
    scope: "new_construction",
    sector: "commercial",
    site_area: "2 acres",
    building_area: "6000",
    floors: "1",
    rooms: null,
    functional_requirements: null,
    special_requirements: null,
    brief: null,
    stage: "brief",
    approved_at: null,
    consultation_requested_at: null,
    consultation_phone: null,
    consultation_best_time: null,
    consultation_notes: null,
    checklist_done: [],
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...over,
  };
}

const fullBrief = generateDesignBrief({
  scope: "new_construction",
  buildingArea: "6000",
  floors: "1",
});
const fitOutBrief = generateDesignBrief({ scope: "interior_fit_out", buildingArea: "6000" });

describe("designChecklist", () => {
  it("ticks approval and consultation automatically", () => {
    const items = designChecklist(
      row({
        approved_at: "2026-10-07T00:00:00Z",
        consultation_requested_at: "2026-10-07T00:00:00Z",
      }),
      fullBrief,
    );
    expect(items.find((i) => i.key === "approve_brief")).toMatchObject({ auto: true, done: true });
    expect(items.find((i) => i.key === "consultation")).toMatchObject({ auto: true, done: true });
  });

  it("keeps the customer's own ticks", () => {
    const items = designChecklist(row({ checklist_done: ["program"] }), fullBrief);
    expect(items.find((i) => i.key === "program")?.done).toBe(true);
    expect(items.find((i) => i.key === "budget")?.done).toBe(false);
  });

  it("asks for a survey on new construction and as-builts on a fit-out", () => {
    const full = designChecklist(row(), fullBrief).map((i) => i.key);
    const fit = designChecklist(row({ scope: "interior_fit_out" }), fitOutBrief).map((i) => i.key);
    expect(full).toContain("survey");
    expect(full).toContain("plat");
    expect(fit).toContain("as_built");
    expect(fit).not.toContain("plat");
  });

  it("marks a stage's items done once staff move past it", () => {
    const items = designChecklist(row({ stage: "final_drawings" }), fullBrief);
    expect(items.filter((i) => i.group === "Concept design").every((i) => i.done)).toBe(true);
    expect(items.filter((i) => i.group === "Design development").every((i) => i.done)).toBe(true);
    expect(items.filter((i) => i.group === "Permit set").some((i) => i.done)).toBe(false);
  });
});

describe("designRoadmap", () => {
  it("includes survey only for whole-building scopes", () => {
    expect(designRoadmap(row(), fullBrief).map((s) => s.key)).toContain("survey");
    expect(
      designRoadmap(row({ scope: "interior_fit_out" }), fitOutBrief).map((s) => s.key),
    ).not.toContain("survey");
  });

  it("follows the request's stage", () => {
    const steps = designRoadmap(row({ stage: "development" }), fullBrief);
    const status = Object.fromEntries(steps.map((s) => [s.key, s.status]));
    expect(status).toMatchObject({
      brief: "done",
      concept: "done",
      code: "current",
      development: "current",
      permit_set: "upcoming",
    });
  });
});

describe("designSchedule", () => {
  it("chains phases end to end and matches the brief's totals", () => {
    const s = designSchedule(fullBrief);
    expect(s[0].startMin).toBe(0);
    expect(s[1].startMin).toBe(s[0].endMin);
    expect(s[1].startMax).toBe(s[0].endMax);
    expect(s[s.length - 1].endMin).toBe(fullBrief.totalWeeksMin);
    expect(s[s.length - 1].endMax).toBe(fullBrief.totalWeeksMax);
  });

  it("adds weeks to a date", () => {
    expect(addWeeks("2026-10-07T12:00:00Z", 2).toISOString().slice(0, 10)).toBe("2026-10-21");
  });
});

describe("designSiteAnalysis", () => {
  it("returns jurisdiction, utilities and constraints for the design's location", () => {
    const s = designSiteAnalysis(row());
    expect(s.jurisdiction.authority).toBeTruthy();
    expect(s.constraints.utilities.length).toBeGreaterThan(0);
    expect(s.constraints.constraints.length).toBeGreaterThan(0);
  });
});
