// Deploy via CLI: `supabase functions deploy send-signup-invite`. Requires
// the RESEND_API_KEY secret (separate from Supabase Auth's own SMTP config
// — this function calls Resend's API directly, bypassing Supabase Auth
// entirely, since it must NOT create an account).
//
// Deliberately not admin.inviteUserByEmail() (see admin-create-user, now
// unused) — that creates a real auth.users/profiles row the instant staff
// click Invite, before the invitee has done anything. Per product
// direction, no account should exist until the invitee actually finishes
// signing up themselves (password or Google) — this function only ever
// sends a real, branded email with a link into the app's own sign-up form,
// prefilled via query params (see buildSignupInviteLink in src/lib/admin.ts
// and sign-in.tsx's validateSearch). The account gets created the normal
// way, through supabase.auth.signUp() on that page, same as any organic
// visitor — nothing here has admin/service-role reach into auth.users.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

function emailHtml(signupUrl: string, email: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0; padding:0; background-color:#eef2f4; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef2f4; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 2px 12px rgba(22,35,58,0.08);">
            <tr>
              <td style="background-color:#16233a; background-image:linear-gradient(135deg,#16233a 0%,#1d3b5c 55%,#0f9e6e 100%); padding:36px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:44px; height:44px;">
                      <img src="https://raw.githubusercontent.com/dheeraj-corvusrf/CorvusRF/feature-dev-dheeraj/public/email/corvuspt-logo-badge.png" width="44" height="44" alt="CorvusPT" style="display:block; border-radius:10px;" />
                    </td>
                    <td style="padding-left:12px; vertical-align:middle;">
                      <span style="font-size:22px; font-weight:700; color:#ffffff; letter-spacing:-0.3px;">Corvus<span style="color:#5eead4;">PT</span></span><br />
                      <span style="font-size:12px; color:#b7c4d6; letter-spacing:0.4px; text-transform:uppercase;">AI-Powered Texas Property Tax</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:36px 32px 8px 32px;">
                <p style="margin:0 0 4px 0; font-size:13px; font-weight:700; letter-spacing:1px; text-transform:uppercase; color:#0f9e6e;">You're invited</p>
                <h1 style="margin:0 0 16px 0; font-size:26px; line-height:1.3; color:#16233a;">Welcome to CorvusPT</h1>
                <p style="margin:0 0 20px 0; font-size:15px; line-height:1.65; color:#42506a;">
                  CorvusPT is an AI-powered platform built for Texas commercial and residential
                  property owners. It reads your county's real appraisal data, checks it against
                  comparable properties, and tells you — in plain language — whether you're
                  overpaying and what to do about it.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:4px 32px 28px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td width="50%" style="padding:6px 6px 6px 0; vertical-align:top;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ecfdf5; border-radius:10px;">
                        <tr><td style="padding:14px 16px;">
                          <span style="font-size:18px;">🔍</span>
                          <p style="margin:6px 0 0 0; font-size:13.5px; font-weight:600; color:#0f6b4f;">AI Value &amp; Protest Check</p>
                          <p style="margin:2px 0 0 0; font-size:12.5px; color:#4c6f61;">Flags overassessment and your real savings opportunity.</p>
                        </td></tr>
                      </table>
                    </td>
                    <td width="50%" style="padding:6px 0 6px 6px; vertical-align:top;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef4ff; border-radius:10px;">
                        <tr><td style="padding:14px 16px;">
                          <span style="font-size:18px;">📄</span>
                          <p style="margin:6px 0 0 0; font-size:13.5px; font-weight:600; color:#26467a;">Evidence &amp; Filing, Guided</p>
                          <p style="margin:2px 0 0 0; font-size:12.5px; color:#4c5f7a;">AI reads your evidence, drafts your protest, guides filing.</p>
                        </td></tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td width="50%" style="padding:6px 6px 0 0; vertical-align:top;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fff7ed; border-radius:10px;">
                        <tr><td style="padding:14px 16px;">
                          <span style="font-size:18px;">💰</span>
                          <p style="margin:6px 0 0 0; font-size:13.5px; font-weight:600; color:#9a4a12;">Payments &amp; Refunds</p>
                          <p style="margin:2px 0 0 0; font-size:12.5px; color:#6d5138;">Track deadlines, dues, and savings in one dashboard.</p>
                        </td></tr>
                      </table>
                    </td>
                    <td width="50%" style="padding:6px 0 0 6px; vertical-align:top;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fdf2f8; border-radius:10px;">
                        <tr><td style="padding:14px 16px;">
                          <span style="font-size:18px;">🗂️</span>
                          <p style="margin:6px 0 0 0; font-size:13.5px; font-weight:600; color:#9d2c6a;">BPP Rendition</p>
                          <p style="margin:2px 0 0 0; font-size:12.5px; color:#75425f;">Business personal property, handled the same easy way.</p>
                        </td></tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:4px 32px 36px 32px;" align="center">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="background-color:#0f9e6e; border-radius:10px;">
                      <a href="${signupUrl}" style="display:inline-block; padding:14px 36px; font-size:15px; font-weight:700; color:#ffffff; text-decoration:none;">
                        Create Your Account
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:14px 0 0 0; font-size:12px; color:#8592a6;">This link is unique to you — please don't forward this email.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px; background-color:#f6f8fa; border-top:1px solid #e7ecf1;">
                <p style="margin:0; font-size:12px; line-height:1.6; color:#8592a6;">
                  You're receiving this because someone at CorvusPT invited you to
                  <strong>${email}</strong>. No account has been created — nothing exists until
                  you actually finish signing up. If you weren't expecting this, you can safely
                  ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { email, signupUrl, firstName, lastName, wantsBeta } = await req.json();
    if (!email || !signupUrl) {
      return new Response(JSON.stringify({ error: "email and signupUrl required" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    // Same caller-identity + is_admin check as admin-create-user — this
    // sends real email on someone's behalf, so it's staff-only same as
    // every other admin-* function, even though it never touches auth.users.
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

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) throw new Error("Missing RESEND_API_KEY");

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "CorvusPT <info@corvusre.com>",
        to: email,
        subject: "You're invited to CorvusPT — AI-Powered Texas Property Tax",
        html: emailHtml(signupUrl, email),
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      // Logged in full for debugging, but never shown to the caller — this is
      // Resend's own raw API response (HTTP status, its internal error
      // schema/terminology), not something an admin sending an invite should
      // see verbatim (see invokeEdgeFunction in src/lib/edge-functions.ts,
      // which surfaces this Error's message as-is in the toast).
      console.error(`Resend error ${res.status} sending signup invite:`, text.slice(0, 500));
      throw new Error("Could not send this invite — please check the email address and try again.");
    }

    // Record/update the pending invite — the only trace of this invite
    // until the person actually signs up (handle_new_user() in schema.sql
    // deletes this row the moment a real account for this email exists).
    // email is unique, so a re-invite of the same address updates the
    // existing row's send count/timestamp instead of duplicating it.
    const { data: existing } = await adminClient
      .from("invited_users")
      .select("id, resend_count")
      .eq("email", email)
      .maybeSingle();
    if (existing) {
      await adminClient
        .from("invited_users")
        .update({ last_sent_at: new Date().toISOString(), resend_count: existing.resend_count + 1 })
        .eq("id", existing.id);
    } else {
      await adminClient.from("invited_users").insert({
        email,
        first_name: firstName || null,
        last_name: lastName || null,
        wants_beta: wantsBeta === true,
        invited_by: user.id,
      });
    }

    const { error: auditErr } = await adminClient.from("admin_audit_log").insert({
      actor_id: user.id,
      actor_email: user.email ?? "",
      action: "send_signup_invite",
      target_user_id: null,
      target_email: email,
      detail: "Sent sign-up link — no account created yet",
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
