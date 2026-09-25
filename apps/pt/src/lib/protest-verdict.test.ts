import { describe, expect, it } from "vitest";
import { protestVerdict, type VerdictInput } from "./protest-verdict";

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
});
