import { describe, it, expect } from "vitest";
import { runPermittingAnalysis } from "./analysis";
import type { DpIntakeState } from "./dp-intake";

function intake(over: Partial<DpIntakeState> = {}): DpIntakeState {
  return {
    sessionId: "test",
    track: "permitting",
    step: 4,
    property: {
      address: "123 Lone Star Trail",
      city: "Celina",
      county: "Collin",
      state: "TX",
      zoning: "C-2",
    },
    project: {
      intent: "new_construction",
      sector: "commercial",
      lotSize: "2 acres",
      buildingArea: "25000",
      floors: "2",
    },
    design: {},
    ...over,
  };
}

describe("runPermittingAnalysis", () => {
  it("produces a full, internally-consistent analysis for a ground-up commercial build", () => {
    const a = runPermittingAnalysis(intake());
    expect(a.jurisdiction.matched).toBe(true);
    expect(a.jurisdiction.authority).toMatch(/Celina/);
    expect(a.zoning.category).toBe("commercial");
    expect(a.feasibility.status).toBe("allowed");
    expect(a.permits.length).toBeGreaterThan(3);
    expect(a.agencies).toHaveLength(a.permits.length);
    expect(a.roadmap.flatMap((p) => p.permits)).toHaveLength(a.permits.length);
    expect(a.fees.totalHigh).toBeGreaterThan(a.fees.totalLow);
    expect(a.timeline.totalWeeksMax).toBeGreaterThan(a.timeline.totalWeeksMin);
    expect(a.preApp.length).toBeGreaterThan(4);
    expect(a.preAppMeeting.agenda.length).toBeGreaterThan(3);
    expect(a.preAppMeeting.bring.length).toBeGreaterThan(3);
    expect(a.responsibilityMatrix.some((r) => /Architect/.test(r.consultant))).toBe(true);
    expect(a.constraints.utilities.length).toBeGreaterThanOrEqual(4);
  });

  it("flags rezoning for a commercial use on residential-zoned land", () => {
    const a = runPermittingAnalysis(
      intake({ property: { city: "Celina", county: "Collin", state: "TX", zoning: "SF-3" } }),
    );
    expect(a.feasibility.status).toBe("not_allowed");
  });

  it("falls back to an estimated jurisdiction for an unknown city", () => {
    const a = runPermittingAnalysis(
      intake({ property: { city: "Nowheresville", county: "Nolan", state: "TX", zoning: "C-1" } }),
    );
    expect(a.jurisdiction.matched).toBe(false);
    expect(a.jurisdiction.departments.length).toBeGreaterThan(0);
  });

  it("keeps a remodel simple", () => {
    const a = runPermittingAnalysis(
      intake({ project: { intent: "remodeling", sector: "commercial", buildingArea: "4000" } }),
    );
    expect(a.complexity.level).toBe("Easy");
    expect(a.fees.impactFeesLow).toBe(0);
  });
});
