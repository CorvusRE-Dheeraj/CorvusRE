import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Created on first send, not at signup — most accounts never trigger a
// reminder/digest email at all, so there's no reason every profile carries
// one (same reasoning as CorvusPT's calendar_feed_token). Reused on every
// later email. `admin` must be a service-role client — this reads/writes a
// column no client-side grant covers.
export async function getOrCreateUnsubscribeToken(
  admin: SupabaseClient,
  userId: string,
  existing?: string | null,
): Promise<string> {
  if (existing) return existing;
  const token = crypto.randomUUID().replace(/-/g, "");
  await admin.from("profiles").update({ unsubscribe_token: token }).eq("id", userId);
  return token;
}

export function unsubscribeUrl(
  supabaseUrl: string,
  token: string,
  kind: "email" | "weekly" | "permit_status",
): string {
  return `${supabaseUrl}/functions/v1/unsubscribe-notifications?token=${token}&kind=${kind}`;
}
