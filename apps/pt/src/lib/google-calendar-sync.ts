import { invokeEdgeFunction } from "./edge-functions";

// Real, continuous OAuth-based sync — distinct from calendar-feed.ts's
// webcal subscribe link. That link is genuinely "sync" too (Google keeps
// re-fetching it), but on Google's own schedule, which is often much
// slower than its own advertised refresh interval. This pushes each
// deadline directly via the Calendar API on our own ~5-minute cron
// instead, so a new one shows up in minutes, not on Google's own timing.

export type GoogleCalendarStatus = {
  connected: boolean;
  connectedAt: string | null;
  lastSyncedAt: string | null;
};

export async function getGoogleCalendarStatus(): Promise<GoogleCalendarStatus> {
  return invokeEdgeFunction<GoogleCalendarStatus>("google-calendar-status", {});
}

// Full-page redirect to Google's real consent screen — not a popup, since
// this needs the actual browser navigation for Google's OAuth flow to work
// cleanly. redirectPath is base-path-aware (import.meta.env.BASE_URL),
// same pattern as admin-create-user's invite redirect, so the callback
// sends the user back to wherever this app is actually deployed under.
export async function startGoogleCalendarConnect(): Promise<void> {
  const redirectPath = `${import.meta.env.BASE_URL}dashboard/calendar`;
  const { authUrl } = await invokeEdgeFunction<{ authUrl: string }>("google-calendar-start", {
    redirectPath,
  });
  window.location.href = authUrl;
}

export async function disconnectGoogleCalendar(): Promise<void> {
  await invokeEdgeFunction<{ ok: true }>("google-calendar-disconnect", {});
}
