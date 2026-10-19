// Marketing email sending — served by the admin-update-plan router as
// ?action=marketing-send (Supabase's 100-function limit).
//
// Body (one of):
//   { campaignId }  send an approved/scheduled email campaign to its audience now
//   { followupId }  send one email follow-up and mark it done
//   { process: "due" }  send every scheduled campaign whose time has come, run
//                       the status rules + lead monitor, and email each staff
//                       member a digest of what needs them (the hourly
//                       marketing-due cron job)
//
// Callers: a Marketing Admin / Super Admin (their JWT), or the cron job (the
// service-role key). Every email carries a one-click unsubscribe link; leads
// who unsubscribed or are marked Do Not Contact are never emailed. Each send is written to the lead's
// history (marketing_activities) so Leads, Follow-ups and Analytics agree.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { emailShell, escapeHtml } from "../email-shell.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

const SITE = Deno.env.get("PUBLIC_SITE_URL") ?? "https://corvusre.com/corvuspt";
const FROM = "CorvusPT <info@corvusre.com>";
const MAX_RECIPIENTS = 300;

type Lead = {
  id: string;
  full_name: string | null;
  email: string | null;
  stage: string;
  county: string | null;
  property_type: string | null;
  property_address: string | null;
  unsubscribe_token: string;
};

function personalize(text: string, lead: Lead): string {
  const first = (lead.full_name ?? "").trim().split(/\s+/)[0] || "there";
  return text
    .replaceAll("{{first_name}}", first)
    .replaceAll("{{name}}", lead.full_name ?? "there")
    .replaceAll("{{property_address}}", lead.property_address ?? "your property")
    .replaceAll("{{county}}", lead.county ?? "your county");
}

function renderEmail(subject: string, body: string, lead: Lead): string {
  const paragraphs = personalize(body, lead)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;">${escapeHtml(p.trim()).replaceAll("\n", "<br>")}</p>`)
    .join("");
  return emailShell({
    eyebrow: "CorvusPT",
    heading: escapeHtml(personalize(subject, lead)),
    intro: paragraphs,
    unsubscribeUrl: `${SITE}/unsubscribe?t=${lead.unsubscribe_token}`,
  });
}

