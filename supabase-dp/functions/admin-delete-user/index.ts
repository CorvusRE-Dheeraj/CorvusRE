// Deploy via the CLI (`supabase functions deploy admin-delete-user`).
// Requires public.profiles.is_admin (see supabase-dp/schema.sql) to
// already exist.
//
// Mirrors CorvusPT's own admin-delete-user function (same shape: caller
// JWT -> service-role is_admin check -> privileged auth.admin.deleteUser
// call). Feature parity was explicitly requested -- CorvusDP's admin
// panel previously had no way to delete a user at all. Unlike CorvusPT's
// version, this doesn't write the admin_audit_log row itself -- CorvusDP's
// own admin.tsx already logs every admin action client-side via
// logAdminAction() (see AdminToggle for the existing pattern), so the
// caller does that after this returns ok, same as every other admin
// action in this app already does.
//
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are
// auto-injected by the Edge Runtime for every function.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

    // Service-role client: trusted, bypasses RLS -- used only after the
    // caller's identity is established above, to check admin status and
    // perform the deletion.
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

    // profiles/projects both cascade on auth.users delete (see
    // supabase-dp/schema.sql) -- this one call cleans up everything owned
    // by this account, same as CorvusPT's equivalent.
    const { error: deleteErr } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteErr) throw deleteErr;

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
