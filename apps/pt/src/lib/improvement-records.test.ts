import { describe, expect, it } from "vitest";
import { GENERAL_SECTIONS, sectionsFor } from "./improvement-fields";
import {
  cardConditions,
  recordsForModule,
  summarize,
  type Building,
  type ImprovementItem,
} from "./improvement-records";

const item = (over: Partial<ImprovementItem>): ImprovementItem => ({
  id: Math.random().toString(36).slice(2),
  buildingId: "b1",
  mediaId: null,
  section: "roof_exterior",
  component: "Roof",
  condition: "Not Assessed",
  issue: null,
  observation: null,
  repairEstimate: null,
  estimateSource: null,
  fixedOrMovable: null,
  page: null,
  videoTime: null,
  needsProfessional: false,
  uncertain: null,
  source: "owner",
  status: "confirmed",
  createdAt: "2026-10-31T00:00:00Z",
  ...over,
});
const building = (over: Partial<Building> = {}): Building => ({
  id: "b1",
  name: "Main building",
  types: ["Daycare / Preschool"],
  customFeatures: [],
  details: {},
  sort: 0,
  ...over,
});

describe("sections adapt to the improvement type", () => {
  it("adds the type's own features after the general sections", () => {
    const s = sectionsFor(["Daycare / Preschool"]);
    expect(s.slice(0, GENERAL_SECTIONS.length)).toEqual(GENERAL_SECTIONS);
    expect(s.at(-1)?.components).toContain("Playground equipment & surfacing");
  });
  it("merges mixed-use types without duplicates and adds custom features", () => {
    const f = sectionsFor(["Office", "Multifamily / Hotel / Senior Living"], ["Rooftop deck"]).at(
      -1,
    )!;
    expect(f.components.filter((c) => c === "Elevators")).toHaveLength(1);
    expect(f.components).toContain("Rooftop deck");
  });
  it("shows only the general sections when no type is chosen", () => {
    expect(sectionsFor([])).toEqual(GENERAL_SECTIONS);
  });
});

describe("summary", () => {
  it("is Not Assessed until the owner sets an overall condition — never inferred", () => {
    const s = summarize(
      building(),
      [
        item({ condition: "Poor" }),
        item({ component: "HVAC", section: "systems", condition: "Good" }),
      ],
      [],
    );
    expect(s.overall).toBe("Not Assessed");
    expect(s.overallBasis).toMatch(/1 Good, 1 Poor|1 Poor, 1 Good|1 Good|1 Poor/);
    expect(summarize(building({ details: { overallCondition: "Fair" } }), [], []).overall).toBe(
      "Fair",
    );
  });
  it("lists issues, documented estimates with sources, and what's missing", () => {
    const s = summarize(
      building(),
      [
        item({
          issue: "Active leak over suite B",
          repairEstimate: 18000,
          estimateSource: "ABC Roofing bid",
        }),
        item({ section: "systems", component: "HVAC", condition: "Poor" }),
        item({
          section: "interior",
          component: "Flooring",
          status: "suggested",
          condition: "Poor",
        }),
      ],
      [],
    );
    expect(s.issues.map((i) => i.component)).toEqual(["Roof", "HVAC"]);
    expect(s.estimateTotal).toBe(18000);
    expect(s.estimates[0].item.estimateSource).toBe("ABC Roofing bid");
    // a suggestion doesn't count until confirmed — interior is still missing
    expect(s.missing.map((m) => m.section)).toContain("interior");
    expect(s.missing.map((m) => m.section)).not.toContain("systems");
    expect(s.missingDetails).toContain("Year built");
  });
  it("missing photos alone never make the condition poor", () => {
    const s = summarize(building(), [], []);
    expect(s.overall).toBe("Not Assessed");
    expect(s.hasAnyEvidence).toBe(false);
  });
});

describe("feeding the module", () => {
  it("rolls confirmed components up to the four AI cards, worst first", () => {
    const c = cardConditions([
      item({ section: "roof_exterior", component: "Exterior walls", condition: "Good" }),
      item({ section: "structure", component: "Foundation", condition: "Poor" }),
      item({ section: "systems", component: "HVAC", condition: "Fair" }),
      item({ section: "interior", component: "Ceilings", condition: "Poor", status: "rejected" }),
    ]);
    expect(c).toEqual({ Exterior: "Poor", HVAC: "Fair" });
  });
  it("sends only confirmed records, named by building", () => {
    const r = recordsForModule({
      buildings: [building()],
      items: [
        item({ condition: "Fair", issue: "Worn membrane" }),
        item({ status: "suggested", condition: "Poor" }),
      ],
      media: [],
    });
    expect(r?.items).toEqual([
      {
        building: "Main building",
        component: "Roof",
        condition: "Fair",
        issue: "Worn membrane",
        estimate: null,
        source: "owner",
      },
    ]);
  });
});

describe("building facts from a report", () => {
  it("stores numbers as numbers", async () => {
    const { detailValue } = await import("./improvement-fields");
    expect(detailValue("buildingAreaSqft", "6,200 square feet")).toBe(6200);
    expect(detailValue("floors", "single story")).toBe(1);
    expect(detailValue("yearBuilt", "1998")).toBe(1998);
    expect(detailValue("constructionType", " masonry and steel frame ")).toBe(
      "masonry and steel frame",
    );
  });
});
