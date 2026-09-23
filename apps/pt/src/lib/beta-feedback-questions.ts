// The Corvus Beta Tester Feedback Form — see beta-feedback.ts for the
// real-usage signals, and routes/dashboard/_layout.feedback.tsx for the form.
//
// SECTIONS below is the full question bank (57 questions), NOT what a tester
// sees. Each tester gets at most MAX_QUESTIONS of them, chosen
// deterministically from what they actually DID in the app (see
// selectQuestionIds) — a short always-asked core, then the questions most
// relevant to how far they got, most-relevant first. No randomness: the same
// activity always yields the same questions.
export type UsageSignals = {
  propertyCount: number;
  hasNoticeUpload: boolean;
  hasAnyDocuments: boolean;
  hasAiReview: boolean;
  hasComps: boolean;
  hasEvidenceModule: boolean;
  hasProtest: boolean;
  protestAdvanced: boolean;
  multiProperty: boolean;
};

export const ZERO_SIGNALS: UsageSignals = {
  propertyCount: 0,
  hasNoticeUpload: false,
  hasAnyDocuments: false,
  hasAiReview: false,
  hasComps: false,
  hasEvidenceModule: false,
  hasProtest: false,
  protestAdvanced: false,
  multiProperty: false,
};

export type QuestionType = "single" | "multi" | "text" | "nps";

export type Answer = string | string[];

export type Question = {
  id: string;
  type: QuestionType;
  label: string;
  helper?: string;
  options?: string[];
  otherOption?: boolean;
  maxSelect?: number;
  required?: boolean;
  // An inline "if yes/maybe: ..." follow-up shown right under this question,
  // gated on THIS question's own answer rather than usage signals (e.g. Q6,
  // Q10, Q42 in the spec).
  followUp?: {
    showIf: (answer: Answer | undefined) => boolean;
    question: Question;
  };
};

export type Section = {
  key: string;
  title: string;
  showIf: (signals: UsageSignals) => boolean;
  questions: Question[];
};

const yesNoMaybe = ["Yes", "No", "Maybe"];
const includesAny = (vals: string[]) => (a: Answer | undefined) =>
  typeof a === "string"
    ? vals.includes(a)
    : Array.isArray(a)
      ? a.some((x) => vals.includes(x))
      : false;

