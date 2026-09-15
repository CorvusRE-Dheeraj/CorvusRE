import { supabase } from "./supabase";
import { getHealthScore } from "./ai-health-score";
import type { PropertyRecord } from "./properties";

export type PropertyAiScore = {
  score: number;
  summary: string;
  factors: string[];
};

// Fire-and-forget, called right after a genuinely new property is saved (see
// addProperty() in ./properties). Never throws — a failed/slow AI call shouldn't
// affect the property-add flow itself, same posture as the staff-notification
// email in requestProtest(). The score simply won't appear until a later visit.
// Returns the computed score (or null on failure) so callers that DO want it —
// e.g. useHealthScoreBackfill — don't need a second round trip to read it back.
export async function computeAndStoreHealthScore(
  property: PropertyRecord,
): Promise<PropertyAiScore | null> {
  try {
    const result = await getHealthScore({
      address: property.address,
      cad: property.cad ?? undefined,
      propertyType: property.propertyType ?? undefined,
      landValue: property.landValue ?? undefined,
      improvementValue: property.improvementValue ?? undefined,
      totalValue: property.totalValue ?? undefined,
      taxYear: property.taxYear ?? undefined,
    });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    // property_ai_scores' summary/factors columns predate Module 1's richer
    // rebuild (see ai-report.tsx/ai-health-score) — executiveConclusion and
    // factorsIncreasing are each real fields from the same result, just
    // stored under this table's original narrower column names rather than
    // widening its schema for a background dashboard score nothing else reads.
    const summary = result.executiveConclusion;
    const factors = result.factorsIncreasing;
    const { error } = await supabase.from("property_ai_scores").insert({
      property_id: property.id,
      user_id: user.id,
      score: result.score,
      summary,
      factors,
    });
    if (error) throw error;
    return { score: result.score, summary, factors };
  } catch (err) {
    console.error("Background AI health score failed:", err);
    return null;
  }
}

export async function listHealthScores(userId: string): Promise<Record<string, PropertyAiScore>> {
  const { data, error } = await supabase
    .from("property_ai_scores")
    .select("property_id, score, summary, factors")
    .eq("user_id", userId)
    .order("computed_at", { ascending: false });
  if (error) throw error;
  const byProperty: Record<string, PropertyAiScore> = {};
  for (const row of data as {
    property_id: string;
    score: number;
    summary: string;
    factors: string[];
  }[]) {
    if (byProperty[row.property_id]) continue; // keep the most recent (already ordered desc)
    byProperty[row.property_id] = { score: row.score, summary: row.summary, factors: row.factors };
  }
  return byProperty;
}
