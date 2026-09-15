import { invokeEdgeFunction } from "./edge-functions";
import { getComps, type CompProperty } from "./cad-comps";
import { computeComparableStats } from "./comps-analysis";
import type { PropertyRecord } from "./properties";
import type { ProtestRecord, AttendanceType } from "./protests";
import type { CountyProtestInfo } from "./county-protest-info";
import type { HearingNoticeRecord } from "./hearing-notice";
import type { EvidenceAnalysis } from "./protest-reason";

// A real, step-by-step ARB hearing prep guide — see
// hearing-prep-guide/index.ts for the prompt/discipline. Every number in
// it traces back to either the property's own real fields or the real
// comps this file computes below (same computeComparableStats() Module 3
// uses) — the edge function narrates around given numbers, it never
// invents its own.
export type HearingPrepGuide = {
  hearingSummary: string;
  evidencePacketNote: string;
  beforeHearing: {
    whatToReview: string[];
    documentsToHaveReady: string[];
    valueToRequest: string;
    keyEvidence: string[];
    howToOrganize: string;
    questionPrep: string;
  };
  duringHearing: {
    openingStatement: string;
    valueExplanation: string;
    comparableEvidencePresentation: string;
    conditionArguments: string;
    requestedValue: string;
    closingStatement: string;
  };
  propertySpecificArguments: string[];
  questionsToAsk: string[];
  questionsArbMayAsk: string[];
  weaknessesAndRisks: string[];
  documentsToHave: string[];
  submissionInstructions: string;
  countyContact: string;
  hearingLogistics: string;
  disclaimer: string;
};

// The real comps table this app can actually ground a hearing argument in
// — only ever populated for the counties getComps() has a real live source
// for (see cad-comps.ts); every other county gets available: false rather
// than a fabricated table.
export type HearingPrepComps = {
  available: boolean;
  indicated: { min: number; median: number; max: number } | null;
  valuationGapPct: number | null;
  confidencePct: number | null;
  ranked: { address: string; distanceMi: number; marketValue: number | null; similarity: number }[];
};

async function loadComps(property: PropertyRecord): Promise<HearingPrepComps> {
  try {
    const result = await getComps({
      cad: property.cad ?? undefined,
      accountNumber: property.accountNumber ?? undefined,
    });
    const subject: CompProperty | null = result.subject;
    if (!subject)
      return {
        available: false,
        indicated: null,
        valuationGapPct: null,
        confidencePct: null,
        ranked: [],
      };
    const stats = computeComparableStats(subject, result.comps, property.totalValue);
    if (!stats.indicated) {
      return {
        available: false,
        indicated: null,
        valuationGapPct: null,
        confidencePct: null,
        ranked: [],
      };
    }
    return {
      available: true,
      indicated: stats.indicated,
      valuationGapPct: stats.valuationGapPct,
      confidencePct: stats.confidencePct,
      ranked: stats.ranked.slice(0, 5).map((c) => ({
        address: c.address,
        distanceMi: c.distanceMi,
        marketValue: c.marketValue ?? null,
        similarity: c.similarity,
      })),
    };
  } catch {
    // No live comps source for this county, or the lookup failed — honest
    // absence, never a fabricated table.
    return {
      available: false,
      indicated: null,
      valuationGapPct: null,
      confidencePct: null,
      ranked: [],
    };
  }
}

export async function getHearingPrepGuide(
  property: PropertyRecord,
  protest: ProtestRecord,
  strategyRecommendation: string | null,
  strategyRationale: string | null,
  countyInfo: CountyProtestInfo | null,
  hearingNotice: HearingNoticeRecord | null,
  evidenceFileNames: string[],
  priorEvidenceAnalysis: EvidenceAnalysis | null,
): Promise<HearingPrepGuide> {
  const comps = await loadComps(property);

  return invokeEdgeFunction<HearingPrepGuide>("hearing-prep-guide", {
    caseContext: {
      address: property.address,
      cad: property.cad,
      accountNumber: property.accountNumber,
      taxYear: property.taxYear ?? protest.taxYear,
      propertyType: property.propertyType,
      totalValue: property.totalValue,
      landValue: property.landValue,
      improvementValue: property.improvementValue,
      strategyRecommendation,
      strategyRationale,
      originalValue: protest.originalValue,
    },
    hearingNotice: hearingNotice
      ? {
          hearingDate: hearingNotice.hearingDate,
          hearingTime: hearingNotice.hearingTime,
          hearingLocation: hearingNotice.hearingLocation,
          hearingMode: hearingNotice.hearingMode,
          hearingType: hearingNotice.hearingType,
          evidenceSubmissionDeadline: hearingNotice.evidenceSubmissionDeadline,
          submissionInstructions: hearingNotice.submissionInstructions,
          requiredDocuments: hearingNotice.requiredDocuments,
          countyContact: hearingNotice.countyContact,
          appraiserContact: hearingNotice.appraiserContact,
        }
      : null,
    countyReference: countyInfo
      ? { arbContact: countyInfo.arbContact, filingMethod: countyInfo.filingMethod }
      : null,
    evidence: {
      fileNames: evidenceFileNames,
      analysisSummary: priorEvidenceAnalysis?.summary ?? null,
      documentFindings: priorEvidenceAnalysis?.documentFindings ?? [],
    },
    comps,
    attendanceType: protest.attendanceType,
  });
}
