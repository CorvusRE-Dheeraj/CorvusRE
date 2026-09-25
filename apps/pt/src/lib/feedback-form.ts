// The Corvus beta feedback form (v3) — 10 questions, asked one at a time by the
// chat-style FeedbackWidget. Answers are stored on the same beta_feedback_responses
// row as before, under the ids g1..g10, plus `${id}__other` for the "Other: ____"
// box and `__form: "v3"` so a response can be told apart from the earlier 20-question
// form (v2, ids f1..f20 — see feedback-form-v2.ts) and the 57-question one. Their
// answers stay on file and stay visible to admins, and anyone who finished v2 is
// not asked again (see isFormV2Complete in beta-feedback.ts).
//
// Shaped as Section[] on purpose — the admin viewer already renders that shape.
import type { Answer, Question, Section } from "./beta-feedback-questions";

export const FORM_VERSION = "v3";
// Earlier forms whose completion still counts as "done".
export const LEGACY_FORM_VERSIONS = ["v2"];
export const FORM_MARKER_KEY = "__form";

const always = () => true;

// A single-choice question. The "Other / Comment" box shown under every choice
// question is the "Other: ____" option from the source list.
const choice = (
  id: string,
  label: string,
  options: string[],
  extra: Partial<Question> = {},
): Question => ({
  id,
  type: "single",
  label,
  options,
  ...extra,
});

const open = (id: string, label: string, helper?: string): Question => ({
  id,
  type: "text",
  label,
  helper,
});

export const FORM_SECTIONS: Section[] = [
  {
    key: "value",
    title: "Value & Usefulness",
    showIf: always,
    questions: [
      choice("g1", "After using Corvus, what would you say is its biggest benefit to you?", [
        "Helps me find protest opportunities",
        "Helps me understand my property’s assessment",
        "Makes the protest process easier",
        "Helps me manage my property taxes over time",
      ]),
      choice("g2", "What did you find most useful?", [
        "AI analysis of my property",
        "Finding potential valuation issues",
        "Comparable properties / market information",
        "Evidence and protest preparation",
      ]),
      choice("g3", "What did you find least useful?", [
        "Property information",
        "AI analysis",
        "Comparable / market information",
        "Protest workflow",
        "Nothing — it was all useful",
      ]),
      choice(
        "g4",
        "Did Corvus uncover anything you found interesting or didn't already know?",
        ["Yes, a lot", "Yes, a few things", "Not really", "No"],
        {
          followUp: {
            showIf: (a: Answer | undefined) => typeof a === "string" && a.startsWith("Yes"),
            question: open("g4_what", "What did it uncover?"),
          },
        },
      ),
    ],
  },
  {
    key: "trust_automation",
    title: "Trust & Automation",
    showIf: always,
    questions: [
      choice("g5", "When Corvus gives you an answer or recommendation, what makes you trust it?", [
        "Showing the evidence",
        "Showing the sources",
        "Explaining how it reached the conclusion",
        "Showing comparable properties",
        "All of these",
      ]),
      choice("g6", "What would you like Corvus to do for you automatically?", [
        "Find and analyze comparable properties",
        "Investigate site/property issues",
        "Analyze building condition",
        "Analyze income/rental information",
        "Check zoning/classification",
        "Research county/CAD information",
      ]),
      choice("g7", "How much of the protest process would you want Corvus to handle?", [
        "Research and preparation",
        "Evidence and filing",
        "County communication and tracking",
        "Hearings and follow-up",
        "As much of the process as possible",
      ]),
    ],
  },
  {
    key: "improve",
    title: "Making It Better",
    showIf: always,
    questions: [
      choice(
        "g8",
        "While using Corvus, did you ever wonder, “What do I do next?”",
        ["Never", "Occasionally", "Several times", "Frequently"],
        {
          followUp: {
            showIf: (a: Answer | undefined) => typeof a === "string" && a !== "Never",
            question: open("g8_where", "Where did you feel unsure?"),
          },
        },
      ),
      choice("g9", "What is the biggest thing that would make Corvus better for you?", [
        "More accurate AI analysis",
        "Better property / county information",
        "Better valuation analysis",
        "Better evidence",
        "Easier filing and case management",
        "Clearer explanation of the AI",
      ]),
      open("g10", "If you could tell us to build ONE thing next, what would it be?"),
    ],
  },
];

// The flat question order the widget walks through — follow-ups are attached to
// their parent question, not separate steps, so this is exactly 10 steps.
export const FORM_QUESTIONS: Question[] = FORM_SECTIONS.flatMap((s) => s.questions);
export const FORM_TOTAL = FORM_QUESTIONS.length;

export function sectionKeyOf(questionId: string): string {
  return FORM_SECTIONS.find((s) => s.questions.some((q) => q.id === questionId))?.key ?? "";
}

// Answered = an option was picked, or text was typed (for a choice question the
// "Other / Comment" box counts too).
export function isAnswered(q: Question, answers: Record<string, Answer>): boolean {
  const v = answers[q.id];
  if (typeof v === "string" && v.trim() !== "") return true;
  const other = answers[`${q.id}__other`];
  return q.type === "single" && typeof other === "string" && other.trim() !== "";
}

// Where a returning person resumes: the first question they haven't answered.
export function firstUnansweredIndex(answers: Record<string, Answer>): number {
  const i = FORM_QUESTIONS.findIndex((q) => !isAnswered(q, answers));
  return i === -1 ? FORM_TOTAL - 1 : i;
}
