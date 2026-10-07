// Deploy via CLI: `supabase functions deploy retrieve-county-procedures`.
// Requires GEMINI_API_KEY (shared with the other AI functions).
//
// The "AI web/PDF retrieval" step for county procedures: for a county without a
// hand-researched entry (apps/pt/src/lib/county-protest-info.ts), read the
// appraisal district's OWN website — the official URL from the Texas
// Comptroller's directory (../_shared/tx-cad-directory.json), never a URL the
// caller supplies — follow its protest/appeal/online-filing pages and PDFs, and
// extract how to file there. Every URL, email and phone kept was checked to appear
// in what was fetched (../_shared/web-retrieval.ts).
//
// Cached per county in public.county_procedures for 90 days — public facts, read
// once for every user. Signed-in callers only (each uncached read costs an AI call).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import directory from "../_shared/tx-cad-directory.json" with { type: "json" };
import { GEMINI_MODEL_FAST, geminiUrl } from "../_shared/gemini.ts";
import {
  corpus,
  groundedEmail,
  groundedPhone,
  groundedUrl,
  readOfficialSite,
} from "../_shared/web-retrieval.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const FRESH_MS = 90 * 24 * 60 * 60 * 1000;
const FOLLOW = /protest|appeal|online|e-?file|ifile|filing|informal|review board|\barb\b|hearing|forms?\b/i;

const SYSTEM = `You read a Texas appraisal district's own web pages (and any attached PDFs) and report how a property owner files a property tax protest THERE. Use ONLY what the provided pages state. If a page doesn't clearly say something, return null for it — never fill in what is "typical for Texas".

Return ONLY JSON with exactly this shape:
{"onlinePortalUrl": <the URL of the district's online protest / appeal filing system, copied exactly from the pages, or null>,
 "onlineNotes": <one short sentence of conditions stated for online filing (e.g. needs the PIN on the notice), or null>,
 "emailFilingAvailable": <true only if the pages say a protest may be filed by email; false only if they say it may not; else null>,
 "emailFilingAddress": <the email address the pages say protests are sent to, or null>,
 "emailNotes": <one short sentence, or null>,
 "informalReviewHowTo": <one or two sentences on how the pages say to request an informal review / settlement with an appraiser, or null>,
 "informalReviewNotes": <one short sentence of stated timing or conditions, or null>,
 "arbPhone": <the phone number the pages give for protests / the appraisal review board, or null>,
 "arbEmail": <the email the pages give for protest or ARB questions, or null>,
 "sourceUrls": [<the page URLs you actually used, copied exactly>]}`;

type Extracted = Record<string, unknown>;

function str(v: unknown, max = 400): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: corsHeaders });

  try {
    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );
    const {
      data: { user },
    } = await callerClient.auth.getUser();
    if (!user) return json({ error: "unauthenticated" }, 401);

    const { countyCode } = (await req.json()) as { countyCode?: unknown };
    const entry =
      typeof countyCode === "string"
        ? (directory as { counties: Record<string, { appraisalDistrict: { name: string; website: string | null } | null }> })
            .counties[countyCode]
        : undefined;
    if (!entry?.appraisalDistrict) return json({ error: "Unknown county." }, 400);
    const website = entry.appraisalDistrict.website;
    if (!website) return json({ procedures: null });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: cached } = await admin
      .from("county_procedures")
      .select("procedures, retrieved_at")
      .eq("county_code", countyCode)
      .maybeSingle();
    if (cached && Date.now() - new Date(cached.retrieved_at as string).getTime() < FRESH_MS) {
      return json({ procedures: cached.procedures ?? null });
    }

    const { pages, pdfs } = await readOfficialSite(website, FOLLOW);
    let procedures: Extracted | null = null;

    if (pages.length > 0) {
      const apiKey = Deno.env.get("GEMINI_API_KEY");
      if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
      const pageText = pages
        .map((p) => `=== PAGE ${p.url} ===\n${p.text}\n--- links on this page ---\n${p.links
          .filter((l) => l.label)
          .slice(0, 150)
          .map((l) => `${l.label} -> ${l.url}`)
          .join("\n")}`)
        .join("\n\n");
      const parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [
        { text: `Appraisal district: ${entry.appraisalDistrict.name}\n\n${pageText}` },
        ...pdfs.map((p) => ({ inline_data: { mime_type: "application/pdf", data: p.base64 } })),
      ];
      const res = await fetch(geminiUrl(GEMINI_MODEL_FAST, apiKey), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: "user", parts }],
          generationConfig: { responseMimeType: "application/json", temperature: 0 },
        }),
      });
      if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const out = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const raw = out.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
      let parsed: Extracted = {};
      try {
        parsed = JSON.parse(raw);
      } catch {
        const m = raw.match(/\{[\s\S]*\}/);
        parsed = m ? JSON.parse(m[0]) : {};
      }

      // Keep only what's grounded in what was actually fetched.
      const c = corpus(pages);
      for (const p of pdfs) c.urls.add(p.url);
      const sourceUrls = Array.isArray(parsed.sourceUrls)
        ? parsed.sourceUrls.map((u) => groundedUrl(u, c)).filter((u): u is string => !!u)
        : [];
      procedures = {
        onlinePortalUrl: groundedUrl(parsed.onlinePortalUrl, c),
        onlineNotes: str(parsed.onlineNotes),
        emailFilingAvailable: typeof parsed.emailFilingAvailable === "boolean" ? parsed.emailFilingAvailable : null,
        emailFilingAddress: groundedEmail(parsed.emailFilingAddress, c),
        emailNotes: str(parsed.emailNotes),
        informalReviewHowTo: str(parsed.informalReviewHowTo, 600),
        informalReviewNotes: str(parsed.informalReviewNotes),
        arbPhone: groundedPhone(parsed.arbPhone, c),
        arbEmail: groundedEmail(parsed.arbEmail, c),
        sourceUrls: sourceUrls.length > 0 ? sourceUrls : pages.map((p) => p.url).slice(0, 3),
        retrievedAt: new Date().toISOString(),
      };
    }

    // Cache either way — a site we couldn't read is retried after the window too.
    await admin.from("county_procedures").upsert(
      {
        county_code: countyCode,
        cad_name: entry.appraisalDistrict.name,
        website,
        procedures,
        retrieved_at: new Date().toISOString(),
      },
      { onConflict: "county_code" },
    );

    return json({ procedures });
  } catch (err) {
    console.error("retrieve-county-procedures failed:", err);
    return json({ error: err instanceof Error ? err.message : "unknown error" }, 500);
  }
});
