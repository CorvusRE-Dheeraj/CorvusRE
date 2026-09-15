// Deploy via the CLI (`supabase functions deploy admin-impersonate-user`). Requires
// the admin schema in supabase/schema.sql (public.profiles.is_admin) to already exist.
//
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are auto-injected by
// the Edge Runtime for every function — no manual secret configuration needed.
//
// Returns a real one-time Supabase login link (auth.admin.generateLink, type
// "magiclink") for the target user — the client opens it in a NEW tab (see
// impersonateUser() in src/lib/admin.ts), so the admin's own tab keeps its own
// session and the new tab signs in as the target user. This is the first use of
// generateLink in this codebase; every other privileged action here follows the
// same caller-JWT -> service-role is_admin check -> privileged call -> audit-log
// shape (see admin-create-user, admin-delete-user) and this does too.
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
    // identity is established above, to check admin status and generate the link.
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
    // email for something this sensitive) — this is also what confirms the
    // target account actually exists.
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

    const { error: auditErr } = await adminClient.from("admin_audit_log").insert({
      actor_id: user.id,
      actor_email: user.email ?? "",
      action: "impersonate_user",
      target_user_id: userId,
      target_email: targetUser.user.email,
      detail: "Generated a login link",
    });
    if (auditErr) console.error("admin_audit_log insert failed:", auditErr);

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