export const SECTIONS: Section[] = [
  {
    key: "first_impression",
    title: "First Impression — Did You Understand What Corvus Is For?",
    showIf: () => true,
    questions: [
      {
        id: "q1",
        type: "single",
        label: "When you first landed on Corvus, what did you think it would help you do?",
        options: [
          "Protest my property taxes",
          "Find out if my property is overvalued",
          "Understand my property tax assessment",
          "Find information about my property",
          "Save money on property taxes",
          "Manage my property tax process",
          "I wasn't sure",
        ],
        otherOption: true,
      },
      {
        id: "q2",
        type: "single",
        label: "What was the first thing you wanted to do?",
        options: [
          "Enter my property address",
          "Upload my appraisal notice",
          "Ask the AI something",
          "See my property information",
          "See if I could save money",
          "Understand my tax situation",
          "I wasn't sure what to do",
        ],
        otherOption: true,
      },
      {
        id: "q3",
        type: "text",
        label: "What would have made the first screen immediately clearer?",
        helper: "Just tell us what you were looking for when you first opened it.",
      },
    ],
  },
  {
    key: "property_identification",
    title: "Property Identification — Did Corvus Get My Property Right?",
    showIf: (s) => s.propertyCount > 0,
    questions: [
      {
        id: "q4",
        type: "single",
        label:
          "After entering your property/address or uploading your notice, how confident were you that Corvus had identified the correct property?",
        options: [
          "Completely confident",
          "Mostly confident",
          "I checked it but it looked right",
          "I wasn't sure",
          "I thought something was wrong",
        ],
      },
      {
        id: "q5",
        type: "multi",
        label: "Which property information would you expect Corvus to automatically show you?",
        helper: "Select up to 5",
        maxSelect: 5,
        options: [
          "Current appraised value",
          "Land value",
          "Improvement value",
          "Previous year's value",
          "Tax history",
          "Property characteristics",
          "Ownership information",
          "County/CAD information",
          "Property classification",
          "Property size",
          "Building/land details",
          "Important deadlines",
          "Comparable properties",
          "Market information",
        ],
        otherOption: true,
      },
      {
        id: "q6",
        type: "single",
        label:
          "Was there any information Corvus showed you that you did NOT expect to be available?",
        options: yesNoMaybe,
        followUp: {
          showIf: includesAny(["Yes", "Maybe"]),
          question: { id: "q6_what", type: "text", label: "What was it?" },
        },
      },
    ],
  },
  {
    key: "ai_review",
    title: "AI Review — Is Corvus Actually Helping Me Understand My Taxes?",
    showIf: (s) => s.hasAiReview,
    questions: [
      {
        id: "q7",
        type: "multi",
        label: "After seeing the AI Review, what did you feel Corvus helped you understand?",
        helper: "Select all that apply",
        options: [
          "Whether my property may be overvalued",
          "Why my value may be high",
          "How my current value compares with previous years",
          "How my property compares with similar properties",
          "What factors may support a protest",
          "What evidence I may need",
          "What I should do next",
          "How much I might potentially save",
          "I understood very little from the review",
        ],
        otherOption: true,
      },
      {
        id: "q8",
        type: "single",
        label: "Which part of the AI Review was most useful to you?",
        options: [
          "Estimated Overvaluation",
          "Protest Strength",
          "Possible Savings",
          "Protest Strategy",
          "Comparable Properties",
          "Market Analysis",
          "Property Information",
          "Deadline/Timing",
          "AI Confidence",
        ],
        otherOption: true,
      },
      {
        id: "q9",
        type: "multi",
        label:
          "If Corvus tells you that your property may be overvalued, what would you need to see before you would believe it?",
        helper: "Select up to 4",
        maxSelect: 4,
        options: [
          "County/CAD data",
          "Comparable properties",
          "Previous-year values",
          "Market data",
          "Explanation of how Corvus reached the conclusion",
          "Supporting documents",
          "Calculation of potential savings",
          "Source of the information",
          "Human review",
          "Nothing — I would trust the result",
        ],
        otherOption: true,
      },
      {
        id: "q10",
        type: "single",
        label:
          'Was there anything in the AI analysis that made you think: "Wait... how did Corvus come up with that?"',
        options: ["Yes", "No", "A little"],
        followUp: {
          showIf: includesAny(["Yes", "A little"]),
          question: {
            id: "q10_what",
            type: "text",
            label: "What was it?",
            helper: "This is important to us. Tell us exactly what made you question the answer.",
          },
        },
      },
    ],
  },
  {
    key: "savings",
    title: "Savings — Does the Value Feel Real?",
    showIf: (s) => s.hasAiReview,
    questions: [
      {
        id: "q11",
        type: "single",
        label: "When Corvus shows a potential savings amount, what is your reaction?",
        options: [
          "“That's useful — now I know why I should protest.”",
          "“Interesting, but I would want to verify it.”",
          "“I would need more explanation.”",
          "“I don't really care about the estimate.”",
          "“I don't trust the estimate yet.”",
        ],
        otherOption: true,
      },
      {
        id: "q12",
        type: "multi",
        label: "What would make a potential savings estimate feel credible to you?",
        helper: "Select up to 3",
        maxSelect: 3,
        options: [
          "Showing the calculation",
          "Showing the current assessed value",
          "Showing the expected reduced value",
          "Showing the effective tax rate",
          "Showing comparable properties",
          "Showing historical values",
          "Showing supporting evidence",
          "Showing where the data came from",
          "Having a human review it",
        ],
        otherOption: true,
      },
      {
        id: "q13",
        type: "text",
        label:
          'Imagine Corvus tells you: "Based on the available property data, comparable properties, and market information, your property may be overvalued." What would you want to see immediately after that?',
        helper:
          "Think like a property owner. What would you want Corvus to show you before you decide whether to protest?",
      },
    ],
  },
  {
    key: "comps_market",
    title: "Comparable Properties & Market Analysis",
    showIf: (s) => s.hasComps,
    questions: [
      {
        id: "q14",
        type: "single",
        label:
          "How useful would comparable-property information be when deciding whether to protest?",
        options: [
          "Extremely useful",
          "Very useful",
          "Somewhat useful",
          "Not very useful",
          "I wouldn't use it",
        ],
      },
      {
        id: "q15",
        type: "multi",
        label: "What would you want to know about a comparable property?",
        helper: "Select up to 5",
        maxSelect: 5,
        options: [
          "Location",
          "Property type",
          "Size",
          "Appraised value",
          "Value per SF",
          "Land value",
          "Improvement value",
          "Previous-year value",
          "Tax history",
          "Sale information",
          "Distance from my property",
          "Similarity to my property",
          "Why Corvus selected it",
        ],
        otherOption: true,
      },
      {
        id: "q16",
        type: "single",
        label: "If Corvus gives you 10 comparable properties, what would you rather have?",
        options: [
          "Show me everything",
          "Show me the 3–5 most relevant ones",
          "Show me the strongest 1–2 and explain why",
          "Let me choose how many I want to see",
          "I don't really need comps",
        ],
      },
      {
        id: "q17",
        type: "single",
        label:
          "Did the market/comparable information make the protest recommendation feel more believable?",
        options: ["Yes", "Somewhat", "No", "I didn't use this section"],
      },
    ],
  },
  {
    key: "next_action",
    title: '"Tell Me What I Need To Do"',
    showIf: (s) => s.propertyCount > 0,
    questions: [
      {
        id: "q18",
        type: "single",
        label: 'At any point, did you wonder: "Okay... what am I supposed to do now?"',
        options: ["Never", "Once or twice", "Several times", "Pretty much throughout 😅"],
      },
      {
        id: "q19",
        type: "single",
        label: "Was Corvus clear about your next required action?",
        options: ["Yes, always", "Usually", "Sometimes", "Not really", "I wasn't sure"],
      },
      {
        id: "q20",
        type: "multi",
        label: "Which next action would you expect Corvus to clearly guide you through?",
        options: [
          "File Protest",
          "Review/confirm property information",
          "Upload evidence",
          "Complete an agent/representative form",
          "Complete an evidence affidavit/declaration",
          "Submit documents to the county",
          "Prepare for informal review",
          "Prepare for formal hearing",
          "Track hearing information",
          "Understand what happens after filing",
        ],
        otherOption: true,
      },
      {
        id: "q21",
        type: "single",
        label:
          'If Corvus had one permanent button on your case screen saying: "What do I need to do next?" Would you use it?',
        options: ["Absolutely", "Probably", "Maybe", "Probably not", "No"],
      },
      {
        id: "q22",
        type: "text",
        label: "What should that button do for you?",
        helper: "Don't think about the current website. Tell us what you would want it to do.",
      },
    ],
  },
  {
    key: "protest_filing",
    title: "Protest Filing — Would You Actually Use Corvus?",
    showIf: (s) => s.hasAiReview || s.hasProtest,
    questions: [
      {
        id: "q23",
        type: "single",
        label: "How comfortable would you be using Corvus to prepare your property tax protest?",
        options: [
          "Very comfortable",
          "Comfortable, but I would review everything",
          "I would use it as a starting point",
          "I would need a human to review it",
          "I wouldn't trust it for filing yet",
        ],
      },
      {
        id: "q24",
        type: "multi",
        label: "Which parts of the protest process would you want Corvus to handle for you?",
        helper: "Select all that apply",
        options: [
          "Identify whether protesting makes sense",
          "Research my property",
          "Analyze my current value",
          "Find comparable properties",
          "Analyze market conditions",
          "Recommend protest reasons",
          "Tell me what evidence I need",
          "Organize my documents",
          "Prepare protest information",
          "Prepare forms",
          "Help submit/file",
          "Track filing status",
          "Track deadlines",
          "Prepare me for the hearing",
          "Help with hearing questions",
          "Track the outcome",
          "Help me understand the next year's assessment",
        ],
        otherOption: true,
      },
      {
        id: "q25",
        type: "text",
        label:
          "What part of the protest process would you NEVER want AI to handle without you reviewing it?",
        helper: "This is a big one for us. Tell us where you want to stay in control.",
      },
    ],
  },
  {
    key: "documents_evidence",
    title: "Documents & Evidence — The Real-World Mess Test",
    showIf: (s) => s.hasAnyDocuments,
    questions: [
      {
        id: "q26",
        type: "single",
        label:
          'Imagine you have a folder called: "Property Tax Protest FINAL FINAL 2.pdf" with 20 different documents inside. How much would you trust Corvus to organize and understand them?',
        options: [
          "Yes, absolutely",
          "Yes, but I would review everything",
          "Maybe",
          "Probably not",
          "No",
        ],
      },
      {
        id: "q27",
        type: "multi",
        label: "What would you want Corvus to do with your documents?",
        helper: "Select up to 5",
        maxSelect: 5,
        options: [
          "Identify what each document is",
          "Extract important information",
          "Organize documents automatically",
          "Tell me which documents are useful",
          "Tell me which documents are missing",
          "Connect documents to my protest strategy",
          "Suggest where each document should be used",
          "Prepare information for the protest form",
          "Prepare information for the hearing",
          "Flag conflicting information",
          "Tell me where the document information came from",
        ],
        otherOption: true,
      },
      {
        id: "q28",
        type: "single",
        label: "Would you rather:",
        options: [
          "Upload everything once and let Corvus organize it",
          "Upload documents one by one",
          "Upload only the documents Corvus asks for",
          "A combination of these",
          "I'm not sure",
        ],
      },
      {
        id: "q29",
        type: "multi",
        label: "What type of evidence would you expect Corvus to help you find?",
        helper: "Select all that apply",
        options: [
          "Comparable property information",
          "Property condition",
          "Construction/incomplete improvements",
          "Repairs",
          "Market data",
          "Income/rent information",
          "Operating expenses",
          "Sales information",
          "Property photographs",
          "Property characteristics",
          "Prior protest information",
        ],
        otherOption: true,
      },
    ],
  },
  {
    key: "case_management",
    title: "Case Management — Would You Come Back?",
    showIf: (s) => s.propertyCount > 0,
    questions: [
      {
        id: "q30",
        type: "multi",
        label:
          "If you were managing multiple commercial properties, what would you want to see on your Corvus property dashboard?",
        helper: "Select up to 7",
        maxSelect: 7,
        options: [
          "Property name/address",
          "Current assessed value",
          "Previous assessed value",
          "Potential savings",
          "Protest status",
          "Next action",
          "Filing deadline",
          "Hearing date",
          "Missing documents",
          "AI review status",
          "Protest outcome",
          "Tax savings achieved",
          "Properties that may need attention",
          "Year-over-year value changes",
        ],
        otherOption: true,
      },
      {
        id: "q31",
        type: "multi",
        label:
          "If you had 50 properties, which would you want Corvus to automatically flag for you?",
        helper: "Select all that apply",
        options: [
          "Large increase in assessed value",
          "Potential overvaluation",
          "Significant change from previous year",
          "Unusual property classification",
          "Strong comparable evidence",
          "Upcoming protest deadline",
          "Missing documents",
          "Possible protest opportunity",
          "Significant potential savings",
        ],
        otherOption: true,
      },
      {
        id: "q32",
        type: "single",
        label:
          'Would you want Corvus to automatically monitor your properties every year and tell you: "These properties may need your attention this year."',
        options: ["Absolutely", "Probably", "Maybe", "Probably not", "No"],
      },
      {
        id: "q33",
        type: "text",
        label:
          "What would make you come back to Corvus every year instead of only using it when you have a tax problem?",
      },
    ],
  },
  {
    key: "tax_mgmt_beyond",
    title: "Property Tax Management — Beyond the Protest",
    showIf: (s) => s.hasAiReview,
    questions: [
      {
        id: "q34",
        type: "multi",
        label:
          "If Corvus could become your yearly property-tax management tool, which of these would you actually use?",
        helper: "Select up to 6",
        maxSelect: 6,
        options: [
          "Annual value monitoring",
          "Tax protest reminders",
          "Property assessment history",
          "Tax payment/deadline reminders",
          "Property value changes",
          "Comparable property monitoring",
          "Market changes",
          "Protest history",
          "Document storage",
          "Evidence management",
          "Hearing tracking",
          "Tax savings tracking",
          "Multi-property dashboard",
          "Reports for ownership/management",
        ],
        otherOption: true,
      },
      {
        id: "q35",
        type: "single",
        label: "Which sounds more valuable to you?",
        options: [
          "A. “Corvus helps me protest my property taxes.”",
          "B. “Corvus watches my property taxes and tells me when I should take action.”",
          "Both",
          "Neither",
        ],
      },
      {
        id: "q36",
        type: "text",
        label: "If you could only keep ONE Corvus feature, which one would you keep?",
      },
    ],
  },
  {
    key: "ai_chat",
    title: "AI Chat / Ask AI",
    showIf: (s) => s.propertyCount > 0,
    questions: [
      {
        id: "q37",
        type: "multi",
        label: "What would you naturally ask Corvus?",
        helper: "Select all that apply",
        options: [
          "“Why did my property value increase?”",
          "“Do I have a reason to protest?”",
          "“How much could I potentially save?”",
          "“Show me comparable properties.”",
          "“What evidence do I need?”",
          "“What do I do next?”",
          "“When is my deadline?”",
          "“What does this county require?”",
          "“What does this notice mean?”",
          "“What should I say at my hearing?”",
          "“Why is my property valued this way?”",
          "“What changed from last year?”",
        ],
        otherOption: true,
      },
      {
        id: "q38",
        type: "text",
        label: "What is one question you expected to be able to ask Corvus but couldn't?",
      },
    ],
  },
  {
    key: "trust_test",
    title: "The Trust Test",
    showIf: (s) => s.hasAiReview,
    questions: [
      {
        id: "q39",
        type: "single",
        label: "Which statement best describes how you currently feel about Corvus?",
        options: [
          "“I could use this for a real property tax protest.”",
          "“I could use this, but I would double-check important information.”",
          "“I see the value, but I need more proof before relying on it.”",
          "“I like the concept, but I don't trust the results yet.”",
          "“I'm not sure I would use it.”",
        ],
      },
      {
        id: "q40",
        type: "single",
        label: "What is the biggest reason you would hesitate to trust Corvus?",
        options: [
          "Accuracy of property data",
          "Accuracy of AI analysis",
          "Savings estimate",
          "Comparable properties",
          "County requirements",
          "Filing information",
          "AI explanations",
          "Data sources",
          "Privacy/security",
          "I want a human involved",
          "I don't understand what the AI is doing",
          "Nothing specific",
        ],
        otherOption: true,
      },
      {
        id: "q41",
        type: "text",
        label: '"What would make you say: "Okay, I trust Corvus."',
        helper:
          "Don't give us the answer you think we want. Tell us what would actually convince you.",
      },
    ],
  },
  {
    key: "magic_moment",
    title: "The Magic Moment ✨",
    showIf: (s) => s.propertyCount > 0,
    questions: [
      {
        id: "q42",
        type: "single",
        label:
          'Did Corvus do anything that made you think: "Oh... that\'s actually pretty useful."',
        options: ["Yes", "Not yet", "Still looking 😄"],
        followUp: {
          showIf: includesAny(["Yes"]),
          question: {
            id: "q42_what",
            type: "text",
            label: "What happened?",
            helper: "It can be something tiny. Tell us the exact moment.",
          },
        },
      },
    ],
  },
  {
    key: "almost_left",
    title: 'The "Almost Closed the Website" Test',
    showIf: () => true,
    questions: [
      {
        id: "q43",
        type: "single",
        label: "Was there a point where you almost stopped using Corvus?",
        options: [
          "No",
          "I was confused",
          "I didn't know what to do next",
          "I didn't trust the information",
          "Something wasn't working",
          "There was too much information",
          "There wasn't enough information",
          "It was taking too long",
          "I didn't see enough value",
        ],
        otherOption: true,
      },
      {
        id: "q44",
        type: "text",
        label: "What almost made you leave?",
        helper:
          'Be honest. If something annoyed you, confused you, or made you think "I\'m done with this," tell us.',
      },
    ],
  },
  {
    key: "if_disappeared",
    title: "If Corvus Disappeared Tomorrow...",
    showIf: (s) => s.hasAiReview,
    questions: [
      {
        id: "q45",
        type: "text",
        label:
          "Imagine you had used Corvus for a real property tax protest, and tomorrow it disappeared. What would you miss?",
        helper: "Don't think too much about this one. Whatever comes to mind first.",
      },
    ],
  },
  {
    key: "magic_wand",
    title: "Magic Wand 🪄",
    showIf: () => true,
    questions: [
      {
        id: "q46",
        type: "text",
        label: "If you could make Corvus do ONE thing it doesn't do today, what would it be?",
        helper:
          "Don't worry about whether it's technically possible. Just tell us what you wish it could do.",
      },
    ],
  },
  {
    key: "investor_validation",
    title: "Investor / Market Validation Questions",
    showIf: () => true,
    questions: [
      {
        id: "q47",
        type: "single",
        label: "Before using Corvus, how were you normally handling property tax protests?",
        options: [
          "Doing it myself",
          "Property manager handled it",
          "Tax consultant/protest company",
          "Attorney",
          "CPA/accounting team",
          "I usually didn't protest",
        ],
        otherOption: true,
      },
      { id: "q48", type: "text", label: "What was the most frustrating part of that process?" },
      {
        id: "q49",
        type: "single",
        label: "Compared with how you handled property taxes before Corvus, Corvus feels:",
        options: [
          "Much easier",
          "Somewhat easier",
          "About the same",
          "Somewhat harder",
          "Much harder",
          "Too early to tell",
        ],
      },
      {
        id: "q50",
        type: "single",
        label: "If Corvus worked exactly as you would want it to, how often would you use it?",
        options: [
          "Once a year",
          "Every tax/assessment cycle",
          "Whenever I receive a notice",
          "Throughout the year",
          "Whenever Corvus alerts me",
          "Only when I think my value is wrong",
        ],
        otherOption: true,
      },
      {
        id: "q51",
        type: "single",
        label: "Who would you expect to get the most value from Corvus?",
        options: [
          "Individual commercial property owners",
          "Property managers",
          "Real estate investors",
          "Owners with multiple properties",
          "Asset managers",
          "Real estate companies",
          "Tax/protest professionals",
        ],
        otherOption: true,
      },
      {
        id: "q52",
        type: "single",
        label: "Would you consider using Corvus for multiple properties?",
        options: ["Yes", "Probably", "Maybe", "Probably not", "No"],
        followUp: {
          showIf: includesAny(["Yes", "Probably", "Maybe"]),
          question: {
            id: "q52_count",
            type: "single",
            label: "How many properties would you realistically want to manage through it?",
            options: ["1", "2–5", "6–20", "21–50", "50+"],
          },
        },
      },
    ],
  },
  {
    key: "reality_check",
    title: "One Last Reality Check",
    showIf: () => true,
    questions: [
      {
        id: "q53",
        type: "single",
        label:
          "If Corvus were available today, which statement is closest to how you would use it?",
        options: [
          "I would use it for my next property tax protest.",
          "I would use it, but I would still have someone review the work.",
          "I would use it mainly for research and analysis.",
          "I would use it to monitor my properties, but not handle the protest.",
          "I would try it once before deciding.",
          "I probably wouldn't use it.",
        ],
      },
      {
        id: "q54",
        type: "nps",
        label:
          "How likely are you to tell another property owner, property manager, or real estate professional about Corvus?",
      },
      {
        id: "q55",
        type: "text",
        label: "Why did you give it that number?",
        helper: "We care more about the reason than the number.",
      },
    ],
  },
  {
    key: "one_sentence",
    title: "The One Sentence We Really Want",
    showIf: () => true,
    questions: [
      {
        id: "q56",
        type: "text",
        label: "Complete this sentence: “Corvus would be much more useful to me if __________.”",
      },
      {
        id: "q57",
        type: "text",
        label:
          "Complete this one too: “The thing I would never want Corvus to get wrong is __________.”",
      },
    ],
  },
];

