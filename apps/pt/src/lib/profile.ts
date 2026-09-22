import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";

// Account-level notification controls, exposed under Settings →
// Notification Preferences and read server-side by send-evidence-reminders /
// send-deadline-reminders (never trusted from the client for anything the
// cron job itself decides). A jsonb column specifically so a new
// notification type is one more key, not a schema change — deadlineReminders*
// below is the second type added this way.
export type NotificationPrefs = {
  evidenceReminders: "daily" | "weekly" | "off";
  // Every protest deadline, ARB hearing, tax date, and personal reminder on
  // the Calendar page (see send-deadline-reminders) — missing key defaults
  // to true, same "absent = default" treatment evidenceReminders' own
  // default already relies on for rows created before this key existed.
  deadlineRemindersEmail: boolean;
  // Off by default — also requires a phone number on file; see
  // getMyProfile's own phone field. SMS transport itself isn't live yet
  // (needs an SMS provider connected server-side), so this only controls
  // whether the account WANTS SMS once that's true.
  deadlineRemindersSms: boolean;
  // Which of the 30/15/7/3/2/0-days-out reminder points the account wants
  // at all, across BOTH channels — send-deadline-reminders only ever fires
  // at these exact offsets (DEADLINE_REMINDER_OFFSETS below is the full,
  // default-on set), so this is a subset, not a separate schedule. Missing
  // key = every offset on, same "absent = default" treatment as the two
  // booleans above.
  deadlineReminderOffsets: number[];
};

// The only offsets send-deadline-reminders ever sends at — also this app's
// one source of truth for which checkboxes Settings renders, so adding a
// new offset there is the only place that'd ever need to change.
export const DEADLINE_REMINDER_OFFSETS = [30, 15, 7, 3, 2, 0] as const;

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  evidenceReminders: "weekly",
  deadlineRemindersEmail: true,
  deadlineRemindersSms: false,
  deadlineReminderOffsets: [...DEADLINE_REMINDER_OFFSETS],
};

export type MyProfile = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  companyName: string | null;
  notificationPrefs: NotificationPrefs;
};

type ProfileRow = {
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  company_name: string | null;
  notification_prefs: {
    evidence_reminders?: NotificationPrefs["evidenceReminders"];
    deadline_reminders_email?: boolean;
    deadline_reminders_sms?: boolean;
    deadline_reminder_offsets?: number[];
  } | null;
};

export async function getMyProfile(userId: string): Promise<MyProfile> {
  const { data, error } = await supabase
    .from("profiles")
    .select("email, first_name, last_name, phone, company_name, notification_prefs")
    .eq("id", userId)
    .single();
  if (error) throw error;
  const row = data as ProfileRow;
  return {
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    companyName: row.company_name,
    notificationPrefs: {
      evidenceReminders:
        row.notification_prefs?.evidence_reminders ?? DEFAULT_NOTIFICATION_PREFS.evidenceReminders,
      deadlineRemindersEmail:
        row.notification_prefs?.deadline_reminders_email ??
        DEFAULT_NOTIFICATION_PREFS.deadlineRemindersEmail,
      deadlineRemindersSms:
        row.notification_prefs?.deadline_reminders_sms ??
        DEFAULT_NOTIFICATION_PREFS.deadlineRemindersSms,
      deadlineReminderOffsets:
        row.notification_prefs?.deadline_reminder_offsets ??
        DEFAULT_NOTIFICATION_PREFS.deadlineReminderOffsets,
    },
  };
}

// Merges onto whatever's already stored rather than overwriting the whole
// jsonb blob — callers pass only the key(s) they're changing (see Settings,
// which calls this separately for the evidence-reminder select and each
// deadline-reminder checkbox) so one control's save can never clobber
// another's current value with a stale in-memory copy.
export async function updateNotificationPrefs(
  userId: string,
  prefs: Partial<NotificationPrefs>,
): Promise<void> {
  const { data: current, error: readErr } = await supabase
    .from("profiles")
    .select("notification_prefs")
    .eq("id", userId)
    .single();
  if (readErr) throw readErr;
  const merged: Record<string, unknown> = { ...(current.notification_prefs ?? {}) };
  if (prefs.evidenceReminders !== undefined) merged.evidence_reminders = prefs.evidenceReminders;
  if (prefs.deadlineRemindersEmail !== undefined)
    merged.deadline_reminders_email = prefs.deadlineRemindersEmail;
  if (prefs.deadlineRemindersSms !== undefined)
    merged.deadline_reminders_sms = prefs.deadlineRemindersSms;
  if (prefs.deadlineReminderOffsets !== undefined)
    merged.deadline_reminder_offsets = prefs.deadlineReminderOffsets;

  const { error } = await supabase
    .from("profiles")
    .update({ notification_prefs: merged })
    .eq("id", userId);
  if (error) throw error;
}

export async function updateMyProfile(
  userId: string,
  patch: {
    firstName?: string;
    lastName?: string;
    phone?: string | null;
    companyName?: string | null;
  },
): Promise<void> {
  const update: Record<string, string | null> = {};
  if (patch.firstName !== undefined) update.first_name = patch.firstName;
  if (patch.lastName !== undefined) update.last_name = patch.lastName;
  if (patch.phone !== undefined) update.phone = patch.phone;
  if (patch.companyName !== undefined) update.company_name = patch.companyName;
  const { error } = await supabase.from("profiles").update(update).eq("id", userId);
  if (error) throw error;
}

// Permanently deletes the signed-in user's own account — and everything under it
// (properties, protests, documents, BPP accounts), via cascading foreign keys on
// the auth.users row. Irreversible; the caller is responsible for confirming with
// the user before calling this.
export async function deleteMyAccount(): Promise<void> {
  await invokeEdgeFunction<{ ok: true }>("delete-my-account", {});
}
