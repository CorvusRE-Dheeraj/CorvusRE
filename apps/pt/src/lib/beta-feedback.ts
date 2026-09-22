import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";
import type { UsageSignals } from "./beta-feedback-questions";
import { ZERO_SIGNALS } from "./beta-feedback-questions";

export type { UsageSignals } from "./beta-feedback-questions";

// What the tester actually DID, read straight from their own data — this is
// what every section's showIf() in beta-feedback-questions.ts gates on.
// module_results.module_id === "executive" is the AI Review's own overall
// synthesis (see MODULE_SPECS in supabase-pt/functions/ai-report-modules),
// so its existence is as close as this app gets to "they generated a real
// AI Review," same for "comps" = they saw comparable properties.
export async function computeUsageSignals(userId: string): Promise<UsageSignals> {
  const [{ data: properties }, { data: documents }, { data: moduleResults }, { data: protests }] =
    await Promise.all([
      supabase.from("properties").select("id").eq("user_id", userId),
      supabase.from("documents").select("document_type, evidence_item_id").eq("user_id", userId),
      supabase.from("module_results").select("module_id").eq("user_id", userId),
      supabase
        .from("protests")
        .select("status, hearing_date, informal_review_date")
        .eq("user_id", userId),
    ]);

  const propertyCount = properties?.length ?? 0;
  const docs = documents ?? [];
  const modules = new Set((moduleResults ?? []).map((m) => m.module_id as string));
  const protestRows = protests ?? [];

  return {
    propertyCount,
    hasNoticeUpload: docs.some(
      (d) =>
        typeof d.document_type === "string" && d.document_type.toLowerCase().includes("notice"),
    ),
    hasAnyDocuments: docs.length > 0,
    hasAiReview: modules.has("executive") || modules.size > 0,
    hasComps: modules.has("comps"),
    hasEvidenceModule: modules.has("evidence") || docs.some((d) => d.evidence_item_id != null),
    hasProtest: protestRows.length > 0,
    protestAdvanced: protestRows.some(
      (p) =>
        p.status === "hearing_scheduled" ||
        p.status === "resolved" ||
        p.hearing_date != null ||
        p.informal_review_date != null,
    ),
    multiProperty: propertyCount > 1,
  };
}

export type FeedbackResponse = {
  id: string;
  userId: string;
  answers: Record<string, string | string[]>;
  sectionsShown: string[];
  usageSignals: UsageSignals;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type FeedbackRow = {
  id: string;
  user_id: string;
  answers: Record<string, string | string[]> | null;
  sections_shown: string[] | null;
  usage_signals: Partial<UsageSignals> | null;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
};

function fromRow(row: FeedbackRow): FeedbackResponse {
  return {
    id: row.id,
    userId: row.user_id,
    answers: row.answers ?? {},
    sectionsShown: row.sections_shown ?? [],
    usageSignals: { ...ZERO_SIGNALS, ...(row.usage_signals ?? {}) },
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export async function getMyFeedbackResponse(userId: string): Promise<FeedbackResponse | null> {
  const { data, error } = await supabase
    .from("beta_feedback_responses")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ? fromRow(data as FeedbackRow) : null;
}

// Autosaved after every section — a 7-10 minute form is exactly the kind
// that loses a tester for good if closing the tab loses their answers.
// Upserted (unique(user_id)), so a returning tester always resumes into
// their own single in-progress row rather than starting a duplicate.
export async function saveFeedbackProgress(
  userId: string,
  answers: Record<string, string | string[]>,
  sectionsShown: string[],
  signals: UsageSignals,
): Promise<void> {
  const { error } = await supabase.from("beta_feedback_responses").upsert(
    {
      user_id: userId,
      answers,
      sections_shown: sectionsShown,
      usage_signals: signals,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw error;
}

export async function submitFeedback(
  userId: string,
  answers: Record<string, string | string[]>,
  sectionsShown: string[],
  signals: UsageSignals,
): Promise<void> {
  const { error } = await supabase.from("beta_feedback_responses").upsert(
    {
      user_id: userId,
      answers,
      sections_shown: sectionsShown,
      usage_signals: signals,
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw error;
}

// ── Admin ──────────────────────────────────────────────────────────────

export type AdminFeedbackRow = FeedbackResponse & {
  email: string;
  firstName: string | null;
  lastName: string | null;
};

export async function listFeedbackResponses(): Promise<AdminFeedbackRow[]> {
  const { data, error } = await supabase
    .from("beta_feedback_responses")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  const rows = (data as FeedbackRow[]).map(fromRow);
  if (rows.length === 0) return [];

  const { data: profiles, error: profErr } = await supabase
    .from("profiles")
    .select("id, email, first_name, last_name")
    .in(
      "id",
      rows.map((r) => r.userId),
    );
  if (profErr) throw profErr;
  const profileById = new Map((profiles ?? []).map((p) => [p.id as string, p]));

  return rows.map((r) => {
    const p = profileById.get(r.userId);
    return {
      ...r,
      email: (p?.email as string) ?? "(unknown)",
      firstName: (p?.first_name as string | null) ?? null,
      lastName: (p?.last_name as string | null) ?? null,
    };
  });
}

export type FeedbackInsights = {
  painPoints: { theme: string; count: number; examples: string[] }[];
  featureRequests: { theme: string; count: number; examples: string[] }[];
  wouldMiss: { theme: string; count: number; examples: string[] }[];
};

export type FeedbackInsightsRecord = {
  insights: FeedbackInsights;
  responseCount: number;
  generatedAt: string;
};

export async function getFeedbackInsights(): Promise<FeedbackInsightsRecord | null> {
  const { data, error } = await supabase
    .from("beta_feedback_insights")
    .select("insights, response_count, generated_at")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    insights: data.insights as FeedbackInsights,
    responseCount: data.response_count as number,
    generatedAt: data.generated_at as string,
  };
}

// Clusters the free-text answers (pain points, magic-wand requests, "what
// would you miss") into themes via Gemini — see
// supabase-pt/functions/summarize-beta-feedback. Admin-triggered on demand
// (not automatic on every submission) since it re-reads every completed
// response each time; same "Regenerate with AI" pattern as the AI Report's
// own refresh button.
export async function regenerateFeedbackInsights(): Promise<FeedbackInsightsRecord> {
  return invokeEdgeFunction<FeedbackInsightsRecord>("summarize-beta-feedback", {});
}
