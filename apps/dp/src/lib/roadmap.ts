// Permitting roadmap / dependency sequencing (PRD 1.1.15 / 2.1.7).
import type { PermitItem } from "./permits";

export type RoadmapPhase = {
  order: number;
  title: string;
  permits: PermitItem[];
  /** permits from earlier phases that gate this one */
  prerequisites: string[];
  parallel: boolean;
};

// Topological grouping: each phase contains every permit whose dependencies are
// all satisfied by earlier phases. Permits within a phase run in parallel.
export function buildRoadmap(permits: PermitItem[]): RoadmapPhase[] {
  const byId = new Map(permits.map((p) => [p.id, p]));
  const placed = new Set<string>();
  const phases: RoadmapPhase[] = [];
  let guard = 0;

  while (placed.size < permits.length && guard++ < 20) {
    const ready = permits.filter(
      (p) => !placed.has(p.id) && p.dependsOn.every((d) => placed.has(d) || !byId.has(d)),
    );
    if (ready.length === 0) {
      // dependency cycle / dangling ref — dump the rest into a final phase
      const rest = permits.filter((p) => !placed.has(p.id));
      phases.push({
        order: phases.length + 1,
        title: phaseTitle(rest),
        permits: rest,
        prerequisites: [],
        parallel: rest.length > 1,
      });
      rest.forEach((p) => placed.add(p.id));
      break;
    }
    const prereq = new Set<string>();
    ready.forEach((p) => p.dependsOn.forEach((d) => prereq.add(d)));
    phases.push({
      order: phases.length + 1,
      title: phaseTitle(ready),
      permits: ready,
      prerequisites: [...prereq],
      parallel: ready.length > 1,
    });
    ready.forEach((p) => placed.add(p.id));
  }
  return phases;
}

function phaseTitle(permits: PermitItem[]): string {
  if (permits.length === 1) return permits[0].name;
  const cats = [...new Set(permits.map((p) => p.category))];
  if (cats.length === 1) return `${cats[0]} approvals`;
  return `${permits.map((p) => p.name.replace(/ Permit.*/, "")).join(" + ")}`;
}

export type RoadmapStatus = {
  totalPhases: number;
  completedPhases: number;
  currentPhase: string;
  nextStep: string;
  percentComplete: number;
};

export function roadmapStatus(phases: RoadmapPhase[], approvedPermitIds: string[]): RoadmapStatus {
  const approved = new Set(approvedPermitIds);
  let completed = 0;
  for (const phase of phases) {
    if (phase.permits.every((p) => approved.has(p.id))) completed += 1;
    else break;
  }
  const current = phases[completed];
  return {
    totalPhases: phases.length,
    completedPhases: completed,
    currentPhase: current ? current.title : "All phases complete",
    nextStep: current
      ? `Submit & clear ${current.permits.map((p) => p.name).join(", ")}`
      : "Proceed to pre-construction clearance",
    percentComplete: phases.length ? Math.round((completed / phases.length) * 100) : 0,
  };
}
