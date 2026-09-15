import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";

// Referral program — mirrors the CorvusPT door's own src/lib/referrals.ts.
// The actual reward (once Stripe is wired) is granted by stripe-webhook,
// same as there; this file is the read/write side the dashboard uses today.
export type ReferralRecord = {
  id: string;
  firstName: string | null;
  signedUpAt: string;
  /** True once the referred person is on a real paid plan, not just signed up. */
  converted: boolean;
  /** True once a reward has actually been granted for this referral. */
  rewarded: boolean;
};

type ReferralRow = {
  id: string;
  first_name: string | null;
  signed_up_at: string;
  converted: boolean;
  rewarded: boolean;
};

export async function getMyReferralCode(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("referral_code")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data?.referral_code as string | null) ?? null;
}

export async function getMyReferrals(): Promise<ReferralRecord[]> {
  const { data, error } = await supabase.rpc("get_my_referrals");
  if (error) throw error;
  return (data as ReferralRow[]).map((row) => ({
    id: row.id,
    firstName: row.first_name,
    signedUpAt: row.signed_up_at,
    converted: row.converted,
    rewarded: row.rewarded,
  }));
}

export type ReferralInvite = { id: string; email: string; sentAt: string };

export async function getMyReferralInvites(): Promise<ReferralInvite[]> {
  const { data, error } = await supabase
    .from("referral_invites")
    .select("id, email, sent_at")
    .order("sent_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    email: r.email as string,
    sentAt: r.sent_at as string,
  }));
}

export async function dismissReferralInvite(id: string): Promise<void> {
  const { error } = await supabase.from("referral_invites").delete().eq("id", id);
  if (error) throw error;
}

// A working share link, built as /sign-in?ref=CODE. CorvusPT uses a
// prettier /join/CODE path with a 404-fallback rewrite (its own static
// host trick) — CorvusDP skips that extra machinery and points straight at
// the real prerendered /sign-in page, which already reads ?ref= (see
// src/routes/sign-in.tsx) and threads it through signUp's options.data.
export function buildReferralLink(code: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const base = typeof window !== "undefined" ? import.meta.env.BASE_URL : "/";
  return `${origin}${base}sign-in?ref=${encodeURIComponent(code)}`;
}

// A real, branded "your friend referred you" email via send-referral-invite
// (Resend) — the referrer's own name/code are resolved server-side from
// their own authenticated profile, never trusted from this call.
export async function sendReferralInvite(toEmail: string): Promise<void> {
  const origin =
    typeof window !== "undefined" ? `${window.location.origin}${import.meta.env.BASE_URL}` : "";
  await invokeEdgeFunction("send-referral-invite", { toEmail, origin });
}
