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
import { GEMINI_MODEL_FAST, geminiUrl } from "../gemini.ts";
import { instrument, linkify } from "../marketing-tracking.ts";
import { e164, sendSms, smsConfigured } from "../telnyx.ts";
import { runLinkedInDaily } from "./linkedin.ts";

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
  company: string | null;
  portfolio_count: number | null;
  portfolio_value: number | null;
  max_change_pct: number | null;
  protest_deadline: string | null;
  invite_token: string | null;
};
const LEAD_COLS =
  "id, full_name, email, stage, county, property_type, property_address, unsubscribe_token, company, portfolio_count, portfolio_value, max_change_pct, protest_deadline, invite_token";

// Links back to the step a prospect hasn't finished (same as journeyLinks() in marketing-crm.ts).
function links(lead: Lead) {
  const q = new URLSearchParams({ mode: "signup" });
  if (lead.email) q.set("email", lead.email);
  const first = (lead.full_name ?? "").trim().split(/\s+/)[0];
  if (first) q.set("firstName", first);
  if (lead.invite_token) q.set("lead", lead.invite_token);
  return {
    registration: `${SITE}/sign-in?${q}`,
    addProperty: `${SITE}/dashboard/properties`,
    checkout: `${SITE}/dashboard/properties`,
  };
}

// Same tokens and fallbacks as personalize() in apps/pt/src/lib/marketing-crm.ts.
function personalize(text: string, lead: Lead): string {
  const first = (lead.full_name ?? "").trim().split(/\s+/)[0] || "there";
  const n = lead.portfolio_count ?? 0;
  const money = (v: number | null) => (v == null ? "your properties" : `$${Math.round(v).toLocaleString("en-US")}`);
  const deadline = lead.protest_deadline
    ? new Date(`${lead.protest_deadline}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : "May 15 (or 30 days after your notice, if later)";
  return text
    .replaceAll("{{first_name}}", first)
    .replaceAll("{{name}}", lead.full_name ?? "there")
    .replaceAll("{{company}}", lead.company ?? lead.full_name ?? "your company")
    .replaceAll("{{property_address}}", lead.property_address ?? "your property")
    .replaceAll("{{county}}", lead.county ?? "your")
    .replaceAll("{{property_count}}", String(n || 1))
    .replaceAll("{{portfolio_value}}", money(lead.portfolio_value))
    .replaceAll("{{value_change}}", lead.max_change_pct != null && lead.max_change_pct > 0 ? `${lead.max_change_pct}%` : "noticeably")
    .replaceAll("{{protest_deadline}}", deadline)
    .replaceAll("{{portfolio_note}}", n > 1 ? ` and your other ${n - 1} propert${n === 2 ? "y" : "ies"}` : "")
    .replaceAll("{{registration_link}}", links(lead).registration)
    .replaceAll("{{add_property_link}}", links(lead).addProperty)
    .replaceAll("{{checkout_link}}", links(lead).checkout);
}

function renderEmail(subject: string, body: string, lead: Lead, postal: string | null): string {
  const paragraphs = personalize(body, lead)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;">${linkify(escapeHtml(p.trim())).replaceAll("\n", "<br>")}</p>`)
    .join("");
  return emailShell({
    eyebrow: "CorvusPT",
    heading: escapeHtml(personalize(subject, lead)),
    intro: paragraphs,
    footnote: postal ? `CorvusPT · ${escapeHtml(postal)}` : undefined,
    unsubscribeUrl: `${SITE}/unsubscribe?t=${lead.unsubscribe_token}`,
  });
}

async function sendOne(resendKey: string, to: string, subject: string, html: string, unsubUrl: string): Promise<string | null> {
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
  const j = (await res.json().catch(() => ({}))) as { id?: string };
  return j.id ?? null;
}

async function postalAddress(db: SupabaseClient): Promise<string | null> {
  const { data } = await db.from("marketing_settings").select("postal_address").eq("id", 1).maybeSingle();
  return (data?.postal_address as string | null)?.trim() || null;
}

