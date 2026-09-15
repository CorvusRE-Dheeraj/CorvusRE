// Deploy via CLI: `supabase functions deploy delete-my-account`.
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are auto-injected by
// the Edge Runtime — no manual secret configuration needed.
//
// Self-service account deletion — unlike admin-delete-user (which lets staff delete
// ANY other user's account and explicitly forbids self-deletion), this only ever
// deletes the caller's own account, identified from their own JWT. No admin check
// needed: a signed-in user is always authorized to delete themselves.
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

    // Service-role client: trusted, bypasses RLS — used only to perform the
    // deletion itself, after the caller's own identity is established above.
    // properties/protests/documents/bpp_accounts/profiles all reference
    // auth.users with "on delete cascade", so this single call removes
    // everything the user owns.
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { error: deleteErr } = await adminClient.auth.admin.deleteUser(user.id);
    if (deleteErr) throw deleteErr;

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
