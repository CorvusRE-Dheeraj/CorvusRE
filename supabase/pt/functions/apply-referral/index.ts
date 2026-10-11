// Deploy via CLI: `supabase functions deploy apply-referral` (JWT-verified —
// the caller must be the signed-in account being credited).
//
// Attaches a referrer to a BRAND-NEW account after the fact. An email signup
// carries the referral code in signUp()'s metadata and handle_new_user()
// resolves it, but a Google signup (OAuth) can't carry metadata, so the shared
// /auth/ screen calls this right after login instead.
//
// Guarded so it can't be used to rewrite referrals later:
//   - only the caller's own profile is touched (id comes from their JWT)
//   - only when referred_by is still empty, and the profile is < 2 hours old
//   - the code must match a real profile's referral_code, and never their own
// A code that doesn't resolve is a silent no-op, same as at signup.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const NEW_ACCOUNT_WINDOW_MS = 2 * 60 * 60 * 1000;

function reply(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { referralCode } = (await req.json()) as { referralCode?: string };
    if (typeof referralCode !== "string" || !/^[A-Za-z0-9]{4,16}$/.test(referralCode)) {
      return reply({ applied: false, reason: "invalid_code" });
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
    if (userErr || !user) return reply({ error: "unauthenticated" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: me, error: meErr } = await admin
      .from("profiles")
      .select("id, referred_by, created_at")
      .eq("id", user.id)
      .maybeSingle();
    if (meErr) throw meErr;
    if (!me) return reply({ applied: false, reason: "no_profile" });
    if (me.referred_by) return reply({ applied: false, reason: "already_referred" });
    if (Date.now() - new Date(me.created_at as string).getTime() > NEW_ACCOUNT_WINDOW_MS) {
      return reply({ applied: false, reason: "account_not_new" });
    }

    const { data: referrer, error: refErr } = await admin
      .from("profiles")
      .select("id")
      .eq("referral_code", referralCode.toUpperCase())
      .maybeSingle();
    if (refErr) throw refErr;
    if (!referrer || referrer.id === user.id) return reply({ applied: false, reason: "no_match" });

    // .is("referred_by", null) again in the write itself so two racing calls
    // can't both win.
    const { data: updated, error: upErr } = await admin
      .from("profiles")
      .update({ referred_by: referrer.id })
      .eq("id", user.id)
      .is("referred_by", null)
      .select("id");
    if (upErr) throw upErr;

    return reply({ applied: (updated?.length ?? 0) > 0 });
  } catch (err) {
    return reply({ error: err instanceof Error ? err.message : "unknown error" }, 500);
  }
});
