import { renderEmailShell, esc } from "./email-layout.ts";
import { sendEmail, appUrl } from "./resend.ts";

// Never throws — a failed status-change email must never surface as an
// error to whatever action triggered the underlying notification (a permit
// status update, an engagement request).
export async function sendNotificationEmail(opts: {
  email: string;
  title: string;
  body: string | null;
  kind: string;
}): Promise<void> {
  try {
    const eyebrow = opts.kind === "permit_status" ? "Permit update" : "Project update";
    const bodyHtml = `
      <p style="margin:0 0 4px 0; font-size:15px; line-height:1.6; color:#16233a; font-weight:600;">
        ${esc(opts.title)}
      </p>
      ${
        opts.body
          ? `<p style="margin:0 0 20px 0; font-size:14px; line-height:1.6; color:#42506a;">${esc(opts.body)}</p>`
          : `<p style="margin:0 0 20px 0;"></p>`
      }`;

    const html = renderEmailShell({
      eyebrow,
      heading: "Something moved on your project",
      bodyHtml,
      ctaLabel: "Open dashboard",
      ctaUrl: `${appUrl()}/dashboard`,
      footerNote:
        "You're getting this because email notifications are on for your CorvusDP account. Turn them off any time from Dashboard → Settings → Notification preferences.",
    });

    await sendEmail({ to: opts.email, subject: opts.title, html });
  } catch (err) {
    console.error("Notification email failed:", err);
  }
}
