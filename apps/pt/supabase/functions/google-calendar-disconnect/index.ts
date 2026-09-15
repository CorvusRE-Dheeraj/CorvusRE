// Deploy via CLI: `supabase functions deploy google-calendar-disconnect`.
// Authenticated. Best-effort revokes the refresh token with Google (so it
// shows as removed under the user's own Google Account permissions, not
// just forgotten on our side) and always deletes our stored row regardless
// of whether the revoke call itself succeeds. Leaves the dedicated
// "CorvusPT Tax Calendar" and its events in place on the user's Google
// account — deleting a calendar out from under someone without asking is a
// bigger, separate decision than disconnecting sync.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
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
    const { data: connection } = await adminClient
      .from("google_calendar_connections")
      .select("refresh_token")
      .eq("user_id", user.id)
      .maybeSingle();

    if (connection?.refresh_token) {
      try {
        await fetch(
          `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(connection.refresh_token)}`,
          { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } },
        );
      } catch (revokeErr) {
        console.error("revoke failed, proceeding to delete our record anyway", revokeErr);
      }
    }

    await adminClient.from("google_calendar_connections").delete().eq("user_id", user.id);

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
