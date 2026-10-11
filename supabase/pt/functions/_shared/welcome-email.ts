// Sent from send-welcome-email, called by the client (see src/lib/auth.tsx)
// on every SIGNED_IN event — safe to call repeatedly because the caller
// (send-welcome-email/index.ts) only ever sends once, gated by the atomic
// profiles.welcome_email_sent_at UPDATE ... WHERE ... IS NULL. Never throws
// — a failed welcome email must never surface as a sign-in error.
//
// Carries the beta login link the in-app welcome screen (WelcomeScreen in
// apps/pt/src/components/EngagementPacketHost.tsx) tells the person was sent —
// keep the two wordings in step.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { emailShell, escapeHtml } from "./email-shell.ts";
import { loginUrl } from "./app-url.ts";

export async function sendWelcomeEmail(
  _adminClient: ReturnType<typeof createClient>,
  opts: { userId: string; email: string; firstName: string | null },
): Promise<void> {
  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) throw new Error("Missing RESEND_API_KEY");

    const p = (text: string) => `<span style="display:block; margin:0 0 14px 0;">${text}</span>`;
    const intro = [
      p(
        `${opts.firstName ? `Hi ${escapeHtml(opts.firstName)}, thank` : "Thank"} you for signing up. We’re glad to have you with us.`,
      ),
      p(
        "You’re in control of your property tax protest, but you’re not doing it alone. CorvusPT gives you AI-powered tools, guidance, and support to help you understand your assessment, identify reduction opportunities, organize your evidence, track deadlines, and prepare for each step.",
      ),
      p(
        "When something needs your attention, we’ll help you understand what to do next and why it matters.",
      ),
      p("<strong>Here’s your CorvusPT beta login link</strong> — use the button below any time to sign in."),
    ].join("");

    const html = emailShell({
      eyebrow: "Welcome",
      heading: "Welcome to CorvusPT",
      intro,
      ctaLabel: "Log in to CorvusPT Beta",
      ctaHref: loginUrl("/dashboard"),
      footnote:
        "Once you sign your agreements in CorvusPT, your signed documents will be sent to this email with a link to your client portal. You manage the protest. CorvusPT helps make it easier. If you didn't create this account, please contact support.",
    });

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "CorvusPT <info@corvusre.com>",
        to: opts.email,
        subject: "Welcome to CorvusPT — your beta login link",
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
