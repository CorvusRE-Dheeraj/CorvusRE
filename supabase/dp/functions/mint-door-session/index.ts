// Deploy via the CLI (`supabase functions deploy mint-door-session`).
// Requires public.corvusre_email_has_account(text) to already exist
// (see supabase/dp/schema.sql).
// (Redeployed automatically by .github/workflows/deploy.yml's deploy-functions job on merge to dev.)
//
// CorvusRE login bridge (Phase 4): CorvusPT is the shared identity source
// (see the migration plan — no new/paid Supabase project was created for
// this). This function is the DP-side half of "one login, separate
// databases" — given a caller's already-verified CorvusPT session, it
// silently establishes a real CorvusDP session for the same person,
// WITHOUT ever merging the two projects' auth.users tables.
//
// Mechanics (confirmed against this exact project via a live spike before
// writing this function, not assumed from docs):
//   1. auth.admin.generateLink({type:"magiclink", email}) auto-CREATES the
//      user if that email has no CorvusDP account yet (confirmed: a fresh
//      email comes back with properties.verification_type "signup"). This
//      used to be treated as a problem to guard against (existence checked
//      first, request refused for a new email) — now it's exactly what's
//      wanted: every /sign-in landing on every door goes through the shared
//      identity screen (apps/identity), so THIS is the only place a first-
//      time CorvusDP visitor's account actually gets created. It arrives
//      with no name/company/referral/etc — see apps/dp/src/components/
//      ProfileGate.tsx, which collects those right after, the first time a
//      nameless account lands on a real page.
//   2. auth.users isn't exposed over PostgREST and the admin /admin/users
//      REST endpoint's `email` query param is silently ignored (confirmed
//      empirically) — corvusre_email_has_account() is a SECURITY DEFINER
//      RPC built specifically to answer this safely. Still called below,
//      now only to report `isNewAccount` to the caller, not to block it.
//   3. properties.hashed_token + properties.verification_type from
//      generateLink are what the client passes to `supabase.auth.verifyOtp
//      ({ token_hash, type })` to get a real session with no redirect/new
//      tab (the type must be the verification_type Supabase actually
//      returned — "magiclink" for an existing user, "signup" for a brand
//      new one, confirmed live).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

// CorvusPT is the identity source. Its anon key is a public, client-side-by-
// design value (same one CorvusPT's own frontend ships) — safe to embed
// here for the sole purpose of verifying a caller-supplied PT access token.
const PT_URL = "https://iotzuhuajbsxxuccuihn.supabase.co";
const PT_ANON_KEY = "sb_publishable_RpyqtM6EeGiT7qc3FyN5Iw_vm0aiuM3";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { ptAccessToken, referralCode } = await req.json();
    if (!ptAccessToken || typeof ptAccessToken !== "string") {
      return new Response(JSON.stringify({ error: "ptAccessToken required" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    // Verify the caller's identity against CorvusPT — never trust a
    // client-supplied email for something this sensitive.
    const ptClient = createClient(PT_URL, PT_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${ptAccessToken}` } },
    });
    const {
      data: { user: ptUser },
      error: ptErr,
    } = await ptClient.auth.getUser();
    if (ptErr || !ptUser?.email) {
      return new Response(JSON.stringify({ error: "not signed in on CorvusPT" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Checked only to tell the caller whether this is a first-ever CorvusDP
    // account (so it knows to run ProfileGate) — no longer used to refuse
    // the bridge. A failure here isn't fatal to signing the person in, so
    // it degrades to "assume not new" rather than throwing.
    const { data: hasAccount } = await adminClient.rpc("corvusre_email_has_account", {
      check_email: ptUser.email,
    });
    const isNewAccount = !hasAccount;

    const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email: ptUser.email,
      // A referral code (from a ?ref= link the visitor landed on) only means
      // anything at account creation -- handle_new_user() resolves it into a
      // real referred_by server-side, and an unknown/tampered code just
      // resolves to null. Never sent for an existing account, and shape-
      // checked here so arbitrary text can't ride into the metadata.
      ...(isNewAccount && typeof referralCode === "string" && /^[A-Za-z0-9]{4,16}$/.test(referralCode)
        ? { options: { data: { referral_code_used: referralCode } } }
        : {}),
    });
    if (linkErr) throw linkErr;
    const hashedToken = linkData?.properties?.hashed_token;
    const verificationType = linkData?.properties?.verification_type;
    if (!hashedToken || !verificationType) {
      throw new Error("Supabase did not return a verifiable token.");
    }

    return new Response(
      JSON.stringify({
        ok: true,
        email: ptUser.email,
        hashedToken,
        verificationType,
        isNewAccount,
      }),
      { status: 200, headers: corsHeaders },
    );
  } catch (err) {
    console.error("mint-door-session failed:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
