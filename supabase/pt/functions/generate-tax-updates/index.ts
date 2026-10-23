// Deploy via CLI: `supabase functions deploy generate-tax-updates` (JWT-verified).
//
// Texas Property Tax Law & Updates — the CorvusPT Regulatory Watch. Runs DAILY
// (pg_cron, service-role Bearer) or from an admin's "Generate now" button. The
// week's report is refreshed every day; anything found new during the week
// stays marked new until the week ends. Every NEW change the model judges
// MATERIAL for commercial owners (deadlines, protest procedures, evidence,
// hearings, representation) also becomes a staff-only alert in
// public.tax_update_alerts — with what it means for CorvusPT's owner-managed
// platform and the recommended action — and the team is notified (in-app for
// Super Admins + an email to the staff inbox). See supabase/pt/tax-watch.sql.
//
// HOW IT STAYS HONEST — the AI here has no way to look anything up (Gemini's
// search-grounding tool has never worked on this project's key), so it is NEVER
// asked what the law is. Instead:
//   1. The official pages in public.tax_update_sources are fetched directly.
//   2. The model is shown ONE page's text at a time and may only report NEW or
//      CHANGED information that appears in that text.
//   3. The source URL/name on every update is attached by THIS code from the page
//      that was fetched — the model never writes a link, so it can't invent one.
//   4. Every update must include a short verbatim quote from the page; updates
//      whose quote can't be found in the fetched text are dropped.
//   5. A page that couldn't be read is listed as such in the report's source list,
//      so a quiet week is never confused with an unread source.
// The result is stored in public.tax_update_reports; only the 5 newest are kept.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GEMINI_MODEL_FAST, geminiUrl } from "../_shared/gemini.ts";
import { isServiceRoleRequest } from "../_shared/service-role-only.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const KEEP_REPORTS = 5;
const PAGE_CHARS = 14_000;
const FETCH_TIMEOUT_MS = 15_000;
const GEMINI_TIMEOUT_MS = 45_000;
const MAX_PER_CHAPTER = 6;
const CONCURRENCY = 4;

const STATUSES = [
  "enacted_law",
  "adopted_rule",
  "proposed_rule",
  "pending_legislation",
  "failed_legislation",
  "notice_guidance",
] as const;
const TAGS = [
  "commercial",
  "protest",
  "arb",
  "arbitration",
  "court",
  "valuation",
  "tax_rate",
  "deadlines",
  "evidence",
  "hearings",
  "representation",
] as const;
// what a change is about — the Regulatory Watch's priority areas first
const AREAS = [
  "deadlines",
  "protest_procedures",
  "evidence",
  "hearings",
  "representation",
  "valuation",
  "tax_rate",
  "other",
] as const;

// Internal, staff-only analysis of one update (never stored on the
// customer-facing report).
type Watch = {
  area: (typeof AREAS)[number];
  material: boolean;
  corvusImpact: string;
  teamAction: string;
};

type Source = {
  id: string;
  name: string;
  url: string;
  kind: string;
  county: string | null;
  last_text: string | null;
  note?: string | null;
};

type Update = {
  id: string;
  chapter: number;
  title: string;
  whatChanged: string;
  effectiveDate: string | null;
  affects: string;
  whyItMatters: string;
  actionNeeded: string;
  status: (typeof STATUSES)[number];
  tags: string[];
  counties: string[];
  sourceName: string;
  sourceUrl: string;
  sourceCheckedAt: string;
  quote: string;
  // true = text that appeared since the last weekly check; false = information
  // that is currently posted but was already there (first check of a source).
  isNew: boolean;
};

// ── Fetching ─────────────────────────────────────────────────────────────
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|br|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&sect;/g, "§")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

