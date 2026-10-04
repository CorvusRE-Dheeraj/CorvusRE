// Deploy via CLI: `supabase functions deploy send-inquiry-email --no-verify-jwt`.
// Requires RESEND_API_KEY.
//
// One notification path for every real, intentional inquiry CorvusDP
// receives — the contact form, a "proceed with professional assistance"
// engagement request, and the construction intake form — all forwarded to
// the same staff inbox. Deliberately NOT wired to the passive lead capture
// that fires in the background during the anonymous permitting/design
// wizards (src/lib/leads.ts captureLead) — that's routine product usage,
// not someone reaching out, and would flood the inbox; those stay
// admin-panel-only via the Leads tab, same as before.
//
// No auth required — same posture as the public contact form it replaces
// (this app's other guest-accessible functions, e.g. the permitting/design
// analyzers, already accept anonymous callers). Worst case is a fake
// inquiry, the same risk any public contact form already carries.
import { renderEmailShell, esc } from "../_shared/email-layout.ts";
import { sendEmail } from "../_shared/resend.ts";
import { corsHeaders, preflight, jsonError } from "../_shared/cors.ts";

const STAFF_EMAILS = ["pm2@srclandbuilding.com", "pm1@srclandbuilding.com"];

const KIND_LABEL: Record<string, string> = {
  contact: "Contact form message",
  engagement: "Professional-assistance request",
  construction_lead: "Construction project inquiry",
};

Deno.serve(async (req: Request) => {
  const pf = preflight(req);
  if (pf) return pf;

  try {
    const { kind, name, email, company, phone, message, meta } = await req.json();
    if (!kind || typeof kind !== "string" || !KIND_LABEL[kind]) {
      throw new Error("A valid inquiry kind is required.");
    }

    const label = KIND_LABEL[kind];
    const rows: string[] = [];
    if (name) rows.push(`<strong>Name:</strong> ${esc(String(name))}`);
    if (email) rows.push(`<strong>Email:</strong> ${esc(String(email))}`);
    if (phone) rows.push(`<strong>Phone:</strong> ${esc(String(phone))}`);
    if (company) rows.push(`<strong>Company:</strong> ${esc(String(company))}`);
    if (message) {
      rows.push(
        `<strong>Message:</strong><br>${esc(String(message)).replace(/\n/g, "<br>")}`,
      );
    }
    if (meta && typeof meta === "object") {
      for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
        if (v === null || v === undefined || v === "") continue;
        rows.push(`<strong>${esc(k)}:</strong> ${esc(String(v))}`);
      }
    }

    const bodyHtml = `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f8fa; border-radius:12px;">
        <tr><td style="padding:20px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px; line-height:1.8; color:#16233a;">
            ${rows.map((r) => `<tr><td style="padding:2px 0;">${r}</td></tr>`).join("")}
          </table>
        </td></tr>
      </table>`;

    const html = renderEmailShell({
      eyebrow: "New inquiry",
      heading: label,
      bodyHtml,
      ctaLabel: "Open admin console",
      ctaUrl: `https://corvusre.com/corvusdp/admin`,
      footerNote: "Sent automatically by CorvusDP whenever someone submits this form.",
    });

    await sendEmail({
      to: STAFF_EMAILS,
      subject: `CorvusDP — ${label}${name ? ` from ${name}` : ""}`,
      html,
    });

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("send-inquiry-email failed:", err);
    return jsonError(err instanceof Error ? err.message : "unknown error");
  }
});
