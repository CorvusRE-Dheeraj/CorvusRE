// Deploy via CLI: `supabase functions deploy admin-update-plan`.
//
// Replaces a direct client-side `supabase.from("profiles").update({ plan })` —
// the "Users can update their own profile" RLS policy only checks row ownership,
// not which columns are being changed, and Postgres column grants now restrict
// `plan` to service-role writes only (see supabase/schema.sql). This function is
// that service-role write, gated on the caller actually being an admin.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const VALID_PLANS = [
  "free_ai_review",
  "ai_report",
  "managed_protest",
  "owner_managed",
  "corvusrf_managed",
  "beta",
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { userId, plan, targetEmail, previousPlan } = await req.json();
    if (!userId || !VALID_PLANS.includes(plan)) {
      return new Response(JSON.stringify({ error: "userId and a valid plan are required" }), {
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

    // Service-role client: trusted, bypasses RLS/column grants — used only after
    // the caller's identity is established above, to check admin status and
    // perform the update.
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

    const { error: updateErr } = await adminClient
      .from("profiles")
      .update({ plan })
      .eq("id", userId);
    if (updateErr) throw updateErr;

    const { error: auditErr } = await adminClient.from("admin_audit_log").insert({
      actor_id: user.id,
      actor_email: user.email ?? "",
      action: "update_plan",
      target_user_id: userId,
      target_email: targetEmail ?? null,
      detail: previousPlan ? `${previousPlan} → ${plan}` : `set to ${plan}`,
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
