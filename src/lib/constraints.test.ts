import { describe, it, expect } from "vitest";
import { analyzeJurisdiction } from "./jurisdiction";
import { classifyZoning } from "./zoning";
import { deriveSiteConstraints, availabilityLabel } from "./constraints";

const jur = analyzeJurisdiction({ city: "Celina", county: "Collin", state: "TX" });
const etjJur = analyzeJurisdiction({ city: "Celina", county: "Collin", state: "TX", isEtj: true });

describe("deriveSiteConstraints", () => {
  it("lists water/sewer/electric/storm/gas utilities", () => {
    const c = deriveSiteConstraints({ jurisdiction: jur, zoning: classifyZoning("C-2") });
    const names = c.utilities.map((u) => u.name);
    expect(names).toEqual(
      expect.arrayContaining(["Water", "Wastewater / Sewer", "Electric", "Storm drainage"]),
    );
  });

  it("lists gas and telecom/data as separate due-diligence lines (PRD 2.2.11/2.2.12)", () => {
    const c = deriveSiteConstraints({ jurisdiction: jur, zoning: classifyZoning("C-2") });
    const names = c.utilities.map((u) => u.name);
    expect(names).toContain("Gas");
    expect(names).toContain("Telecom / Data");
  });

  it("flags wastewater as likely constrained and raises a critical warning in an ETJ", () => {
    const c = deriveSiteConstraints({
      jurisdiction: etjJur,
      zoning: classifyZoning("C-2"),
      isEtj: true,
    });
    const sewer = c.utilities.find((u) => u.name.startsWith("Wastewater"))!;
    expect(sewer.status).toBe("likely_constrained");
    expect(c.criticalWarnings.some((w) => /ETJ/.test(w))).toBe(true);
    expect(c.criticalWarnings.some((w) => /wastewater/i.test(w))).toBe(true);
  });

  it("adds platting + environmental constraints for a large ground-up tract", () => {
    const c = deriveSiteConstraints({
      jurisdiction: jur,
      zoning: classifyZoning("C-2"),
      intent: "new_construction",
      lotSize: "5 acres",
    });
    const titles = c.constraints.map((x) => x.title);
    expect(titles).toContain("Platting & dedications");
    expect(titles.some((t) => /environmental|floodplain/i.test(t))).toBe(true);
  });

  it("always carries a disclaimer", () => {
    const c = deriveSiteConstraints({ jurisdiction: jur, zoning: classifyZoning("") });
    expect(c.disclaimer.length).toBeGreaterThan(20);
  });
});

describe("availabilityLabel", () => {
  it("humanizes the enum", () => {
    expect(availabilityLabel("likely_available")).toBe("Likely available");
    expect(availabilityLabel("verify")).toBe("Verify");
    expect(availabilityLabel("likely_constrained")).toBe("Likely constrained");
  });
});
