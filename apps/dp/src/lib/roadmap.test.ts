import { describe, it, expect } from "vitest";
import { identifyPermits } from "./permits";
import { buildRoadmap, roadmapStatus } from "./roadmap";

describe("buildRoadmap", () => {
  const permits = identifyPermits({
    intent: "new_construction",
    sector: "commercial",
    lotSizeSqft: 100000,
  });
  const phases = buildRoadmap(permits);

  it("places the plat before anything that depends on it", () => {
    const platPhase = phases.findIndex((ph) => ph.permits.some((p) => p.id === "plat"));
    const sitePhase = phases.findIndex((ph) => ph.permits.some((p) => p.id === "site"));
    expect(platPhase).toBeGreaterThanOrEqual(0);
    expect(platPhase).toBeLessThan(sitePhase);
  });

  it("groups concurrent site/civil permits into one phase", () => {
    const sitePhase = phases.find((ph) => ph.permits.some((p) => p.id === "site"))!;
    expect(sitePhase.permits.length).toBeGreaterThan(1);
    expect(sitePhase.parallel).toBe(true);
  });

  it("places every permit exactly once", () => {
    const flattened = phases.flatMap((ph) => ph.permits.map((p) => p.id)).sort();
    expect(flattened).toEqual(permits.map((p) => p.id).sort());
  });
});

describe("roadmapStatus", () => {
  const permits = identifyPermits({ intent: "new_construction", lotSizeSqft: 100000 });
  const phases = buildRoadmap(permits);

  it("reports 0% with nothing approved", () => {
    const s = roadmapStatus(phases, []);
    expect(s.completedPhases).toBe(0);
    expect(s.percentComplete).toBe(0);
  });

  it("advances as leading phases are fully approved", () => {
    const firstPhaseIds = phases[0].permits.map((p) => p.id);
    const s = roadmapStatus(phases, firstPhaseIds);
    expect(s.completedPhases).toBe(1);
    expect(s.percentComplete).toBeGreaterThan(0);
  });
});
