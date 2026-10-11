// Deploy via CLI: `supabase functions deploy apply-beta-signup` (JWT-verified
// -- the caller must be the signed-in account being upgraded).
//
// Grants the free, full-access beta plan to a BRAND-NEW account after the
// fact. A password signup carries the "join as beta tester" checkbox in
// signUp()'s metadata and handle_new_user() reads it directly (wants_beta),
// but a Google signup (OAuth) can't carry metadata, so the shared /auth/
// screen calls this right after login instead -- same split as
// apply-referral, same reason.
//
// Guarded so it can't be used to self-upgrade an existing account later:
//   - only the caller's own profile is touched (id comes from their JWT)
//   - only when the profile is still on the default free plan, and is
//     < 2 hours old
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const NEW_ACCOUNT_WINDOW_MS = 2 * 60 * 60 * 1000;
const DEFAULT_PLAN = "free_ai_review";

function reply(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

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
    if (userErr || !user) return reply({ error: "unauthenticated" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: me, error: meErr } = await admin
      .from("profiles")
      .select("id, plan, created_at")
      .eq("id", user.id)
      .maybeSingle();
    if (meErr) throw meErr;
    if (!me) return reply({ applied: false, reason: "no_profile" });
    if (me.plan !== DEFAULT_PLAN) return reply({ applied: false, reason: "not_default_plan" });
    if (Date.now() - new Date(me.created_at as string).getTime() > NEW_ACCOUNT_WINDOW_MS) {
      return reply({ applied: false, reason: "account_not_new" });
    }

    // .eq("plan", DEFAULT_PLAN) again in the write itself so two racing
    // calls (or a race with some other plan change) can't both win.
    const { data: updated, error: upErr } = await admin
      .from("profiles")
      .update({ plan: "beta" })
      .eq("id", user.id)
      .eq("plan", DEFAULT_PLAN)
      .select("id");
    if (upErr) throw upErr;

    return reply({ applied: (updated?.length ?? 0) > 0 });
  } catch (err) {
    return reply({ error: err instanceof Error ? err.message : "unknown error" }, 500);
  }
});
