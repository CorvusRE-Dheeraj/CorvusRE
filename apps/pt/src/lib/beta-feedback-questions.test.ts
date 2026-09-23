import { describe, expect, it } from "vitest";
import {
  MAX_QUESTIONS,
  ZERO_SIGNALS,
  selectQuestionIds,
  visibleSections,
  type UsageSignals,
} from "./beta-feedback-questions";

const full: UsageSignals = {
  propertyCount: 3,
  hasNoticeUpload: true,
  hasAnyDocuments: true,
  hasAiReview: true,
  hasComps: true,
  hasEvidenceModule: true,
  hasProtest: true,
  protestAdvanced: true,
  multiProperty: true,
};

// What a tester can actually be shown: main questions plus any inline follow-up.
const maxShown = (s: UsageSignals) =>
  visibleSections(s)
    .flatMap((p) => p.questions)
    .reduce((n, q) => n + (q.followUp ? 2 : 1), 0);

describe("activity-driven feedback questions", () => {
  it("never exceeds the cap, even for the most active tester", () => {
    expect(maxShown(full)).toBeLessThanOrEqual(MAX_QUESTIONS);
    expect(maxShown(ZERO_SIGNALS)).toBeLessThanOrEqual(MAX_QUESTIONS);
  });

  it("is deterministic — same activity, same questions", () => {
    expect(selectQuestionIds(full)).toEqual(selectQuestionIds({ ...full }));
  });

  it("always asks the core questions", () => {
    for (const s of [ZERO_SIGNALS, full]) {
      const ids = selectQuestionIds(s);
      for (const id of ["q44", "q46", "q54", "q55", "q56"]) expect(ids).toContain(id);
    }
  });

  it("asks about filing only when a protest exists, and about comps only when comps were used", () => {
    const explored = { ...ZERO_SIGNALS, propertyCount: 1, hasAiReview: true };
    const ids = selectQuestionIds(explored);
    expect(ids).not.toContain("q23");
    expect(ids).not.toContain("q17");
    expect(selectQuestionIds({ ...explored, hasProtest: true })).toContain("q23");
    expect(selectQuestionIds({ ...explored, hasComps: true })).toContain("q17");
  });

  it("asks first-impression questions of someone who never added a property", () => {
    expect(selectQuestionIds(ZERO_SIGNALS)).toContain("q1");
    expect(selectQuestionIds({ ...ZERO_SIGNALS, propertyCount: 1 })).not.toContain("q1");
  });

  it("keeps a saved selection instead of reshuffling", () => {
    const pages = visibleSections(full, ["q54", "q56"]);
    expect(pages.flatMap((p) => p.questions.map((q) => q.id))).toEqual(["q54", "q56"]);
  });
});
