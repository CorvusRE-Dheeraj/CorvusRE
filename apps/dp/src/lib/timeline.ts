// Timeline estimation + scenario comparison (PRD 1.1.18 / 1.1.18.A / 2.x).
import type { PermitItem } from "./permits";
import type { ComplexitySummary } from "./permits";
import type { JurisdictionInfo } from "./jurisdiction";
import { buildRoadmap } from "./roadmap";

export type TimelinePhase = {
  name: string;
  weeksMin: number;
  weeksMax: number;
};

export type TimelineEstimate = {
  phases: TimelinePhase[];
  totalWeeksMin: number;
  totalWeeksMax: number;
  assumptions: string[];
};

export function estimateTimeline(input: {
  permits: PermitItem[];
  complexity: ComplexitySummary;
  jurisdiction: JurisdictionInfo;
}): TimelineEstimate {
  const { permits, complexity, jurisdiction } = input;
  const roadmap = buildRoadmap(permits);
  const [firstLow, firstHigh] = jurisdiction.firstReviewWeeks;
  const cycles = complexity.estimatedReviewCycles;

  // Each roadmap phase = one review + one resubmission cycle, phases run in
  // series (later phases depend on earlier). Resubmission cycles are shorter.
  const phases: TimelinePhase[] = [
    { name: "Pre-application & due diligence", weeksMin: 3, weeksMax: 8 },
    ...roadmap.map((phase) => ({
      name: `${phase.title} — review`,
      weeksMin: firstLow + (cycles - 1) * 2,
      weeksMax: firstHigh + (cycles - 1) * 4,
    })),
    { name: "Permit issuance & pre-construction clearance", weeksMin: 1, weeksMax: 3 },
  ];

  const totalWeeksMin = phases.reduce((n, p) => n + p.weeksMin, 0);
  const totalWeeksMax = phases.reduce((n, p) => n + p.weeksMax, 0);

  return {
    phases,
    totalWeeksMin,
    totalWeeksMax,
    assumptions: [
      `${jurisdiction.authority} first-cycle plan review assumed at ${firstLow}–${firstHigh} weeks.`,
      `${cycles} review cycle${cycles === 1 ? "" : "s"} assumed based on ${complexity.level.toLowerCase()} complexity.`,
      "Assumes a complete first submittal and responsive design team.",
      "Does not include rezoning, variance, or platting hearings if separately required.",
    ],
  };
}

export type Scenario = {
  label: string;
  totalWeeksMin: number;
  totalWeeksMax: number;
  feeTotalLow: number;
  feeTotalHigh: number;
  complexity: string;
};

export function compareScenarios(
  a: Scenario,
  b: Scenario,
): {
  weeksDeltaMin: number;
  weeksDeltaMax: number;
  feeDeltaLow: number;
  feeDeltaHigh: number;
} {
  return {
    weeksDeltaMin: b.totalWeeksMin - a.totalWeeksMin,
    weeksDeltaMax: b.totalWeeksMax - a.totalWeeksMax,
    feeDeltaLow: b.feeTotalLow - a.feeTotalLow,
    feeDeltaHigh: b.feeTotalHigh - a.feeTotalHigh,
  };
}
