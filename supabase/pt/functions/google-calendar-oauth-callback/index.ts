// Deploy via CLI:
// `supabase functions deploy google-calendar-oauth-callback --no-verify-jwt`
// (--no-verify-jwt because Google redirects the user's browser here directly
// — there is no Supabase session/JWT attached to that request at all; the
// single-use `state` row created by google-calendar-start is what proves
// which CorvusPT user this is, not a JWT).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildUserEvents, reconcileGoogleCalendar } from "../_shared/google-calendar-sync.ts";

const CALLBACK_PATH = "/functions/v1/google-calendar-oauth-callback";

function redirectTo(origin: string, path: string, query: Record<string, string>): Response {
  const url = new URL(path, origin);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new Response(null, { status: 302, headers: { Location: url.toString() } });
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const googleError = url.searchParams.get("error");

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Where to send the browser back to — recovered from the state row below
  // once we have it; falls back to the production app root if we never get
  // that far (e.g. state itself was missing/invalid).
  const appOrigin = "https://corvusre.com";
  let redirectPath = "/dashboard/calendar";

  try {
    if (!state) {
      return redirectTo(appOrigin, redirectPath, { google_error: "missing_state" });
    }

    const { data: stateRow, error: stateErr } = await adminClient
      .from("google_oauth_states")
      .select("user_id, redirect_path")
      .eq("state", state)
      .maybeSingle();
    if (stateErr || !stateRow) {
      return redirectTo(appOrigin, redirectPath, { google_error: "invalid_state" });
    }
    // Single-use regardless of what happens next.
    await adminClient.from("google_oauth_states").delete().eq("state", state);
    const userId = stateRow.user_id as string;
    redirectPath = stateRow.redirect_path as string;
    // The app can run from more than one origin (corvusre.com/corvuspt/,
    // the old GitHub Pages project URL, localhost during dev) — the request
    // that started this flow came from one of those, but this callback
    // request comes from Google, not the app, so there's no Origin header
    // to read here. redirect_path always starts with "/", so reusing
    // whichever origin the request's own Referer/redirect target implies
    // isn't reliable either; corvusre.com is correct for real usage, and
    // this is only wrong for someone testing the connect flow from
    // localhost or the legacy Pages URL, who can still find their way back
    // manually from what's otherwise a successful connection.

    if (googleError) {
      return redirectTo(appOrigin, redirectPath, { google_error: googleError });
    }
    if (!code) {
      return redirectTo(appOrigin, redirectPath, { google_error: "missing_code" });
    }

    const redirectUri = `${Deno.env.get("SUPABASE_URL")!}${CALLBACK_PATH}`;
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID")!,
        client_secret: Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET")!,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenRes.ok) {
      console.error("token exchange failed", await tokenRes.text());
      return redirectTo(appOrigin, redirectPath, { google_error: "token_exchange_failed" });
    }
    const tokenJson = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
    };
    if (!tokenJson.refresh_token) {
      // Happens if the user had already granted consent before and Google
      // skipped issuing a new refresh token — prompt=consent on the
      // authorize URL is meant to prevent this, but fail honestly rather
      // than silently leaving the old (possibly revoked) one in place.
      return redirectTo(appOrigin, redirectPath, { google_error: "no_refresh_token" });
    }

    // Reuse the existing dedicated calendar on a reconnect rather than
    // creating a duplicate one on the user's Google account each time.
    const { data: existingConnection } = await adminClient
      .from("google_calendar_connections")
      .select("calendar_id")
      .eq("user_id", userId)
      .maybeSingle();

    let calendarId = existingConnection?.calendar_id as string | undefined;
    if (!calendarId) {
      const createRes = await fetch("https://www.googleapis.com/calendar/v3/calendars", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenJson.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ summary: "CorvusPT Tax Calendar" }),
      });
      if (!createRes.ok) {
        console.error("calendar create failed", await createRes.text());
        return redirectTo(appOrigin, redirectPath, { google_error: "calendar_create_failed" });
      }
      const created = (await createRes.json()) as { id: string };
      calendarId = created.id;
    }

    await adminClient.from("google_calendar_connections").upsert({
      user_id: userId,
      refresh_token: tokenJson.refresh_token,
      calendar_id: calendarId,
      connected_at: new Date().toISOString(),
    });

    // Immediate first sync, right here, so the user sees real events land
    // the moment they connect instead of waiting for the next cron tick.
    try {
      const events = await buildUserEvents(adminClient, userId);
      await reconcileGoogleCalendar(tokenJson.access_token, calendarId, events);
      await adminClient
        .from("google_calendar_connections")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("user_id", userId);
    } catch (syncErr) {
      // Connection itself succeeded — a failed first sync just means the
      // next cron pass (within minutes) picks it up instead. Don't fail the
      // whole connect flow over it.
      console.error("initial sync failed", syncErr);
    }

    return redirectTo(appOrigin, redirectPath, { google_connected: "1" });
  } catch (err) {
    console.error("oauth callback error", err);
    return redirectTo(appOrigin, redirectPath, { google_error: "unexpected" });
  }
});
