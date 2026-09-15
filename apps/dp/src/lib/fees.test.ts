import { describe, it, expect } from "vitest";
import { identifyPermits } from "./permits";
import { analyzeJurisdiction } from "./jurisdiction";
import { estimateFees, estimateConstructionValue } from "./fees";

const jur = analyzeJurisdiction({ city: "Celina", county: "Collin", state: "TX" });

describe("estimateConstructionValue", () => {
  it("scales with area and sector", () => {
    const comm = estimateConstructionValue(10000, "commercial");
    const res = estimateConstructionValue(10000, "residential");
    expect(comm.low).toBeGreaterThan(res.low);
    expect(comm.high).toBeGreaterThan(comm.low);
  });
  it("falls back to a default area when null", () => {
    expect(estimateConstructionValue(null).low).toBeGreaterThan(0);
  });
});

describe("estimateFees", () => {
  const permits = identifyPermits({
    intent: "new_construction",
    sector: "commercial",
    lotSizeSqft: 90000,
  });
  const est = estimateFees({
    permits,
    jurisdiction: jur,
    buildingAreaSqft: 20000,
    sector: "commercial",
  });

  it("produces one line per permit and a coherent total", () => {
    expect(est.lines).toHaveLength(permits.length);
    expect(est.totalHigh).toBeGreaterThan(est.totalLow);
    expect(est.subtotalHigh).toBeGreaterThan(est.subtotalLow);
  });

  it("adds impact fees when the project creates new demand", () => {
    expect(est.impactFeesHigh).toBeGreaterThan(0);
  });

  it("omits impact fees for a pure interior remodel", () => {
    const remodel = estimateFees({
      permits: identifyPermits({ intent: "remodeling" }),
      jurisdiction: jur,
      buildingAreaSqft: 4000,
    });
    expect(remodel.impactFeesLow).toBe(0);
  });

  it("scales the building permit fee with valuation", () => {
    const small = estimateFees({ permits, jurisdiction: jur, buildingAreaSqft: 5000 });
    const big = estimateFees({ permits, jurisdiction: jur, buildingAreaSqft: 80000 });
    const smallB = small.lines.find((l) => l.permitId === "building")!;
    const bigB = big.lines.find((l) => l.permitId === "building")!;
    expect(bigB.high).toBeGreaterThan(smallB.high);
  });

  it("always states its assumptions", () => {
    expect(est.assumptions.length).toBeGreaterThan(2);
  });
});
