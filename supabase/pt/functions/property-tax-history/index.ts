// Deploy via CLI: `supabase functions deploy property-tax-history`.
// Requires GEMINI_API_KEY (for counties read off the CAD's own page).
//
// Pay Taxes → 5-year tax history, from the appraisal district, for one of the
// caller's own properties (read through RLS). Cached per property for 30 days
// in public.property_tax_history; the app reads that table directly and calls
// this only for a property with nothing fresh cached.
//
// Collin — exact, no AI: Collin CAD publishes every year's certified roll on
// the Texas Open Data Portal (data.texas.gov, "Collin CAD Appraisal Data -
// YYYY"): the account's assessed value and its taxing units (entitycodes) per
// year, and "Collin CAD Entity List - All Years" gives each unit's adopted
// rate per year. Tax = assessed value × the sum of those rates. Exact for an
// account with no exemptions; with exemptions (homestead, over-65 …) the
// exemption amounts per unit aren't in the data, so the year is flagged
// approximate. (Collin CAD's own site is behind a Cloudflare bot check, so
// this is the only machine-readable source — and it's the CAD's own data.)
//
// Every other county — AI: the property's record page on the CAD's own site
// (the caller passes it; it's fetched only if it's on the official CAD
// website from the Comptroller directory), read by Gemini for the value and
// tax history it shows. Every number kept must appear on that page.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import directory from "../_shared/tx-cad-directory.json" with { type: "json" };
import { GEMINI_MODEL_FAST, geminiUrl } from "../_shared/gemini.ts";
import { rateLimitUser } from "../_shared/rate-limit.ts";
import { readOfficialSite, corpus } from "../_shared/web-retrieval.ts";
import {
  collinHistory,
  CURRENT_TAX_YEAR,
  num,
  round2,
  YEARS,
  type TaxHistoryYear,
} from "../_shared/tax-history.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const FRESH_MS = 30 * 24 * 60 * 60 * 1000;

type DirEntry = { county: string; appraisalDistrict: { website: string | null } | null };
const counties = (directory as unknown as { counties: Record<string, DirEntry> }).counties;

function countyOf(cad: string | null): string | null {
  if (!cad) return null;
  const c = cad
    .replace(/\s+(central\s+)?appraisal\s+district$/i, "")
    .replace(/\s+cad$/i, "")
    .replace(/\s+county$/i, "")
    .trim();
  return c || null;
}

// ── Any other county: AI reads the CAD's own record page ────────────────────

const AI_SYSTEM = `You read a Texas appraisal district's web page for ONE property account and list its value and tax history by year, exactly as the page shows it. Use ONLY numbers printed on the page — never compute, estimate or fill in a year that isn't shown.

Return ONLY JSON: {"years": [{"year": <4-digit tax year>, "marketValue": <number or null>, "appraisedValue": <number or null>, "taxableValue": <the net taxable / assessed value, or null>, "rate": <the combined tax rate per $100 for that year if printed, or null>, "tax": <the total tax / estimated taxes for that year if printed, or null>}]}
Numbers as plain numbers (no $ or commas). Most recent year first, at most 6 years.`;

const sameSite = (a: URL, b: URL) => a.hostname.replace(/^www\./, "") === b.hostname.replace(/^www\./, "");

