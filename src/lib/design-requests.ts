import { supabase } from "./supabase";
import type { DpIntakeState } from "./dp-intake";
import { generateDesignBrief, type DesignBrief } from "./design";

export type DesignRequestRow = {
  id: string;
  user_id: string | null;
  address: string | null;
  city: string | null;
  county: string | null;
  scope: string | null;
  sector: string | null;
  site_area: string | null;
  building_area: string | null;
  floors: string | null;
  rooms: string | null;
  functional_requirements: string | null;
  special_requirements: string | null;
  brief: DesignBrief | null;
  stage: string;
  approved_at: string | null;
  consultation_requested_at: string | null;
  created_at: string;
};

export async function saveDesignRequest(userId: string, intake: DpIntakeState): Promise<string> {
  const brief = generateDesignBrief(intake.design);
  const { data, error } = await supabase
    .from("design_requests")
    .insert({
      user_id: userId,
      session_id: intake.sessionId,
      address: intake.property.address ?? null,
      city: intake.property.city ?? null,
      county: intake.property.county ?? null,
      scope: intake.design.scope ?? null,
      sector: intake.design.sector ?? null,
      site_area: intake.design.approxSiteArea ?? null,
      building_area: intake.design.buildingArea ?? null,
      floors: intake.design.floors ?? null,
      rooms: intake.design.rooms ?? null,
      functional_requirements: intake.design.functionalRequirements ?? null,
      special_requirements: intake.design.specialRequirements ?? null,
      brief,
      stage: "brief",
    })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

// PRD 1.2.19 Design Stage Tracking & Timeline — once a request is approved
// and the design team is engaged (tracked today via the admin Engagements
// queue, not an automated payment step — PRD 1.2.15-18's hire/quote/payment
// flow still needs real business process, not just a status field), staff
// advance it through the same three stages PRD 1.2.11.A names for the
// timeline itself, so the customer sees one consistent progress tracker.
export const DESIGN_STAGES = [
  "brief",
  "approved",
  "concept",
  "development",
  "final_drawings",
  "completed",
] as const;
export type DesignStage = (typeof DESIGN_STAGES)[number];

export const DESIGN_STAGE_LABEL: Record<DesignStage, string> = {
  brief: "Brief",
  approved: "Approved",
  concept: "Concept design",
  development: "Design development",
  final_drawings: "Final drawings",
  completed: "Completed",
};

export function nextDesignStage(stage: string): DesignStage | null {
  const i = DESIGN_STAGES.indexOf(stage as DesignStage);
  return i < 0 || i === DESIGN_STAGES.length - 1 ? null : DESIGN_STAGES[i + 1];
}

export async function advanceDesignRequestStage(id: string, stage: DesignStage): Promise<void> {
  const { error } = await supabase.from("design_requests").update({ stage }).eq("id", id);
  if (error) throw error;
}

// PRD 1.2.8.A / 1.2.8.B — record the customer's intent before the paid work.
export async function approveDesignBrief(id: string): Promise<void> {
  const { error } = await supabase
    .from("design_requests")
    .update({ approved_at: new Date().toISOString(), stage: "approved" })
    .eq("id", id);
  if (error) throw error;
}

export async function requestDesignConsultation(id: string): Promise<void> {
  const { error } = await supabase
    .from("design_requests")
    .update({ consultation_requested_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function getActiveDesignRequest(userId: string): Promise<DesignRequestRow | null> {
  const { data, error } = await supabase
    .from("design_requests")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as DesignRequestRow) ?? null;
}
