// Deploy via Supabase Dashboard (Edge Functions > Deploy a new function > paste this
// file) or the CLI (`supabase functions deploy admin-create-user`). Requires the
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
    const { email, firstName, lastName, phone, redirectPath, wantsBeta } = await req.json();
    if (!email) {
      return new Response(JSON.stringify({ error: "email required" }), {
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
    // identity is established above, to check admin status and perform the creation.
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

    // The existing handle_new_user trigger fires on this insert and creates the
    // profiles row automatically, same as normal public signup. inviteUserByEmail
    // (rather than createUser with an admin-chosen password) sends Supabase's
    // built-in invite email with a one-time link — the new user sets their own
    // password, the admin never sees or picks it for them. redirectTo sends that
    // link to reset-password, which already handles "set a new password for
    // whatever session this link just established" for both recovery and invite.
    //
    // redirectPath comes from the calling admin's own browser (via
    // import.meta.env.BASE_URL, same pattern as billing.ts) since this edge
    // function has no way to know the app's base path on its own — guessing/
    // hardcoding it here is exactly how the Stripe redirect URLs went stale once
    // already when the base path last changed.
    const origin = req.headers.get("origin") ?? Deno.env.get("SUPABASE_URL")!;
    const safeRedirectPath =
      typeof redirectPath === "string" && redirectPath.startsWith("/") && !redirectPath.startsWith("//")
        ? redirectPath
        : "/reset-password";
    // wants_beta mirrors the same metadata key handle_new_user() (see
    // schema.sql) already reads off self-signup — setting it here grants
    // plan='beta' at row-creation instead of the free_ai_review default,
    // for admin-approved beta-access requests.
    const { data: created, error: createErr } = await adminClient.auth.admin.inviteUserByEmail(
      email,
      {
        data: {
          first_name: firstName,
          last_name: lastName,
          phone,
          wants_beta: wantsBeta === true ? "true" : "false",
        },
        redirectTo: new URL(safeRedirectPath, origin).toString(),
      },
    );
    if (createErr) throw createErr;

    const { error: auditErr } = await adminClient.from("admin_audit_log").insert({
      actor_id: user.id,
      actor_email: user.email ?? "",
      action: "create_user",
      target_user_id: created.user?.id ?? null,
      target_email: email,
      detail: `Invited as ${firstName ?? ""} ${lastName ?? ""}`.trim(),
    });
    if (auditErr) console.error("admin_audit_log insert failed:", auditErr);

    return new Response(JSON.stringify({ ok: true, userId: created.user?.id }), {
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
