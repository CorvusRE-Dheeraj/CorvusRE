import { describe, it, expect } from "vitest";
import { classifyZoning, analyzeFeasibility, statusLabel } from "./zoning";

describe("classifyZoning", () => {
  it("maps common residential codes", () => {
    expect(classifyZoning("SF-3").category).toBe("residential");
    expect(classifyZoning("R-1").category).toBe("residential");
    expect(classifyZoning("RMF-4").category).toBe("residential");
  });
  it("maps commercial and industrial codes", () => {
    expect(classifyZoning("C-2").category).toBe("commercial");
    expect(classifyZoning("GR").category).toBe("commercial");
    expect(classifyZoning("LI").category).toBe("industrial");
  });
  it("maps mixed use and agricultural", () => {
    expect(classifyZoning("MU-1").category).toBe("mixed_use");
    expect(classifyZoning("AG").category).toBe("agricultural");
  });
  it("falls back to unknown for empty / unrecognized", () => {
    expect(classifyZoning("").category).toBe("unknown");
    expect(classifyZoning("ZZZ-9").category).toBe("unknown");
  });
  it("scans free text when no prefix matches", () => {
    expect(classifyZoning("Planned Commercial District").category).toBe("commercial");
  });
});

describe("analyzeFeasibility", () => {
  it("allows a commercial project in a commercial zone", () => {
    const r = analyzeFeasibility({
      intent: "new_construction",
      sector: "commercial",
      zoning: classifyZoning("C-2"),
    });
    expect(r.status).toBe("allowed");
    expect(r.confidence).toBeGreaterThan(0.6);
  });

  it("flags rezoning when commercial lands in a residential zone", () => {
    const r = analyzeFeasibility({
      intent: "new_construction",
      sector: "commercial",
      zoning: classifyZoning("SF-3"),
    });
    expect(r.status).toBe("not_allowed");
    expect(r.risks.some((x) => /rezoning/i.test(x.approval))).toBe(true);
    expect(r.risks[0].addedReviewMonths).toEqual([3, 6]);
  });

  it("downgrades to conditional for a remodel even in a mismatched zone", () => {
    const r = analyzeFeasibility({
      intent: "remodeling",
      sector: "commercial",
      zoning: classifyZoning("SF-3"),
    });
    expect(r.status).toBe("conditional");
  });

  it("returns low-confidence conditional when zoning is unknown", () => {
    const r = analyzeFeasibility({
      intent: "new_construction",
      sector: "commercial",
      zoning: classifyZoning(""),
    });
    expect(r.status).toBe("conditional");
    expect(r.confidence).toBeLessThan(0.6);
  });

  it("adds a site development risk for ground-up builds", () => {
    const r = analyzeFeasibility({
      intent: "new_construction",
      sector: "commercial",
      zoning: classifyZoning("C-2"),
    });
    expect(r.risks.some((x) => /plat/i.test(x.approval))).toBe(true);
  });
});

describe("statusLabel", () => {
  it("humanizes each status", () => {
    expect(statusLabel("allowed")).toBe("Allowed");
    expect(statusLabel("conditional")).toBe("Conditional");
    expect(statusLabel("not_allowed")).toBe("Not Allowed");
  });
});
