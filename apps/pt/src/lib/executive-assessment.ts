// Module 10's final assessment: the AI's recommendedAction folded into one of
// three colour-coded tiers, and one protest-readiness status with the single
// most important outstanding requirement. Pure and deterministic — the
// screen and the downloadable report both read from here.
import type { ModuleResultMap } from "./ai-report-modules";
import { isBlockingUnresolved, type PreFilingCheckItem } from "./pre-filing-check";

export type AssessmentTier = "recommended" | "review" | "limited";

export const ASSESSMENT_TIER: Record<AssessmentTier, { label: string; description: string }> = {
  recommended: {
    label: "Protest Recommended",
    description: "Available evidence supports pursuing a lower valuation.",
  },
  review: {
    label: "Further Review Recommended",
    description:
      "Potential opportunity exists, but important information is missing or evidence is inconclusive.",
  },
  limited: {
    label: "Limited Protest Opportunity",
    description: "Available evidence does not currently support a meaningful valuation reduction.",
  },
};

export function assessmentTier(
  action: ModuleResultMap["executive"]["recommendedAction"],
): AssessmentTier {
  if (action === "Proceed with Protest") return "recommended";
  if (action === "Limited Protest Opportunity Based on Available Information") return "limited";
  return "review";
}

export type ReadinessStatus = "ready" | "info_needed" | "deadline_review";

export const READINESS_LABEL: Record<ReadinessStatus, string> = {
  ready: "Ready to Proceed",
  info_needed: "Additional Information Needed",
  deadline_review: "Deadline / Filing Status Requires Review",
};

export type ProtestReadinessResult = {
  status: ReadinessStatus;
  // One sentence naming the most important outstanding requirement; null
  // when ready.
  requirement: string | null;
  // Which module resolves it, when one does.
  module: "evidence" | null;
};

const DEADLINE_ROWS = new Set(["Protest Deadline", "Tax Year"]);

export function getProtestReadiness(input: {
  // The property's own protest deadline (date-only "YYYY-MM-DD"), used when
  // there's no protest yet and so no Pre-Filing Check.
  protestDeadline: string | null;
  preFilingItems: PreFilingCheckItem[] | null;
  evidenceItems: {
    item: string;
    priority?: string;
    status?: string;
    importance: string;
    availability: string;
  }[];
  missingInformation: { item: string; severity: string }[];
  today?: Date;
}): ProtestReadinessResult {
  const today = input.today ?? new Date();
  const startOfToday = new Date(today);
  startOfToday.setHours(0, 0, 0, 0);

  // 1. Deadline / filing status — a passed deadline or a tax-year mismatch.
  const deadlineRow = input.preFilingItems?.find(
    (i) => DEADLINE_ROWS.has(i.label) && i.status === "needs_review",
  );
  if (deadlineRow) {
    return { status: "deadline_review", requirement: deadlineRow.issue ?? null, module: null };
  }
  if (!input.preFilingItems && input.protestDeadline) {
    const d = new Date(`${input.protestDeadline}T12:00:00`);
    if (!Number.isNaN(d.getTime()) && d < startOfToday) {
      return {
        status: "deadline_review",
        requirement: `The protest deadline on file (${d.toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        })}) has passed — confirm the correct date or whether a late-protest reason applies.`,
        module: null,
      };
    }
  }

  // 2. Missing filing identity (county, account, owner, deadline …).
  const blocking = input.preFilingItems?.find(isBlockingUnresolved);
  if (blocking) {
    return {
      status: "info_needed",
      requirement: blocking.issue ?? `${blocking.label} is missing from the property record.`,
      module: null,
    };
  }

  // 3. Critical evidence still missing.
  const criticalEvidence = input.evidenceItems.find((i) =>
    i.priority
      ? i.priority === "Critical" && i.status === "Missing"
      : i.importance === "High" && i.availability === "Low",
  );
  if (criticalEvidence) {
    return {
      status: "info_needed",
      requirement: `Most important outstanding item: ${criticalEvidence.item}.`,
      module: "evidence",
    };
  }
  const criticalInfo = input.missingInformation.find((m) => m.severity === "Critical");
  if (criticalInfo) {
    return {
      status: "info_needed",
      requirement: `Most important outstanding item: ${criticalInfo.item.replace(/\.$/, "")}.`,
      module: null,
    };
  }

  return { status: "ready", requirement: null, module: null };
}
