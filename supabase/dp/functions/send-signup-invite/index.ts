// Deploy via CLI: `supabase functions deploy send-signup-invite --no-verify-jwt`.
// Requires RESEND_API_KEY.
//
// Admin-only — staff inviting a prospect directly (the admin "Invited
// Users" tab), a different flow from the peer-to-peer referral invite.
// Verifies the caller is really an admin server-side before sending or
// writing anything; re-inviting the same address bumps resend_count/
// last_sent_at on the existing row instead of duplicating.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { renderEmailShell, esc } from "../_shared/email-layout.ts";
import { sendEmail, appUrl } from "../_shared/resend.ts";
import { corsHeaders, preflight, jsonError } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  const pf = preflight(req);
  if (pf) return pf;

  try {
    const { email, firstName, lastName } = await req.json();
    if (!email || typeof email !== "string" || !email.includes("@")) {
      throw new Error("A valid email address is required.");
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
    if (userErr || !user) return jsonError("unauthenticated", 401);

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: callerProfile } = await adminClient
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .maybeSingle();
    if (!callerProfile?.is_admin) return jsonError("forbidden", 403);

    const normalized = (email as string).trim().toLowerCase();
    const name = [firstName, lastName].filter(Boolean).join(" ").trim();

    const bodyHtml = `
      <p style="margin:0 0 20px 0; font-size:15px; line-height:1.6; color:#42506a;">
        ${name ? `Hi ${esc(name)},` : "Hi,"} you've been invited to CorvusDP — turn an address and a
        project scope into a permitting roadmap and a design brief, then track the real work in one
        place.
      </p>`;

    const html = renderEmailShell({
      eyebrow: "You've been invited",
      heading: "Join CorvusDP",
      bodyHtml,
      ctaLabel: "Create your account",
      // mode=signup is required, not cosmetic -- a plain /sign-in visit with
      // no mode/ref now redirects to the shared cross-door identity sign-in
      // (see apps/dp/src/routes/sign-in.tsx), which is a DIFFERENT Supabase
      // project (CorvusPT's). Without this, an invitee lands there instead
      // of CorvusDP's own signup form, and if that email already has an
      // identity-side account, Supabase's real "already registered" error
      // shows up looking like they can't create a CorvusDP account at all.
      ctaUrl: `${appUrl()}/sign-in?mode=signup&email=${encodeURIComponent(normalized)}`,
    });

    await sendEmail({ to: normalized, subject: "You've been invited to CorvusDP", html });

    const { data: existing } = await adminClient
      .from("invited_users")
      .select("id, resend_count")
      .eq("email", normalized)
      .maybeSingle();

    if (existing) {
      await adminClient
        .from("invited_users")
        .update({
          last_sent_at: new Date().toISOString(),
          resend_count: ((existing.resend_count as number) ?? 0) + 1,
        })
        .eq("id", existing.id);
    } else {
      await adminClient.from("invited_users").insert({
        email: normalized,
        first_name: firstName ?? null,
        last_name: lastName ?? null,
        invited_by: user.id,
      });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("send-signup-invite failed:", err);
    return jsonError(err instanceof Error ? err.message : "unknown error");
  }
});
