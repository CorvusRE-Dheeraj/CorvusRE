// Deploy via CLI: `supabase functions deploy google-calendar-start`.
// Requires GOOGLE_CALENDAR_CLIENT_ID (secret).
//
// Step 1 of the real, continuous OAuth-based sync (distinct from
// calendar-feed's webcal subscribe link, which stays available too).
// Authenticated — verifies the caller's own JWT, then creates a
// short-lived, single-use state row tied to THIS user before handing back
// Google's real consent URL. The client just does
// window.location.href = authUrl; there's no client secret or token
// handling on the client side at all.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const CALLBACK_PATH = "/functions/v1/google-calendar-oauth-callback";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { redirectPath } = await req.json();

    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );
    const {
      data: { user },
      error: userErr,
    } = await callerClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "unauthenticated" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const state = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const safeRedirectPath =
      typeof redirectPath === "string" &&
      redirectPath.startsWith("/") &&
      !redirectPath.startsWith("//")
        ? redirectPath
        : "/dashboard/calendar";

    // Old, unused states for this user are just clutter — this is a
    // best-effort cleanup, not a security measure (each state is single-use
    // and short-lived by construction; the callback rejects anything not
    // found in this table regardless of age).
    await adminClient.from("google_oauth_states").delete().eq("user_id", user.id);
    const { error: insertErr } = await adminClient
      .from("google_oauth_states")
      .insert({ state, user_id: user.id, redirect_path: safeRedirectPath });
    if (insertErr) throw insertErr;

    const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID")!;
    const redirectUri = `${Deno.env.get("SUPABASE_URL")!}${CALLBACK_PATH}`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPE,
      access_type: "offline",
      prompt: "consent",
      state,
    });
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

    return new Response(JSON.stringify({ authUrl }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
