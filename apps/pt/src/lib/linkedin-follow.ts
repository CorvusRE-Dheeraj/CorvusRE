// "Follow CorvusRE on LinkedIn" — the small popup after the welcome tour (new
// users) or on the next dashboard visit (everyone else). Per account
// (profiles.linkedin_followed_at / linkedin_prompt_snoozed_until — see
// supabase/pt/linkedin-follow.sql). LinkedIn can't tell us whether someone
// actually followed, so clicking Follow counts as followed.
import { supabase } from "./supabase";

export const LINKEDIN_PAGE_URL = "https://www.linkedin.com/company/corvusre";
/** "Maybe later" asks again after this long. */
export const SNOOZE_DAYS = 14;

export type FollowState = { followedAt: string | null; snoozedUntil: string | null };

export function shouldAskToFollow(state: FollowState, now = new Date()): boolean {
  if (state.followedAt) return false;
  return !state.snoozedUntil || new Date(state.snoozedUntil).getTime() <= now.getTime();
}

export async function getFollowState(userId: string): Promise<FollowState> {
  const { data, error } = await supabase
    .from("profiles")
    .select("linkedin_followed_at, linkedin_prompt_snoozed_until")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return {
    followedAt: (data?.linkedin_followed_at as string | null) ?? null,
    snoozedUntil: (data?.linkedin_prompt_snoozed_until as string | null) ?? null,
  };
}

export async function markFollowed(userId: string): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ linkedin_followed_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw error;
}

export async function snoozeFollowPrompt(userId: string, now = new Date()): Promise<void> {
  const until = new Date(now.getTime() + SNOOZE_DAYS * 24 * 60 * 60 * 1000);
  const { error } = await supabase
    .from("profiles")
    .update({ linkedin_prompt_snoozed_until: until.toISOString() })
    .eq("id", userId);
  if (error) throw error;
}