type Ctx = { campaignId?: string | null; followupId?: string | null; runNo?: number | null; postal: string | null };

/** One tracked marketing email: logged in marketing_messages so delivery, opens, clicks and bounces land on it. */
async function deliverEmail(db: SupabaseClient, resendKey: string, lead: Lead, subjectRaw: string, bodyRaw: string, ctx: Ctx) {
  const { data: why } = await db.rpc("marketing_can_contact", { p_lead: lead.id, p_channel: "email" });
  if (why) throw new Error(`Not eligible for email: ${why}`);
  const id = crypto.randomUUID();
  const subject = personalize(subjectRaw, lead);
  const html = await instrument(renderEmail(subjectRaw, bodyRaw, lead, ctx.postal), id);
  const providerId = await sendOne(resendKey, lead.email!, subject, html, `${SITE}/unsubscribe?t=${lead.unsubscribe_token}`);
  await db.from("marketing_messages").insert({
    id, lead_id: lead.id, campaign_id: ctx.campaignId ?? null, followup_id: ctx.followupId ?? null, channel: "email",
    provider: "resend", provider_id: providerId, to_address: lead.email, from_address: FROM, subject, run_no: ctx.runNo ?? null,
  });
  return { subject, body: personalize(bodyRaw, lead) };
}

/** One text, only with express SMS consent; opt-out wording always included. */
async function deliverSms(db: SupabaseClient, lead: Lead & { phone?: string | null }, textRaw: string, ctx: Omit<Ctx, "postal">) {
  if (!smsConfigured()) throw new Error("SMS isn't connected yet — add the Telnyx keys to send texts.");
  const { data: why } = await db.rpc("marketing_can_contact", { p_lead: lead.id, p_channel: "sms" });
  if (why) throw new Error(`Not eligible for texts: ${why}`);
  const to = e164(lead.phone);
  if (!to) throw new Error("Phone number isn't a valid US number.");
  let text = personalize(textRaw, lead).trim();
  if (!/reply stop/i.test(text)) text += " Reply STOP to opt out.";
  if (!/^corvuspt/i.test(text)) text = `CorvusPT: ${text}`;
  const { id } = await sendSms(to, text);
  await db.from("marketing_messages").insert({
    lead_id: lead.id, campaign_id: ctx.campaignId ?? null, followup_id: ctx.followupId ?? null, channel: "sms",
    provider: "telnyx", provider_id: id, to_address: to, from_address: Deno.env.get("TELNYX_FROM"), body: text, run_no: ctx.runNo ?? null,
  });
  return { body: text };
}

