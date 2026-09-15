// Design brief generation (PRD 1.2.5 / 1.2.9 / 1.2.10 / 1.2.11).
import type { DesignRequirements, DesignScope } from "./dp-intake";
import { parseArea } from "./format";

export type DesignBrief = {
  inclusions: { title: string; detail: string }[];
  timeline: { phase: string; weeksMin: number; weeksMax: number; note: string }[];
  totalWeeksMin: number;
  totalWeeksMax: number;
  budgetLow: number;
  budgetHigh: number;
  /** design fee split by discipline (PRD 1.2.10.A) */
  costBreakdown: { discipline: string; low: number; high: number }[];
  /** rough total constructed cost, separate from design fees */
  buildCostLow: number;
  buildCostHigh: number;
  costDrivers: string[];
  spacePlan: { zone: string; note: string }[];
  recommendations: string[];
  /** suggested delivery approaches (PRD 1.2.12.A) */
  approaches: { name: string; summary: string; bestWhen: string }[];
};

const SCOPE_LABEL: Record<DesignScope, string> = {
  new_construction: "New Construction",
  addition: "Addition",
  remodeling: "Remodeling",
  interior_fit_out: "Interior Fit-Out",
};

export function scopeLabel(s: DesignScope | undefined): string {
  return s ? SCOPE_LABEL[s] : "Project";
}

export function generateDesignBrief(req: DesignRequirements): DesignBrief {
  const sf = parseArea(req.buildingArea) ?? 8000;
  const floors = Math.max(1, parseInt(req.floors ?? "1", 10) || 1);
  const sector = req.sector ?? "commercial";
  const scope = req.scope ?? "new_construction";

  const full = scope === "new_construction" || scope === "addition";

  const inclusions = [
    {
      title: "Survey & Platting",
      detail: "Boundary/topographic survey coordination and platting support.",
    },
    {
      title: "Site Plan & Landscape",
      detail: "Site layout, parking, access, grading concept, and landscape layout.",
    },
    {
      title: "Civil Design",
      detail: "Drainage, detention, and utility routing (water, wastewater, storm).",
    },
    { title: "Architectural", detail: "Floor plans, elevations, sections, and code analysis." },
    { title: "Structural", detail: "Foundation and superstructure design, sealed." },
    { title: "MEP", detail: "Mechanical, electrical, and plumbing design, sealed." },
  ].filter((row) => full || !["Survey & Platting", "Civil Design"].includes(row.title));

  // $/sf design-fee bands (all disciplines) scale down slightly with size.
  const feeBand = sector === "commercial" ? [6, 12] : [5, 10];
  const sizeFactor = sf > 40000 ? 0.8 : sf > 15000 ? 0.9 : 1;
  const budgetLow = Math.round(sf * feeBand[0] * sizeFactor);
  const budgetHigh = Math.round(sf * feeBand[1] * sizeFactor);

  // Split the design fee across disciplines (rough industry proportions).
  const split: [string, number][] = full
    ? [
        ["Architectural", 0.4],
        ["Structural", 0.15],
        ["MEP", 0.22],
        ["Civil", 0.15],
        ["Survey & Landscape", 0.08],
      ]
    : [
        ["Architectural", 0.62],
        ["Structural", 0.12],
        ["MEP", 0.26],
      ];
  const costBreakdown = split.map(([discipline, pct]) => ({
    discipline,
    low: Math.round(budgetLow * pct),
    high: Math.round(budgetHigh * pct),
  }));

  // Rough constructed cost, independent of the design fee.
  const buildBand = sector === "commercial" ? [180, 320] : [150, 270];
  const buildCostLow = Math.round(sf * buildBand[0]);
  const buildCostHigh = Math.round(sf * buildBand[1]);

  const timeline = [
    {
      phase: "Concept design",
      weeksMin: 2,
      weeksMax: 3,
      note: "Initial layout & planning options for review.",
    },
    {
      phase: "Design development",
      weeksMin: 3,
      weeksMax: 5,
      note: "Refinement with engineering coordination.",
    },
    {
      phase: "Final / permit drawings",
      weeksMin: 3,
      weeksMax: 6,
      note: "Permit-ready coordinated set (Plat + Arch + MEP + Structural + Civil).",
    },
  ];
  if (full && floors >= 2) {
    timeline[1].weeksMax += 2;
    timeline[2].weeksMax += 2;
  }
  const totalWeeksMin = timeline.reduce((n, t) => n + t.weeksMin, 0);
  const totalWeeksMax = timeline.reduce((n, t) => n + t.weeksMax, 0);

  return {
    inclusions,
    timeline,
    totalWeeksMin,
    totalWeeksMax,
    budgetLow,
    budgetHigh,
    costBreakdown,
    buildCostLow,
    buildCostHigh,
    approaches: [
      {
        name: "Standard",
        summary: "One coordinated pass through concept → development → permit set.",
        bestWhen:
          "Schedule matters and the program is well defined — fastest and most cost-effective.",
      },
      {
        name: "Custom",
        summary: "Extra concept iterations and design study before locking the direction.",
        bestWhen: "Signature building, unusual site, or the program is still being shaped.",
      },
      {
        name: "Phased",
        summary: "Split the fee and scope into stages, each authorized on its own.",
        bestWhen: "Budget or entitlement uncertainty — stop or adjust between stages.",
      },
    ],
    costDrivers: [
      "Size — larger buildings raise total fee but lower the $/sf rate.",
      "Quality — standard vs. premium finishes and envelope.",
      "Complexity — more systems, irregular geometry, or special-use requirements.",
      floors >= 2
        ? "Multi-story — added structural and vertical-transport coordination."
        : "Single story keeps structural coordination straightforward.",
    ],
    spacePlan: buildSpacePlan(req),
    recommendations: [
      full
        ? "Standard approach recommended — fastest and most cost-effective for this scope."
        : "Interior/remodel scope suits a phased design to align with tenant or budget timing.",
      "Run a code review early to lock occupancy, construction type, and egress before design development.",
      "Coordinate with the CorvusDP permitting workspace so site constraints feed the design set.",
    ],
  };
}

function buildSpacePlan(req: DesignRequirements): { zone: string; note: string }[] {
  const rooms = (req.rooms ?? "")
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (rooms.length) {
    return rooms.map((r) => ({
      zone: r,
      note: "Sized and adjacency-planned in full space planning.",
    }));
  }
  return [
    { zone: "Entry / reception", note: "Public-facing arrival and wayfinding." },
    { zone: "Primary program area", note: "Core function per your stated use." },
    { zone: "Support / back-of-house", note: "Storage, mechanical, staff areas." },
    {
      zone: "Restrooms & accessibility",
      note: "Code-required fixture counts and accessible routes.",
    },
  ];
}
