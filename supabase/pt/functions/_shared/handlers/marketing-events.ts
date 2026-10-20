// Marketing engagement events, served by county-mail-inbound (a public
// function — Supabase's 100-function limit means webhooks share it):
//   GET  ?action=track&k=open|click   open pixel / click redirect (marketing email only)
//   POST (Resend, svix-signed)        email.delivered / bounced / complained / opened / clicked / failed
//   POST ?action=sms (Telnyx, ed25519) text replies (STOP/START/HELP) and delivery reports
// Each updates the message, the lead (engagement, opt-outs, bounces) and the
// lead's history, and flags the assigned staff member when someone engages.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sign, unb64url } from "../marketing-tracking.ts";
import { HELP_WORDS, START_WORDS, STOP_WORDS, e164, sendSms, smsConfigured, verifyTelnyx } from "../telnyx.ts";

const admin = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const GIF = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));
const now = () => new Date().toISOString();

type Msg = { id: string; lead_id: string | null; campaign_id: string | null; subject: string | null; opened_at: string | null; clicked_at: string | null; open_count: number; click_count: number; status: string };

async function campaignName(db: SupabaseClient, id: string | null) {
  if (!id) return null;
  const { data } = await db.from("marketing_campaigns").select("name").eq("id", id).maybeSingle();
  return data?.name ?? null;
}

async function engaged(db: SupabaseClient, m: Msg, kind: "open" | "click", url?: string) {
  const first = kind === "open" ? !m.opened_at : !m.clicked_at;
  const patch: Record<string, unknown> =
    kind === "open"
      ? { opened_at: m.opened_at ?? now(), open_count: m.open_count + 1, status: ["sent", "delivered", "delivery_delayed"].includes(m.status) ? "opened" : m.status }
      : { opened_at: m.opened_at ?? now(), clicked_at: m.clicked_at ?? now(), click_count: m.click_count + 1, last_click_url: url ?? null, status: ["bounced", "complained"].includes(m.status) ? m.status : "clicked" };
  await db.from("marketing_messages").update(patch).eq("id", m.id);
  if (!m.lead_id) return;
  await db.from("marketing_leads").update({ last_engaged_at: now() }).eq("id", m.lead_id);
  if (kind !== "click" || !first) return;
  const name = (await campaignName(db, m.campaign_id)) ?? m.subject ?? "an email";
  await db.from("marketing_activities").insert({ lead_id: m.lead_id, campaign_id: m.campaign_id, kind: "engagement", summary: `Clicked a link in "${name}"`, body: url ?? null });
  const { data: l } = await db.from("marketing_leads").select("stage, assigned_to, company, full_name, email, suggestion_dismissed").eq("id", m.lead_id).maybeSingle();
  if (!l) return;
  // a click is engagement, not a decision — suggest Interested for a person to confirm
  if (["ready", "contacted", "no_response"].includes(l.stage) && l.suggestion_dismissed !== "interested")
    await db.from("marketing_leads").update({ suggested_stage: "interested", suggested_stage_reason: `Clicked a link in "${name}"`, suggested_at: now() }).eq("id", m.lead_id);
  if (l.assigned_to)
    await db.from("marketing_notifications").upsert(
      { staff_id: l.assigned_to, lead_id: m.lead_id, kind: "engagement", title: `${l.company ?? l.full_name ?? l.email} clicked your email`, detail: `"${name}" — a good moment to follow up.`, dedupe_key: `click:${m.id}` },
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    );
}

const MSG_COLS = "id, lead_id, campaign_id, subject, opened_at, clicked_at, open_count, click_count, status";