async function sendOne(resendKey: string, to: string, subject: string, html: string, unsubUrl: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject,
      html,
      headers: { "List-Unsubscribe": `<${unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function audienceFor(db: SupabaseClient, audience: Record<string, unknown>): Promise<Lead[]> {
  let q = db
    .from("marketing_leads")
    .select("id, full_name, email, stage, county, property_type, property_address, unsubscribe_token")
    .is("unsubscribed_at", null)
    .not("email", "is", null)
    .neq("stage", "do_not_contact")
    .limit(MAX_RECIPIENTS);
  // Same rule as audienceLeads() in apps/pt/src/lib/marketing.ts.
  const ids = audience.leadIds as string[] | undefined;
  if (ids?.length) q = q.in("id", ids);
  else {
    const stages = audience.stages as string[] | undefined;
    if (stages?.length) q = q.in("stage", stages);
    else q = q.neq("stage", "not_interested");
    const counties = audience.counties as string[] | undefined;
    if (counties?.length) q = q.overlaps("counties", counties);
    const types = audience.propertyTypes as string[] | undefined;
    if (types?.length) q = q.overlaps("property_types", types);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Lead[];
}

async function sendCampaign(db: SupabaseClient, resendKey: string, campaignId: string, actor: string | null) {
  const { data: c, error } = await db.from("marketing_campaigns").select("*").eq("id", campaignId).single();
  if (error || !c) throw new Error("Campaign not found");
  if (c.channel !== "email") throw new Error("SMS isn't connected yet — only email campaigns can be sent.");
  if (!["approved", "scheduled"].includes(c.status)) throw new Error(`A ${c.status} campaign can't be sent — approve it first.`);
  if (!c.subject || !c.body) throw new Error("Add a subject and message before sending.");
  await db.from("marketing_campaigns").update({ status: "sending" }).eq("id", campaignId);
  const leads = await audienceFor(db, c.audience ?? {});
  let sent = 0, failed = 0;
  const errors: string[] = [];
  for (const lead of leads) {
    const unsub = `${SITE}/unsubscribe?t=${lead.unsubscribe_token}`;
    try {
      await sendOne(resendKey, lead.email!, personalize(c.subject, lead), renderEmail(c.subject, c.body, lead), unsub);
      sent++;
      await db.from("marketing_activities").insert({
        lead_id: lead.id, campaign_id: campaignId, kind: "email",
        summary: `Campaign email: ${c.name}`, body: personalize(c.subject, lead), created_by: actor,
      });
      await db.from("marketing_leads").update({ last_contacted_at: new Date().toISOString() }).eq("id", lead.id);
    } catch (e) {
      failed++;
      if (errors.length < 5) errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  const stats = { targeted: leads.length, sent, failed, errors };
  await db.from("marketing_campaigns")
    .update({ status: "sent", sent_at: new Date().toISOString(), stats })
    .eq("id", campaignId);
  await db.from("marketing_activities").insert({
    campaign_id: campaignId, kind: "campaign",
    summary: `Campaign "${c.name}" sent to ${sent} of ${leads.length}${failed ? ` (${failed} failed)` : ""}`,
    created_by: actor,
  });
  // status follows the approved rules (e.g. Ready for Outreach → Contacted)
  await db.rpc("marketing_apply_rules", { p_lead: null });
  return stats;
}

async function sendFollowup(db: SupabaseClient, resendKey: string, followupId: string, actor: string | null) {
  const { data: f, error } = await db
    .from("marketing_followups")
    .select("*, lead:marketing_leads(id, full_name, email, stage, county, property_type, property_address, unsubscribe_token, unsubscribed_at, assigned_to)")
    .eq("id", followupId)
    .single();
  if (error || !f) throw new Error("Follow-up not found");
  if (f.status !== "pending") throw new Error("This follow-up is already done.");
  if (f.channel !== "email") throw new Error("Only email follow-ups can be sent from here — mark calls and tasks done instead.");
  const lead = f.lead as Lead & { unsubscribed_at: string | null };
  if (!lead?.email) throw new Error("This lead has no email address.");
  if (lead.unsubscribed_at) throw new Error("This lead unsubscribed from marketing email.");
  if (lead.stage === "do_not_contact") throw new Error("This lead is marked Do Not Contact.");
  if (!f.message) throw new Error("Write or generate the message first.");
  const subject = f.subject || "Following up";
  await sendOne(resendKey, lead.email, personalize(subject, lead), renderEmail(subject, f.message, lead), `${SITE}/unsubscribe?t=${lead.unsubscribe_token}`);
  const now = new Date().toISOString();
  await db.from("marketing_followups").update({ status: "done", completed_at: now }).eq("id", followupId);
  await db.from("marketing_activities").insert({
    lead_id: lead.id, kind: "email", summary: `Follow-up email: ${personalize(subject, lead)}`, body: personalize(f.message, lead), created_by: actor,
  });
  await db.from("marketing_leads").update({ last_contacted_at: now }).eq("id", lead.id);
  await db.rpc("marketing_apply_rules", { p_lead: lead.id });
  return { sent: 1 };
}

// One email per staff member with what's new for them since the last digest
// (at most one a day) — overdue follow-ups, actions due, quiet leads, status
// suggestions and engagement changes on the leads assigned to them.
async function sendDigests(db: SupabaseClient, resendKey: string) {
  const { data: settings } = await db.from("marketing_settings").select("notify_email").eq("id", 1).maybeSingle();
  if (settings && settings.notify_email === false) return { digests: 0 };
  const { data: notes } = await db
    .from("marketing_notifications")
    .select("id, staff_id, title, detail, created_at")
    .is("emailed_at", null)
    .is("read_at", null)
    .gte("created_at", new Date(Date.now() - 3 * 864e5).toISOString())
    .order("created_at", { ascending: false })
    .limit(1000);
  const byStaff = new Map<string, typeof notes>();
  for (const n of notes ?? []) byStaff.set(n.staff_id, [...(byStaff.get(n.staff_id) ?? []), n]);
  let digests = 0;
  for (const [staffId, list] of byStaff) {
    const { data: recent } = await db
      .from("marketing_notifications")
      .select("id")
      .eq("staff_id", staffId)
      .gte("emailed_at", new Date(Date.now() - 20 * 36e5).toISOString())
      .limit(1);
    if (recent?.length) continue;
    const { data: staff } = await db.from("profiles").select("email, first_name, is_admin, marketing_admin").eq("id", staffId).maybeSingle();
    if (!staff?.email || (!staff.is_admin && !staff.marketing_admin)) continue;
    const items = list!.slice(0, 15);
    const rows = items
      .map(
        (n) =>
          `<tr><td style="padding:8px 0; border-bottom:1px solid #e5e7eb;"><div style="font-weight:600; color:#16233a;">${escapeHtml(n.title)}</div>${n.detail ? `<div style="color:#5b6472; font-size:13px;">${escapeHtml(n.detail)}</div>` : ""}</td></tr>`,
      )
      .join("");
    const html = emailShell({
      eyebrow: "Marketing",
      heading: `${list!.length} lead${list!.length === 1 ? " needs" : "s need"} you`,
      intro: `<p style="margin:0 0 14px;">Hi ${escapeHtml(staff.first_name ?? "there")}, here's what changed on the leads assigned to you.</p>`,
      bodyRows: rows,
      ctaLabel: "Open Marketing",
      ctaHref: `${SITE}/marketing`,
      footnote: list!.length > items.length ? `+${list!.length - items.length} more in the workspace.` : undefined,
    });
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [staff.email], subject: `CorvusPT Marketing: ${list!.length} item${list!.length === 1 ? "" : "s"} need you`, html }),
    });
    if (!res.ok) continue;
    await db.from("marketing_notifications").update({ emailed_at: new Date().toISOString() }).in("id", list!.map((n) => n.id));
    digests++;
  }
  return { digests };
}

