// Sent from send-welcome-email, called by the client (see src/lib/auth.tsx)
// on every SIGNED_IN event — safe to call repeatedly because the caller
// (send-welcome-email/index.ts) only ever sends once, gated by the atomic
// profiles.welcome_email_sent_at UPDATE ... WHERE ... IS NULL. Never throws
// — a failed welcome email must never surface as a sign-in error.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function sendWelcomeEmail(
  adminClient: ReturnType<typeof createClient>,
  opts: { userId: string; email: string; firstName: string | null },
): Promise<void> {
  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) throw new Error("Missing RESEND_API_KEY");

    const greeting = opts.firstName ? `Welcome, ${opts.firstName}!` : "Welcome to CorvusPT!";
    const appUrl = Deno.env.get("APP_URL") ?? "https://corvuspt.com";

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
              <td style="padding:32px 32px 8px 32px;">
                <p style="margin:0 0 4px 0; font-size:13px; font-weight:700; letter-spacing:1px; text-transform:uppercase; color:#0f9e6e;">Welcome</p>
                <h1 style="margin:0 0 12px 0; font-size:24px; line-height:1.3; color:#16233a;">${greeting}</h1>
                <p style="margin:0 0 20px 0; font-size:15px; line-height:1.6; color:#42506a;">
                  CorvusPT uses AI to help you protest an unfair Texas property tax valuation, from your
                  first look at the numbers all the way through a filed case. Here's what's waiting for you.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 8px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f8fa; border-radius:12px;">
                  <tr><td style="padding:20px 24px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13.5px; color:#16233a;">
                      <tr><td style="padding:7px 0; vertical-align:top; width:22px;">🔍</td><td style="padding:7px 0;"><strong>10 AI modules</strong> — a free health-score preview, then a full report covering strategy, comps, condition, zoning, income, and evidence.</td></tr>
                      <tr><td style="padding:7px 0; vertical-align:top;">📎</td><td style="padding:7px 0;"><strong>Evidence Building</strong> — upload your documents and AI sorts and scores them against your case automatically.</td></tr>
                      <tr><td style="padding:7px 0; vertical-align:top;">📝</td><td style="padding:7px 0;"><strong>Filing, done for you</strong> — pre-filled Texas Comptroller forms, e-signature, and county filing guidance.</td></tr>
                      <tr><td style="padding:7px 0; vertical-align:top;">📅</td><td style="padding:7px 0;"><strong>Your case, start to finish</strong> — Informal Review, Hearing, and Decision & Appeal, tracked in one place.</td></tr>
                    </table>
                  </td></tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 8px 32px;" align="center">
                <a href="${appUrl}/dashboard/properties" style="display:inline-block; background-color:#0f9e6e; color:#ffffff; font-size:14px; font-weight:700; text-decoration:none; padding:12px 28px; border-radius:8px;">Go to My Properties</a>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 32px 32px;">
                <p style="margin:0; font-size:12.5px; line-height:1.6; color:#8592a6;">
                  Add a property any time to get its free AI Property Health Score — no card required to see it.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px; background-color:#f6f8fa; border-top:1px solid #e7ecf1;">
                <p style="margin:0; font-size:12px; line-height:1.6; color:#8592a6;">
                  CorvusPT — AI-Powered Texas Property Tax. If you didn't create this account, please contact support.
                </p>
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
        to: opts.email,
        subject: "Welcome to CorvusPT",
        html,
      }),
    });
    if (!res.ok) {
      console.error(`Resend error ${res.status} sending welcome email:`, await res.text());
    }
  } catch (err) {
    console.error("Welcome email failed:", err);
  }
}