export const OPTIONAL_INFO: Section = {
  key: "optional_info",
  title: "Optional Tester Information",
  showIf: () => true,
  questions: [
    {
      id: "role",
      type: "single",
      label: "Your role",
      options: [
        "Commercial property owner",
        "Property manager",
        "Real estate professional",
        "Investor",
        "Tax/property-tax professional",
      ],
      otherOption: true,
    },
    {
      id: "property_type",
      type: "single",
      label: "Property type",
      options: ["Retail", "Office", "Industrial", "Multifamily", "Land", "Hospitality"],
      otherOption: true,
    },
    {
      id: "how_far",
      type: "multi",
      label: "How far did you get with Corvus?",
      options: [
        "Just explored the website",
        "Entered a property",
        "Uploaded an appraisal notice",
        "Reviewed property information",
        "Completed AI Review",
        "Reviewed comps/market analysis",
        "Reviewed savings/recommendations",
        "Prepared protest",
        "Worked with evidence/documents",
        "Reviewed filing process",
        "Reviewed hearing process",
        "Completed the full journey",
      ],
    },
  ],
};

export const ALL_SECTIONS: Section[] = [...SECTIONS, OPTIONAL_INFO];

// --- Activity-driven selection ----------------------------------------------

export const MAX_QUESTIONS = 15;
const PAGE_SIZE = 5;

