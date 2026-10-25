// Deploy via CLI: `supabase functions deploy generate-tax-updates` (JWT-verified).
//
// Texas Property Tax Law & Updates — the CorvusPT Regulatory Watch. Runs DAILY
// (pg_cron, service-role Bearer) or from an admin's "Generate now" button. The
// week's report is refreshed every day; anything found new during the week
// stays marked new until the week ends. Every NEW change the model judges
// MATERIAL for commercial owners (deadlines, protest procedures, evidence,
// hearings, representation) also becomes a staff-only alert in
// public.tax_update_alerts — what changed, what applied before, why it matters
// and a recommended action for property owners — and the team is notified
// (in-app for Super Admins + an email to the staff inbox). See
// supabase/pt/tax-watch.sql.
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
  // what applied before (from the page, or "Background: …" — the model's
  // general knowledge, shown to owners as background to verify)
  previouslyApplied?: string;
  // every relevant official page, built by code from known official URLs
  sources?: { name: string; url: string }[];
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
  "- WRITING STYLE (every field except quote): write like a clear news alert for busy business owners. Short sentences, everyday words. Spell out every acronym the first time (e.g. \"regular binding arbitration (RBA) — an appeal of the appraisal review board's decision to an independent arbitrator\"). Lead with what it means, not with rule numbers; put rule numbers only at the end in parentheses, if at all. No legal phrasing like \"adopts by reference\" or \"mandatory dismissal for lack of jurisdiction\" — say \"uses a new form\" or \"the appeal can be thrown out if…\".\n" +
  '- title: a plain headline, e.g. "Texas updates binding arbitration rules, effective October 25, 2026".\n' +
  "- whatChanged: 1-3 sentences in that style.\n" +
  "- whyItMatters: 1-3 sentences on the practical effect for commercial property owners and tenants.\n" +
  '- previouslyApplied: 1-2 sentences on what applied BEFORE this change. Prefer what the page text says (e.g. the earlier proposal or prior rule). If the page doesn\'t say but you are CERTAIN of the earlier Texas rule or law, you may state it — then begin the field with "Background:". If you are not certain, use exactly "Not stated". Never invent a bill number, date or amount.\n' +
  '- If a field is not stated in the page, use null (for effectiveDate) or "Not stated" (other text fields). Never invent dates.\n' +
  `- status must be one of: ${STATUSES.join(", ")}. Use enacted_law only for law the page says has been enacted; adopted_rule for a rule the page says is adopted/effective; proposed_rule for a proposed rule; pending_legislation / failed_legislation for bills; otherwise notice_guidance.\n` +
  `- tags: choose any that apply from: ${TAGS.join(", ")}.\n` +
  "- chapter: 1 Texas statewide updates; 2 county updates (only for a county-specific page); 3 current-year rules & law changes; 4 commercial property updates; 5 protest, ARB & appeals; 6 important deadlines; 7 what property owners should know or do.\n" +
  `- area: the main subject, one of: ${AREAS.join(", ")}. protest_procedures = how/where/when a protest is filed or handled; evidence = what evidence is required, exchanged or allowed (incl. the district's evidence); hearings = ARB / informal / arbitration hearing rules; representation = agents, Form 50-162, who may represent an owner.\n` +
  "- material: true when the change alters what a COMMERCIAL property owner must or can do — filing deadlines, protest procedures, evidence requirements, hearings, representation rules, commercial valuation or tax-rate rules, or the official forms they must use. false for routine notices, reminders of unchanged rules, staffing, events, or anything that doesn't change the rules.\n" +
  'Return ONLY JSON: {"updates":[{"title","chapter","whatChanged","previouslyApplied","effectiveDate","affects","whyItMatters","actionNeeded","status","tags","area","material","quote"}]}';

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
      previouslyApplied: str(r.previouslyApplied).slice(0, 600),
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
  status: string;
  what_changed: string;
  effective_date: string | null;
  owner_impact: string | null;
  corvus_impact: string | null;
  recommended_action: string | null;
  source_name: string;
  source_url: string;
  quote: string;
  previously_applied?: string | null;
  marketing_sentence?: string | null;
  verification_note?: string | null;
  related_sources?: { name: string; url: string }[];
};
const ALERT_COLS =
  "id, title, area, status, what_changed, effective_date, owner_impact, corvus_impact, recommended_action, source_name, source_url, quote, previously_applied, marketing_sentence, verification_note, related_sources";

