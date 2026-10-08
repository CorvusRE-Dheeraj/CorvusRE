import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";

// Personal reminders (public.user_reminders) — the user adds these directly
// or the Ask AI assistant parses one out of "remind me to …". They show on
// the Calendar page next to the real derived deadlines. Owner-scoped by RLS.

export type Reminder = {
  id: string;
  propertyId: string | null;
  remindOn: string; // YYYY-MM-DD
  note: string;
  done: boolean;
  // Explicitly acknowledged as missed — set by setReminderMissed, cleared
  // whenever done is set true. Distinct from "just overdue": a reminder past
  // its date with this still null is auto-treated as missed for DISPLAY too
  // (see fromReminder() in tax-calendar.ts) so an old, ignored reminder
  // never silently reads as "Done" — but this field is what lets the owner
  // mark one missed explicitly (even before its date) rather than only ever
  // toggling done/not-done.
  missedAt: string | null;
  // 'system' = created automatically (e.g. the weekly property-base-data
  // refresh noticed the CAD data changed).
  source: "manual" | "assistant" | "system";
  createdAt: string;
};

type Row = {
  id: string;
  property_id: string | null;
  remind_on: string;
  note: string;
  done: boolean;
  missed_at: string | null;
  source: string;
  created_at: string;
};

const fromRow = (r: Row): Reminder => ({
  id: r.id,
  propertyId: r.property_id,
  remindOn: r.remind_on,
  note: r.note,
  done: r.done,
  missedAt: r.missed_at,
  source: r.source === "assistant" || r.source === "system" ? r.source : "manual",
  createdAt: r.created_at,
});

const SELECT_COLUMNS = "id, property_id, remind_on, note, done, missed_at, source, created_at";

export async function listReminders(userId: string): Promise<Reminder[]> {
  const { data, error } = await supabase
    .from("user_reminders")
    .select(SELECT_COLUMNS)
    .eq("user_id", userId)
    .order("remind_on", { ascending: true });
  if (error || !data) return [];
  return (data as Row[]).map(fromRow);
}

export async function addReminder(
  userId: string,
  input: {
    remindOn: string;
    note: string;
    propertyId?: string | null;
    source?: "manual" | "assistant";
  },
): Promise<Reminder> {
  const { data, error } = await supabase
    .from("user_reminders")
    .insert({
      user_id: userId,
      property_id: input.propertyId ?? null,
      remind_on: input.remindOn,
      note: input.note.trim(),
      source: input.source ?? "manual",
    })
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw error;
  return fromRow(data as Row);
}

export async function setReminderDone(id: string, done: boolean): Promise<void> {
  // Marking done also clears any explicit "missed" mark — the two are
  // mutually exclusive end states.
  const { error } = await supabase
    .from("user_reminders")
    .update({ done, missed_at: done ? null : undefined })
    .eq("id", id);
  if (error) throw error;
}

// Explicitly marks a reminder missed (or clears that mark) — separate from
// setReminderDone so the Calendar page can offer "Completed" and "Missed" as
// two distinct actions instead of one done/not-done toggle. Setting missed
// also clears `done`, since a reminder can't be both.
export async function setReminderMissed(id: string, missed: boolean): Promise<void> {
  const { error } = await supabase
    .from("user_reminders")
    .update({
      missed_at: missed ? new Date().toISOString() : null,
      done: missed ? false : undefined,
    })
    .eq("id", id);
  if (error) throw error;
}

// Edits a reminder the owner already added — the Calendar page's edit form, and its
// drag-to-reschedule (only ever a reminder; every other calendar entry is a real county/case
// fact and stays read-only there).
export async function updateReminder(
  id: string,
  patch: { remindOn?: string; note?: string; propertyId?: string | null },
): Promise<void> {
  const update: Record<string, string | null> = {};
  if (patch.remindOn !== undefined) update.remind_on = patch.remindOn;
  if (patch.note !== undefined) update.note = patch.note.trim();
  if (patch.propertyId !== undefined) update.property_id = patch.propertyId;
  const { error } = await supabase.from("user_reminders").update(update).eq("id", id);
  if (error) throw error;
}

export async function deleteReminder(id: string): Promise<void> {
  const { error } = await supabase.from("user_reminders").delete().eq("id", id);
  if (error) throw error;
}

// ── Natural-language parsing for the Ask AI assistant ────────────────────
// A cheap client-side gate so we only spend an AI call when the message
// actually looks like a reminder request.
export function looksLikeReminderRequest(text: string): boolean {
  return /\b(remind me|reminder|don'?t let me forget|save (the |this )?date|add (a )?(reminder|date)|note to self|schedule (a )?reminder|ping me|alert me)\b/i.test(
    text,
  );
}

export type ParsedReminder = {
  isReminder: boolean;
  remindOn: string | null; // YYYY-MM-DD
  note: string;
  propertyId: string | null;
};

// Resolves a phrase like "remind me to call the Denton ARB next Tuesday" into
// { remindOn, note, propertyId } via the extract-reminder edge function
// (Gemini, JSON mode, given today's date + the user's property list so it can
// resolve relative dates and match a named property). Never invents a date:
// remindOn is null when the phrase has no resolvable date, and the caller
// then asks the user for one instead of guessing.
export async function parseReminderRequest(
  phrase: string,
  properties: { id: string; address: string }[],
): Promise<ParsedReminder> {
  return invokeEdgeFunction<ParsedReminder>("extract-reminder", {
    phrase,
    today: new Date().toISOString().slice(0, 10),
    properties: properties.map((p) => ({ id: p.id, address: p.address })),
  });
}
