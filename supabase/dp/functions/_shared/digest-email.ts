import { renderEmailShell, esc } from "./email-layout.ts";
import { sendEmail, appUrl } from "./resend.ts";

export type DigestStats = {
  totalPermits: number;
  pendingPermits: number;
  approvedPermits: number;
  submittedThisWeek: number;
  approvedThisWeek: number;
  unreadNotifications: number;
  upcomingRenewals: number;
};

export async function sendWeeklyDigestEmail(opts: {
  email: string;
  firstName: string | null;
  stats: DigestStats;
  unsubscribeUrl?: string;
}): Promise<void> {
  const s = opts.stats;
  const row = (label: string, value: number, emoji: string) => `
    <tr><td style="padding:9px 0; vertical-align:top; width:26px;">${emoji}</td><td style="padding:9px 0; font-size:14px; color:#16233a;">${value} ${esc(label)}</td></tr>`;

  const rows = [
    s.pendingPermits > 0 ? row("permit(s) in progress", s.pendingPermits, "📋") : "",
    s.approvedThisWeek > 0 ? row("permit(s) approved this week", s.approvedThisWeek, "✅") : "",
    s.submittedThisWeek > 0 ? row("permit(s) submitted this week", s.submittedThisWeek, "📤") : "",
    s.upcomingRenewals > 0 ? row("permit(s) renewing within 30 days", s.upcomingRenewals, "⏰") : "",
    s.unreadNotifications > 0 ? row("unread notification(s)", s.unreadNotifications, "🔔") : "",
  ]
    .filter(Boolean)
    .join("");

  const bodyHtml = `
    <p style="margin:0 0 20px 0; font-size:15px; line-height:1.6; color:#42506a;">
      Here's where things stand on your CorvusDP project${
        opts.firstName ? `, ${esc(opts.firstName)}` : ""
      }:
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f8fa; border-radius:12px;">
      <tr><td style="padding:16px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${rows}
        </table>
      </td></tr>
    </table>`;

  const html = renderEmailShell({
    eyebrow: "Weekly summary",
    heading: "Your CorvusDP week",
    bodyHtml,
    ctaLabel: "Open dashboard",
    ctaUrl: `${appUrl()}/dashboard`,
    footerNote:
      "You're getting this because weekly project updates are on for your CorvusDP account. Turn them off any time from Dashboard → Settings → Notification preferences.",
    unsubscribeUrl: opts.unsubscribeUrl,
  });

  await sendEmail({ to: opts.email, subject: "Your CorvusDP week", html });
}