async function audienceFor(db: SupabaseClient, audience: Record<string, unknown>, channel: "email" | "sms"): Promise<Lead[]> {
  let q = db.from("marketing_leads").select(`${LEAD_COLS}, phone`).neq("stage", "do_not_contact").limit(MAX_RECIPIENTS);
  // Same rule as audienceLeads() in apps/pt/src/lib/marketing.ts (+ the channel's eligibility).
  if (channel === "email") q = q.is("unsubscribed_at", null).not("email", "is", null).neq("email_consent", "withdrawn").is("email_bounced_at", null);
  else q = q.not("phone", "is", null).eq("sms_consent", "granted");
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

/** When a recurring campaign runs next (null = no more runs). */
export function nextRun(frequency: string, customDays: number | null, from: Date, endsAt: string | null): Date | null {
  const d = new Date(from);
  if (frequency === "weekly") d.setDate(d.getDate() + 7);
  else if (frequency === "monthly") {
    // same day next month, clamped (Jan 31 → Feb 28, not Mar 3)
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
    d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  } else if (frequency === "twice_monthly") {
    if (d.getUTCDate() < 15) d.setUTCDate(15);
    else {
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
  } else if (frequency === "custom" && customDays) d.setDate(d.getDate() + customDays);
  else return null;
  if (endsAt && d > new Date(endsAt)) return null;
  return d;
}
const windowDays = (frequency: string, customDays: number | null) =>
  frequency === "weekly" ? 6 : frequency === "twice_monthly" ? 12 : frequency === "monthly" ? 25 : frequency === "custom" ? Math.max(1, (customDays ?? 7) - 1) : 3650;

async function sendCampaign(db: SupabaseClient, resendKey: string, campaignId: string, actor: string | null) {
  const { data: c, error } = await db.from("marketing_campaigns").select("*").eq("id", campaignId).single();
  if (error || !c) throw new Error("Campaign not found");
  if (!["approved", "scheduled"].includes(c.status)) throw new Error(`A ${c.status} campaign can't be sent — approve it first.`);
  const channel = c.channel === "sms" ? "sms" : "email";
  if (channel === "sms" && !smsConfigured()) throw new Error("SMS isn't connected yet — add the Telnyx keys to send text campaigns.");
  if (!c.body || (channel === "email" && !c.subject)) throw new Error("Add a subject and message before sending.");
  const postal = await postalAddress(db);
  if (channel === "email" && !postal) throw new Error("Add the company's postal address (Campaigns → Settings) — US law requires it in marketing email.");
  await db.from("marketing_campaigns").update({ status: "sending" }).eq("id", campaignId);
  const runNo = (c.run_count ?? 0) + 1;
  let leads = await audienceFor(db, c.audience ?? {}, channel);
  // recurring: nobody gets the same campaign twice inside one cycle
  if (c.frequency && c.frequency !== "once") {
    const since = new Date(Date.now() - windowDays(c.frequency, c.custom_days) * 864e5).toISOString();
    const { data: recent } = await db.from("marketing_messages").select("lead_id").eq("campaign_id", campaignId).gte("sent_at", since);
    const skip = new Set((recent ?? []).map((r) => r.lead_id));
    leads = leads.filter((l) => !skip.has(l.id));
  }
  let sent = 0, failed = 0;
  const errors: string[] = [];
  for (const lead of leads) {
    try {
      const out =
        channel === "email"
          ? await deliverEmail(db, resendKey, lead, c.subject, c.body, { campaignId, runNo, postal })
          : await deliverSms(db, lead, c.body, { campaignId, runNo });
      sent++;
      await db.from("marketing_activities").insert({
        lead_id: lead.id, campaign_id: campaignId, kind: channel, template_id: c.template_id ?? null,
        summary: `Campaign ${channel === "sms" ? "text" : "email"}: ${c.name}`, body: "subject" in out ? out.subject : out.body, created_by: actor,
      });
      await db.from("marketing_leads").update({ last_contacted_at: new Date().toISOString() }).eq("id", lead.id);
    } catch (e) {
      failed++;
      if (errors.length < 5) errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  const at = new Date();
  const next = c.frequency && c.frequency !== "once" ? nextRun(c.frequency, c.custom_days, c.scheduled_at && new Date(c.scheduled_at) > new Date(at.getTime() - 864e5) ? new Date(c.scheduled_at) : at, c.ends_at) : null;
  const runs = [...(((c.stats ?? {}) as { runs?: unknown[] }).runs ?? []), { run: runNo, at: at.toISOString(), targeted: leads.length, sent, failed }].slice(-50);
  const stats = { targeted: leads.length, sent, failed, errors, runs };
  await db.from("marketing_campaigns")
    .update({
      status: next ? "scheduled" : "sent",
      scheduled_at: next ? next.toISOString() : c.scheduled_at,
      sent_at: at.toISOString(),
      last_sent_at: at.toISOString(),
      run_count: runNo,
      stats,
    })
    .eq("id", campaignId);
  await db.from("marketing_activities").insert({
    campaign_id: campaignId, kind: "campaign",
    summary: `Campaign "${c.name}"${runNo > 1 ? ` (run ${runNo})` : ""} sent to ${sent} of ${leads.length}${failed ? ` (${failed} failed)` : ""}${next ? ` · next run ${next.toISOString().slice(0, 10)}` : ""}`,
    created_by: actor,
  });
  // status follows the approved rules (e.g. Ready for Outreach → Contacted)
  await db.rpc("marketing_apply_rules", { p_lead: null });
  return { ...stats, nextRun: next?.toISOString() ?? null };
}

async function sendFollowup(db: SupabaseClient, resendKey: string, followupId: string, actor: string | null) {
  const { data: f, error } = await db
    .from("marketing_followups")
    .select("*, lead:marketing_leads(id, full_name, email, phone, stage, county, property_type, property_address, unsubscribe_token, unsubscribed_at, assigned_to, company, portfolio_count, portfolio_value, max_change_pct, protest_deadline, invite_token)")
    .eq("id", followupId)
    .single();
  if (error || !f) throw new Error("Follow-up not found");
  if (f.status === "draft") throw new Error("Approve this message before it's sent.");
  if (f.status !== "pending") throw new Error("This follow-up is already done.");
  if (f.channel !== "email" && f.channel !== "sms") throw new Error("Only email and text follow-ups can be sent from here — mark calls and tasks done instead.");
  const lead = f.lead as Lead & { phone: string | null };
  if (!f.message) throw new Error("Write or generate the message first.");
  const subject = f.subject || "Following up";
  const out =
    f.channel === "email"
      ? await deliverEmail(db, resendKey, lead, subject, f.message, { followupId, campaignId: f.campaign_id ?? null, postal: await postalAddress(db) })
      : await deliverSms(db, lead, f.message, { followupId });
  const now = new Date().toISOString();
  await db.from("marketing_followups").update({ status: "done", completed_at: now, outcome: "sent" }).eq("id", followupId);
  await db.from("marketing_activities").insert({
    lead_id: lead.id, kind: f.channel, template_id: f.template_id ?? null,
    summary: f.channel === "email" ? `Follow-up email: ${"subject" in out ? out.subject : subject}` : "Follow-up text",
    body: out.body, created_by: actor,
  });
  await db.from("marketing_leads").update({ last_contacted_at: now }).eq("id", lead.id);
  await db.rpc("marketing_apply_rules", { p_lead: lead.id });
  return { sent: 1 };
}

// Approved campaigns' engagement rules: after N days, recipients who didn't
// open / opened but didn't click / clicked / didn't reply get the follow-up the
// rule describes (once each). Approved with the campaign, so emails go out by
// themselves; eligibility and opt-outs are still checked when they send.
async function runCampaignRules(db: SupabaseClient) {
  const { data: camps } = await db
    .from("marketing_campaigns")
    .select("id, name, owner_id, followup_rules, status")
    .in("status", ["sent", "scheduled"])
    .not("last_sent_at", "is", null);
  let created = 0;
  for (const c of camps ?? []) {
    const rules = (c.followup_rules ?? []) as { trigger: string; afterDays: number; action: string; subject?: string; body?: string }[];
    for (const [i, r] of rules.entries()) {
      if (!r?.trigger || !r.action) continue;
      const cutoff = new Date(Date.now() - Math.max(0, Number(r.afterDays) || 0) * 864e5).toISOString();
      let q = db.from("marketing_messages").select("lead_id, opened_at, clicked_at, replied_at, status").eq("campaign_id", c.id).eq("direction", "out").lte("sent_at", cutoff).limit(500);
      if (r.trigger === "no_open") q = q.is("opened_at", null).not("status", "in", "(bounced,failed,complained)");
      if (r.trigger === "opened_no_click") q = q.not("opened_at", "is", null).is("clicked_at", null);
      if (r.trigger === "clicked") q = q.not("clicked_at", "is", null);
      if (r.trigger === "no_reply") q = q.is("replied_at", null).not("status", "in", "(failed)");
      const { data: msgs } = await q;
      const seq = `campaign:${c.id}:rule${i}`;
      const { data: done } = await db.from("marketing_followups").select("lead_id").eq("sequence_name", seq);
      const have = new Set((done ?? []).map((x) => x.lead_id));
      for (const m of msgs ?? []) {
        if (!m.lead_id || have.has(m.lead_id)) continue;
        have.add(m.lead_id);
        const { data: l } = await db.from("marketing_leads").select("assigned_to, stage, phone").eq("id", m.lead_id).maybeSingle();
        if (!l || ["subscribed", "do_not_contact", "not_interested"].includes(l.stage)) continue;
        // no phone on file: the call becomes a task (find a number / reach out another way)
        const channel = r.action === "call" && !l.phone ? "task" : r.action;
        const { error } = await db.from("marketing_followups").insert({
          lead_id: m.lead_id,
          due_at: new Date().toISOString(),
          channel,
          subject: r.subject ?? `Following up: ${c.name}`,
          message: r.action === "email" || r.action === "sms" ? (r.body ?? null) : null,
          call_script: r.action === "call" ? (r.body ?? null) : null,
          notes: channel !== r.action ? "No phone number on file — find one, or follow up another way." : null,
          status: "pending",
          auto_send: r.action === "email" && !!r.body,
          assigned_to: l.assigned_to ?? c.owner_id ?? null,
          sequence_name: seq,
          sequence_step: i + 1,
          ai_generated: true,
          campaign_id: c.id,
        });
        if (!error) created++;
      }
    }
  }
  return { created };
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
    // what's connected: SMS provider and the Resend delivery-event webhook
    if (body.process === "status") return json({ smsConfigured: smsConfigured(), resend: await resendWebhook(false) });
    if (body.process === "email-setup") return json({ resend: await resendWebhook(true) });
    if (body.campaignId) return json(await sendCampaign(db, resendKey, body.campaignId, actor));
    if (body.followupId) return json(await sendFollowup(db, resendKey, body.followupId, actor));
    if (body.process === "due") {
      // Which automations a Super Admin has allowed (automation_permissions;
      // changing one needs an approval — see staff-approvals). Unknown or
      // unreadable → allowed, the behaviour before these switches existed.
      const { data: perms } = await db.from("automation_permissions").select("key, enabled");
      const allowed = (key: string) => (perms ?? []).find((p) => p.key === key)?.enabled !== false;
      const off = (key: string) => ({ skipped: `automation "${key}" is turned off` });
      const { data: due } = allowed("scheduled_campaigns")
        ? await db
            .from("marketing_campaigns")
            .select("id")
            .eq("status", "scheduled")
            .lte("scheduled_at", new Date().toISOString())
        : { data: [] as { id: string }[] };
      const results = [];
      for (const c of due ?? []) {
        try {
          results.push({ id: c.id, ...(await sendCampaign(db, resendKey, c.id, actor)) });
        } catch (e) {
          results.push({ id: c.id, error: e instanceof Error ? e.message : String(e) });
        }
      }
      const monitor = await db.rpc("marketing_monitor");
      // approved emails that are due go out by themselves
      const { data: dueF } = allowed("auto_send_followups")
        ? await db
            .from("marketing_followups")
            .select("id")
            .eq("status", "pending")
            .eq("channel", "email")
            .eq("auto_send", true)
            .lte("due_at", new Date().toISOString())
            .limit(100)
        : { data: [] as { id: string }[] };
      const autoSent: { id: string; error?: string }[] = [];
      for (const f of dueF ?? []) {
        try {
          await sendFollowup(db, resendKey, f.id, null);
          autoSent.push({ id: f.id });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          autoSent.push({ id: f.id, error: msg });
          // unsendable (opted out, no email…) — stop retrying it every hour
          await db.from("marketing_followups").update({ status: "skipped", completed_at: new Date().toISOString(), stop_reason: msg }).eq("id", f.id);
        }
      }
      const handoffs = allowed("ai_handoff_summaries")
        ? await summarizeHandoffs(db).catch((e) => ({ error: String(e) }))
        : off("ai_handoff_summaries");
      // engagement rules of approved campaigns → follow-ups
      const campaignRules = allowed("campaign_engagement_rules")
        ? await runCampaignRules(db).catch((e) => ({ error: String(e) }))
        : off("campaign_engagement_rules");
      // campaign / team analysis → recommendations that wait for approval
      const analysis = allowed("ai_recommendations")
        ? await db.rpc("marketing_analyze")
        : { data: off("ai_recommendations"), error: null };
      // daily / weekly / monthly performance reports, AI-written
      const reportsMade = await db.rpc("marketing_generate_reports");
      const reports = await summarizeReports(db).catch((e) => ({ error: String(e) }));
      const digest = await sendDigests(db, resendKey).catch((e) => ({ error: String(e) }));
      // LinkedIn: draft the upcoming posting days, publish approved posts that are due
      const linkedin = await runLinkedInDaily(db).catch((e) => ({ error: String(e) }));
      return json({
        processed: results.length,
        results,
        monitor: monitor.data ?? monitor.error?.message,
        autoSent,
        handoffs,
        campaignRules,
        analysis: analysis.data ?? analysis.error?.message,
        reports: { created: reportsMade.data ?? reportsMade.error?.message, ...reports },
        digest,
        linkedin,
      });
    }
    return json({ error: "Nothing to send." }, 400);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "unknown error" }, 400);
  }
}

// AI summary for each new Customer Support handoff: properties, subscription,
// past communication and onboarding needs — so Support starts informed.
async function summarizeHandoffs(db: SupabaseClient) {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return { summarized: 0, note: "GEMINI_API_KEY not set" };
  const { data: hs } = await db
    .from("support_handoffs")
    .select("id, lead_id, snapshot, lead:marketing_leads(company, full_name, email, phone, source, created_at, subscribed_at, registered_at, notes, ai_summary)")
    .is("summary", null)
    .limit(10);
  let summarized = 0;
  for (const h of hs ?? []) {
    const { data: acts } = await db
      .from("marketing_activities")
      .select("created_at, kind, summary, body")
      .eq("lead_id", h.lead_id)
      .order("created_at", { ascending: false })
      .limit(25);
    const lead = h.lead as Record<string, unknown> | null;
    const prompt =
      "You are handing a new paying CorvusPT customer (Texas property tax software; owners run their own protests with our tools) from Marketing to Customer Support. " +
      "Write a short handoff note in markdown with these sections: **Customer** (1-2 lines), **Properties & subscription**, **What happened before they subscribed** (key conversations, promises or concerns from the history), **Onboarding to do** (bullets from the needs list). " +
      "Use ONLY the facts below. Don't invent anything, and don't promise savings.\n\n" +
      `Lead: ${JSON.stringify(lead)}\nAccount snapshot: ${JSON.stringify(h.snapshot)}\nHistory (newest first):\n${(acts ?? []).map((a) => `- ${String(a.created_at).slice(0, 10)} ${a.kind}: ${a.summary}${a.body ? ` — ${String(a.body).slice(0, 200)}` : ""}`).join("\n")}`;
    const res = await fetch(geminiUrl(GEMINI_MODEL_FAST, key), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3 } }),
    });
    if (!res.ok) continue;
    const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = j.candidates?.[0]?.content?.parts?.map((x) => x.text ?? "").join("").trim();
    if (!text) continue;
    await db.from("support_handoffs").update({ summary: text, summary_at: new Date().toISOString() }).eq("id", h.id);
    summarized++;
  }
  return { summarized };
}