// ── Texas Register (weekly issues) ───────────────────────────────────────
const TEXREG = "https://www.sos.state.tx.us/texreg/archive/";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "October232026" → "2026-10-23" */
function issueDate(folder: string): string | null {
  const m = folder.match(/^([A-Za-z]+)(\d{1,2})(\d{4})$/);
  const mi = m ? MONTHS.indexOf(m[1]) : -1;
  return m && mi >= 0 ? `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}
function issueIsRecent(note: string | null | undefined): boolean {
  const d = note?.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  return !!d && Date.now() - Date.parse(d) <= 7 * 864e5;
}

/**
 * Adds the two newest issues' Title 34 (Comptroller) adopted + proposed rule
 * pages as sources, and retires issues older than three weeks.
 */
async function syncTexasRegister(admin: SupabaseClient) {
  const res = await fetch(`${TEXREG}index.shtml`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; CorvusPT-TaxUpdates/1.0)" } });
  if (!res.ok) throw new Error(`Texas Register index HTTP ${res.status}`);
  const html = await res.text();
  // The index lags a few days behind the newest issue, so also try the last
  // two Fridays (the Register is published on Fridays) — a missing page is
  // simply reported as "no property-tax rules".
  const fridays = [0, 7].map((back) => {
    const d = new Date(Date.now() - 5 * 3600e3); // Texas time, roughly
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 2) % 7) - back);
    return `${MONTHS[d.getUTCMonth()]}${d.getUTCDate()}${d.getUTCFullYear()}`;
  });
  const listed = [...html.matchAll(/archive\/([A-Za-z]+\d{5,6})\/index\.html/g)].map((m) => m[1]);
  const folders = [...new Set([...fridays, ...listed])]
    .filter((f) => issueDate(f))
    .sort((a, b) => issueDate(b)!.localeCompare(issueDate(a)!))
    .slice(0, 2);
  const rows = folders.flatMap((f) => {
    const date = issueDate(f);
    if (!date) return [];
    const label = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    return (["Adopted", "Proposed"] as const).map((k) => ({
      name: `Texas Register ${label} — ${k.toLowerCase()} property-tax rules`,
      url: `${TEXREG}${f}/${k}%20Rules/34.PUBLIC%20FINANCE.html`,
      kind: "texreg",
      county: null,
      enabled: true,
      note: `issue ${date}`,
    }));
  });
  if (rows.length) {
    const { error } = await admin.from("tax_update_sources").upsert(rows, { onConflict: "url", ignoreDuplicates: true });
    if (error) throw error;
  }
  // stop reading old issues (their content is already in the reports)
  const cutoff = new Date(Date.now() - 21 * 864e5).toISOString().slice(0, 10);
  const { data: old } = await admin.from("tax_update_sources").select("id, note").eq("kind", "texreg").eq("enabled", true);
  const stale = (old ?? []).filter((r) => (r.note?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "9999") < cutoff).map((r) => r.id);
  if (stale.length) await admin.from("tax_update_sources").update({ enabled: false }).in("id", stale);
}

/** Only the Comptroller's Chapter 9 (Property Tax Administration) part of a Title 34 page. */
function chapter9(text: string): string {
  // headings are split across lines: "CHAPTER\n9.\nPROPERTY TAX ADMINISTRATION"
  const start = text.search(/CHAPTER\s+9\.\s*PROPERTY TAX ADMINISTRATION/i);
  if (start < 0) return "";
  const rest = text.slice(start + 10);
  const next = rest.search(/\bCHAPTER\s+(?!9\.)\d+\.\s+[A-Z]/);
  return (next < 0 ? text.slice(start) : text.slice(start, start + 10 + next)).slice(0, 30_000);
}

async function fetchPage(
  url: string,
  maxChars = PAGE_CHARS,
): Promise<{ text: string } | { error: string }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; CorvusPT-TaxUpdates/1.0; +https://corvusre.com/corvuspt/)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const text = htmlToText(await res.text());
    if (text.length < 400)
      return { error: "Page returned almost no readable text" };
    return { text: text.slice(0, maxChars) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "fetch failed" };
  } finally {
    clearTimeout(t);
  }
}

// ── Model call (extraction from ONE page's text) ─────────────────────────
const SYSTEM =
  "You extract Texas property-tax LAW, RULE, PROCEDURE and DEADLINE updates from the text of ONE official web page.\n" +
  "STRICT RULES:\n" +
  "- Use ONLY the page text provided. Never use outside knowledge, never guess, never add facts.\n" +
  "- Report only information that is NEW or CHANGED and important to property owners: law changes, adopted or proposed rules, forms, calendars, deadlines, tax-rate or valuation changes, and protest / ARB / arbitration / court-appeal process changes.\n" +
  "- Skip general background, marketing, navigation, contact info and evergreen how-to text.\n" +
  '- If the page has nothing that qualifies, return {"updates": []}. An empty result is correct and expected.\n' +
  '- Every update MUST include "quote": a short (under 200 characters) EXACT verbatim excerpt copied from the page text that supports it.\n' +
  '- In every field EXCEPT quote, write citations in plain words for property owners: "Section 9.4223" / "Sections 9.4202 and 9.4209", never the § sign.\n' +
  '- If a field is not stated in the page, use null (for effectiveDate) or "Not stated" (other text fields). Never invent dates.\n' +
  `- status must be one of: ${STATUSES.join(", ")}. Use enacted_law only for law the page says has been enacted; adopted_rule for a rule the page says is adopted/effective; proposed_rule for a proposed rule; pending_legislation / failed_legislation for bills; otherwise notice_guidance.\n` +
  `- tags: choose any that apply from: ${TAGS.join(", ")}.\n` +
  "- chapter: 1 Texas statewide updates; 2 county updates (only for a county-specific page); 3 current-year rules & law changes; 4 commercial property updates; 5 protest, ARB & appeals; 6 important deadlines; 7 what property owners should know or do.\n" +
  `- area: the main subject, one of: ${AREAS.join(", ")}. protest_procedures = how/where/when a protest is filed or handled; evidence = what evidence is required, exchanged or allowed (incl. the district's evidence); hearings = ARB / informal / arbitration hearing rules; representation = agents, Form 50-162, who may represent an owner.\n` +
  "- material: true when the change alters what a COMMERCIAL property owner must or can do — filing deadlines, protest procedures, evidence requirements, hearings, representation rules, commercial valuation or tax-rate rules, or the official forms they must use. false for routine notices, reminders of unchanged rules, staffing, events, or anything that doesn't change the rules.\n" +
  '- corvusImpact: CorvusPT is an owner-managed protest platform for Texas commercial property owners (it computes protest deadlines automatically, prepares evidence packets with AI, guides the protest / ARB hearing / arbitration workflow and fills the official forms). In one or two sentences say which of these would need to change because of THIS change, or "None".\n' +
  '- teamAction: one sentence — the specific step the CorvusPT team should take, or "No action".\n' +
  'Return ONLY JSON: {"updates":[{"title","chapter","whatChanged","effectiveDate","affects","whyItMatters","actionNeeded","status","tags","area","material","corvusImpact","teamAction","quote"}]}';

async function extract(
  apiKey: string,
  source: Source,
  text: string,
): Promise<unknown[]> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const res = await fetch(geminiUrl(GEMINI_MODEL_FAST, apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Source: ${source.name}${source.county ? ` (${source.county})` : ""}\nURL: ${source.url}\n\nPAGE TEXT:\n${text}`,
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0,
        },
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    let parsed: { updates?: unknown[] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : {};
    }
    return Array.isArray(parsed.updates) ? parsed.updates : [];
  } finally {
    clearTimeout(t);
  }
}

// ── Validation: only what the page actually says survives ────────────────
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function validate(
  raw: unknown,
  source: Source,
  pageText: string,
  checkedAt: string,
  isNew: boolean,
): { u: Update; w: Watch } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, d = "Not stated") =>
    typeof v === "string" && v.trim() ? v.trim() : d;
  const title = str(r.title, "");
  const whatChanged = str(r.whatChanged, "");
  const quote = str(r.quote, "");
  if (!title || !whatChanged || quote.length < 12) return null;
  // The quote must really be on the page.
  if (!norm(pageText).includes(norm(quote))) return null;

  const status = STATUSES.includes(r.status as never)
    ? (r.status as Update["status"])
    : "notice_guidance";
  const tags = Array.isArray(r.tags)
    ? (r.tags as unknown[]).filter(
        (t): t is string => typeof t === "string" && TAGS.includes(t as never),
      )
    : [];
  let chapter = Number(r.chapter);
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > 7)
    chapter = source.county ? 2 : 1;
  // Chapter 2 is for county pages; a county page's items are county updates
  // unless the model placed them in a more specific chapter.
  if (source.county && chapter === 1) chapter = 2;
  if (!source.county && chapter === 2) chapter = 1;

  let effective: string | null = null;
  if (typeof r.effectiveDate === "string" && /\d/.test(r.effectiveDate)) {
    effective = r.effectiveDate.trim().slice(0, 40);
  }

  const area = AREAS.includes(r.area as never) ? (r.area as Watch["area"]) : "other";
  return {
    u: {
      id: crypto.randomUUID(),
      chapter,
      title: title.slice(0, 160),
      whatChanged: whatChanged.slice(0, 600),
      effectiveDate: effective,
      affects: str(r.affects).slice(0, 300),
      whyItMatters: str(r.whyItMatters).slice(0, 400),
      actionNeeded: str(r.actionNeeded).slice(0, 400),
      status,
      tags,
      counties: source.county ? [source.county] : [],
      sourceName: source.name,
      sourceUrl: source.url,
      sourceCheckedAt: checkedAt,
      quote: quote.slice(0, 220),
      isNew,
    },
    w: {
      area,
      // failed bills never change the rules
      material: r.material === true && status !== "failed_legislation",
      corvusImpact: str(r.corvusImpact, "None").slice(0, 500),
      teamAction: str(r.teamAction, "No action").slice(0, 300),
    },
  };
}

// Lines on the page now that were not there at the last check.
function newLines(previous: string, current: string): string {
  const before = new Set(
    previous
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
  );
  return current
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !before.has(l))
    .join("\n");
}

function mondayOf(d: Date): string {
  const day = d.getUTCDay(); // 0 = Sunday
  const diff = (day + 6) % 7;
  const m = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff),
  );
  return m.toISOString().slice(0, 10);
}

type AlertRow = {
  id: string;
  title: string;
  area: string;
  what_changed: string;
  effective_date: string | null;
  corvus_impact: string | null;
  recommended_action: string | null;
  source_name: string;
  source_url: string;
};
const AREA_LABEL: Record<string, string> = {
  deadlines: "Filing deadlines",
  protest_procedures: "Protest procedures",
  evidence: "Evidence requirements",
  hearings: "Hearings",
  representation: "Representation",
  valuation: "Valuation",
  tax_rate: "Tax rates",
  other: "Other",
};
// HTML-escaped, with legal section signs spelled out ("§9.4223" → "Section 9.4223")
const esc = (s: string | null) =>
  (s ?? "")
    .replace(/§§\s*/g, "Sections ")
    .replace(/§\s*/g, "Section ")
    .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// Tell the team: an in-app notification for each Super Admin and one email to
// the staff inbox (same address as the other staff notifications).
async function announce(admin: SupabaseClient, rows: AlertRow[]) {
  for (const a of rows) {
    await admin.rpc("notify_department", {
      p_department: "super_admin",
      p_owner: null,
      p_kind: "tax_alert",
      p_title: `Texas tax rule change: ${a.title}`,
      p_detail: `${AREA_LABEL[a.area] ?? a.area}${a.effective_date ? ` · effective ${a.effective_date}` : ""} — ${a.recommended_action ?? ""}`,
      p_entity_type: "tax_alert",
      p_entity_id: a.id,
      p_lead: null,
    });
  }
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return;
  const to = Deno.env.get("STAFF_ALERT_EMAIL") ?? "properties@srclandbuilding.com";
  const html =
    `<h2 style="font-family:sans-serif">Texas property-tax regulatory watch — ${rows.length} material change${rows.length === 1 ? "" : "s"}</h2>` +
    rows
      .map(
        (a) =>
          `<div style="font-family:sans-serif;border:1px solid #ddd;border-radius:8px;padding:12px;margin:12px 0">` +
          `<p style="margin:0;font-weight:bold">${esc(a.title)}</p>` +
          `<p style="margin:4px 0;color:#555">${esc(AREA_LABEL[a.area] ?? a.area)}${a.effective_date ? ` · effective ${esc(a.effective_date)}` : " · effective date not stated"}</p>` +
          `<p style="margin:6px 0"><b>What changed:</b> ${esc(a.what_changed)}</p>` +
          `<p style="margin:6px 0"><b>CorvusPT implications:</b> ${esc(a.corvus_impact)}</p>` +
          `<p style="margin:6px 0"><b>Recommended action:</b> ${esc(a.recommended_action)}</p>` +
          `<p style="margin:6px 0"><b>Official source:</b> <a href="${esc(a.source_url)}">${esc(a.source_name)}</a></p></div>`,
      )
      .join("") +
    `<p style="font-family:sans-serif;color:#777;font-size:12px">Found by CorvusPT's daily check of official Texas sources. Review and mark each one in CorvusPT → Texas Tax Updates.</p>`;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "CorvusPT <info@corvusre.com>",
        to: [to],
        subject: `Texas tax rule change${rows.length === 1 ? `: ${rows[0].title}` : `s: ${rows.length} material updates`}`,
        html,
      }),
    });
  } catch (err) {
    console.error("tax alert email failed:", err);
  }
}

