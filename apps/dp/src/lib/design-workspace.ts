// The Design track's workspace pages (Site Data, Checklist, Roadmap,
// Timeline) — the design-side counterparts of the permitting dashboard tabs.
// Everything here is derived deterministically from the saved design request
// and its brief; nothing is invented. Site data reuses the permitting
// analysis engine on the design request's own location, so both tracks read
// the same jurisdiction, utilities, and constraints for a property.
import { emptyIntake, type DpIntakeState, type ProjectIntent } from "./dp-intake";
import { runPermittingAnalysis, type PermittingAnalysis } from "./analysis";
import type { DesignBrief } from "./design";
import { DESIGN_STAGES, type DesignRequestRow, type DesignStage } from "./design-requests";

const SCOPE_TO_INTENT: Record<string, ProjectIntent> = {
  new_construction: "new_construction",
  addition: "addition",
  remodeling: "remodeling",
  // An interior fit-out is permitted as a remodel.
  interior_fit_out: "remodeling",
};

export function designSiteAnalysis(
  dr: DesignRequestRow,
): Pick<PermittingAnalysis, "jurisdiction" | "zoning" | "constraints" | "preAppMeeting"> {
  const base = emptyIntake();
  const intake: DpIntakeState = {
    ...base,
    property: {
      address: dr.address ?? undefined,
      city: dr.city ?? undefined,
      county: dr.county ?? undefined,
      state: "TX",
    },
    project: {
      ...base.project,
      intent: SCOPE_TO_INTENT[dr.scope ?? ""] ?? "new_construction",
      sector: dr.sector === "residential" ? "residential" : "commercial",
      lotSize: dr.site_area ?? undefined,
      buildingArea: dr.building_area ?? undefined,
      floors: dr.floors ?? undefined,
    },
  };
  const a = runPermittingAnalysis(intake);
  return {
    jurisdiction: a.jurisdiction,
    zoning: a.zoning,
    constraints: a.constraints,
    preAppMeeting: a.preAppMeeting,
  };
}

// Whole-design scope = new construction or an addition (survey, platting and
// civil are part of the job); otherwise it's an interior/remodel scope.
export function isFullScope(dr: Pick<DesignRequestRow, "scope">): boolean {
  return dr.scope === "new_construction" || dr.scope === "addition" || !dr.scope;
}

// Fee lines that aren't engineering disciplines to coordinate.
const NOT_ENGINEERING = new Set(["Architectural", "Survey & Landscape"]);

function stageIndex(stage: string): number {
  return DESIGN_STAGES.indexOf(stage as DesignStage);
}

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

export type DesignChecklistItem = {
  key: string;
  label: string;
  group: string;
  /** Set from the request itself (approval, consultation, stage) — not toggleable. */
  auto?: boolean;
  done: boolean;
};

export const DESIGN_CHECKLIST_GROUPS = [
  "Before design starts",
  "Concept design",
  "Design development",
  "Permit set",
] as const;

export function designChecklist(dr: DesignRequestRow, b: DesignBrief): DesignChecklistItem[] {
  const full = isFullScope(dr);
  const done = new Set(dr.checklist_done ?? []);
  const at = stageIndex(dr.stage);
  const reached = (s: DesignStage) => at >= stageIndex(s);
  const disciplines = b.costBreakdown.map((c) => c.discipline);

  const items: Omit<DesignChecklistItem, "done">[] = [
    {
      key: "approve_brief",
      label: "Approve the design brief",
      group: "Before design starts",
      auto: true,
    },
    {
      key: "consultation",
      label: "Request the initial consultation call",
      group: "Before design starts",
      auto: true,
    },
    { key: "program", label: "Confirm the room list and program", group: "Before design starts" },
    { key: "budget", label: "Confirm budget and target schedule", group: "Before design starts" },
    ...(full
      ? [
          {
            key: "survey",
            label: "Provide an existing survey, or authorize a new boundary/topographic survey",
            group: "Before design starts",
          },
        ]
      : [
          {
            key: "as_built",
            label: "Share existing drawings or as-builts of the space",
            group: "Before design starts",
          },
        ]),
    { key: "concept_review", label: "Review the concept layouts", group: "Concept design" },
    { key: "concept_pick", label: "Choose a planning option to develop", group: "Concept design" },
    {
      key: "code_review",
      label: "Code review — occupancy, construction type, and egress locked",
      group: "Design development",
    },
    { key: "selections", label: "Finish and system selections made", group: "Design development" },
    {
      key: "coordination",
      label: `Engineering coordinated (${disciplines.filter((d) => !NOT_ENGINEERING.has(d)).join(", ")})`,
      group: "Design development",
    },
    ...b.inclusions.map((i) => ({
      key: `sealed_${i.title.toLowerCase().replace(/[^a-z]+/g, "_")}`,
      label: `${i.title} drawings complete`,
      group: "Permit set",
    })),
    ...(full ? [{ key: "plat", label: "Plat prepared for filing", group: "Permit set" }] : []),
    {
      key: "handoff",
      label: "Permit set handed off to the permitting workspace",
      group: "Permit set",
    },
  ];

  const autoDone: Record<string, boolean> = {
    approve_brief: !!dr.approved_at,
    consultation: !!dr.consultation_requested_at,
  };
  return items.map((i) => ({
    ...i,
    done: i.auto
      ? !!autoDone[i.key]
      : done.has(i.key) ||
        // Staff moving the request past a stage means that stage's work is done.
        (i.group === "Concept design" && reached("development")) ||
        (i.group === "Design development" && reached("final_drawings")) ||
        (i.group === "Permit set" && reached("completed")),
  }));
}