// Asked of everyone regardless of activity: what almost made them leave, the
// one wish, NPS + why, and the closing sentence.
const CORE_IDS = ["q44", "q46", "q54", "q55", "q56"];

// weight(signals) > 0 means "relevant to this tester"; higher = asked first.
// Ties keep the order below. Deeper activity (a protest, documents, comps)
// outranks generic questions, so people see what they actually used.
const CANDIDATES: { id: string; weight: (s: UsageSignals) => number }[] = [
  { id: "q1", weight: (s) => (s.propertyCount === 0 ? 10 : 0) },
  { id: "q2", weight: (s) => (s.propertyCount === 0 ? 9 : 0) },
  { id: "q3", weight: (s) => (s.propertyCount === 0 ? 8 : 0) },
  { id: "q25", weight: (s) => (s.hasProtest ? 9 + (s.protestAdvanced ? 1 : 0) : 0) },
  { id: "q23", weight: (s) => (s.hasProtest ? 9 : 0) },
  { id: "q19", weight: (s) => (s.hasProtest ? 8 : s.propertyCount > 0 ? 5 : 0) },
  { id: "q20", weight: (s) => (s.protestAdvanced ? 6 : 0) },
  { id: "q45", weight: (s) => (s.hasAiReview ? 9 : 0) },
  { id: "q8", weight: (s) => (s.hasAiReview ? 8 : 0) },
  { id: "q39", weight: (s) => (s.hasAiReview ? 8 : 0) },
  { id: "q17", weight: (s) => (s.hasComps ? 8 : 0) },
  { id: "q31", weight: (s) => (s.multiProperty ? 8 : 0) },
  { id: "q7", weight: (s) => (s.hasAiReview ? 7 : 0) },
  { id: "q10", weight: (s) => (s.hasAiReview ? 7 : 0) },
  { id: "q11", weight: (s) => (s.hasAiReview ? 7 : 0) },
  { id: "q26", weight: (s) => (s.hasAnyDocuments ? 7 : 0) },
  { id: "q32", weight: (s) => (s.multiProperty ? 7 : 0) },
  { id: "q52", weight: (s) => (s.multiProperty ? 7 : 0) },
  { id: "q42", weight: (s) => (s.propertyCount > 0 ? 7 : 0) },
  { id: "q4", weight: (s) => (s.propertyCount > 0 ? 6 + (s.hasNoticeUpload ? 2 : 0) : 0) },
  { id: "q27", weight: (s) => (s.hasAnyDocuments ? 6 + (s.hasEvidenceModule ? 2 : 0) : 0) },
  { id: "q48", weight: (s) => (s.propertyCount > 0 ? 6 : 0) },
  { id: "q30", weight: (s) => (s.multiProperty ? 6 : 0) },
  { id: "q40", weight: (s) => (s.hasAiReview ? 5 : 0) },
  { id: "q16", weight: (s) => (s.hasComps ? 5 : 0) },
  { id: "q38", weight: (s) => (s.propertyCount > 0 ? 4 : 0) },
  { id: "q33", weight: (s) => (s.propertyCount > 0 ? 4 : 0) },
];

