import { supabase } from "./supabase";
import type { DpIntakeState } from "./dp-intake";

// Anonymous drop-off capture (PRD 1.1.7.N). Best-effort: a failure here must
// never block the visitor's flow — the lead is a nice-to-have for staff.
export async function captureLead(
  intake: DpIntakeState,
  contact: { email?: string; name?: string; company?: string },
): Promise<void> {
  const intentScore =
    (intake.property.address ? 2 : 0) +
    (intake.project.intent || intake.design.scope ? 2 : 0) +
    (intake.property.zoning ? 1 : 0) +
    (contact.email ? 3 : 0);

  try {
    await supabase.from("leads").insert({
      session_id: intake.sessionId,
      track: intake.track ?? "permitting",
      email: contact.email ?? intake.leadEmail ?? null,
      name: contact.name ?? intake.leadName ?? null,
      company: contact.company ?? null,
      property: intake.property,
      project: intake.project,
      design: intake.design,
      intent_score: intentScore,
    });
  } catch (err) {
    console.error("lead capture failed (non-blocking)", err);
  }
}