async function aiHistory(cadUrl: string): Promise<{ years: TaxHistoryYear[]; sourceUrl: string } | null> {
  const { pages } = await readOfficialSite(cadUrl, /history|values?|tax(es)?/i, { maxPages: 1, maxPdfs: 0 });
  if (pages.length === 0) return null;
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
  const res = await fetch(geminiUrl(GEMINI_MODEL_FAST, apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: AI_SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: pages.map((p) => `=== PAGE ${p.url} ===\n${p.text}`).join("\n\n") }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini API error ${res.status}`);
  const out = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  let parsed: { years?: unknown } = {};
  try {
    parsed = JSON.parse(out.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}");
  } catch {
    parsed = {};
  }
  // Grounding: a number is kept only if its digits appear in the page text.
  const digits = corpus(pages).text.replace(/[,$]/g, "");
  const seen = (n: number | null) => {
    if (n == null) return null;
    const plain = String(n);
    const fixed = n.toFixed(2);
    return digits.includes(plain) || digits.includes(fixed) || digits.includes(fixed.replace(/0+$/, "").replace(/\.$/, ""))
      ? n
      : null;
  };
  const years = (Array.isArray(parsed.years) ? parsed.years : [])
    .map((y): TaxHistoryYear | null => {
      const r = (y ?? {}) as Record<string, unknown>;
      const year = num(r.year);
      if (!year || year < 1990 || year > CURRENT_TAX_YEAR + 1 || !digits.includes(String(year))) return null;
      const e: TaxHistoryYear = {
        year,
        marketValue: seen(num(r.marketValue)),
        appraisedValue: seen(num(r.appraisedValue)),
        taxableValue: seen(num(r.taxableValue)),
        rate: seen(num(r.rate)),
        tax: seen(num(r.tax)),
        exact: true,
      };
      // A printed rate but no printed tax: compute it from the printed taxable value.
      if (e.tax == null && e.rate != null && e.taxableValue != null) {
        e.tax = round2((e.taxableValue * e.rate) / 100);
      }
      return e.marketValue ?? e.appraisedValue ?? e.taxableValue ?? e.tax ? e : null;
    })
    .filter((y): y is TaxHistoryYear => !!y)
    .sort((a, b) => b.year - a.year)
    .slice(0, YEARS);
  return { years, sourceUrl: pages[0].url };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: corsHeaders });

  try {
    const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const {
      data: { user },
    } = await caller.auth.getUser();
    if (!user) return json({ error: "unauthenticated" }, 401);

    const { propertyId, cadUrl, refresh } = (await req.json()) as {
      propertyId?: unknown;
      cadUrl?: unknown;
      refresh?: unknown;
    };
    if (typeof propertyId !== "string") return json({ error: "propertyId is required" }, 400);
    const { data: prop } = await caller
      .from("properties")
      .select("id, user_id, cad, account_number")
      .eq("id", propertyId)
      .maybeSingle();
    if (!prop) return json({ error: "Property not found." }, 404);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    if (refresh !== true) {
      const { data: cached } = await admin
        .from("property_tax_history")
        .select("years, source, source_url, retrieved_at, account_number")
        .eq("property_id", prop.id)
        .maybeSingle();
      if (
        cached &&
        cached.account_number === prop.account_number &&
        Date.now() - new Date(cached.retrieved_at as string).getTime() < FRESH_MS
      ) {
        return json({ years: cached.years, source: cached.source, sourceUrl: cached.source_url, retrievedAt: cached.retrieved_at });
      }
    }
    const limited = await rateLimitUser(user.id, "property-tax-history", 120, corsHeaders);
    if (limited) return limited;

    const county = countyOf(prop.cad);
    let result: { years: TaxHistoryYear[]; sourceUrl: string } | null = null;
    let source: "collin_open_data" | "cad_page" | "none" = "none";
    if (county?.toLowerCase() === "collin" && prop.account_number) {
      result = await collinHistory(prop.account_number.trim());
      source = "collin_open_data";
    } else if (typeof cadUrl === "string" && county) {
      const entry = Object.values(counties).find((c) => c.county.toLowerCase() === county.toLowerCase());
      const site = entry?.appraisalDistrict?.website;
      let ok = false;
      try {
        const u = new URL(cadUrl);
        ok = !!site && (u.protocol === "https:" || u.protocol === "http:") &&
          sameSite(u, new URL(site.startsWith("http") ? site : `https://${site}`));
      } catch {
        ok = false;
      }
      if (ok) {
        result = await aiHistory(cadUrl);
        if (result) source = "cad_page";
      }
    }

    const now = new Date().toISOString();
    const row = {
      property_id: prop.id,
      user_id: prop.user_id,
      account_number: prop.account_number,
      years: result?.years ?? [],
      source,
      source_url: result?.sourceUrl ?? null,
      retrieved_at: now,
    };
    await admin.from("property_tax_history").upsert(row, { onConflict: "property_id" });
    return json({ years: row.years, source, sourceUrl: row.source_url, retrievedAt: now });
  } catch (err) {
    console.error("property-tax-history failed:", err);
    return json({ error: err instanceof Error ? err.message : "unknown error" }, 500);
  }
});
