import { describe, it, expect } from "vitest";
import { pickHeadlineFactor, countDataGaps, type SiteFactor } from "./site-condition";

function factor(overrides: Partial<SiteFactor> = {}): SiteFactor {
  return {
    factor: "Floodplain",
    status: "Additional Data Needed",
    finding: "Additional data needed to assess.",
    severity: "Unknown",
    confidence: "Low",
    potentialImpact: "",
    evidenceNeeded: null,
    ...overrides,
  };
}

describe("pickHeadlineFactor", () => {
  it("returns null when every factor is Additional Data Needed", () => {
    const factors = [factor(), factor({ factor: "Easements" })];
    expect(pickHeadlineFactor(factors)).toBeNull();
  });

  it("never picks an Additional Data Needed factor even if others are gaps", () => {
    const factors = [
      factor({ factor: "Floodplain", status: "Confirmed", severity: "High" }),
      factor({ factor: "Easements", status: "Additional Data Needed", severity: "High" }),
    ];
    const picked = pickHeadlineFactor(factors);
    expect(picked?.factor).toBe("Floodplain");
  });

  it("picks the highest-severity factor among those with real/partial data", () => {
    const factors = [
      factor({ factor: "Grade", status: "Partial Data", severity: "Low" }),
      factor({ factor: "Floodplain", status: "Confirmed", severity: "High" }),
    ];
    const picked = pickHeadlineFactor(factors);
    expect(picked?.factor).toBe("Floodplain");
  });

  it("treats Confirmed and Partial Data as equally eligible, ranked by severity", () => {
    const factors = [
      factor({ factor: "Floodplain", status: "Confirmed", severity: "Moderate" }),
      factor({ factor: "Grade", status: "Partial Data", severity: "High" }),
    ];
    const picked = pickHeadlineFactor(factors);
    expect(picked?.factor).toBe("Grade");
  });

  it("never picks a Not Applicable factor even if it's the only non-gap", () => {
    const factors = [
      factor({ factor: "Easements", status: "Not Applicable", severity: "High" }),
      factor({ factor: "Drainage", status: "Additional Data Needed" }),
    ];
    expect(pickHeadlineFactor(factors)).toBeNull();
  });
});

describe("countDataGaps", () => {
  it("counts only Additional Data Needed rows", () => {
    const factors = [
      factor({ factor: "Floodplain", status: "Confirmed" }),
      factor({ factor: "Grade", status: "Partial Data" }),
      factor({ factor: "Easements", status: "Additional Data Needed" }),
      factor({ factor: "Drainage", status: "Additional Data Needed" }),
    ];
    expect(countDataGaps(factors)).toBe(2);
  });

  it("returns 0 when nothing is missing", () => {
    const factors = [factor({ status: "Confirmed" })];
    expect(countDataGaps(factors)).toBe(0);
  });

  it("returns the full length when every factor is a gap", () => {
    const factors = [factor(), factor({ factor: "Easements" }), factor({ factor: "Drainage" })];
    expect(countDataGaps(factors)).toBe(3);
  });

  it("excludes Not Applicable factors from the gap count", () => {
    const factors = [
      factor({ factor: "Easements", status: "Not Applicable" }),
      factor({ factor: "Drainage", status: "Additional Data Needed" }),
    ];
    expect(countDataGaps(factors)).toBe(1);
  });
});