const QUESTION_BY_ID = new Map<string, Question>();
for (const section of SECTIONS) {
  for (const q of section.questions) QUESTION_BY_ID.set(q.id, q);
}

// A question with an inline follow-up can show two prompts, so it costs two
// against the cap — the tester never sees more than MAX_QUESTIONS.
const cost = (id: string) => (QUESTION_BY_ID.get(id)?.followUp ? 2 : 1);

export function selectQuestionIds(signals: UsageSignals): string[] {
  const picked = new Set(CORE_IDS);
  let used = CORE_IDS.reduce((n, id) => n + cost(id), 0);
  const ranked = CANDIDATES.map((c, order) => ({ id: c.id, order, w: c.weight(signals) }))
    .filter((c) => c.w > 0 && QUESTION_BY_ID.has(c.id))
    .sort((a, b) => b.w - a.w || a.order - b.order);
  for (const c of ranked) {
    if (used + cost(c.id) > MAX_QUESTIONS) continue;
    picked.add(c.id);
    used += cost(c.id);
  }
  return [...picked];
}

// Keeps only ids that still exist in the bank; empty means "no usable saved
// selection".
export function validQuestionIds(ids: unknown): string[] {
  return Array.isArray(ids)
    ? ids.filter((id): id is string => typeof id === "string" && QUESTION_BY_ID.has(id))
    : [];
}

// The pages the tester actually pages through: the chosen questions in
// question-bank order (so the flow still reads first-impression → closing),
// grouped PAGE_SIZE at a time. lockedIds is the selection saved on their
// first visit, so a resumed form never reshuffles under them.
export function visibleSections(signals: UsageSignals, lockedIds?: string[]): Section[] {
  const locked = validQuestionIds(lockedIds);
  const ids = new Set(locked.length > 0 ? locked : selectQuestionIds(signals));
  const ordered = SECTIONS.flatMap((s) => s.questions).filter((q) => ids.has(q.id));
  const pages: Section[] = [];
  for (let i = 0; i < ordered.length; i += PAGE_SIZE) {
    pages.push({
      key: `page_${pages.length + 1}`,
      title: "",
      showIf: () => true,
      questions: ordered.slice(i, i + PAGE_SIZE),
    });
  }
  const last = pages.length - 1;
  pages.forEach((p, i) => {
    p.title =
      pages.length === 1
        ? "Your Corvus experience"
        : i === 0
          ? "Your experience so far"
          : i === last
            ? "Wrapping up"
            : "Going a little deeper";
  });
  return pages;
}
