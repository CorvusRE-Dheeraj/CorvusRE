// Deploy via CLI: `supabase functions deploy send-staff-notification`.
// Staff alerts via Resend — two real, live call sites (the public /contact
// form, and requestProtest()/requestBppProtest()'s best-effort "a new case
// was requested" alert), sent like every other transactional
// email in this app.
//
// Works for a signed-OUT caller too (the contact form doesn't require
// sign-in) — supabase-js's functions.invoke() always attaches a valid
// Supabase-issued JWT (the session's own, or the anon key when signed out),
// so default JWT verification passes either way; this never calls
// auth.getUser() or requires a real session.
//
// Requires the RESEND_API_KEY secret (shared with every other transactional
// email here).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

// The real, established CorvusPT contact address — same inbox the Service
// Agreement and Appointment of Agent forms already name as the real point
// of contact (see CORVUSPT_CONTACT.email in src/lib/service-agreement.ts).
const STAFF_EMAIL = "properties@srclandbuilding.com";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { subject, message, replyToEmail, replyToName } = (await req.json()) as {
      subject?: string;
      message?: string;
      replyToEmail?: string;
      replyToName?: string;
    };
    if (!subject || !message) {
      return new Response(JSON.stringify({ error: "subject and message are required" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY is not configured" }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    // Best-effort real user attribution — the contact form's own signed-in
    // callers, and requestProtest()/requestBppProtest(), both already pass
    // replyToEmail directly, so this is only a fallback for a caller that
    // didn't. Never blocks the send if it fails.
    let fromCaller: { email?: string; name?: string } = {};
    if (!replyToEmail) {
      try {
        const authHeader = req.headers.get("Authorization") ?? "";
        const callerClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
          { global: { headers: { Authorization: authHeader } } },
        );
        const {
          data: { user },
        } = await callerClient.auth.getUser();
        if (user?.email) fromCaller = { email: user.email };
      } catch {
        // signed-out caller, or lookup failed — fine, just no attribution
      }
    }

    const replyTo = replyToEmail ?? fromCaller.email;
    const fromLine = replyToName ? `${replyToName} <${replyTo ?? "no-reply"}>` : replyTo;

    const html = `<!doctype html>
<html>
  <body style="margin:0; padding:0; background-color:#eef2f4; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef2f4; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 2px 12px rgba(22,35,58,0.08);">
            <tr>
              <td style="background-color:#16233a; background-image:linear-gradient(135deg,#16233a 0%,#1d3b5c 55%,#0f9e6e 100%); padding:32px;">
                <span style="font-size:20px; font-weight:700; color:#ffffff; letter-spacing:-0.3px;">Corvus<span style="color:#5eead4;">PT</span></span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <p style="margin:0 0 4px 0; font-size:13px; font-weight:700; letter-spacing:1px; text-transform:uppercase; color:#0f9e6e;">Staff notification</p>
                <h1 style="margin:0 0 16px 0; font-size:22px; line-height:1.3; color:#16233a;">${subject}</h1>
                ${fromLine ? `<p style="margin:0 0 12px 0; font-size:13px; color:#67788f;">From: ${fromLine}</p>` : ""}
                <p style="margin:0; font-size:15px; line-height:1.6; color:#42506a; white-space:pre-wrap;">${message}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "CorvusPT <info@corvusre.com>",
        to: [STAFF_EMAIL],
        ...(replyTo ? { reply_to: replyTo } : {}),
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      return new Response(JSON.stringify({ error: `Resend ${res.status}: ${detail}` }), {
        status: 502,
        headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
