// City-specific submission checklists + pre-application checklist
// (PRD 1.1.10 / 1.1.13 / 2.1.12 / 2.1.17).
import type { PermitItem } from "./permits";
import type { JurisdictionInfo } from "./jurisdiction";

export type ChecklistItem = {
  label: string;
  group: "Drawings" | "Forms" | "Studies" | "Supporting" | "Fees" | "Authorization";
  required: boolean;
};

const BASE_FORMS: ChecklistItem[] = [
  { label: "Completed permit application form", group: "Forms", required: true },
  {
    label: "Owner authorization / agent-of-record letter (notarized)",
    group: "Authorization",
    required: true,
  },
  { label: "Contractor / design professional registration", group: "Forms", required: true },
  { label: "Application & plan-review fees", group: "Fees", required: true },
];

const BY_PERMIT: Record<string, ChecklistItem[]> = {
  plat: [
    { label: "Preliminary / final plat drawing (sealed)", group: "Drawings", required: true },
    { label: "Boundary & topographic survey", group: "Drawings", required: true },
    { label: "Title commitment / ownership evidence", group: "Supporting", required: true },
    { label: "Tax certificate (no delinquent taxes)", group: "Supporting", required: true },
    { label: "Traffic impact analysis", group: "Studies", required: false },
  ],
  site: [
    { label: "Site plan (dimensioned, sealed)", group: "Drawings", required: true },
    { label: "Grading & drainage plan", group: "Drawings", required: true },
    { label: "Landscape & tree-preservation plan", group: "Drawings", required: false },
    { label: "Drainage / detention study", group: "Studies", required: true },
    { label: "Photometric / site lighting plan", group: "Drawings", required: false },
  ],
  civil: [
    { label: "Utility plan & profile sheets (sealed)", group: "Drawings", required: true },
    { label: "Water & wastewater capacity letter", group: "Supporting", required: true },
    { label: "Downstream drainage assessment", group: "Studies", required: false },
  ],
  grading: [
    { label: "Erosion control plan / SWPPP", group: "Drawings", required: true },
    { label: "Cut / fill earthwork quantities", group: "Studies", required: true },
    { label: "Geotechnical report", group: "Studies", required: false },
  ],
  building: [
    { label: "Architectural drawings (sealed)", group: "Drawings", required: true },
    { label: "Structural drawings & calculations (sealed)", group: "Drawings", required: true },
    { label: "MEP drawings (sealed)", group: "Drawings", required: true },
    { label: "Energy code compliance (ComCheck / REScheck)", group: "Supporting", required: true },
    { label: "Accessibility (TAS / ADA) review submittal", group: "Supporting", required: false },
  ],
  fire: [
    { label: "Fire lane & hydrant exhibit", group: "Drawings", required: true },
    {
      label: "Sprinkler / alarm design (deferred submittal OK)",
      group: "Drawings",
      required: false,
    },
  ],
  utility: [
    { label: "Will-serve / service availability letters", group: "Supporting", required: true },
    { label: "Impact / capital recovery fee worksheet", group: "Fees", required: true },
  ],
  env: [
    { label: "FEMA floodplain determination / LOMR", group: "Studies", required: false },
    { label: "Environmental / water quality assessment", group: "Studies", required: false },
    { label: "Tree survey", group: "Drawings", required: false },
  ],
};

export function buildPermitChecklist(permit: PermitItem, _jur: JurisdictionInfo): ChecklistItem[] {
  return [
    ...BASE_FORMS,
    ...(BY_PERMIT[permit.id] ?? [
      {
        label: "Drawings / exhibits per department intake list",
        group: "Drawings",
        required: true,
      },
    ]),
  ];
}

// Design Responsibility Matrix (PRD 1.1.21) — who owns each deliverable in the
// permit package.
export type ResponsibilityRow = {
  requirement: string;
  consultant: string;
};

