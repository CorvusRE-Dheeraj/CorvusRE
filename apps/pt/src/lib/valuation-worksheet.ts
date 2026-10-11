import { supabase } from "./supabase";
import type { ApproachId, Impairment } from "./commercial-valuation";

// The owner's Commercial Valuation inputs and the per-approach result they
// produced, saved per property (public.valuation_worksheets) so they follow
// the owner across devices and feed the evidence packet.

export type WorksheetInputs = {
  vacancyPct?: number | null;
  expenseRatioPct?: number | null;
  capRatePct?: number | null;
  costPerSqft?: number | null;
  economicLifeYears?: number;
  impairments?: Impairment[];
};

export type WorksheetSummary = {
  cadValue: number | null;
  approaches: {
    id: ApproachId;
    name: string;
    status: "indicated" | "needs_data" | "supports_cad";
    indicatedValue: number | null;
    steps: string[];
  }[];
  lowest: { name: string; value: number } | null;
  computedAt: string;
};

export type Worksheet = { inputs: WorksheetInputs; summary: WorksheetSummary | null };

export async function getValuationWorksheet(propertyId: string): Promise<Worksheet | null> {
  const { data, error } = await supabase
    .from("valuation_worksheets")
    .select("inputs, summary")
    .eq("property_id", propertyId)
    .maybeSingle();
  if (error) throw error;
  return data
    ? {
        inputs: (data.inputs ?? {}) as WorksheetInputs,
        summary: (data.summary ?? null) as WorksheetSummary | null,
      }
    : null;
}

export async function saveValuationWorksheet(
  userId: string,
  propertyId: string,
  inputs: WorksheetInputs,
  summary: WorksheetSummary,
): Promise<void> {
  const { error } = await supabase.from("valuation_worksheets").upsert(
    {
      property_id: propertyId,
      user_id: userId,
      inputs,
      summary,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "property_id" },
  );
  if (error) throw error;
}

// Every property's saved worksheet summary in one query — the dashboard's
// Corvus decision cards, keyed by property id.
export async function listValuationSummaries(
  propertyIds: string[],
): Promise<Map<string, WorksheetSummary>> {
  const out = new Map<string, WorksheetSummary>();
  if (propertyIds.length === 0) return out;
  const { data, error } = await supabase
    .from("valuation_worksheets")
    .select("property_id, summary")
    .in("property_id", propertyIds);
  if (error) throw error;
  for (const r of data ?? []) {
    if (r.summary) out.set(r.property_id as string, r.summary as WorksheetSummary);
  }
  return out;
}