// ---------------------------------------------------------------------------
// Roadmap
// ---------------------------------------------------------------------------

export type RoadmapStatus = "done" | "current" | "upcoming";

export type DesignRoadmapStep = {
  key: string;
  title: string;
  detail: string;
  /** Titles of the steps this one waits on. */
  after: string[];
  /** Work that runs alongside this step. */
  parallel?: string;
  status: RoadmapStatus;
};

export function designRoadmap(dr: DesignRequestRow, b: DesignBrief): DesignRoadmapStep[] {
  const full = isFullScope(dr);
  const at = stageIndex(dr.stage);
  const status = (doneFrom: DesignStage, currentAt: DesignStage[]): RoadmapStatus =>
    at >= stageIndex(doneFrom)
      ? "done"
      : currentAt.some((s) => s === dr.stage)
        ? "current"
        : "upcoming";
  const engineering = b.costBreakdown
    .map((c) => c.discipline)
    .filter((d) => !NOT_ENGINEERING.has(d))
    .join(", ");

  const steps: DesignRoadmapStep[] = [
    {
      key: "brief",
      title: "Approve the brief",
      detail: "Scope, fee basis, and schedule agreed so the design team can be engaged.",
      after: [],
      status: status("approved", ["brief"]),
    },
  ];
  if (full) {
    steps.push({
      key: "survey",
      title: "Survey & platting",
      detail:
        "Boundary and topographic survey and easement research — the base every site and civil drawing is built on.",
      after: ["Approve the brief"],
      parallel: "Runs alongside concept design.",
      status: status("development", ["approved", "concept"]),
    });
  }
  steps.push(
    {
      key: "concept",
      title: "Concept design",
      detail: "Layouts and planning options against your program and the site's constraints.",
      after: ["Approve the brief"],
      status: status("development", ["approved", "concept"]),
    },
    {
      key: "code",
      title: "Code review",
      detail: "Occupancy, construction type, and egress locked before the drawings are developed.",
      after: ["Concept design"],
      status: status("final_drawings", ["development"]),
    },
    {
      key: "development",
      title: "Design development",
      detail: `The chosen direction refined and coordinated across disciplines (${engineering}).`,
      after: full ? ["Code review", "Survey & platting"] : ["Code review"],
      parallel: "Architecture and engineering progress together.",
      status: status("final_drawings", ["development"]),
    },
    {
      key: "permit_set",
      title: "Final / permit set",
      detail: "A coordinated, sealed package ready for the city.",
      after: ["Design development"],
      status: status("completed", ["final_drawings"]),
    },
    {
      key: "permitting",
      title: "Submit for permits",
      detail: "The permit set moves to the permitting workspace for submission and review.",
      after: ["Final / permit set"],
      status: dr.stage === "completed" ? "current" : "upcoming",
    },
  );
  return steps;
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export type DesignSchedulePhase = {
  phase: string;
  note: string;
  weeksMin: number;
  weeksMax: number;
  /** Week offsets from the design start (earliest / latest). */
  startMin: number;
  startMax: number;
  endMin: number;
  endMax: number;
};

export function designSchedule(b: DesignBrief): DesignSchedulePhase[] {
  let min = 0;
  let max = 0;
  return b.timeline.map((t) => {
    const row = {
      ...t,
      startMin: min,
      startMax: max,
      endMin: min + t.weeksMin,
      endMax: max + t.weeksMax,
    };
    min = row.endMin;
    max = row.endMax;
    return row;
  });
}

export function addWeeks(iso: string, weeks: number): Date {
  const d = new Date(iso);
  d.setDate(d.getDate() + Math.round(weeks * 7));
  return d;
}
