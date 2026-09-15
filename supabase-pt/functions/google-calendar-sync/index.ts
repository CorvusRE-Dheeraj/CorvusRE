// Deploy via CLI: `supabase functions deploy google-calendar-sync`
// (JWT-verified — only pg_cron, calling with the service-role key as
// Bearer auth, is meant to trigger this; see the cron.schedule migration).
//
// Runs one reconciliation pass for every connected user: refresh their
// access token, rebuild their real event set, and push the diff to their
// dedicated Google Calendar. This — not the webcal feed's Google-controlled
// polling — is what makes sync "continuous": a new deadline shows up within
// one cron interval, not whenever Google feels like re-fetching a link.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildUserEvents,
  getAccessToken,
  reconcileGoogleCalendar,
} from "../_shared/google-calendar-sync.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: connections, error } = await adminClient
    .from("google_calendar_connections")
    .select("user_id, refresh_token, calendar_id");
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  const results: { userId: string; ok: boolean; error?: string }[] = [];
  // Sequential, not Promise.all — same reasoning as every other bulk pass
  // in this app: one user's token being revoked or Google being briefly
  // slow shouldn't take the whole batch down together, and this keeps
  // Google API calls from all firing at once.
  for (const conn of connections ?? []) {
    const userId = conn.user_id as string;
    try {
      const accessToken = await getAccessToken(conn.refresh_token as string);
      const events = await buildUserEvents(adminClient, userId);
      await reconcileGoogleCalendar(accessToken, conn.calendar_id as string, events);
      await adminClient
        .from("google_calendar_connections")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("user_id", userId);
      results.push({ userId, ok: true });
    } catch (err) {
      console.error(`sync failed for user ${userId}`, err);
      results.push({ userId, ok: false, error: err instanceof Error ? err.message : "failed" });
      // A refresh token that's been revoked on Google's side fails every
      // future pass identically until the user disconnects/reconnects —
      // not auto-deleting the row here, since "briefly unreachable" and
      // "actually revoked" aren't distinguishable from one failure, and
      // silently dropping someone's connection on a transient error would
      // be worse than a few noisy retries.
    }
  }

  return new Response(JSON.stringify({ synced: results.length, results }), {
    status: 200,
    headers: corsHeaders,
  });
});