const STATUS_TEXT: Record<string, string> = {
  enacted_law: "Enacted law",
  adopted_rule: "Adopted administrative rule",
  proposed_rule: "Proposed rule",
  pending_legislation: "Pending legislation",
  notice_guidance: "Official notice / guidance",
};

/** Written by code from the status — never by the model. */
function verificationNote(a: AlertRow): string {
  const base = `The supporting quote was found word-for-word on ${a.source_name}.`;
  switch (a.status) {
    case "adopted_rule":
      return `${base} This is an adopted rule — read the final rule text on the official source before acting on it.`;
    case "proposed_rule":
      return `${base} This is only a proposal and may change or be withdrawn before it is adopted.`;
    case "enacted_law":
      return `${base} Enacted law — confirm the effective date and watch for the Comptroller's implementing rules.`;
    case "pending_legislation":
      return `${base} A pending bill is not law until it passes.`;
    default:
      return `${base} Official notice or guidance — check the official source for the rule or law behind it.`;
  }
}

/** Every relevant official page — built from known official URLs, never by the model. */
/** Same facts, plain words (title, what changed, why it matters, what to do, who, before). */
async function rewritePlain(apiKey: string, u: Update): Promise<Update> {
  try {
    const res = await fetch(geminiUrl(GEMINI_MODEL_FAST, apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text:
              "Rewrite this Texas property-tax update for busy commercial property owners. Keep every fact; add none (except the labelled background below). " +
              "Style: a clear news alert — short sentences, everyday words, acronyms spelled out the first time, rule numbers only at the end in parentheses, no legal phrasing. Write \"Section\", never §.\n" +
              '- title: plain headline. - whatChanged: 1-3 sentences. - whyItMatters: 1-3 sentences, practical effect for commercial owners/tenants. - actionNeeded: 1-2 sentences. - affects: who, in a short phrase.\n' +
              '- previouslyApplied: what applied BEFORE, 1-2 sentences. Use the quote/text if it says; otherwise, only if you are CERTAIN of the earlier Texas rule or law, state it beginning with "Background:"; else exactly "Not stated". Never invent a bill number, date or amount.\n' +
              'Return ONLY JSON: {"title","whatChanged","whyItMatters","actionNeeded","affects","previouslyApplied"}',
          }],
        },
        contents: [{ role: "user", parts: [{ text: JSON.stringify({ title: u.title, whatChanged: u.whatChanged, whyItMatters: u.whyItMatters, actionNeeded: u.actionNeeded, affects: u.affects, previouslyApplied: u.previouslyApplied ?? null, status: u.status, effectiveDate: u.effectiveDate, source: u.sourceName, quote: u.quote }) }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
    });
    if (!res.ok) return u;
    const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const p = JSON.parse(j.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}") as Record<string, string>;
    const t = (k: string, fallback: string, n: number) =>
      typeof p[k] === "string" && p[k].trim() ? p[k].trim().replace(/§§\s*/g, "Sections ").replace(/§\s*/g, "Section ").slice(0, n) : fallback;
    return {
      ...u,
      title: t("title", u.title, 160),
      whatChanged: t("whatChanged", u.whatChanged, 600),
      whyItMatters: t("whyItMatters", u.whyItMatters, 400),
      actionNeeded: t("actionNeeded", u.actionNeeded, 400),
      affects: t("affects", u.affects, 300),
      previouslyApplied: t("previouslyApplied", u.previouslyApplied ?? "Not stated", 600),
    };
  } catch {
    return u;
  }
}