async function gemini(prompt: string): Promise<string | null> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return null;
  const res = await fetch(geminiUrl(GEMINI_MODEL_FAST, key), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3 } }),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return j.candidates?.[0]?.content?.parts?.map((x) => x.text ?? "").join("").trim() || null;
}

// AI summary for each new daily / weekly / monthly report, compared with the
// period before; the marketing team is told it's ready.
async function summarizeReports(db: SupabaseClient) {
  const { data: rs } = await db.from("marketing_reports").select("*").is("summary", null).order("period_start").limit(6);
  let summarized = 0;
  for (const r of rs ?? []) {
    const { data: prev } = await db
      .from("marketing_reports")
      .select("metrics")
      .eq("period", r.period)
      .lt("period_start", r.period_start)
      .order("period_start", { ascending: false })
      .limit(1)
      .maybeSingle();
    const text = await gemini(
      `You are Corvus AI writing the CorvusPT ${r.period} marketing performance summary (${r.period_start} to ${r.period_end}). ` +
        "In markdown: **Headline** (one line), **Achievements**, **Concerns**, **Next actions** (3 bullets max each). Cover lead generation, campaign results, team productivity, conversion, customer acquisition cost (spend ÷ subscriptions) and new subscription revenue (annual list value). " +
        "Compare with the previous period where given. Use ONLY these numbers; say plainly when a number is zero or missing. No promises about savings.\n\n" +
        `This period: ${JSON.stringify(r.metrics)}\nPrevious period: ${JSON.stringify(prev?.metrics ?? null)}`,
    );
    if (!text) continue;
    await db.from("marketing_reports").update({ summary: text, summary_at: new Date().toISOString() }).eq("id", r.id);
    summarized++;
    if (r.period !== "daily") {
      const { data: staff } = await db.from("profiles").select("id").or("is_admin.eq.true,marketing_admin.eq.true");
      await db.from("marketing_notifications").upsert(
        (staff ?? []).map((p) => ({
          staff_id: p.id,
          kind: "report",
          title: `${r.period === "weekly" ? "Weekly" : "Monthly"} marketing report ready`,
          detail: `${r.period_start} – ${r.period_end}. Open Analytics → Reports.`,
          dedupe_key: `report:${r.id}:${p.id}`,
        })),
        { onConflict: "dedupe_key", ignoreDuplicates: true },
      );
    }
  }
  return { summarized };
}

