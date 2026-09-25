// Deploy via CLI: `supabase functions deploy generate-tax-updates` (JWT-verified).
//
// Weekly Texas Property Tax Law & Updates report. Triggered by pg_cron (Mondays,
// service-role Bearer) or by an admin's "Generate now" button.
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
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GEMINI_MODEL_FAST, geminiUrl } from "../_shared/gemini.ts";
import { isServiceRoleRequest } from "../_shared/service-role-only.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
] as const;

type Source = {
  id: string;
  name: string;
  url: string;
  kind: string;
  county: string | null;
  last_text: string | null;
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
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

async function fetchPage(url: string): Promise<{ text: string } | { error: string }> {
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
    if (text.length < 400) return { error: "Page returned almost no readable text" };
    return { text: text.slice(0, PAGE_CHARS) };
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
  "- If the page has nothing that qualifies, return {\"updates\": []}. An empty result is correct and expected.\n" +
  "- Every update MUST include \"quote\": a short (under 200 characters) EXACT verbatim excerpt copied from the page text that supports it.\n" +
  "- If a field is not stated in the page, use null (for effectiveDate) or \"Not stated\" (other text fields). Never invent dates.\n" +
  `- status must be one of: ${STATUSES.join(", ")}. Use enacted_law only for law the page says has been enacted; adopted_rule for a rule the page says is adopted/effective; proposed_rule for a proposed rule; pending_legislation / failed_legislation for bills; otherwise notice_guidance.\n` +
  `- tags: choose any that apply from: ${TAGS.join(", ")}.\n` +
  "- chapter: 1 Texas statewide updates; 2 county updates (only for a county-specific page); 3 current-year rules & law changes; 4 commercial property updates; 5 protest, ARB & appeals; 6 important deadlines; 7 what property owners should know or do.\n" +
  "Return ONLY JSON: {\"updates\":[{\"title\",\"chapter\",\"whatChanged\",\"effectiveDate\",\"affects\",\"whyItMatters\",\"actionNeeded\",\"status\",\"tags\",\"quote\"}]}";

async function extract(apiKey: string, source: Source, text: string): Promise<unknown[]> {
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
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
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
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function validate(
  raw: unknown,
  source: Source,
  pageText: string,
  checkedAt: string,
  isNew: boolean,
): Update | null {
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

  const status = STATUSES.includes(r.status as never) ? (r.status as Update["status"]) : "notice_guidance";
  const tags = Array.isArray(r.tags)
    ? (r.tags as unknown[]).filter((t): t is string => typeof t === "string" && TAGS.includes(t as never))
    : [];
  let chapter = Number(r.chapter);
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > 7) chapter = source.county ? 2 : 1;
  // Chapter 2 is for county pages; a county page's items are county updates
  // unless the model placed them in a more specific chapter.
  if (source.county && chapter === 1) chapter = 2;
  if (!source.county && chapter === 2) chapter = 1;

  let effective: string | null = null;
  if (typeof r.effectiveDate === "string" && /\d/.test(r.effectiveDate)) {
    effective = r.effectiveDate.trim().slice(0, 40);
  }

  return {
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
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff));
  return m.toISOString().slice(0, 10);
}

async function inBatches<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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
        { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
      );
      const {
        data: { user },
      } = await callerClient.auth.getUser();
      const { data: profile } = user
        ? await admin.from("profiles").select("is_admin").eq("id", user.id).single()
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

    const { data: sourceRows, error: srcErr } = await admin
      .from("tax_update_sources")
      .select("id, name, url, kind, county, last_text")
      .eq("enabled", true);
    if (srcErr) throw srcErr;
    const sources = (sourceRows ?? []) as Source[];

    const checkedAt = new Date().toISOString();
    const results = await inBatches(sources, CONCURRENCY, async (source) => {
      const page = await fetchPage(source.url);
      if ("error" in page) {
        return { source, ok: false, note: page.error, updates: [] as Update[] };
      }
      try {
        // First check of a source: everything on the page is "currently posted".
        // Later checks: only text that changed since last week is examined, and
        // anything found there is "new this week".
        const baseline = source.last_text == null;
        const examine = baseline ? page.text : newLines(source.last_text ?? "", page.text);
        let updates: Update[] = [];
        if (examine.length >= 60) {
          const raw = await extract(apiKey, source, examine);
          updates = raw
            .map((r) => validate(r, source, page.text, checkedAt, !baseline))
            .filter((u): u is Update => u !== null);
        }
        await admin
          .from("tax_update_sources")
          .update({ last_text: page.text, last_checked_at: checkedAt })
          .eq("id", source.id);
        return {
          source,
          ok: true,
          note: baseline ? `${updates.length} currently posted (first check)` : `${updates.length} new`,
          updates,
        };
      } catch (err) {
        return {
          source,
          ok: false,
          note: err instanceof Error ? err.message : "extraction failed",
          updates: [] as Update[],
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
    updates.sort((a, b) => a.chapter - b.chapter);

    const readCount = results.filter((r) => r.ok).length;
    const weekStart = mondayOf(new Date());
    const summary =
      updates.length > 0
        ? `${updates.length} verified update${updates.length === 1 ? "" : "s"} (${updates.filter((u) => u.isNew).length} new this week) from ${readCount} of ${sources.length} official sources.`
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

    // Keep only the newest KEEP_REPORTS.
    const { data: all } = await admin
      .from("tax_update_reports")
      .select("id, week_start")
      .order("week_start", { ascending: false });
    const stale = (all ?? []).slice(KEEP_REPORTS).map((r) => r.id as string);
    if (stale.length > 0) await admin.from("tax_update_reports").delete().in("id", stale);

    return new Response(
      JSON.stringify({ ok: true, weekStart, updates: updates.length, sourcesRead: readCount, sources: sources.length }),
      { status: 200, headers: corsHeaders },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