type SourceInfo = Pick<AlertRow, "source_name" | "source_url" | "status" | "area" | "title" | "what_changed">;
async function relatedSources(admin: SupabaseClient, a: SourceInfo): Promise<{ name: string; url: string }[]> {
  const out = [{ name: a.source_name, url: a.source_url }];
  const add = (name: string, url: string) => {
    if (!out.some((x) => x.url === url)) out.push({ name, url });
  };
  const issue = a.source_url.match(/texreg\/archive\/([A-Za-z]+\d{5,6})\//)?.[1];
  if (issue) add(`Texas Register — ${issue.replace(/(\d{1,2})(\d{4})$/, " $1, $2")} issue`, `${TEXREG}${issue}/index.html`);
  if (["adopted_rule", "proposed_rule"].includes(a.status)) {
    add("Texas Comptroller — Property tax rules (proposed & adopted)", "https://comptroller.texas.gov/taxes/property-tax/rules/");
    const { data } = await admin.from("tax_update_sources").select("name, url").ilike("name", "%Administrative Code%").limit(1).maybeSingle();
    if (data) add(data.name, data.url);
  }
  if (a.area === "hearings" || /arbitration|ARB\b/i.test(`${a.title} ${a.what_changed}`)) {
    add("Texas Comptroller — Protests & appeals (incl. arbitration)", "https://comptroller.texas.gov/taxes/property-tax/protests/");
  }
  if (a.area === "representation" || /\bform\b|AP-\d+|50-\d{3}/i.test(`${a.title} ${a.what_changed}`)) {
    add("Texas Comptroller — Property tax forms", "https://comptroller.texas.gov/taxes/property-tax/forms/");
  }
  if (a.status === "enacted_law" || a.status === "pending_legislation") add("Texas Legislature Online", "https://capitol.texas.gov/");
  return out;
}

/**
 * Completes an alert's brief: "what previously applied" (ONLY if the official
 * page itself says so) and a marketing-ready sentence (for staff to review),
 * plus the code-written verification note and official source list.
 */
async function enrich(admin: SupabaseClient, apiKey: string, rows: AlertRow[]): Promise<AlertRow[]> {
  const out: AlertRow[] = [];
  for (const a of rows) {
    let previously = a.previously_applied && !/^not stated/i.test(a.previously_applied) ? a.previously_applied : "Not stated on the official source.";
    let marketing: string | null = null;
    const plain: Partial<Pick<AlertRow, "title" | "what_changed" | "owner_impact" | "recommended_action" | "corvus_impact">> = {};
    try {
      const page = await fetchPage(a.source_url, /texreg/.test(a.source_url) ? 60_000 : PAGE_CHARS);
      const text = "error" in page ? "" : /texreg/.test(a.source_url) ? chapter9(page.text) : page.text;
      const res = await fetch(geminiUrl(GEMINI_MODEL_FAST, apiKey), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text:
                "You complete and rewrite a regulatory alert for CorvusPT (a Texas commercial property-tax protest platform) using the official page text given. Keep every fact; add none (except the labelled background below).\n" +
                "STYLE: a clear news alert for busy business owners — short sentences, everyday words, acronyms spelled out the first time, rule numbers only at the end in parentheses, no legal phrasing (say \"uses a new form\", \"the appeal can be thrown out if…\").\n" +
                '- title: a plain headline, e.g. "Texas updates binding arbitration rules, effective October 25, 2026".\n' +
                "- whatChanged: 1-3 sentences.\n" +
                "- whyItMatters: 1-3 sentences on the practical effect for commercial property owners and tenants.\n" +
                "- recommendedAction: 1-2 sentences — a practical suggestion for a commercial property owner or tenant (what to check or do next). Never a task for CorvusPT or any company; no legal advice.\n" +
                '- previouslyApplied: 1-2 sentences on what applied BEFORE. Prefer the page text (earlier proposal, prior rule, the law it implements). If the page doesn\'t say but you are CERTAIN of the earlier Texas rule or law, state it and begin with "Background:". If not certain, return exactly "Not stated on the official source." Never invent a bill number, date or amount.\n' +
                '- marketingSentence: ONE accurate sentence (under 30 words) CorvusPT marketing could post for commercial property owners, starting "TEXAS PROPERTY TAX UPDATE:". Everyday words — no rule or section numbers, no legal jargon (say "appeal", not "mandatory dismissal for lack of jurisdiction"). Name the effective date if known. No promises of savings, no legal advice. Example style: "TEXAS PROPERTY TAX UPDATE: New binding arbitration rules take effect October 25, 2026 — commercial owners and qualifying tenants should know their appeal rights."\n' +
                'Return ONLY JSON: {"title": "...", "whatChanged": "...", "whyItMatters": "...", "recommendedAction": "...", "previouslyApplied": "...", "marketingSentence": "..."}',
            }],
          },
          contents: [{ role: "user", parts: [{ text: `ALERT: ${a.title}\nWHAT CHANGED: ${a.what_changed}\nWHY IT MATTERS: ${a.owner_impact ?? ""}\nEFFECTIVE: ${a.effective_date ?? "not stated"}\nSTATUS: ${STATUS_TEXT[a.status] ?? a.status}\n\nOFFICIAL PAGE TEXT:\n${text.slice(0, 30_000)}` }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0 },
        }),
      });
      if (res.ok) {
        const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        const parsed = JSON.parse(j.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}") as {
          title?: string;
          whatChanged?: string;
          whyItMatters?: string;
          recommendedAction?: string;
          previouslyApplied?: string;
          marketingSentence?: string;
        };
        const tidy = (x?: string, n = 600) => x?.trim().replace(/§§\s*/g, "Sections ").replace(/§\s*/g, "Section ").slice(0, n);
        if (parsed.title?.trim()) plain.title = tidy(parsed.title, 160);
        if (parsed.whatChanged?.trim()) plain.what_changed = tidy(parsed.whatChanged);
        if (parsed.whyItMatters?.trim()) plain.owner_impact = tidy(parsed.whyItMatters);
        if (parsed.recommendedAction?.trim()) plain.recommended_action = tidy(parsed.recommendedAction, 400);
        plain.corvus_impact = null;
        if (parsed.previouslyApplied?.trim()) previously = tidy(parsed.previouslyApplied)!;
        if (parsed.marketingSentence?.trim()) marketing = parsed.marketingSentence.trim().replace(/§§\s*/g, "Sections ").replace(/§\s*/g, "Section ").slice(0, 300);
      }
    } catch (err) {
      console.error("alert enrich failed:", err);
    }
    const patch = {
      ...plain,
      previously_applied: previously,
      marketing_sentence: marketing,
      verification_note: verificationNote(a),
      related_sources: await relatedSources(admin, a),
      enriched_at: new Date().toISOString(),
    };
    await admin.from("tax_update_alerts").update(patch).eq("id", a.id);
    out.push({ ...a, ...patch });
  }
  return out;
}
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
          `<p style="margin:4px 0;color:#555"><b>Status:</b> ${esc(STATUS_TEXT[a.status] ?? a.status)} · ${esc(AREA_LABEL[a.area] ?? a.area)}${a.effective_date ? ` · effective ${esc(a.effective_date)}` : " · effective date not stated"}</p>` +
          `<p style="margin:6px 0"><b>1. What changed:</b> ${esc(a.what_changed)}</p>` +
          `<p style="margin:6px 0"><b>2. What previously applied:</b> ${esc(a.previously_applied ?? "Not stated on the official source.")}</p>` +
          `<p style="margin:6px 0"><b>3. Why it matters to commercial property owners:</b> ${esc(a.owner_impact)}</p>` +
          `<p style="margin:6px 0"><b>4. Recommended action for property owners:</b> ${esc(a.recommended_action ?? "Check the official source.")}</p>` +
          `<p style="margin:6px 0"><b>5. Official sources:</b><br>${(a.related_sources?.length ? a.related_sources : [{ name: a.source_name, url: a.source_url }]).map((s) => `<a href="${esc(s.url)}">${esc(s.name)}</a>`).join("<br>")}</p>` +
          (a.marketing_sentence ? `<p style="margin:6px 0"><b>6. Marketing-ready sentence</b> (review before use): ${esc(a.marketing_sentence)}</p>` : "") +
          `<p style="margin:6px 0;color:#555"><b>Verification note:</b> ${esc(a.verification_note ?? verificationNote(a))}</p></div>`,
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

    // { rewrite: true } — re-word the updates already published (latest report
    // + the tax-year critical list) in the plain style; facts and quotes stay.
    const body = (await req.json().catch(() => ({}))) as { rewrite?: boolean };
    if (body.rewrite === true) {
      const { data: rep } = await admin.from("tax_update_reports").select("id, updates").order("week_start", { ascending: false }).limit(1).maybeSingle();
      let n = 0;
      if (rep) {
        const out = await inBatches((rep.updates ?? []) as Update[], 8, (u) => rewritePlain(apiKey, u));
        n += out.length;
        for (const u of out) {
          if (!u.sources?.length)
            u.sources = await relatedSources(admin, { source_name: u.sourceName, source_url: u.sourceUrl, status: u.status, area: "other", title: u.title, what_changed: u.whatChanged });
        }
        await admin.from("tax_update_reports").update({ updates: out }).eq("id", rep.id);
      }
      const { data: crit } = await admin.from("tax_update_critical_items").select("id, update").gte("tax_year", new Date().getUTCFullYear());
      await inBatches(crit ?? [], 8, async (c) => {
        await admin.from("tax_update_critical_items").update({ update: await rewritePlain(apiKey, c.update as Update) }).eq("id", c.id);
        n++;
      });
      await admin.from("tax_update_alerts").update({ enriched_at: null }).not("id", "is", null);
      const { data: alerts } = await admin.from("tax_update_alerts").select(ALERT_COLS);
      if (alerts?.length) await enrich(admin, apiKey, alerts as AlertRow[]);
      return new Response(JSON.stringify({ ok: true, rewritten: n, alerts: alerts?.length ?? 0 }), { status: 200, headers: corsHeaders });
    }

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
    // every relevant official page for each update (owners see the list;
    // paying customers can open the links)
    for (const u of updates) {
      if (u.sources?.length) continue;
      u.sources = await relatedSources(admin, {
        source_name: u.sourceName,
        source_url: u.sourceUrl,
        status: u.status,
        area: u.tags.includes("representation") ? "representation" : u.tags.includes("hearings") || u.tags.includes("arb") ? "hearings" : "other",
        title: u.title,
        what_changed: u.whatChanged,
      });
    }

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
            owner_impact: u.whyItMatters !== "Not stated" ? u.whyItMatters : u.affects,
            previously_applied: u.previouslyApplied && u.previouslyApplied !== "Not stated" ? u.previouslyApplied : null,
            corvus_impact: null,
            recommended_action: u.actionNeeded !== "Not stated" ? u.actionNeeded : null,
            counties: u.counties,
            source_name: u.sourceName,
            source_url: u.sourceUrl,
            quote: u.quote,
          })),
          { onConflict: "dedup_key", ignoreDuplicates: true },
        )
        .select(ALERT_COLS);
      if (alertErr) console.error("tax_update_alerts upsert failed:", alertErr);
      alerted = (inserted ?? []) as typeof alerted;
      if (inserted && inserted.length > 0) {
        await announce(admin, await enrich(admin, apiKey, inserted as AlertRow[]));
      }
    }
    // catch up older alerts that don't have the full brief yet (no re-announce)
    const { data: bare } = await admin.from("tax_update_alerts").select(ALERT_COLS).is("enriched_at", null).limit(10);
    if (bare && bare.length > 0) await enrich(admin, apiKey, bare as AlertRow[]);

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
