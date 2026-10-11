// Deploy via CLI: `supabase functions deploy county-mailbox-admin`.
// Uses the existing Google OAuth app (GOOGLE_CALENDAR_CLIENT_ID / _SECRET) — add
// <SUPABASE_URL>/functions/v1/county-mailbox-oauth-callback as an authorized
// redirect URI on it, and enable the Gmail API on its Google Cloud project.
//
// Admin-only actions for the county mailbox (public.county_mailbox):
//   status      — connected?, which address, last check, last error, queue size
//   start       — Google consent URL to connect the mailbox READ-ONLY (gmail.readonly)
//   sync        — run a pass now (same as the 15-minute job)
//   list        — county emails waiting for a property (the admin queue)
//   assign      — file a queued email under a property
//   disconnect  — forget the mailbox (revokes the stored refresh token)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { assignCountyEmail, syncCountyMailbox } from "../_shared/county-mailbox-sync.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

// Read-only mail access, plus the address itself so the panel can show which
// mailbox is connected. No send / modify / delete scope.
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const CALLBACK_PATH = "/functions/v1/county-mailbox-oauth-callback";
export const AGENT_MAILBOX = "properties@srclandbuilding.com";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: corsHeaders });

  try {
    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );
    const {
      data: { user },
    } = await callerClient.auth.getUser();
    if (!user) return json({ error: "unauthenticated" }, 401);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: profile } = await admin.from("profiles").select("is_admin").eq("id", user.id).single();
    if (!profile?.is_admin) return json({ error: "not authorized" }, 403);

    const body = (await req.json()) as {
      action?: string;
      emailId?: string;
      propertyId?: string;
      // Base-path-aware admin page to come back to (see startCountyMailboxConnect).
      redirectPath?: string;
    };

    switch (body.action) {
      case "status": {
        const { data: box } = await admin
          .from("county_mailbox")
          .select("email, connected_at, last_checked_at, last_error")
          .eq("id", true)
          .maybeSingle();
        const { count } = await admin
          .from("county_emails")
          .select("id", { count: "exact", head: true })
          .eq("status", "needs_property");
        return json({
          connected: !!box,
          email: box?.email ?? null,
          connectedAt: box?.connected_at ?? null,
          lastCheckedAt: box?.last_checked_at ?? null,
          lastError: box?.last_error ?? null,
          queued: count ?? 0,
          expectedEmail: AGENT_MAILBOX,
        });
      }
      case "start": {
        const state = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
        await admin.from("google_oauth_states").delete().eq("user_id", user.id).eq("purpose", "mailbox");
        const redirectPath =
          typeof body.redirectPath === "string" &&
          body.redirectPath.startsWith("/") &&
          !body.redirectPath.startsWith("//")
            ? body.redirectPath
            : "/admin";
        const { error } = await admin
          .from("google_oauth_states")
          .insert({ state, user_id: user.id, redirect_path: redirectPath, purpose: "mailbox" });
        if (error) throw error;
        const params = new URLSearchParams({
          client_id: Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID")!,
          redirect_uri: `${Deno.env.get("SUPABASE_URL")!}${CALLBACK_PATH}`,
          response_type: "code",
          scope: SCOPE,
          access_type: "offline",
          prompt: "consent",
          login_hint: AGENT_MAILBOX,
          state,
        });
        return json({ authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
      }
      case "sync":
        return json(await syncCountyMailbox(admin));
      case "list": {
        const { data } = await admin
          .from("county_emails")
          .select("id, from_address, subject, text_excerpt, received_at, county, file_names")
          .eq("status", "needs_property")
          .order("received_at", { ascending: false })
          .limit(50);
        return json({ emails: data ?? [] });
      }
      case "assign": {
        if (!body.emailId || !body.propertyId) return json({ error: "emailId and propertyId are required" }, 400);
        await assignCountyEmail(admin, body.emailId, body.propertyId);
        await admin.from("admin_audit_log").insert({
          actor_id: user.id,
          actor_email: user.email ?? "",
          action: "assign_county_email",
          detail: `county email ${body.emailId} -> property ${body.propertyId}`,
        });
        return json({ ok: true });
      }
      case "disconnect": {
        const { data: box } = await admin.from("county_mailbox").select("refresh_token").eq("id", true).maybeSingle();
        if (box?.refresh_token) {
          await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(box.refresh_token as string)}`, {
            method: "POST",
          }).catch(() => {});
        }
        await admin.from("county_mailbox").delete().eq("id", true);
        return json({ ok: true });
      }
      default:
        return json({ error: "unknown action" }, 400);
    }
  } catch (err) {
    console.error("county-mailbox-admin failed:", err);
    return json({ error: err instanceof Error ? err.message : "unknown error" }, 500);
  }
});