/** GET ?action=track — open pixel or click redirect. Always answers fast; failures never break the email. */
export async function handleTrack(req: Request): Promise<Response> {
  const p = new URL(req.url).searchParams;
  const id = p.get("m") ?? "";
  const kind = p.get("k");
  const valid = /^[0-9a-f-]{36}$/i.test(id);
  if (kind === "click") {
    let url = "";
    try {
      url = unb64url(p.get("u") ?? "");
    } catch {
      url = "";
    }
    const ok = valid && /^https?:\/\//.test(url) && (await sign(`${id}|${url}`)) === p.get("s");
    if (!ok) return new Response("Link not recognised", { status: 400 });
    try {
      const db = admin();
      const { data: m } = await db.from("marketing_messages").select(MSG_COLS).eq("id", id).maybeSingle();
      if (m) await engaged(db, m as Msg, "click", url);
    } catch {
      // still send them on
    }
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store" } });
  }
  if (valid) {
    try {
      const db = admin();
      const { data: m } = await db.from("marketing_messages").select(MSG_COLS).eq("id", id).maybeSingle();
      if (m) await engaged(db, m as Msg, "open");
    } catch {
      // the pixel always loads
    }
  }
  return new Response(GIF, { headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, max-age=0" } });
}

/** Resend delivery events for marketing email (matched by the Resend email id). */
export async function handleEmailEvent(event: { type?: string; data?: Record<string, unknown> }): Promise<{ handled: boolean }> {
  const emailId = event.data?.email_id as string | undefined;
  if (!emailId) return { handled: false };
  const db = admin();
  const { data: m } = await db.from("marketing_messages").select(MSG_COLS).eq("provider", "resend").eq("provider_id", emailId).maybeSingle();
  if (!m) return { handled: false }; // not a marketing email
  const msg = m as Msg;
  switch (event.type) {
    case "email.delivered":
      await db.from("marketing_messages").update({ delivered_at: now(), status: msg.status === "sent" || msg.status === "delivery_delayed" ? "delivered" : msg.status }).eq("id", msg.id);
      break;
    case "email.delivery_delayed":
      if (msg.status === "sent") await db.from("marketing_messages").update({ status: "delivery_delayed" }).eq("id", msg.id);
      break;
    case "email.opened":
      await engaged(db, msg, "open");
      break;
    case "email.clicked":
      await engaged(db, msg, "click", ((event.data?.click as Record<string, unknown>)?.link as string) ?? undefined);
      break;
    case "email.bounced": {
      const bounce = (event.data?.bounce ?? {}) as Record<string, unknown>;
      const type = String(bounce.type ?? bounce.subType ?? "bounce");
      await db.from("marketing_messages").update({ bounced_at: now(), bounce_type: type, status: "bounced", failed_reason: String(bounce.message ?? "").slice(0, 300) || null }).eq("id", msg.id);
      if (msg.lead_id) {
        // hard bounces stop further email; temporary ones don't
        if (!/transient|temporary|soft/i.test(type)) await db.from("marketing_leads").update({ email_bounced_at: now() }).eq("id", msg.lead_id);
        await db.from("marketing_activities").insert({ lead_id: msg.lead_id, campaign_id: msg.campaign_id, kind: "engagement", summary: `Email bounced (${type})`, body: String(bounce.message ?? "") || null });
      }
      break;
    }
    case "email.complained":
      await db.from("marketing_messages").update({ complained_at: now(), status: "complained" }).eq("id", msg.id);
      if (msg.lead_id) {
        await db.from("marketing_leads").update({ unsubscribed_at: now(), consent_source: "Marked our email as spam" }).eq("id", msg.lead_id).is("unsubscribed_at", null);
        await db.from("marketing_activities").insert({ lead_id: msg.lead_id, campaign_id: msg.campaign_id, kind: "engagement", summary: "Marked a marketing email as spam — unsubscribed from email" });
      }
      break;
    case "email.failed":
      await db.from("marketing_messages").update({ status: "failed", failed_reason: String((event.data?.failed as Record<string, unknown>)?.reason ?? "failed") }).eq("id", msg.id);
      break;
    default:
      return { handled: false };
  }
  return { handled: true };
}

/** POST ?action=sms — Telnyx replies and delivery reports. */
export async function handleSms(req: Request): Promise<Response> {
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
  const body = await req.text();
  if (!(await verifyTelnyx(req.headers.get("telnyx-signature-ed25519"), req.headers.get("telnyx-timestamp"), body)))
    return json({ error: "invalid signature" }, 401);
  let ev: { data?: { event_type?: string; payload?: Record<string, unknown> } };
  try {
    ev = JSON.parse(body);
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const type = ev.data?.event_type ?? "";
  const p = ev.data?.payload ?? {};
  const db = admin();
  if (type === "message.received") {
    const from = String((p.from as Record<string, unknown>)?.phone_number ?? "");
    const text = String(p.text ?? "").trim();
    const digits = from.replace(/\D/g, "").slice(-10);
    const { data: leads } = await db.from("marketing_leads").select("id, phone, assigned_to, company, full_name, email").not("phone", "is", null).limit(5000);
    const lead = (leads ?? []).find((l) => (l.phone ?? "").replace(/\D/g, "").slice(-10) === digits);
    await db.from("marketing_messages").insert({ lead_id: lead?.id ?? null, channel: "sms", direction: "in", provider: "telnyx", provider_id: String(p.id ?? "") || null, from_address: from, body: text.slice(0, 1600), status: "received" });
    if (!lead) return json({ ok: true, matched: false });
    const word = text.toLowerCase().replace(/[^a-z]/g, "");
    if (STOP_WORDS.includes(word)) {
      await db.from("marketing_leads").update({ sms_consent: "withdrawn", consent_source: `Replied ${text.toUpperCase().slice(0, 12)}` }).eq("id", lead.id);
      await db.from("marketing_followups").update({ status: "skipped", completed_at: now(), stop_reason: "Opted out of texts" }).eq("lead_id", lead.id).eq("channel", "sms").in("status", ["pending", "draft"]);
      await db.from("marketing_activities").insert({ lead_id: lead.id, kind: "sms", summary: "Opted out of texts (replied STOP)" });
    } else if (START_WORDS.includes(word)) {
      await db.from("marketing_leads").update({ sms_consent: "granted", consent_source: "Replied START" }).eq("id", lead.id);
      await db.from("marketing_activities").insert({ lead_id: lead.id, kind: "sms", summary: "Opted back in to texts (replied START)" });
    } else if (HELP_WORDS.includes(word)) {
      if (smsConfigured())
        await sendSms(from, "CorvusPT: property tax protest help for Texas owners. Questions: info@corvusre.com. Reply STOP to opt out.").catch(() => undefined);
    } else {
      // a real reply: tie it to the last text we sent, log it, and let a person respond
      const { data: last } = await db.from("marketing_messages").select("id, campaign_id").eq("lead_id", lead.id).eq("channel", "sms").eq("direction", "out").order("sent_at", { ascending: false }).limit(1).maybeSingle();
      if (last) await db.from("marketing_messages").update({ replied_at: now() }).eq("id", last.id);
      await db.from("marketing_activities").insert({ lead_id: lead.id, campaign_id: last?.campaign_id ?? null, kind: "sms", summary: "Text reply", body: text.slice(0, 1000), outcome: "replied" });
      await db.from("marketing_leads").update({ last_engaged_at: now() }).eq("id", lead.id);
      await db.rpc("marketing_apply_rules", { p_lead: lead.id });
      if (lead.assigned_to)
        await db.from("marketing_notifications").upsert(
          { staff_id: lead.assigned_to, lead_id: lead.id, kind: "engagement", title: `${lead.company ?? lead.full_name ?? lead.email} replied by text`, detail: text.slice(0, 160), dedupe_key: `smsreply:${p.id}` },
          { onConflict: "dedupe_key", ignoreDuplicates: true },
        );
    }
    return json({ ok: true });
  }
  if (type === "message.sent" || type === "message.finalized") {
    const to = ((p.to as Record<string, unknown>[]) ?? [])[0] ?? {};
    const st = String(to.status ?? "");
    const patch: Record<string, unknown> =
      st === "delivered"
        ? { status: "delivered", delivered_at: now() }
        : /failed|undeliverable/.test(st)
          ? { status: "failed", failed_reason: String(((p.errors as Record<string, unknown>[]) ?? [])[0]?.detail ?? st) }
          : {};
    if (Object.keys(patch).length) await db.from("marketing_messages").update(patch).eq("provider", "telnyx").eq("provider_id", String(p.id ?? ""));
    return json({ ok: true });
  }
  return json({ ignored: type });
}

export { e164 };
