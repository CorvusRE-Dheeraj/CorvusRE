// Typed client wrappers around CorvusDP's AI Edge Functions
// (supabase/functions/ai-*). Every call goes through invokeEdgeFunction,
// which already retries a transient 429/504 with backoff — see
// src/lib/edge-functions.ts.
import { invokeEdgeFunction } from "./edge-functions";
import type { JurisdictionInfo } from "./jurisdiction";
import type { ZoningClassification, FeasibilityResult } from "./zoning";
import type { PermitItem, ComplexitySummary } from "./permits";
import type { SiteConstraints } from "./constraints";

export type FeasibilitySummary = {
  narrative: string;
  keyRisks: string[];
  recommendedNextStep: string;
};

export async function generateFeasibilitySummary(input: {
  address?: string;
  city?: string;
  county?: string;
  state?: string;
  intent?: string;
  sector?: string;
  zoning: ZoningClassification;
  feasibility: FeasibilityResult;
  permits: Pick<PermitItem, "name" | "category">[];
  complexity: ComplexitySummary;
  constraints: Pick<SiteConstraints, "criticalWarnings" | "utilities">;
}): Promise<FeasibilitySummary> {
  return invokeEdgeFunction<FeasibilitySummary>("ai-feasibility-summary", input);
}

export type DesignNarrative = {
  scopeSummary: string;
  narrative: string;
  designConsiderations: string[];
};

export async function generateDesignNarrative(input: {
  scope?: string;
  sector?: string;
  approxSiteArea?: string;
  buildingArea?: string;
  floors?: string;
  rooms?: string;
  functionalRequirements?: string;
  specialRequirements?: string;
  inclusions: { title: string; detail: string }[];
  budgetLow: number;
  budgetHigh: number;
  timelineWeeksMin: number;
  timelineWeeksMax: number;
  costDrivers: string[];
}): Promise<DesignNarrative> {
  return invokeEdgeFunction<DesignNarrative>("ai-design-narrative", input);
}

export type TranslatedReviewComment = {
  plainLanguage: string;
  whyItMatters: string;
  requiredAction: string;
  responsible: string;
  priority: "low" | "medium" | "high" | "critical";
};

export async function translateReviewComment(input: {
  comment: string;
  permitName?: string;
  jurisdiction?: string;
}): Promise<TranslatedReviewComment> {
  return invokeEdgeFunction<TranslatedReviewComment>("ai-translate-review-comment", input);
}

export type ChatMessage = { role: "user" | "assistant"; content: string };

// Deliberately loose/partial — this is a small, non-sensitive summary built
// from data the current page already has in memory (never a fresh DB
// query), so the assistant can ground answers without the Edge Function
// touching the database itself.
export type AssistantProjectContext = Partial<{
  track: "permitting" | "design" | "construction";
  address: string;
  city: string;
  county: string;
  state: string;
  jurisdiction: Pick<JurisdictionInfo, "level" | "authority">;
  zoningCode: string;
  feasibilityStatus: string;
  permitCount: number;
  permitNames: string[];
  complexityLevel: string;
  designScope: string;
  checklistProgress: string;
}>;

export async function askAssistant(
  messages: ChatMessage[],
  context?: AssistantProjectContext,
): Promise<string> {
  const { reply } = await invokeEdgeFunction<{ reply: string }>("ai-assistant", {
    messages,
    context: context ?? {},
  });
  return reply;
}
