// Deploy via the CLI (`supabase functions deploy admin-impersonate-user`).
// Requires public.profiles.is_admin (see supabase/dp/schema.sql) to
// already exist.
//
// Mirrors CorvusPT's own admin-impersonate-user function (same shape and
// same generateLink({type:"magiclink"}) mechanic the CorvusRE login
// bridge itself is built on -- see supabase/dp/functions/
// mint-door-session/index.ts). Returns a real one-time login link for the
// target user; the client opens it in a NEW tab so the admin's own tab
// keeps its own session. Doesn't write admin_audit_log itself -- the
// caller does that client-side via logAdminAction(), same as every other
// admin action in CorvusDP's admin.tsx already does.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { userId, redirectPath } = await req.json();
    if (!userId) {
      return new Response(JSON.stringify({ error: "userId required" }), {
        status: 400,
        headers: corsHeaders,
      });
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

    if (userId === user.id) {
      return new Response(JSON.stringify({ error: "cannot log in as your own account" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    // Looked up server-side from auth.users (never trusting a client-supplied
    // email for something this sensitive) -- this also confirms the target
    // account actually exists.
    const { data: targetUser, error: targetErr } = await adminClient.auth.admin.getUserById(userId);
    if (targetErr || !targetUser?.user?.email) {
      return new Response(JSON.stringify({ error: "user not found" }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    const origin = req.headers.get("origin") ?? Deno.env.get("SUPABASE_URL")!;
    const safeRedirectPath =
      typeof redirectPath === "string" &&
      redirectPath.startsWith("/") &&
      !redirectPath.startsWith("//")
        ? redirectPath
        : "/dashboard";
    const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email: targetUser.user.email,
      options: { redirectTo: new URL(safeRedirectPath, origin).toString() },
    });
    if (linkErr) throw linkErr;
    const actionLink = linkData?.properties?.action_link;
    if (!actionLink) throw new Error("Supabase did not return a login link.");

    return new Response(JSON.stringify({ ok: true, actionLink }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
