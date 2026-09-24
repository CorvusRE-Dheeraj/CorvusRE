import { describe, expect, it } from "vitest";
import {
  FORM_QUESTIONS,
  FORM_SECTIONS,
  FORM_TOTAL,
  firstUnansweredIndex,
  isAnswered,
  sectionKeyOf,
} from "./feedback-form";

describe("feedback form (v2)", () => {
  it("is exactly 20 questions across 6 groups, with unique ids", () => {
    expect(FORM_TOTAL).toBe(20);
    expect(FORM_SECTIONS).toHaveLength(6);
    const ids = FORM_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(20);
  });

  it("only the two closing questions are open text; the rest are choices", () => {
    const text = FORM_QUESTIONS.filter((q) => q.type === "text").map((q) => q.id);
    expect(text).toEqual(["f19", "f20"]);
  });

  it("counts a picked option or a typed comment as answered", () => {
    const q = FORM_QUESTIONS[0];
    expect(isAnswered(q, {})).toBe(false);
    expect(isAnswered(q, { f1: "Understanding how my property is valued" })).toBe(true);
    expect(isAnswered(q, { f1__other: "something else" })).toBe(true);
    expect(isAnswered(q, { f1__other: "   " })).toBe(false);
  });

  it("resumes at the first unanswered question", () => {
    expect(firstUnansweredIndex({})).toBe(0);
    expect(firstUnansweredIndex({ f1: "x", f2: "y" })).toBe(2);
  });

  it("shows the follow-ups only when they apply", () => {
    const f4 = FORM_QUESTIONS.find((q) => q.id === "f4")!;
    expect(f4.followUp!.showIf("Yes, somewhat")).toBe(true);
    expect(f4.followUp!.showIf("No")).toBe(false);
    const f14 = FORM_QUESTIONS.find((q) => q.id === "f14")!;
    expect(f14.followUp!.showIf("Never")).toBe(false);
    expect(f14.followUp!.showIf("A few times")).toBe(true);
  });

  it("maps each question to its group", () => {
    expect(sectionKeyOf("f1")).toBe("overall");
    expect(sectionKeyOf("f20")).toBe("build_next");
  });
});
