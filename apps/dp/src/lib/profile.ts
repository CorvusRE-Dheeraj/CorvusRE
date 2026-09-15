import { supabase } from "./supabase";

export type NotificationPrefs = {
  email: boolean;
  sms: boolean;
  in_app: boolean;
  weekly: boolean;
  permit_status: boolean;
};

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  email: true,
  sms: false,
  in_app: true,
  weekly: true,
  permit_status: true,
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
  notification_prefs: NotificationPrefs | null;
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
    notificationPrefs: { ...DEFAULT_NOTIFICATION_PREFS, ...(row.notification_prefs ?? {}) },
  };
}

export async function updateNotificationPrefs(
  userId: string,
  prefs: NotificationPrefs,
): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ notification_prefs: prefs })
    .eq("id", userId);
  if (error) throw error;
}

export async function updateMyProfile(
  userId: string,
  patch: { firstName?: string; lastName?: string; phone?: string; companyName?: string | null },
): Promise<void> {
  const update: Record<string, string | null> = {};
  if (patch.firstName !== undefined) update.first_name = patch.firstName;
  if (patch.lastName !== undefined) update.last_name = patch.lastName;
  if (patch.phone !== undefined) update.phone = patch.phone;
  if (patch.companyName !== undefined) update.company_name = patch.companyName;
  const { error } = await supabase.from("profiles").update(update).eq("id", userId);
  if (error) throw error;
}
