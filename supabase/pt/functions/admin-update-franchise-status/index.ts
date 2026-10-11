// Deploy via CLI: `supabase functions deploy admin-update-franchise-status`.
//
// Marks/unmarks a profile as a verified franchise owner, which makes every
// new property checkout for that account carry the 50%-off franchise coupon
// (see ../_shared/discounts.ts). Same service-role + server-side is_admin
// check as admin-update-admin-status — profiles.is_franchise_owner is not
// client-writable (see the column grants in supabase/pt/schema.sql), so a
// customer can't grant themselves the discount.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { userId, isFranchiseOwner, targetEmail } = await req.json();
    if (!userId || typeof isFranchiseOwner !== "boolean") {
      return new Response(
        JSON.stringify({ error: "userId and a boolean isFranchiseOwner are required" }),
        { status: 400, headers: corsHeaders },
      );
    }

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
      .update({ is_franchise_owner: isFranchiseOwner })
      .eq("id", userId);
    if (updateErr) throw updateErr;

    const { error: auditErr } = await adminClient.from("admin_audit_log").insert({
      actor_id: user.id,
      actor_email: user.email ?? "",
      action: "update_franchise_status",
      target_user_id: userId,
      target_email: targetEmail ?? null,
      detail: isFranchiseOwner
        ? "marked as franchise owner (50% off new subscriptions)"
        : "removed franchise owner status",
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