export function designResponsibilityMatrix(permits: PermitItem[]): ResponsibilityRow[] {
  const rows: ResponsibilityRow[] = [];
  const has = (id: string) => permits.some((p) => p.id === id);
  if (has("plat")) {
    rows.push({ requirement: "Boundary & topographic survey", consultant: "Land Surveyor" });
    rows.push({
      requirement: "Plat drawing & metes/bounds",
      consultant: "Land Surveyor / Civil Engineer",
    });
    rows.push({
      requirement: "Title commitment & tax certificate",
      consultant: "Owner / Title company",
    });
  }
  if (has("site") || has("civil") || has("grading")) {
    rows.push({ requirement: "Site plan & dimensional control", consultant: "Civil Engineer" });
    rows.push({
      requirement: "Grading, drainage & detention design",
      consultant: "Civil Engineer",
    });
    rows.push({ requirement: "Drainage / detention study", consultant: "Civil Engineer" });
    rows.push({ requirement: "SWPPP / erosion control", consultant: "Civil Engineer" });
    rows.push({
      requirement: "Landscape & tree preservation plan",
      consultant: "Landscape Architect",
    });
    rows.push({ requirement: "Site photometrics", consultant: "Electrical Engineer" });
  }
  if (has("building")) {
    rows.push({ requirement: "Architectural drawings & code analysis", consultant: "Architect" });
    rows.push({
      requirement: "Structural drawings & calculations",
      consultant: "Structural Engineer",
    });
    rows.push({ requirement: "MEP drawings", consultant: "MEP Engineer" });
    rows.push({
      requirement: "Energy code compliance (COMcheck)",
      consultant: "MEP Engineer / Architect",
    });
    rows.push({ requirement: "Accessibility (TAS/ADA) review", consultant: "Architect / RAS" });
  }
  if (has("fire")) {
    rows.push({ requirement: "Fire lane & hydrant exhibit", consultant: "Civil Engineer" });
    rows.push({
      requirement: "Sprinkler / alarm design (deferred)",
      consultant: "Fire Protection Engineer",
    });
  }
  if (has("utility")) {
    rows.push({
      requirement: "Will-serve / service availability letters",
      consultant: "Owner / Utility Consultant",
    });
    rows.push({ requirement: "Impact fee worksheet", consultant: "Civil Engineer" });
  }
  return rows;
}

export function checklistCompletion(items: { required: boolean; done?: boolean }[]): number {
  const req = items.filter((i) => i.required);
  if (req.length === 0) return 0;
  return Math.round((req.filter((i) => i.done).length / req.length) * 100);
}

export type PreAppItem = { label: string; required: boolean };

// Pre-application meeting agenda + what to bring (PRD 1.1.14).
export type PreAppMeeting = {
  agenda: string[];
  bring: string[];
  questionsToAsk: string[];
};

export function preApplicationMeeting(jur: JurisdictionInfo, permits: PermitItem[]): PreAppMeeting {
  const hasPlat = permits.some((p) => p.id === "plat");
  return {
    agenda: [
      "Introduce the project: location, use, size, and intended schedule.",
      "Confirm zoning classification, overlays, and whether the use is permitted by right.",
      `Confirm the ${jur.authority} submittal path and which departments review which permits.`,
      "Review required studies (drainage, traffic, environmental) and known site constraints.",
      hasPlat
        ? "Confirm platting status, required dedications, and whether it can run parallel with civil."
        : "Confirm the site plan vs. building permit submittal sequence.",
      "Identify impact / capital-recovery fees and when they are due.",
      "Agree on next steps and the point of contact on each side.",
    ],
    bring: [
      "Project summary sheet (address, parcel ID, use, building area, floors)",
      "Concept site plan or bubble diagram",
      "Aerial / location exhibit",
      "Preliminary utility availability information",
      "List of your design team of record (Architect, Civil, Structural, MEP)",
      "Written list of questions",
    ],
    questionsToAsk: [
      "Is a pre-application or Development Review Committee meeting required or optional?",
      "Current first-review turnaround, and how many cycles are typical for this project type?",
      "Any moratoria, pending code changes, or utility capacity issues affecting this site?",
      "Which items can be deferred submittals (e.g. sprinkler / alarm)?",
    ],
  };
}

export function preApplicationChecklist(
  jur: JurisdictionInfo,
  permits: PermitItem[],
): PreAppItem[] {
  const items: PreAppItem[] = [
    { label: `Request a pre-application meeting with ${jur.authority}`, required: true },
    { label: "Confirm zoning classification & overlay districts in writing", required: true },
    {
      label: "Obtain utility service availability letters (water / wastewater / power)",
      required: true,
    },
    { label: "Order boundary & topographic survey", required: true },
    { label: "Confirm required studies (drainage, traffic, environmental)", required: true },
    { label: "Assemble owner authorization & entity documents", required: true },
    { label: "Budget for application, impact, and review fees", required: true },
    { label: "Identify design team of record (Architect, Civil, Structural, MEP)", required: true },
  ];
  if (permits.some((p) => p.id === "plat")) {
    items.push({ label: "Confirm platting status & any required dedications", required: true });
  }
  if (permits.some((p) => p.id === "env")) {
    items.push({ label: "Order environmental / floodplain determination", required: false });
  }
  return items;
}
