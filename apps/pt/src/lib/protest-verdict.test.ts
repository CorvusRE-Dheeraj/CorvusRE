import { describe, expect, it } from "vitest";
import { protestVerdict, usualDeadlinePassed, type VerdictInput } from "./protest-verdict";

const base: VerdictInput = {
  score: 80,
  daysLeft: 12,
  estimatedSavings: 1800,
  hasProtest: false,
  protestResolved: false,
  protestStageLabel: null,
};

describe("protestVerdict", () => {
  it("says yes for a strong score and mentions savings and deadline", () => {
    const v = protestVerdict(base);
    expect(v.tone).toBe("good");
    expect(v.detail).toContain("$1,800");
    expect(v.detail).toContain("12 days");
  });
  it("uses the report's bands: 40-69 is maybe, below 40 is no", () => {
    expect(protestVerdict({ ...base, score: 69 }).tone).toBe("maybe");
    expect(protestVerdict({ ...base, score: 40 }).tone).toBe("maybe");
    expect(protestVerdict({ ...base, score: 39 }).tone).toBe("no");
  });
  it("flags a passed deadline before anything else", () => {
    expect(protestVerdict({ ...base, daysLeft: -2 }).tone).toBe("warn");
  });
  it("asks for data when there is no score yet", () => {
    const v = protestVerdict({ ...base, score: null });
    expect(v.tone).toBe("info");
    expect(v.action).toBe("upload");
  });
  it("reports an open or closed case instead of a verdict", () => {
    expect(
      protestVerdict({ ...base, hasProtest: true, protestStageLabel: "Hearing" }).detail,
    ).toContain("Hearing");
    expect(protestVerdict({ ...base, hasProtest: true, protestResolved: true }).tone).toBe("done");
  });
  it("warns when no deadline is on file and May 15 has passed", () => {
    const v = protestVerdict({ ...base, daysLeft: null, usualDeadlinePassed: true });
    expect(v.tone).toBe("warn");
    expect(v.headline).toContain("May 15");
  });
  it("knows when May 15 has passed", () => {
    expect(usualDeadlinePassed(new Date(2026, 8, 25))).toBe(true);
    expect(usualDeadlinePassed(new Date(2026, 2, 1))).toBe(false);
  });
});
