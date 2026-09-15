// Pure end-to-end analysis pipeline for the permitting track. Takes the intake
// state and produces every derived output the results page and the dashboard
// need. No I/O — fully unit-testable and safe to run on the static build.
import type { DpIntakeState } from "./dp-intake";
import { analyzeJurisdiction, type JurisdictionInfo } from "./jurisdiction";
import {
  classifyZoning,
  analyzeFeasibility,
  type ZoningClassification,
  type FeasibilityResult,
} from "./zoning";
import {
  identifyPermits,
  summarizeComplexity,
  type PermitItem,
  type ComplexitySummary,
} from "./permits";
import { mapAgencies, type AgencyAssignment } from "./agencies";
import { buildRoadmap, type RoadmapPhase } from "./roadmap";
import { estimateFees, type FeeEstimate } from "./fees";
import { estimateTimeline, type TimelineEstimate } from "./timeline";
import {
  preApplicationChecklist,
  preApplicationMeeting,
  designResponsibilityMatrix,
  type PreAppItem,
  type PreAppMeeting,
  type ResponsibilityRow,
} from "./checklist";
import { deriveSiteConstraints, type SiteConstraints } from "./constraints";
import { parseArea } from "./format";

export type PermittingAnalysis = {
  jurisdiction: JurisdictionInfo;
  zoning: ZoningClassification;
  feasibility: FeasibilityResult;
  permits: PermitItem[];
  complexity: ComplexitySummary;
  agencies: AgencyAssignment[];
  roadmap: RoadmapPhase[];
  fees: FeeEstimate;
  timeline: TimelineEstimate;
  preApp: PreAppItem[];
  preAppMeeting: PreAppMeeting;
  responsibilityMatrix: ResponsibilityRow[];
  constraints: SiteConstraints;
};

export function runPermittingAnalysis(intake: DpIntakeState): PermittingAnalysis {
  const { property, project } = intake;

  const isEtj = /etj/i.test(property.jurisdiction ?? "");
  const jurisdiction = analyzeJurisdiction({
    city: property.city,
    county: property.county,
    state: property.state,
    isEtj,
  });

  const zoning = classifyZoning(property.zoning);
  const feasibility = analyzeFeasibility({
    intent: project.intent,
    sector: project.sector,
    zoning,
  });

  const lotSizeSqft = parseArea(project.lotSize ?? property.approxSiteArea);
  const floors = project.floors ? parseInt(project.floors, 10) || null : null;

  const permits = identifyPermits({
    intent: project.intent,
    sector: project.sector,
    lotSizeSqft,
    floors,
  });
  const complexity = summarizeComplexity(permits);
  const agencies = mapAgencies(permits, jurisdiction);
  const roadmap = buildRoadmap(permits);
  const fees = estimateFees({
    permits,
    jurisdiction,
    buildingAreaSqft: parseArea(project.buildingArea),
    sector: project.sector,
  });
  const timeline = estimateTimeline({ permits, complexity, jurisdiction });
  const preApp = preApplicationChecklist(jurisdiction, permits);
  const constraints = deriveSiteConstraints({
    jurisdiction,
    zoning,
    intent: project.intent,
    lotSize: project.lotSize ?? property.approxSiteArea,
    isEtj,
  });

  return {
    jurisdiction,
    zoning,
    feasibility,
    permits,
    complexity,
    agencies,
    roadmap,
    fees,
    timeline,
    preApp,
    preAppMeeting: preApplicationMeeting(jurisdiction, permits),
    responsibilityMatrix: designResponsibilityMatrix(permits),
    constraints,
  };
}
