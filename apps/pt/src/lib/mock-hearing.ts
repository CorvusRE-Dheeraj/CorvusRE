import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";
import { loadComps } from "./hearing-prep";
import { getValuationWorksheet } from "./valuation-worksheet";
import { listCadEvidenceReviews, type StoredCadEvidenceReview } from "./cad-evidence-review";
import type { PropertyRecord } from "./properties";
import type { ProtestRecord } from "./protests";
import type {
  Debrief,
  Difficulty,
  Phase,
  SimContext,
  Turn,
} from "../../../../supabase/pt/functions/_shared/hearing-simulator";

export type { Debrief, Difficulty, Phase, SimContext, Turn };

export type MockHearing = {
  id: string;
  difficulty: Difficulty;
  transcript: Turn[];
  debrief: Debrief | null;
  createdAt: string;
};

// Everything the simulated district and panel may cite for this case — the
// county record, the comparables, the owner's valuation approaches and the
// district's own evidence once it's been reviewed. Nothing else.
export async function loadSimContext(
  property: PropertyRecord,
  protest: ProtestRecord,
  evidenceFiles: string[],
): Promise<SimContext> {
  const [comps, worksheet, reviews] = await Promise.all([
    loadComps(property).catch(() => null),
    getValuationWorksheet(property.id).catch(() => null),
    listCadEvidenceReviews([protest.id]).catch(() => new Map<string, StoredCadEvidenceReview>()),
  ]);
  const review = reviews.get(protest.id) ?? null;
  const cad = protest.originalValue ?? property.totalValue;
  const lowest = worksheet?.summary?.lowest ?? null;
  return {
    address: property.address,
    cad: property.cad,
    accountNumber: property.accountNumber,
    taxYear: protest.taxYear ?? property.taxYear,
    propertyType: property.propertyType,
    appraisedValue: cad,
    landValue: property.landValue,
    improvementValue: property.improvementValue,
    ownerOpinion: lowest && cad != null && lowest.value < cad ? lowest.value : null,
    comps: (comps?.ranked ?? []).map((c) => ({
      address: c.address,
      value: c.marketValue,
      distanceMi: c.distanceMi,
    })),
    compsMedian: comps?.indicated?.median ?? null,
    approaches: (worksheet?.summary?.approaches ?? []).map((a) => ({
      name: a.name,
      value: a.indicatedValue,
      status: a.status,
    })),
    districtEvidence: review
      ? {
          indicatedValue: review.cadIndicatedValue,
          summary: review.summary,
          weaknesses: review.weaknesses.map((w) => w.finding),
        }
      : null,
    evidenceFiles,
  };
}

export async function nextTurn(
  context: SimContext,
  transcript: Turn[],
  difficulty: Difficulty,
): Promise<{ turn: Turn; phase: Phase }> {
  return invokeEdgeFunction("hearing-simulator", { mode: "turn", context, transcript, difficulty });
}

export async function getDebrief(context: SimContext, transcript: Turn[]): Promise<Debrief> {
  return invokeEdgeFunction("hearing-simulator", { mode: "debrief", context, transcript });
}

type Row = {
  id: string;
  difficulty: Difficulty;
  transcript: Turn[];
  debrief: Debrief | null;
  created_at: string;
};
const fromRow = (r: Row): MockHearing => ({
  id: r.id,
  difficulty: r.difficulty,
  transcript: r.transcript ?? [],
  debrief: r.debrief,
  createdAt: r.created_at,
});

export async function listMockHearings(protestId: string): Promise<MockHearing[]> {
  const { data, error } = await supabase
    .from("mock_hearings")
    .select("id, difficulty, transcript, debrief, created_at")
    .eq("protest_id", protestId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  return (data as Row[]).map(fromRow);
}

// Creates the session on the first save, updates it after that.
export async function saveMockHearing(
  userId: string,
  protestId: string,
  session: {
    id: string | null;
    difficulty: Difficulty;
    transcript: Turn[];
    debrief: Debrief | null;
  },
): Promise<string> {
  const row = {
    user_id: userId,
    protest_id: protestId,
    difficulty: session.difficulty,
    transcript: session.transcript,
    debrief: session.debrief,
    updated_at: new Date().toISOString(),
  };
  if (session.id) {
    const { error } = await supabase.from("mock_hearings").update(row).eq("id", session.id);
    if (error) throw error;
    return session.id;
  }
  const { data, error } = await supabase.from("mock_hearings").insert(row).select("id").single();
  if (error) throw error;
  return (data as { id: string }).id;
}
