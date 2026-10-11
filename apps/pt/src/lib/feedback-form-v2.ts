// The 20-question beta feedback form (v2) — kept only so the admin Beta Feedback
// viewer can still label the answers people already gave (ids f1..f20). The live
// form is in feedback-form.ts.
import type { Answer, Question, Section } from "./beta-feedback-questions";

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

export const FORM_V2_SECTIONS: Section[] = [
  {
    key: "overall",
    title: "Overall Experience",
    showIf: always,
    questions: [
      choice("f1", "After using Corvus, what do you think its main value is?", [
        "Finding property tax protest opportunities",
        "Understanding how my property is valued",
        "Helping me manage the protest process",
        "Managing my property taxes year after year",
      ]),
      choice("f2", "What part of Corvus felt most valuable to you?", [
        "AI property analysis",
        "Finding valuation/evidence opportunities",
        "Comparable properties and market analysis",
        "Managing the protest process",
      ]),
      choice("f3", "What part of Corvus felt least useful or unnecessary?", [
        "Property information",
        "AI analysis",
        "Comparable/market analysis",
        "Protest workflow",
        "Nothing felt unnecessary",
      ]),
    ],
  },
  {
    key: "ai_analysis",
    title: "AI & Analysis",
    showIf: always,
    questions: [
      choice(
        "f4",
        "Did Corvus help you understand something about your property that you didn't know before?",
        ["Yes, significantly", "Yes, somewhat", "Not really", "No"],
        {
          followUp: {
            showIf: (a: Answer | undefined) => typeof a === "string" && a.startsWith("Yes"),
            question: open("f4_what", "What did it help you understand?"),
          },
        },
      ),
      choice(
        "f5",
        "When Corvus gives you an AI conclusion, what do you most want to see with it?",
        [
          "Supporting evidence",
          "Data sources",
          "How Corvus calculated it",
          "Comparable properties",
          "All of the above",
        ],
      ),
      choice("f6", "How confident would you be using Corvus' analysis as part of a real protest?", [
        "I would rely on it with normal review",
        "I would use it but verify important conclusions",
        "I would mainly use it for research",
        "I would not rely on it yet",
      ]),
      choice(
        "f7",
        "What is the biggest thing Corvus needs to improve before you would trust its analysis more?",
        [
          "Accuracy of the AI",
          "Quality of property/county data",
          "Valuation methodology",
          "Supporting evidence",
          "Explanation of its reasoning",
        ],
      ),
    ],
  },
  {
    key: "strategy",
    title: "Finding the Protest Strategy",
    showIf: always,
    questions: [
      choice("f8", "Did Corvus make it clear why you might want to protest?", [
        "Very clear",
        "Mostly clear",
        "Somewhat clear",
        "Not clear yet",
      ]),
      choice(
        "f9",
        "When Corvus recommends a protest strategy, what would make that recommendation more useful?",
        [
          "Stronger supporting evidence",
          "More comparable properties",
          "More explanation of the reasoning",
          "Clearer estimate of potential impact",
          "Clearer next steps",
        ],
      ),
      choice("f10", "What would you most want Corvus to investigate automatically for you?", [
        "Comparable sales",
        "Property/site conditions",
        "Building condition",
        "Income/rental information",
        "Zoning/classification",
        "County/CAD information",
      ]),
    ],
  },
  {
    key: "evidence_workflow",
    title: "Evidence, Documents & Workflow",
    showIf: always,
    questions: [
      choice("f11", "How would you prefer Corvus to handle your property documents?", [
        "Upload everything once and let Corvus organize it",
        "Upload only when Corvus asks for something",
        "Upload documents individually as I go",
        "A combination of these",
      ]),
      choice("f12", "What should Corvus do with your documents automatically?", [
        "Extract important information",
        "Find missing evidence",
        "Connect evidence to the protest strategy",
        "Prepare documents/information for filing",
        "All of the above",
      ]),
      choice(
        "f13",
        "Which part of the actual protest process would you most want Corvus to handle or guide?",
        [
          "Research and preparation",
          "Evidence and filing",
          "County communication and tracking",
          "Hearings and follow-up",
          "The entire process",
        ],
      ),
      choice(
        "f14",
        "At any point, did you feel unsure about what you were supposed to do next?",
        ["Never", "Once", "A few times", "Frequently"],
        {
          followUp: {
            showIf: (a: Answer | undefined) => typeof a === "string" && a !== "Never",
            question: open("f14_where", "Where?"),
          },
        },
      ),
    ],
  },
  {
    key: "control_trust",
    title: "Control & Trust",
    showIf: always,
    questions: [
      choice("f15", "Where do you most want to remain personally in control?", [
        "Reviewing AI analysis",
        "Approving evidence/documents",
        "Approving filings",
        "Making all major decisions",
        "I would prefer Corvus to handle as much as possible",
      ]),
      choice("f16", "What would make you stop using or trusting Corvus?", [
        "Incorrect AI analysis",
        "Incorrect property/county information",
        "Unrealistic valuation or savings estimates",
        "Incorrect filing/procedural guidance",
        "Not being able to understand why AI reached a conclusion",
      ]),
    ],
  },
  {
    key: "build_next",
    title: "What Should We Build Next?",
    showIf: always,
    questions: [
      choice("f17", "Which area should Corvus improve first?", [
        "Better property valuation analysis",
        "Better evidence gathering",
        "Better protest filing/case management",
        "Better hearing and follow-up support",
        "Better yearly property monitoring",
      ]),
      choice(
        "f18",
        "If Corvus monitored your property every year, what would you most want it to tell you?",
        [
          "My assessment changed significantly",
          "I may have a new protest opportunity",
          "Comparable/market conditions changed",
          "I may have significant potential savings",
          "I have an upcoming deadline/action",
        ],
      ),
      open("f19", "If you could add one feature to Corvus tomorrow, what would it be?"),
      open("f20", "Complete this sentence: “I would use Corvus every year if __________________.”"),
    ],
  },
];
