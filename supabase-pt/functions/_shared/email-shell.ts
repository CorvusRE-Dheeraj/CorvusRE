// Shared branded HTML shell for CorvusPT's simpler transactional emails
// (cron-triggered reminders/confirmations, not the richer welcome/purchase
// templates which have their own bespoke layouts). Same header gradient,
// colors and footer as welcome-email.ts — extracted here once a second
// caller needed the identical chrome, rather than duplicating it a third
// time inline.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function emailShell(opts: {
  eyebrow: string;
  heading: string;
  /** Inner HTML — caller controls markup, so build it with escapeHtml() on any user/DB-sourced text. */
  intro: string;
  /** Inner HTML for a <table> of <tr> rows shown in a light card below the intro. Optional. */
  bodyRows?: string;
  ctaLabel: string;
  ctaHref: string;
  footnote?: string;
  /** A one-click, no-login link to turn this specific reminder off — shown in the footer. */
  unsubscribeUrl?: string;
}): string {
  return `<!doctype html>
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
                <p style="margin:0 0 4px 0; font-size:13px; font-weight:700; letter-spacing:1px; text-transform:uppercase; color:#0f9e6e;">${escapeHtml(opts.eyebrow)}</p>
                <h1 style="margin:0 0 12px 0; font-size:24px; line-height:1.3; color:#16233a;">${escapeHtml(opts.heading)}</h1>
                <p style="margin:0 0 20px 0; font-size:15px; line-height:1.6; color:#42506a;">${opts.intro}</p>
              </td>
            </tr>
            ${
              opts.bodyRows
                ? `<tr>
              <td style="padding:0 32px 8px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f8fa; border-radius:12px;">
                  <tr><td style="padding:20px 24px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13.5px; color:#16233a;">
                      ${opts.bodyRows}
                    </table>
                  </td></tr>
                </table>
              </td>
            </tr>`
                : ""
            }
            <tr>
              <td style="padding:24px 32px 8px 32px;" align="center">
                <a href="${opts.ctaHref}" style="display:inline-block; background-color:#0f9e6e; color:#ffffff; font-size:14px; font-weight:700; text-decoration:none; padding:12px 28px; border-radius:8px;">${escapeHtml(opts.ctaLabel)}</a>
              </td>
            </tr>
            ${
              opts.footnote
                ? `<tr>
              <td style="padding:16px 32px 32px 32px;">
                <p style="margin:0; font-size:12.5px; line-height:1.6; color:#8592a6;">${escapeHtml(opts.footnote)}</p>
              </td>
            </tr>`
                : ""
            }
            <tr>
              <td style="padding:20px 32px; background-color:#f6f8fa; border-top:1px solid #e7ecf1;">
                <p style="margin:0; font-size:12px; line-height:1.6; color:#8592a6;">
                  CorvusPT — AI-Powered Texas Property Tax.
                  ${
                    opts.unsubscribeUrl
                      ? ` <a href="${opts.unsubscribeUrl}" style="color:#8592a6; text-decoration:underline;">Manage email preferences</a>`
                      : ""
                  }
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