// The Resend webhook that points at county-mail-inbound (already used for
// received mail) — reports which marketing delivery events it sends, and with
// fix=true adds the missing ones. Needs a Resend key with webhook access.
const EMAIL_EVENTS = ["email.delivered", "email.delivery_delayed", "email.bounced", "email.complained", "email.failed"];
async function resendWebhook(fix: boolean) {
  const keys = [Deno.env.get("RESEND_API_KEY"), Deno.env.get("RESEND_RECEIVING_API_KEY")].filter(Boolean) as string[];
  for (const key of keys) {
    const res = await fetch("https://api.resend.com/webhooks", { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) continue;
    const j = (await res.json()) as { data?: { id: string; endpoint?: string; events?: string[] }[] };
    const hook = (j.data ?? []).find((w) => (w.endpoint ?? "").includes("county-mail-inbound"));
    if (!hook) return { ok: false, note: "No Resend webhook points at county-mail-inbound." };
    let events = hook.events ?? [];
    if (!events.length) {
      const one = await fetch(`https://api.resend.com/webhooks/${hook.id}`, { headers: { Authorization: `Bearer ${key}` } });
      if (one.ok) events = ((await one.json()) as { events?: string[] }).events ?? [];
    }
    const missing = EMAIL_EVENTS.filter((e) => !events.includes(e));
    if (!fix || !missing.length) return { ok: !missing.length, events, missing };
    const upd = await fetch(`https://api.resend.com/webhooks/${hook.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: hook.endpoint, events: [...new Set([...events, ...EMAIL_EVENTS])] }),
    });
    return upd.ok ? { ok: true, events: [...new Set([...events, ...EMAIL_EVENTS])], missing: [] } : { ok: false, events, missing, note: `Resend refused the update (${upd.status}): ${(await upd.text()).slice(0, 160)}` };
  }
  return { ok: false, note: "The Resend keys here can't read webhooks — add the delivery events to the webhook in the Resend dashboard." };
}
