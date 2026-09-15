// Shared HTML shell for every CorvusDP transactional email — one navy/amber
// header, card frame, and footer, so the welcome email, status-change
// notification, renewal reminder, and weekly digest all read as the same
// product instead of four independently-styled emails. Inline styles only:
// this renders in email clients, not a browser with the app's stylesheet.
export function renderEmailShell(opts: {
  eyebrow: string;
  heading: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footerNote?: string;
}): string {
  return `<!doctype html>
<html>
  <body style="margin:0; padding:0; background-color:#f4f1ea; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f1ea; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 2px 12px rgba(22,35,58,0.08);">
            <tr>
              <td style="background-color:#16233a; background-image:linear-gradient(135deg,#16233a 0%,#1d3b5c 55%,#d97706 100%); padding:32px;">
                <span style="font-size:20px; font-weight:700; color:#ffffff; letter-spacing:-0.3px;">Corvus<span style="color:#f6b566;">DP</span></span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 32px 8px 32px;">
                <p style="margin:0 0 4px 0; font-size:13px; font-weight:700; letter-spacing:1px; text-transform:uppercase; color:#b45f06;">${opts.eyebrow}</p>
                <h1 style="margin:0 0 12px 0; font-size:24px; line-height:1.3; color:#16233a;">${opts.heading}</h1>
                ${opts.bodyHtml}
              </td>
            </tr>
            ${
              opts.ctaLabel && opts.ctaUrl
                ? `<tr>
              <td style="padding:8px 32px 28px 32px;" align="center">
                <a href="${opts.ctaUrl}" style="display:inline-block; background-color:#d97706; color:#ffffff; font-size:14px; font-weight:700; text-decoration:none; padding:12px 28px; border-radius:8px;">${opts.ctaLabel}</a>
              </td>
            </tr>`
                : `<tr><td style="padding-bottom:16px;"></td></tr>`
            }
            <tr>
              <td style="padding:20px 32px; background-color:#f6f8fa; border-top:1px solid #e7ecf1;">
                <p style="margin:0; font-size:12px; line-height:1.6; color:#8592a6;">
                  ${
                    opts.footerNote ??
                    "CorvusDP — AI-assisted permitting &amp; design. If you didn't expect this email, you can safely ignore it."
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

// Basic HTML-escaping for any real user/city text spliced into a template
// above (permit names, comment text) — none of it should ever be trusted to
// not contain "<" or "&".
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
