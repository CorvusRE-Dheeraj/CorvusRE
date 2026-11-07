// Deploy via CLI: `supabase functions deploy tax-owner-alerts` (JWT-verified).
//
// Proactive Texas rule-change alerts for property owners — see
// supabase/pt/tax-owner-alerts.sql. Runs daily after the Regulatory Watch
// (pg_cron, service role, {"mode":"run"}), and from the staff review screen
// ({"action":"send","id"} once an alert is approved, {"action":"preview"}).
//
//   1. New staff alerts (tax_update_alerts) that no owner alert covers yet are
//      grouped — one owner alert per change (same official source, area and
//      effective date), so owners never get three emails about one rule.
//   2. AI rewrites each group for owners using ONLY the staff alert's verified
//      fields (what changed, what applied before, owner impact, recommended
//      action, effective date, the verbatim quote). Internal CorvusPT notes,
//      marketing lines and verification notes are never given to it. The
//      official source + quote are attached by this code, not the model.
//   3. Review gate (default): the alert waits for a staff approval; with
//      app_settings.tax_owner_alerts_auto it's approved immediately.
//   4. Approved alerts go to every owner whose properties they apply to
//      (tax_owner_alert_recipients), in the app always and by email unless the
//      owner turned rule-change emails off; affected properties are named and
//      an open case the change touches is flagged.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GEMINI_MODEL_FAST, geminiUrl } from "../_shared/gemini.ts";
import { appBaseUrl } from "../_shared/app-url.ts";
import { emailShell, escapeHtml } from "../_shared/email-shell.ts";
import { isServiceRoleRequest } from "../_shared/service-role-only.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: corsHeaders });

type StaffAlert = {
  id: string;
  created_at: string;
  title: string;
  area: string;
  what_changed: string;
  effective_date: string | null;
  owner_impact: string | null;
  recommended_action: string | null;
  previously_applied: string | null;
  counties: string[] | null;
  source_name: string;
  source_url: string;
  quote: string;
};

// Protest statuses a change in this area matters to right now.
const RELEVANT: Record<string, string[]> = {
  deadlines: ["requested"],
  protest_procedures: ["requested", "filed", "under_review", "offer_received", "hearing_scheduled"],
  evidence: ["requested", "filed", "under_review", "offer_received", "hearing_scheduled"],
  hearings: ["under_review", "hearing_scheduled"],
  representation: ["requested", "filed", "hearing_scheduled"],
  valuation: ["under_review", "offer_received", "hearing_scheduled"],
  tax_rate: [],
  other: [],
};
const ARBITRATION = /arbitrat|appeal|district court|after the (arb|appraisal review board) decision/i;

export function groupKey(a: Pick<StaffAlert, "source_url" | "area" | "effective_date">): string {
  return `${a.source_url}|${a.area}|${(a.effective_date ?? "").slice(0, 10)}`;
}

export function relevantStatuses(area: string, text: string): string[] {
  const base = RELEVANT[area] ?? [];
  return ARBITRATION.test(text) ? [...new Set([...base, "decision_received", "arbitrating", "appealing"])] : base;
}

