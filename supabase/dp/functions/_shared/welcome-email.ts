// Sent from send-welcome-email, called by the client (src/lib/auth.tsx) on
// every SIGNED_IN event — safe to call repeatedly because the caller only
// ever sends once, gated by the atomic profiles.welcome_email_sent_at
// UPDATE ... WHERE ... IS NULL claim. Never throws — a failed welcome email
// must never surface as a sign-in error.
import { renderEmailShell } from "./email-layout.ts";
import { sendEmail, appUrl } from "./resend.ts";

export async function sendWelcomeEmail(opts: {
  email: string;
  firstName: string | null;
}): Promise<void> {
  try {
    const greeting = opts.firstName ? `Welcome, ${opts.firstName}!` : "Welcome to CorvusDP!";

    const bodyHtml = `
      <p style="margin:0 0 20px 0; font-size:15px; line-height:1.6; color:#42506a;">
        CorvusDP turns an address and a project scope into a permitting roadmap and a design
        brief, then tracks the real work — permits, reviews, and the build — in one place.
        Here's what's waiting for you.
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f8fa; border-radius:12px;">
        <tr><td style="padding:20px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13.5px; color:#16233a;">
            <tr><td style="padding:7px 0; vertical-align:top; width:22px;">🏛️</td><td style="padding:7px 0;"><strong>Permitting roadmap</strong> — zoning, feasibility, every required permit, the agencies, fees, and a realistic timeline.</td></tr>
            <tr><td style="padding:7px 0; vertical-align:top;">📐</td><td style="padding:7px 0;"><strong>Design brief</strong> — scope by discipline, a room-level space plan, and a fee basis before you commit to a design contract.</td></tr>
            <tr><td style="padding:7px 0; vertical-align:top;">🏗️</td><td style="padding:7px 0;"><strong>Construction workspace</strong> — pre-construction clearance, inspections, submittals, and subcontractor tracking.</td></tr>
            <tr><td style="padding:7px 0; vertical-align:top;">🔔</td><td style="padding:7px 0;"><strong>Stay current</strong> — status-change emails and reminders as your project moves, on your terms (see Notification Preferences).</td></tr>
          </table>
        </td></tr>
      </table>
      <p style="margin:20px 0 0 0; font-size:12.5px; line-height:1.6; color:#8592a6;">
        Haven't run an analysis yet? Start with one address — no extra sign-up needed, it's already saved to this account.
      </p>`;

    const html = renderEmailShell({
      eyebrow: "Welcome",
      heading: greeting,
      bodyHtml,
      ctaLabel: "Go to my dashboard",
      ctaUrl: `${appUrl()}/dashboard`,
    });

    await sendEmail({ to: opts.email, subject: "Welcome to CorvusDP", html });
  } catch (err) {
    console.error("Welcome email failed:", err);
  }
}