async function inBatches<T, R>(
  items: T[],
  size: number,
  fn: (x: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Cron (service role) or an admin's own token — nobody else.
    if (!isServiceRoleRequest(req)) {
      const callerClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        {
          global: {
            headers: { Authorization: req.headers.get("Authorization") ?? "" },
          },
        },
      );
      const {
        data: { user },
      } = await callerClient.auth.getUser();
      const { data: profile } = user
        ? await admin
            .from("profiles")
            .select("is_admin")
            .eq("id", user.id)
            .single()
        : { data: null };
      if (!profile?.is_admin) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403,
          headers: corsHeaders,
        });
      }
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

    // This week's Texas Register issues (adopted + proposed Comptroller
    // property-tax rules) join the fixed sources — rule adoptions appear there
    // before the Comptroller's own rules page is updated.
    await syncTexasRegister(admin).catch((e) => console.error("Texas Register sync failed:", e));

    const { data: sourceRows, error: srcErr } = await admin
      .from("tax_update_sources")
      .select("id, name, url, kind, county, last_text, note")
      .eq("enabled", true);
    if (srcErr) throw srcErr;
    const sources = (sourceRows ?? []) as Source[];

    const checkedAt = new Date().toISOString();
    const results = await inBatches(sources, CONCURRENCY, async (source) => {
      const register = source.kind === "texreg";
      const fetched = await fetchPage(source.url, register ? 60_000 : PAGE_CHARS);
      // an issue with no Title 34 rules that week simply has no such page
      if (register && "error" in fetched && /HTTP 404/.test(fetched.error)) {
        return { source, ok: true, note: "No property-tax rules in this issue", updates: [] as Update[], watch: [] as Watch[] };
      }
      if ("error" in fetched) {
        return { source, ok: false, note: fetched.error, updates: [] as Update[], watch: [] as Watch[] };
      }
      const page = register ? { text: chapter9(fetched.text) } : fetched;
      if (register && page.text.length < 200) {
        await admin.from("tax_update_sources").update({ last_text: page.text, last_checked_at: checkedAt }).eq("id", source.id);
        return { source, ok: true, note: "No property-tax rules in this issue", updates: [] as Update[], watch: [] as Watch[] };
      }
      try {
        // First check of a source: everything on the page is "currently posted".
        // Later checks: only text that changed since the last check is
        // examined, and anything found there is "new this week". A Texas
        // Register issue is new in itself: its first read counts as new when
        // the issue came out in the last week.
        const baseline = source.last_text == null;
        const freshIssue = register && issueIsRecent(source.note);
        const examine = baseline
          ? page.text
          : newLines(source.last_text ?? "", page.text);
        let updates: Update[] = [];
        let watch: Watch[] = [];
        if (examine.length >= 60) {
          const raw = await extract(apiKey, source, examine);
          const ok = raw
            .map((r) => validate(r, source, page.text, checkedAt, !baseline || freshIssue))
            .filter((x): x is { u: Update; w: Watch } => x !== null);
          updates = ok.map((x) => x.u);
          watch = ok.map((x) => x.w);
        }
        await admin
          .from("tax_update_sources")
          .update({ last_text: page.text, last_checked_at: checkedAt })
          .eq("id", source.id);
        return {
          source,
          ok: true,
          note: baseline && !freshIssue
            ? `${updates.length} currently posted (first check)`
            : `${updates.length} new`,
          updates,
          watch,
        };
      } catch (err) {
        return {
          source,
          ok: false,
          note: err instanceof Error ? err.message : "extraction failed",
          updates: [] as Update[],
          watch: [] as Watch[],
        };
      }
    });

    // De-duplicate across sources, then cap each chapter.
    const seen = new Set<string>();
    const perChapter = new Map<number, number>();
    const updates: Update[] = [];
    for (const u of results.flatMap((r) => r.updates)) {
      const key = `${norm(u.title)}|${u.counties.join(",")}`;
      if (seen.has(key)) continue;
      const n = perChapter.get(u.chapter) ?? 0;
      if (n >= MAX_PER_CHAPTER) continue;
      seen.add(key);
      perChapter.set(u.chapter, n + 1);
      updates.push(u);
    }
    const weekStart = mondayOf(new Date());

    // Carry forward: a quiet week (nothing new on the sources) used to publish
    // an empty report, so the page read "0 updates". Last report's verified
    // items are still in effect — keep them, marked not-new, after this
    // week's new ones (same dedup key and per-chapter cap).
    // Daily runs: this week's report (from earlier days) is the most recent
    // one — what it found new stays new until the week ends; anything from a
    // previous week is carried forward as not-new.
    const { data: prior } = await admin
      .from("tax_update_reports")
      .select("updates, week_start")
      .lte("week_start", weekStart)
      .order("week_start", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sameWeek = prior?.week_start === weekStart;
    for (const u of (prior?.updates ?? []) as Update[]) {
      const key = `${norm(u.title)}|${u.counties.join(",")}`;
      if (seen.has(key)) continue;
      const n = perChapter.get(u.chapter) ?? 0;
      if (n >= MAX_PER_CHAPTER) continue;
      seen.add(key);
      perChapter.set(u.chapter, n + 1);
      updates.push({ ...u, isNew: sameWeek ? u.isNew : false });
    }
    updates.sort((a, b) => a.chapter - b.chapter);

    const readCount = results.filter((r) => r.ok).length;

    // Append this week's critical items (enacted law / adopted rule /
    // deadline-tagged) to the year-long ledger — tax_update_reports only
    // keeps the newest KEEP_REPORTS weeks, so this is the only place a
    // critical item survives once its own week's report ages out. Keyed by
    // (tax_year, dedup_key); an item that resurfaces unchanged in a later
    // week is skipped (ON CONFLICT DO NOTHING), not re-added. Best-effort —
    // a ledger-write failure must never fail the weekly report itself.
    const critical = updates.filter(
      (u) =>
        u.status !== "failed_legislation" &&
        (u.status === "enacted_law" ||
          u.status === "adopted_rule" ||
          u.tags.includes("deadlines")),
    );
    if (critical.length > 0) {
      const taxYear = new Date(weekStart).getUTCFullYear();
      const { error: critErr } = await admin
        .from("tax_update_critical_items")
        .upsert(
          critical.map((u) => ({
            tax_year: taxYear,
            dedup_key: `${norm(u.title)}|${u.counties.join(",")}`,
            first_seen_week: weekStart,
            update: u,
          })),
          { onConflict: "tax_year,dedup_key", ignoreDuplicates: true },
        );
      if (critErr)
        console.error("tax_update_critical_items upsert failed:", critErr);
    }
    const summary =
      updates.length > 0
        ? `${updates.length} verified update${updates.length === 1 ? "" : "s"} (${updates.filter((u) => u.isNew).length} new this week) from ${readCount} of ${sources.length} official sources, checked daily.`
        : `No new or changed information found on the ${readCount} official sources that could be read this week (${sources.length - readCount} could not be read).`;

    const { error: upErr } = await admin.from("tax_update_reports").upsert(
      {
        week_start: weekStart,
        title: `Texas Property Tax Law & Updates — week of ${weekStart}`,
        summary,
        updates,
        sources: results.map((r) => ({
          name: r.source.name,
          url: r.source.url,
          county: r.source.county,
          ok: r.ok,
          note: r.note,
        })),
        status: "published",
        model: GEMINI_MODEL_FAST,
        generated_at: checkedAt,
      },
      { onConflict: "week_start" },
    );
    if (upErr) throw upErr;

    // Keep every week of the current tax year (the page shows the whole
    // year's updates), plus at least the newest KEEP_REPORTS across a year
    // boundary.
    const { data: all } = await admin
      .from("tax_update_reports")
      .select("id, week_start")
      .order("week_start", { ascending: false });
    const yearStart = `${weekStart.slice(0, 4)}-01-01`;
    const stale = (all ?? [])
      .filter(
        (r, i) => i >= KEEP_REPORTS && (r.week_start as string) < yearStart,
      )
      .map((r) => r.id as string);
    if (stale.length > 0)
      await admin.from("tax_update_reports").delete().in("id", stale);

    // ── Regulatory Watch alerts: material, NEW changes only (a source's first
    // check is a baseline, never an alert). One alert per change — the
    // dedup key makes a change that stays posted for days alert once.
    const material = results
      .flatMap((r) => r.updates.map((u, i) => ({ u, w: r.watch[i] })))
      .filter((x) => x.u.isNew && x.w?.material);
    let alerted: { id: string; title: string; area: string }[] = [];
    if (material.length > 0) {
      const { data: inserted, error: alertErr } = await admin
        .from("tax_update_alerts")
        .upsert(
          material.map(({ u, w }) => ({
            dedup_key: `${norm(u.title)}|${u.counties.join(",")}|${u.sourceUrl}`,
            title: u.title,
            area: w.area,
            status: u.status,
            what_changed: u.whatChanged,
            effective_date: u.effectiveDate,
            owner_impact: [u.affects, u.whyItMatters].filter((x) => x && x !== "Not stated").join(" — "),
            corvus_impact: w.corvusImpact,
            recommended_action: w.teamAction,
            counties: u.counties,
            source_name: u.sourceName,
            source_url: u.sourceUrl,
            quote: u.quote,
          })),
          { onConflict: "dedup_key", ignoreDuplicates: true },
        )
        .select("id, title, area, what_changed, effective_date, corvus_impact, recommended_action, source_name, source_url");
      if (alertErr) console.error("tax_update_alerts upsert failed:", alertErr);
      alerted = (inserted ?? []) as typeof alerted;
      if (inserted && inserted.length > 0) await announce(admin, inserted as AlertRow[]);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        weekStart,
        updates: updates.length,
        sourcesRead: readCount,
        sources: sources.length,
        alerts: alerted.length,
      }),
      { status: 200, headers: corsHeaders },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "unknown error",
      }),
      { status: 500, headers: corsHeaders },
    );
  }
});
