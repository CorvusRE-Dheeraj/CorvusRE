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
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { renderEmailShell, esc } from "../_shared/email-layout.ts";
import { sendEmail, appUrl } from "../_shared/resend.ts";
import { corsHeaders, preflight, jsonError } from "../_shared/cors.ts";

const STAFF_EMAILS = ["pm2@srclandbuilding.com", "pm1@srclandbuilding.com"];

const KIND_LABEL: Record<string, string> = {
  contact: "Contact form message",
  engagement: "Professional-assistance request",
  construction_lead: "Construction project inquiry",
};

const SCOPE_LABEL: Record<string, string> = {
  new_construction: "New Construction",
  addition: "Addition",
  remodeling: "Remodeling",
  interior_fit_out: "Interior Fit-Out",
};

function detailTable(rows: string[]): string {
  return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f8fa; border-radius:12px;">
        <tr><td style="padding:20px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px; line-height:1.8; color:#16233a;">
            ${rows.map((r) => `<tr><td style="padding:2px 0;">${r}</td></tr>`).join("")}
          </table>
        </td></tr>
      </table>`;
}

// A design consultation request (dashboard → Design → "Schedule initial
// consultation call"). Unlike the public forms below, everything is read
// server-side from the caller's own saved design request — the caller must
// be signed in and own it — and the confirmation goes only to that
// account's own email, so this path can't be used to email anyone else.
async function handleConsultation(
  req: Request,
  designRequestId: unknown,
): Promise<Response> {
  if (typeof designRequestId !== "string" || !designRequestId) {
    throw new Error("designRequestId is required.");
  }
  const url = Deno.env.get("SUPABASE_URL")!;
  const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: {
      headers: { Authorization: req.headers.get("Authorization") ?? "" },
    },
  });
  const {
    data: { user },
  } = await caller.auth.getUser();
  if (!user) return jsonError("Sign in to request a consultation.", 401);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: dr } = await admin
    .from("design_requests")
    .select(
      "id, user_id, address, city, scope, sector, building_area, floors, brief, consultation_requested_at, consultation_phone, consultation_best_time, consultation_notes",
    )
    .eq("id", designRequestId)
    .maybeSingle();
  if (!dr || dr.user_id !== user.id)
    return jsonError("Design request not found.", 404);
  if (!dr.consultation_phone) throw new Error("A phone number is required.");

  const { data: profile } = await admin
    .from("profiles")
    .select("first_name, last_name, company_name")
    .eq("id", user.id)
    .maybeSingle();
  const name = [profile?.first_name, profile?.last_name]
    .filter(Boolean)
    .join(" ");
  const location = dr.address ?? dr.city ?? "—";
  const brief = (dr.brief ?? {}) as { budgetLow?: number; budgetHigh?: number };
  const usd = (n?: number) =>
    typeof n === "number" ? `$${n.toLocaleString("en-US")}` : "—";

  const staffRows = [
    name && `<strong>Name:</strong> ${esc(name)}`,
    user.email && `<strong>Email:</strong> ${esc(user.email)}`,
    `<strong>Cell:</strong> ${esc(dr.consultation_phone)}`,
    dr.consultation_best_time &&
      `<strong>Best time to call:</strong> ${esc(dr.consultation_best_time)}`,
    profile?.company_name &&
      `<strong>Company:</strong> ${esc(profile.company_name)}`,
    `<strong>Project:</strong> ${esc(location)}`,
    `<strong>Scope:</strong> ${esc(SCOPE_LABEL[dr.scope ?? ""] ?? dr.scope ?? "—")} · ${esc(dr.sector ?? "commercial")} · ${esc(dr.building_area ?? "?")} sf`,
    `<strong>Design fee range:</strong> ${usd(brief.budgetLow)} – ${usd(brief.budgetHigh)}`,
    dr.consultation_notes &&
      `<strong>Notes:</strong><br>${esc(dr.consultation_notes).replace(/\n/g, "<br>")}`,
  ].filter(Boolean) as string[];

  await sendEmail({
    to: STAFF_EMAILS,
    subject: `CorvusDP — Design consultation request${name ? ` from ${name}` : ""}`,
    html: renderEmailShell({
      eyebrow: "New consultation request",
      heading: "Design consultation call requested",
      bodyHtml: detailTable(staffRows),
      ctaLabel: "Open admin console",
      ctaUrl: `${appUrl()}/admin`,
      footerNote:
        "Sent automatically by CorvusDP when a customer requests a consultation call.",
    }),
  });

  if (user.email) {
    await sendEmail({
      to: user.email,
      subject: "We received your design consultation request",
      html: renderEmailShell({
        eyebrow: "CorvusDP Design",
        heading: "Your consultation request is in",
        bodyHtml: `
          <p style="margin:0 0 16px; font-size:15px; line-height:1.6; color:#16233a;">
            Thanks${profile?.first_name ? `, ${esc(profile.first_name)}` : ""} — our design team will call you at
            <strong>${esc(dr.consultation_phone)}</strong>${dr.consultation_best_time ? ` (${esc(dr.consultation_best_time)})` : ""}
            to talk through your project at <strong>${esc(location)}</strong>.
          </p>
          <p style="margin:0; font-size:14px; line-height:1.6; color:#5b6678;">
            Need to change the number or add anything? Just reply to this email.
          </p>`,
        ctaLabel: "View your design dashboard",
        ctaUrl: `${appUrl()}/dashboard/design`,
        footerNote:
          "You're receiving this because you requested a consultation in CorvusDP.",
      }),
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: corsHeaders,
  });
}

Deno.serve(async (req: Request) => {
  const pf = preflight(req);
  if (pf) return pf;

  try {
    const body = await req.json();
    if (body?.kind === "consultation")
      return await handleConsultation(req, body.designRequestId);
    const { kind, name, email, company, phone, message, meta } = body;
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
      footerNote:
        "Sent automatically by CorvusDP whenever someone submits this form.",
    });

    await sendEmail({
      to: STAFF_EMAILS,
      subject: `CorvusDP — ${label}${name ? ` from ${name}` : ""}`,
      html,
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    console.error("send-inquiry-email failed:", err);
    return jsonError(err instanceof Error ? err.message : "unknown error");
  }
});