function jwtRole(token: string): string | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    return (JSON.parse(json) as { role?: string }).role ?? null;
  } catch {
    return null;
  }
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) return json({ error: "Email isn't configured (RESEND_API_KEY)." }, 500);
    const db = createClient(url, serviceKey);

    const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    let actor: string | null = null;
    // The router runs with verify_jwt on, so the gateway has already checked
    // this token's signature; a service-role token (the cron job) is trusted.
    // (Comparing it to SUPABASE_SERVICE_ROLE_KEY fails when the runtime holds
    // the key in the newer sb_secret_ format.)
    const isCron = bearer === serviceKey || jwtRole(bearer) === "service_role";
    if (!isCron) {
      const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: `Bearer ${bearer}` } },
      });
      const { data: { user } } = await caller.auth.getUser();
      if (!user) return json({ error: "unauthenticated" }, 401);
      const { data: p } = await db.from("profiles").select("is_admin, marketing_admin").eq("id", user.id).single();
      if (!p?.is_admin && !p?.marketing_admin) return json({ error: "not authorized" }, 403);
      actor = user.id;
    }

    const body = (await req.json().catch(() => ({}))) as { campaignId?: string; followupId?: string; process?: string };
    if (body.campaignId) return json(await sendCampaign(db, resendKey, body.campaignId, actor));
    if (body.followupId) return json(await sendFollowup(db, resendKey, body.followupId, actor));
    if (body.process === "due") {
      const { data: due } = await db
        .from("marketing_campaigns")
        .select("id")
        .eq("status", "scheduled")
        .lte("scheduled_at", new Date().toISOString());
      const results = [];
      for (const c of due ?? []) {
        try {
          results.push({ id: c.id, ...(await sendCampaign(db, resendKey, c.id, actor)) });
        } catch (e) {
          results.push({ id: c.id, error: e instanceof Error ? e.message : String(e) });
        }
      }
      const monitor = await db.rpc("marketing_monitor");
      const digest = await sendDigests(db, resendKey).catch((e) => ({ error: String(e) }));
      return json({ processed: results.length, results, monitor: monitor.data ?? monitor.error?.message, digest });
    }
    return json({ error: "Nothing to send." }, 400);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "unknown error" }, 400);
  }
}