async function ownerText(group: StaffAlert[]) {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
  const facts = group.map((a) => ({
    title: a.title,
    whatChanged: a.what_changed,
    previouslyApplied: a.previously_applied,
    whyItMattersForOwners: a.owner_impact,
    recommendedAction: a.recommended_action,
    effectiveDate: a.effective_date,
    officialQuote: a.quote,
  }));
  const res = await fetch(geminiUrl(GEMINI_MODEL_FAST, apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(40_000),
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text: `You write a short alert for Texas commercial property owners about ONE property-tax rule change. Use ONLY the facts given (they describe the same change; merge them). Never add facts, dates, deadlines, legal advice or predictions; never mention CorvusPT's internal analysis. If the facts disagree, use the more cautious wording. Plain English, short sentences, no legal citations beyond what's given.
Return ONLY JSON: {"title": <under 90 characters>, "summary": <one or two sentences>, "whatChanged": <2-4 sentences>, "whyItMatters": <1-3 sentences, for owners>, "recommendedAction": <1-2 sentences of what to do, e.g. review a form, check a deadline — no promises>}`,
          },
        ],
      },
      contents: [{ role: "user", parts: [{ text: JSON.stringify(facts) }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini API error ${res.status}`);
  const out = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const raw = out.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  let j: Record<string, unknown> = {};
  try {
    j = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    j = m ? JSON.parse(m[0]) : {};
  }
  const first = group[0];
  const s = (v: unknown, fallback: string | null) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 1500) : fallback);
  return {
    title: s(j.title, first.title)!.slice(0, 140),
    summary: s(j.summary, first.owner_impact ?? first.what_changed)!,
    whatChanged: s(j.whatChanged, first.what_changed)!,
    whyItMatters: s(j.whyItMatters, first.owner_impact),
    recommendedAction: s(j.recommendedAction, first.recommended_action),
  };
}

// 1–3: new staff alerts → owner alerts (pending review, or approved if automatic)
async function build(admin: SupabaseClient): Promise<{ created: number; pending: string[] }> {
  const since = new Date(Date.now() - 45 * 864e5).toISOString();
  const { data: staffAlerts } = await admin
    .from("tax_update_alerts")
    .select("id, created_at, title, area, what_changed, effective_date, owner_impact, recommended_action, previously_applied, counties, source_name, source_url, quote")
    .gte("created_at", since)
    .order("created_at");
  const { data: existing } = await admin.from("tax_owner_alerts").select("group_key, alert_ids").gte("created_at", new Date(Date.now() - 120 * 864e5).toISOString());
  const covered = new Set((existing ?? []).flatMap((e) => e.alert_ids as string[]));
  const keys = new Set((existing ?? []).map((e) => e.group_key as string));
  const groups = new Map<string, StaffAlert[]>();
  for (const a of (staffAlerts ?? []) as StaffAlert[]) {
    if (covered.has(a.id)) continue;
    const k = groupKey(a);
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  const { data: settings } = await admin.from("app_settings").select("tax_owner_alerts_auto").eq("id", true).maybeSingle();
  const auto = !!settings?.tax_owner_alerts_auto;
  const pending: string[] = [];
  let created = 0;
  for (const [k, g] of groups) {
    if (keys.has(k)) {
      // the change already has an owner alert — fold these in, nothing new to send
      const { data: row } = await admin.from("tax_owner_alerts").select("id, alert_ids").eq("group_key", k).single();
      await admin.from("tax_owner_alerts").update({ alert_ids: [...new Set([...(row!.alert_ids as string[]), ...g.map((a) => a.id)])] }).eq("id", row!.id);
      continue;
    }
    const t = await ownerText(g);
    const first = g[0];
    const counties = [...new Set(g.flatMap((a) => a.counties ?? []))];
    const { data: ins, error } = await admin
      .from("tax_owner_alerts")
      .insert({
        group_key: k,
        alert_ids: g.map((a) => a.id),
        area: first.area,
        title: t.title,
        summary: t.summary,
        what_changed: t.whatChanged,
        effective_date: first.effective_date,
        why_it_matters: t.whyItMatters,
        recommended_action: t.recommendedAction,
        counties,
        relevant_statuses: relevantStatuses(first.area, g.map((a) => `${a.title} ${a.what_changed}`).join(" ")),
        source_name: first.source_name,
        source_url: first.source_url,
        quote: first.quote,
        status: auto ? "approved" : "pending_review",
        ...(auto ? { reviewed_at: new Date().toISOString(), review_note: "Sent automatically (setting on)" } : {}),
      })
      .select("id, title")
      .single();
    if (error) {
      console.error("owner alert insert failed", error);
      continue;
    }
    created++;
    if (!auto) {
      pending.push(ins.title);
      await admin.rpc("notify_department", {
        p_department: "super_admin",
        p_owner: null,
        p_kind: "tax_owner_alert_review",
        p_title: `Owner alert ready for review: ${ins.title}`,
        p_detail: "Approve it in Texas Tax Updates → Owner alerts and it goes to every affected owner.",
        p_entity_type: "tax_rule_alert",
        p_entity_id: ins.id,
        p_lead: null,
      });
    }
  }
  return { created, pending };
}

async function sendEmail(to: string, subject: string, html: string, text: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) throw new Error("RESEND_API_KEY is not configured");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "CorvusPT <info@corvusre.com>", to: [to], subject, html, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

const STATUS_WORDS: Record<string, string> = {
  requested: "protest requested",
  filed: "protest filed",
  under_review: "under county review",
  offer_received: "settlement offer received",
  hearing_scheduled: "hearing scheduled",
  decision_received: "ARB decision received",
  appealing: "appealing",
  arbitrating: "in arbitration",
  resolved: "resolved",
};

// 4: deliver approved alerts
async function deliver(admin: SupabaseClient, onlyId?: string) {
  let q = admin.from("tax_owner_alerts").select("*").eq("status", "approved");
  if (onlyId) q = q.eq("id", onlyId);
  const { data: alerts } = await q;
  const appUrl = appBaseUrl();
  const summary: { id: string; recipients: number; emails: number }[] = [];
  for (const a of alerts ?? []) {
    const { data: recips, error } = await admin.rpc("tax_owner_alert_recipients", { p_alert: a.id });
    if (error) {
      console.error("recipients failed", error);
      continue;
    }
    let emails = 0;
    for (const r of (recips ?? []) as { user_id: string; properties: { address: string; caseStatus: string | null; openCase: boolean }[]; affects_open_case: boolean }[]) {
      const { data: d, error: dErr } = await admin
        .from("tax_owner_alert_deliveries")
        .upsert({ alert_id: a.id, user_id: r.user_id, properties: r.properties, affects_open_case: r.affects_open_case }, { onConflict: "alert_id,user_id", ignoreDuplicates: true })
        .select("id")
        .maybeSingle();
      if (dErr || !d) continue; // already delivered
      const { data: prof } = await admin.from("profiles").select("email, first_name, notification_prefs").eq("id", r.user_id).maybeSingle();
      // deno-lint-ignore no-explicit-any
      const prefs = (prof?.notification_prefs ?? {}) as Record<string, any>;
      if (!prof?.email || prefs.tax_rule_alerts_email === false) continue;
      const list = r.properties.slice(0, 10);
      const rows =
        `<tr><td style="padding:6px 0;"><strong>What changed</strong><br/>${escapeHtml(a.what_changed)}</td></tr>` +
        (a.effective_date ? `<tr><td style="padding:6px 0;"><strong>Effective</strong> ${escapeHtml(a.effective_date)}</td></tr>` : "") +
        (a.why_it_matters ? `<tr><td style="padding:6px 0;"><strong>Why it matters</strong><br/>${escapeHtml(a.why_it_matters)}</td></tr>` : "") +
        `<tr><td style="padding:6px 0;"><strong>Your properties${r.properties.length > 10 ? ` (${r.properties.length}, first 10)` : ""}</strong><br/>${list
          .map((p) => `${escapeHtml(p.address)}${p.openCase ? ` — <strong style="color:#b42318;">your open case (${escapeHtml(STATUS_WORDS[p.caseStatus ?? ""] ?? "in progress")}) is affected</strong>` : ""}`)
          .join("<br/>")}</td></tr>` +
        (a.recommended_action ? `<tr><td style="padding:6px 0;"><strong>What to do</strong><br/>${escapeHtml(a.recommended_action)}</td></tr>` : "") +
        `<tr><td style="padding:6px 0;color:#8592a6;">From the official source (<a href="${escapeHtml(a.source_url)}">${escapeHtml(a.source_name)}</a>): “${escapeHtml(a.quote.slice(0, 400))}”</td></tr>`;
      const html = emailShell({
        eyebrow: "Texas rule change",
        heading: a.title,
        intro: `Hi ${escapeHtml(prof.first_name ?? "there")}, ${escapeHtml(a.summary)}${r.affects_open_case ? " <strong>It affects a case you have open.</strong>" : ""}`,
        bodyRows: rows,
        ctaLabel: "See it in Texas Tax Updates",
        ctaHref: `${appUrl}/dashboard/tax-updates`,
        footnote: "This is general information from the official Texas source, not legal advice. Turn these emails off in Settings → Texas Rule Changes.",
      });
      const text = `${a.title}\n\n${a.summary}\n\nWhat changed: ${a.what_changed}\n${a.effective_date ? `Effective: ${a.effective_date}\n` : ""}${a.why_it_matters ? `Why it matters: ${a.why_it_matters}\n` : ""}Your properties: ${list.map((p) => p.address + (p.openCase ? " (open case affected)" : "")).join("; ")}\n${a.recommended_action ? `What to do: ${a.recommended_action}\n` : ""}\nOfficial source: ${a.source_name} — ${a.source_url}\n\n${appUrl}/dashboard/tax-updates`;
      try {
        await sendEmail(prof.email, `${r.affects_open_case ? "Affects your open case: " : "Texas rule change: "}${a.title}`.slice(0, 150), html, text);
        await admin.from("tax_owner_alert_deliveries").update({ email_sent_at: new Date().toISOString() }).eq("id", d.id);
        emails++;
      } catch (e) {
        await admin.from("tax_owner_alert_deliveries").update({ email_error: e instanceof Error ? e.message : String(e) }).eq("id", d.id);
      }
    }
    const { count } = await admin.from("tax_owner_alert_deliveries").select("id", { count: "exact", head: true }).eq("alert_id", a.id);
    await admin.from("tax_owner_alerts").update({ status: "sent", sent_at: new Date().toISOString(), recipients: count ?? 0, emails_sent: (a.emails_sent ?? 0) + emails }).eq("id", a.id);
    await admin.rpc("log_record_event", {
      p_department: "shared",
      p_entity_type: "tax_rule_alert",
      p_entity_id: a.id,
      p_action: "owner_alert_sent",
      p_summary: `Rule-change alert sent to ${count ?? 0} owner${count === 1 ? "" : "s"} (${emails} email${emails === 1 ? "" : "s"}): ${a.title}`,
    });
    summary.push({ id: a.id, recipients: count ?? 0, emails });
  }
  return summary;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.mode === "run") {
      if (!isServiceRoleRequest(req)) return json({ error: "forbidden" }, 403);
      const built = await build(admin);
      const sent = await deliver(admin);
      return json({ ...built, sent });
    }
    // staff
    const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const {
      data: { user },
    } = await caller.auth.getUser();
    if (!user) return json({ error: "unauthenticated" }, 401);
    const { data: isStaff } = await caller.rpc("is_staff");
    if (!isStaff) return json({ error: "Staff only." }, 403);
    const id = String(body.id ?? "");
    if (body.action === "preview") {
      const { data } = await admin.rpc("tax_owner_alert_recipients", { p_alert: id });
      const r = (data ?? []) as { properties: unknown[]; affects_open_case: boolean }[];
      return json({ owners: r.length, properties: r.reduce((s, x) => s + x.properties.length, 0), openCases: r.filter((x) => x.affects_open_case).length });
    }
    if (body.action === "send") return json({ sent: await deliver(admin, id) });
    if (body.action === "build") return json(await build(admin));
    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("tax-owner-alerts failed:", err);
    return json({ error: err instanceof Error ? err.message : "unknown error" }, 500);
  }
});
