// Deploy via CLI: `supabase functions deploy project-chat-notify --no-verify-jwt`.
// Requires RESEND_API_KEY.
//
// Called by the browser right after a Project Chat message is posted
// (src/lib/project-chat.ts). Everything is re-read server-side: the caller
// must be the message's sender. A client message emails the staff inbox; a
// staff reply emails the client (unless they turned email off in Settings).
// At most one email per thread per side every 10 minutes, so a burst of
// short messages doesn't become a burst of emails, and emailed_at is
// claimed atomically so a retry never double-sends.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { renderEmailShell, esc } from "../_shared/email-layout.ts";
import { sendEmail, appUrl } from "../_shared/resend.ts";
import { corsHeaders, preflight, jsonError, readJson, BadRequestError, errorResponse } from "../_shared/cors.ts";

const STAFF_EMAILS = ["pm2@srclandbuilding.com", "pm1@srclandbuilding.com"];
const QUIET_MINUTES = 10;

const ok = (body: Record<string, unknown>) =>
  new Response(JSON.stringify({ ok: true, ...body }), { status: 200, headers: corsHeaders });

Deno.serve(async (req: Request) => {
  const pf = preflight(req);
  if (pf) return pf;
  try {
    const { messageId } = await readJson(req);
    if (typeof messageId !== "string" || !messageId) throw new BadRequestError("messageId is required");

    const url = Deno.env.get("SUPABASE_URL")!;
    const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const {
      data: { user },
    } = await caller.auth.getUser();
    if (!user) return jsonError("unauthenticated", 401);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: m, error } = await admin
      .from("project_messages")
      .select("id, owner_id, project_id, design_request_id, sender_id, sender_role, body, emailed_at, created_at")
      .eq("id", messageId)
      .maybeSingle();
    if (error) throw error;
    if (!m) return jsonError("message not found", 404);
    if (m.sender_id !== user.id) return jsonError("forbidden", 403);
    if (m.emailed_at) return ok({ sent: false, reason: "already_sent" });

    // Quiet period: skip if this side already triggered an email for this
    // thread in the last few minutes.
    const since = new Date(Date.now() - QUIET_MINUTES * 60_000).toISOString();
    let recent = admin
      .from("project_messages")
      .select("id", { count: "exact", head: true })
      .eq("sender_role", m.sender_role)
      .not("emailed_at", "is", null)
      .gte("emailed_at", since);
    recent = m.project_id ? recent.eq("project_id", m.project_id) : recent.eq("design_request_id", m.design_request_id);
    const { count } = await recent;
    if ((count ?? 0) > 0) return ok({ sent: false, reason: "quiet_period" });

    const { data: claimed } = await admin
      .from("project_messages")
      .update({ emailed_at: new Date().toISOString() })
      .eq("id", m.id)
      .is("emailed_at", null)
      .select("id");
    if (!claimed?.length) return ok({ sent: false, reason: "already_sent" });

    // The thread's name, for the subject line.
    let name = "your project";
    let kind: "permitting" | "design" = "permitting";
    if (m.project_id) {
      const { data: p } = await admin.from("projects").select("name, address").eq("id", m.project_id).maybeSingle();
      name = p?.name ?? p?.address ?? name;
    } else {
      kind = "design";
      const { data: d } = await admin
        .from("design_requests")
        .select("project_name, address, city")
        .eq("id", m.design_request_id)
        .maybeSingle();
      name = d?.project_name ?? d?.address ?? d?.city ?? name;
    }
    const { data: owner } = await admin
      .from("profiles")
      .select("email, first_name, last_name, notification_prefs")
      .eq("id", m.owner_id)
      .maybeSingle();
    const quote = `<div style="margin:0 0 16px; padding:14px 16px; background:#f6f8fa; border-radius:10px; font-size:15px; line-height:1.6; color:#16233a; white-space:pre-wrap;">${esc(m.body)}</div>`;

    if (m.sender_role === "client") {
      const who = [owner?.first_name, owner?.last_name].filter(Boolean).join(" ") || owner?.email || "A client";
      await sendEmail({
        to: STAFF_EMAILS,
        subject: `CorvusDP — New project chat message from ${who} (${name})`,
        html: renderEmailShell({
          eyebrow: "Project Chat",
          heading: `${esc(who)} asked about ${esc(name)}`,
          bodyHtml: quote,
          ctaLabel: "Reply in the admin console",
          ctaUrl: `${appUrl()}/admin`,
          footerNote: "Sent automatically by CorvusDP when a client writes in Project Chat.",
        }),
      });
      return ok({ sent: true, to: "staff" });
    }

    const prefs = (owner?.notification_prefs ?? {}) as { email?: boolean };
    if (!owner?.email || prefs.email === false) return ok({ sent: false, reason: "client_email_off" });
    const id = m.project_id ?? m.design_request_id;
    await sendEmail({
      to: owner.email,
      subject: `New reply about ${name}`,
      html: renderEmailShell({
        eyebrow: "Project Chat",
        heading: `The CorvusDP team replied about ${esc(name)}`,
        bodyHtml: quote,
        ctaLabel: "Open the chat",
        ctaUrl: `${appUrl()}/dashboard/chat?type=${kind}&id=${id}`,
        footerNote: "You're receiving this because you have a CorvusDP project with us.",
      }),
    });
    return ok({ sent: true, to: "client" });
  } catch (err) {
    return errorResponse(err);
  }
});
