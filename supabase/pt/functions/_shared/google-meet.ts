// Creates, moves and deletes the Google Calendar event (with a Google Meet link) for an
// appointment, on the host's connected Google account. The host is the admin chosen in
// appointment_settings; their refresh token lives in google_calendar_connections (the same
// connection the "Connect Google Calendar" button creates — scope calendar.events, which is
// what Meet creation needs). Google itself emails the invite/update/cancellation to every
// attendee (sendUpdates=all), so nothing else needs to be attached.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAccessToken } from "./google-calendar-sync.ts";

const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const ZONE = "America/Chicago";

// A short-lived access token for the host's Google account, or null when no host is set
// (or they've disconnected) — the caller then falls back to the emailed calendar file.
export async function hostAccessToken(admin: SupabaseClient): Promise<string | null> {
  const { data: s } = await admin
    .from("appointment_settings")
    .select("host_user_id")
    .eq("id", true)
    .maybeSingle();
  const userId = s?.host_user_id as string | null | undefined;
  if (!userId) return null;
  const { data: c } = await admin
    .from("google_calendar_connections")
    .select("refresh_token")
    .eq("user_id", userId)
    .maybeSingle();
  if (!c?.refresh_token) return null;
  return await getAccessToken(c.refresh_token as string);
}

const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

export type MeetEvent = { eventId: string; meetLink: string | null };

export async function createMeetEvent(
  token: string,
  opts: {
    startIso: string;
    summary: string;
    description: string;
    attendees: string[];
    requestId: string;
  },
): Promise<MeetEvent> {
  const end = new Date(new Date(opts.startIso).getTime() + 60 * 60_000).toISOString();
  const res = await fetch(`${API}?conferenceDataVersion=1&sendUpdates=all`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      summary: opts.summary,
      description: opts.description,
      start: { dateTime: opts.startIso, timeZone: ZONE },
      end: { dateTime: end, timeZone: ZONE },
      attendees: opts.attendees.map((email) => ({ email })),
      conferenceData: {
        createRequest: {
          requestId: opts.requestId,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 15 }] },
    }),
  });
  if (!res.ok) throw new Error(`Google Calendar ${res.status}: ${await res.text()}`);
  type Ev = {
    id: string;
    hangoutLink?: string;
    conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  };
  const linkOf = (e: Ev) =>
    e.hangoutLink ??
    e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ??
    null;
  let ev = (await res.json()) as Ev;
  // Google can hand back the event before the Meet room is ready — look again briefly.
  for (let i = 0; i < 3 && !linkOf(ev); i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const again = await fetch(`${API}/${encodeURIComponent(ev.id)}?conferenceDataVersion=1`, { headers: headers(token) });
    if (again.ok) ev = (await again.json()) as Ev;
  }
  return { eventId: ev.id, meetLink: linkOf(ev) };
}

export async function moveMeetEvent(token: string, eventId: string, startIso: string): Promise<void> {
  const end = new Date(new Date(startIso).getTime() + 60 * 60_000).toISOString();
  const res = await fetch(`${API}/${encodeURIComponent(eventId)}?sendUpdates=all`, {
    method: "PATCH",
    headers: headers(token),
    body: JSON.stringify({
      start: { dateTime: startIso, timeZone: ZONE },
      end: { dateTime: end, timeZone: ZONE },
    }),
  });
  if (!res.ok) throw new Error(`Google Calendar ${res.status}: ${await res.text()}`);
}

export async function deleteMeetEvent(token: string, eventId: string): Promise<void> {
  const res = await fetch(`${API}/${encodeURIComponent(eventId)}?sendUpdates=all`, {
    method: "DELETE",
    headers: headers(token),
  });
  // 404/410 = already gone — fine.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Google Calendar ${res.status}: ${await res.text()}`);
  }
}
