// Deploy via Supabase Dashboard (Edge Functions > Deploy a new function > paste this
// file) or the CLI (`supabase functions deploy admin-delete-user`). Requires the
// admin schema in supabase/schema.sql (public.profiles.is_admin) to already exist.
//
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are auto-injected by
// the Edge Runtime for every function — no manual secret configuration needed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  // Without this, supabase-js's functions.invoke() parses the body as plain text
  // (a JSON string) instead of a parsed object, based on the response Content-Type.
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { userId } = await req.json();
    if (!userId) {
      return new Response(JSON.stringify({ error: "userId required" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    // Identify the caller from their own JWT (forwarded from the client's session).
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

    // Service-role client: trusted, bypasses RLS — used only after the caller's
    // identity is established above, to check admin status and perform the deletion.
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: profile } = await adminClient
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();
    if (!profile?.is_admin) {
      return new Response(JSON.stringify({ error: "not authorized" }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    if (userId === user.id) {
      return new Response(JSON.stringify({ error: "cannot delete your own account" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    // Captured before deleting — target_email in the audit log needs to survive
    // the row it's describing being gone a moment later.
    const { data: targetProfile } = await adminClient
      .from("profiles")
      .select("email")
      .eq("id", userId)
      .maybeSingle();

    const { error: deleteErr } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteErr) throw deleteErr;

    const { error: auditErr } = await adminClient.from("admin_audit_log").insert({
      actor_id: user.id,
      actor_email: user.email ?? "",
      action: "delete_user",
      target_user_id: null,
      target_email: targetProfile?.email ?? null,
    });
    if (auditErr) console.error("admin_audit_log insert failed:", auditErr);

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
