import { supabase } from "./supabase";

export type ContactMethod = "call" | "email";
export type SupportEscalationStatus = "open" | "contacted" | "resolved";
export type TranscriptTurn = { role: "user" | "assistant"; text: string };

// Filed when someone asks to escalate from the Ask AI widget's "Still need
// help?" prompt — see AskAiWidget.tsx. Visible to admins on the Admin ->
// Support tab. A "call" escalation also triggers a real staff email via
// notifyStaff() at the call site, so this row is never the only place the
// request lands.
export async function createSupportEscalation(input: {
  userId: string;
  contactMethod: ContactMethod;
  summary: string;
  transcript: TranscriptTurn[];
}): Promise<void> {
  const { error } = await supabase.from("support_escalations").insert({
    user_id: input.userId,
    contact_method: input.contactMethod,
    summary: input.summary,
    transcript: input.transcript,
  });
  if (error) throw error;
}

export type SupportEscalation = {
  id: string;
  userId: string | null;
  contactMethod: ContactMethod;
  summary: string;
  transcript: TranscriptTurn[];
  status: SupportEscalationStatus;
  createdAt: string;
};

type Row = {
  id: string;
  user_id: string | null;
  contact_method: ContactMethod;
  summary: string;
  transcript: TranscriptTurn[] | null;
  status: SupportEscalationStatus;
  created_at: string;
};

const fromRow = (r: Row): SupportEscalation => ({
  id: r.id,
  userId: r.user_id,
  contactMethod: r.contact_method,
  summary: r.summary,
  transcript: r.transcript ?? [],
  status: r.status,
  createdAt: r.created_at,
});

// Admin-only (RLS) — every escalation, newest first.
export async function listSupportEscalations(): Promise<SupportEscalation[]> {
  const { data, error } = await supabase
    .from("support_escalations")
    .select("id, user_id, contact_method, summary, transcript, status, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as Row[]).map(fromRow);
}

export async function setSupportEscalationStatus(
  id: string,
  status: SupportEscalationStatus,
): Promise<void> {
  const { error } = await supabase.from("support_escalations").update({ status }).eq("id", id);
  if (error) throw error;
}
