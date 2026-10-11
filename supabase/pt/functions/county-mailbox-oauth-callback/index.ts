// Deploy via CLI: `supabase functions deploy county-mailbox-oauth-callback --no-verify-jwt`
// (Google redirects here with no session — the single-use state row is the auth).
//
// Finishes connecting the county mailbox started by county-mailbox-admin's
// "start": exchanges the code, reads which address was connected, stores the
// read-only refresh token in public.county_mailbox, and runs a first pass.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { syncCountyMailbox } from "../_shared/county-mailbox-sync.ts";

const CALLBACK_PATH = "/functions/v1/county-mailbox-oauth-callback";
const APP_ORIGIN = "https://corvusre.com";

Deno.serve(async (req: Request) => {
  // Back to the admin page the connect started from (stored on the state row —
  // base-path-aware, same pattern as google-calendar-oauth-callback). Per request.
  let redirectPath = "/corvuspt/admin";
  const back = (query: Record<string, string>): Response => {
    const target = new URL(redirectPath, APP_ORIGIN);
    for (const [k, v] of Object.entries(query)) target.searchParams.set(k, v);
    return new Response(null, { status: 302, headers: { Location: target.toString() } });
  };

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error")) return back({ mailbox_error: url.searchParams.get("error")! });
  if (!code || !state) return back({ mailbox_error: "missing_code" });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const { data: row } = await admin
      .from("google_oauth_states")
      .select("user_id, purpose, redirect_path")
      .eq("state", state)
      .maybeSingle();
    if (!row || row.purpose !== "mailbox") return back({ mailbox_error: "invalid_state" });
    redirectPath = (row.redirect_path as string) || redirectPath;
    await admin.from("google_oauth_states").delete().eq("state", state);

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID")!,
        client_secret: Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET")!,
        code,
        grant_type: "authorization_code",
        redirect_uri: `${Deno.env.get("SUPABASE_URL")!}${CALLBACK_PATH}`,
      }),
    });
    if (!tokenRes.ok) {
      console.error("mailbox token exchange failed", await tokenRes.text());
      return back({ mailbox_error: "token_exchange_failed" });
    }
    const tok = (await tokenRes.json()) as { access_token: string; refresh_token?: string };
    if (!tok.refresh_token) return back({ mailbox_error: "no_refresh_token" });

    // Which mailbox the admin actually signed in to.
    const profileRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    const profile = profileRes.ok ? ((await profileRes.json()) as { emailAddress?: string }) : {};
    if (!profile.emailAddress) return back({ mailbox_error: "no_mailbox" });

    await admin.from("county_mailbox").upsert({
      id: true,
      email: profile.emailAddress,
      refresh_token: tok.refresh_token,
      connected_by: row.user_id,
      connected_at: new Date().toISOString(),
      last_checked_at: null,
      last_error: null,
    });

    try {
      await syncCountyMailbox(admin);
    } catch (e) {
      console.error("first mailbox pass failed (connection is saved):", e);
    }
    return back({ mailbox_connected: profile.emailAddress });
  } catch (err) {
    console.error("county-mailbox-oauth-callback failed:", err);
    return back({ mailbox_error: "unexpected" });
  }
});
