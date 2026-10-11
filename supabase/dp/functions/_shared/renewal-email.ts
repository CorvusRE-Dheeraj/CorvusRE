import { renderEmailShell, esc } from "./email-layout.ts";
import { sendEmail, appUrl } from "./resend.ts";

export async function sendRenewalReminderEmail(opts: {
  email: string;
  permitName: string;
  projectAddress: string | null;
  expiryDate: string;
  daysLeft: number;
  unsubscribeUrl?: string;
}): Promise<void> {
  const urgency = opts.daysLeft <= 7 ? "expires very soon" : "is coming up for renewal";
  const bodyHtml = `
    <p style="margin:0 0 20px 0; font-size:15px; line-height:1.6; color:#42506a;">
      <strong>${esc(opts.permitName)}</strong>${
        opts.projectAddress ? ` for ${esc(opts.projectAddress)}` : ""
      } ${urgency} — it expires on <strong>${esc(opts.expiryDate)}</strong> (${opts.daysLeft} day${
        opts.daysLeft === 1 ? "" : "s"
      } from now).
    </p>
    <p style="margin:0; font-size:14px; line-height:1.6; color:#42506a;">
      Confirm whether this permit needs a renewal application before it lapses, and log the
      outcome on your Approvals tab.
    </p>`;

  const html = renderEmailShell({
    eyebrow: "Renewal reminder",
    heading: `${opts.permitName} ${urgency}`,
    bodyHtml,
    ctaLabel: "Open Approvals",
    ctaUrl: `${appUrl()}/dashboard/approvals`,
    footerNote:
      "You're getting this because email notifications are on for your CorvusDP account. Turn them off any time from Dashboard → Settings → Notification preferences.",
    unsubscribeUrl: opts.unsubscribeUrl,
  });

  await sendEmail({ to: opts.email, subject: `Renewal reminder: ${opts.permitName}`, html });
}
