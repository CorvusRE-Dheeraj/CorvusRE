import { supabase } from "./supabase";

// A per-user, unguessable token identifying their calendar to the public
// calendar-feed edge function — see that function's own comment for why a
// URL token (not a session) is how this has to work: Google/Outlook/Apple
// Calendar re-fetch a subscribed feed on their own schedule, with nobody
// signed in to attach a real session to.
function generateToken(): string {
  // 32 hex chars (128 bits) via the Web Crypto API already available in
  // every browser this app supports — no uuid dependency needed.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Creates the token on first use rather than at signup — most users will
// never open "Sync with Google Calendar," so there's no reason every
// profile carries one.
export async function getOrCreateFeedToken(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("calendar_feed_token")
    .eq("id", userId)
    .single();
  if (error) throw error;
  const existing = (data as { calendar_feed_token: string | null }).calendar_feed_token;
  if (existing) return existing;

  const token = generateToken();
  const { error: updateError } = await supabase
    .from("profiles")
    .update({ calendar_feed_token: token })
    .eq("id", userId);
  if (updateError) throw updateError;
  return token;
}

// Invalidates the old link (e.g. it was shared somewhere it shouldn't have
// been) and hands back a fresh one — any calendar app still subscribed to
// the old URL just starts getting 404s on its next refresh.
export async function regenerateFeedToken(userId: string): Promise<string> {
  const token = generateToken();
  const { error } = await supabase
    .from("profiles")
    .update({ calendar_feed_token: token })
    .eq("id", userId);
  if (error) throw error;
  return token;
}

function feedBaseUrl(token: string): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  return `${supabaseUrl}/functions/v1/calendar-feed?token=${token}`;
}

// https:// — for "Copy Link" and opening directly to sanity-check the feed.
export function getFeedHttpsUrl(token: string): string {
  return feedBaseUrl(token);
}

// webcal:// — the scheme calendar apps recognize as "subscribe to this,"
// including Google Calendar's own "From URL" add flow below.
export function getFeedWebcalUrl(token: string): string {
  return feedBaseUrl(token).replace(/^https:\/\//, "webcal://");
}

// Opens Google Calendar's real "Add by URL" flow, prefilled — the closest
// thing to a one-click "connect my Gmail" for a feed-based subscription
// (no OAuth involved; the user just has to be signed into Google in that
// tab, then click Google's own "Add" button).
export function googleCalendarSubscribeUrl(token: string): string {
  const cid = encodeURIComponent(getFeedWebcalUrl(token));
  return `https://calendar.google.com/calendar/render?cid=${cid}`;
}
