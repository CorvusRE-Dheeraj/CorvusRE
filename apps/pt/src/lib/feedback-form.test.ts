import { describe, expect, it } from "vitest";
import {
  FORM_QUESTIONS,
  FORM_SECTIONS,
  FORM_TOTAL,
  firstUnansweredIndex,
  isAnswered,
  sectionKeyOf,
} from "./feedback-form";

describe("feedback form (v3)", () => {
  it("is exactly 10 questions with unique ids g1..g10", () => {
    expect(FORM_TOTAL).toBe(10);
    expect(FORM_QUESTIONS.map((q) => q.id)).toEqual([
      "g1",
      "g2",
      "g3",
      "g4",
      "g5",
      "g6",
      "g7",
      "g8",
      "g9",
      "g10",
    ]);
    expect(FORM_SECTIONS.flatMap((s) => s.questions)).toHaveLength(10);
  });

  it("only the last question is open text; g6, g7 and g9 are multi-select, the rest single", () => {
    expect(FORM_QUESTIONS.filter((q) => q.type === "text").map((q) => q.id)).toEqual(["g10"]);
    expect(FORM_QUESTIONS.filter((q) => q.type === "multi").map((q) => q.id)).toEqual([
      "g6",
      "g7",
      "g9",
    ]);
  });

  it("counts a picked option or a typed comment as answered", () => {
    const q = FORM_QUESTIONS[0];
    expect(isAnswered(q, {})).toBe(false);
    expect(isAnswered(q, { g1: "Makes the protest process easier" })).toBe(true);
    expect(isAnswered(q, { g1__other: "something else" })).toBe(true);
    expect(isAnswered(q, { g1__other: "   " })).toBe(false);
  });

  it("counts a multi-select question answered by a non-empty array, or a typed comment", () => {
    const g6 = FORM_QUESTIONS.find((q) => q.id === "g6")!;
    expect(isAnswered(g6, {})).toBe(false);
    expect(isAnswered(g6, { g6: [] })).toBe(false);
    expect(isAnswered(g6, { g6: ["Research county/CAD information"] })).toBe(true);
    expect(isAnswered(g6, { g6__other: "Something else" })).toBe(true);
  });

  it("resumes at the first unanswered question", () => {
    expect(firstUnansweredIndex({})).toBe(0);
    expect(firstUnansweredIndex({ g1: "x", g2: "y" })).toBe(2);
  });

  it("shows the follow-ups only when they apply", () => {
    const g4 = FORM_QUESTIONS.find((q) => q.id === "g4")!;
    expect(g4.followUp!.showIf("Yes, a few things")).toBe(true);
    expect(g4.followUp!.showIf("Not really")).toBe(false);
    const g8 = FORM_QUESTIONS.find((q) => q.id === "g8")!;
    expect(g8.followUp!.showIf("Never")).toBe(false);
    expect(g8.followUp!.showIf("Several times")).toBe(true);
  });

  it("maps each question to its group", () => {
    expect(sectionKeyOf("g1")).toBe("value");
    expect(sectionKeyOf("g10")).toBe("improve");
  });
});
