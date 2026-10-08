import { describe, expect, it } from "vitest";
import {
  describeChange,
  detectAssessmentChange,
  protestDeadlineEstimate,
} from "../../../../supabase/pt/functions/_shared/assessment-monitor";

const stored = {
  taxYear: 2026,
  totalValue: 2_000_000,
  landValue: 500_000,
  improvementValue: 1_500_000,
};
const v = (taxYear: number | null, totalValue: number | null) => ({
  taxYear,
  totalValue,
  landValue: null,
  improvementValue: null,
});

describe("detectAssessmentChange", () => {
  it("flags a new tax year's notice value against last year", () => {
    const c = detectAssessmentChange(stored, v(2027, 2_500_000))!;
    expect(c).toMatchObject({
      kind: "new_year",
      taxYear: 2027,
      priorYear: 2026,
      priorValue: 2_000_000,
      change: 500_000,
      changePct: 25,
      level: "significant",
    });
    expect(describeChange(c)).toBe(
      "The 2027 appraised value is $2,500,000 — up 25% ($500,000) from $2,000,000 in 2026.",
    );
  });

  it("ignores a year rolled forward at last year's value — a placeholder, not a notice", () => {
    expect(detectAssessmentChange(stored, v(2027, 2_000_000))).toBeNull();
  });

  it("reads the prior year from the county history when the record is older", () => {
    const c = detectAssessmentChange(
      { ...stored, taxYear: 2025 },
      { ...v(2027, 1_800_000), valueHistory: [{ year: 2026, total: 2_000_000 }] },
    )!;
    expect(c.priorValue).toBe(2_000_000);
    expect(c.changePct).toBe(-10);
    expect(c.level).toBeNull();
    expect(describeChange(c)).toContain("down 10%");
  });

  it("flags a meaningful same-year revision, not rounding", () => {
    expect(detectAssessmentChange(stored, v(2026, 2_000_500))).toBeNull();
    expect(detectAssessmentChange(stored, v(2026, 2_005_000))).toBeNull(); // 0.25%
    const c = detectAssessmentChange(stored, v(2026, 1_900_000))!;
    expect(c.kind).toBe("revised");
    expect(describeChange(c)).toBe(
      "The 2026 appraised value was revised to $1,900,000 — down 5% ($100,000) from $2,000,000.",
    );
  });

  it("ignores an older year or a missing value", () => {
    expect(detectAssessmentChange(stored, v(2023, 900_000))).toBeNull();
    expect(detectAssessmentChange(stored, v(2027, null))).toBeNull();
  });

  it("treats a record with no tax year as a new notice", () => {
    const c = detectAssessmentChange(v(null, null), v(2026, 1_000_000))!;
    expect(c.kind).toBe("new_year");
    expect(describeChange(c)).toBe("The 2026 appraised value is $1,000,000.");
  });
});

describe("protestDeadlineEstimate", () => {
  it("is May 15, or 30 days after the notice if later — in notice season only", () => {
    expect(protestDeadlineEstimate(2027, "2027-04-02")).toBe("2027-05-15");
    expect(protestDeadlineEstimate(2027, "2027-05-01")).toBe("2027-05-31");
    expect(protestDeadlineEstimate(2027, "2027-08-01")).toBeNull();
    expect(protestDeadlineEstimate(2027, "2026-10-07")).toBeNull();
  });
});
