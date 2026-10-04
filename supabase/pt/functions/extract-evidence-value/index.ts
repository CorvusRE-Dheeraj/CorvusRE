// Deploy via CLI: `supabase functions deploy extract-evidence-value`.
// Requires the GEMINI_API_KEY secret (shared with the other AI functions).
//
// Reads ONE uploaded evidence document and pulls out what it says about the property's VALUE,
// so the app can move the AI Report scores and the savings estimate when an owner uploads
// evidence (an appraisal, a repair estimate, an income statement, comparable sales...).
//
// The model only READS the file and reports what is printed on it. Everything that turns those
// numbers into a score or a dollar amount is deterministic client code (src/lib/evidence-value.ts),
// so the same evidence always gives the same result and refreshing the page never changes it.
// The result is stored on documents.value_signal (service role only) and only re-read when the
// file itself changes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GEMINI_MODEL_FAST, geminiUrl } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

// Bump when the stored shape changes, so older readings are re-read once.
const SCHEMA_VERSION = 2;

const KINDS = [
  "independent_appraisal",
  "income_statement",
  "repair_estimate",
  "comparable_sales",
  "condition_photos",
  "lease_or_rent_roll",
  "market_report",
  "zoning_or_land_use",
  "site_survey_environmental",
  "other_relevant",
  "not_valuation_evidence",
] as const;
type Kind = (typeof KINDS)[number];

const SYSTEM = `You read ONE document a Texas commercial property owner uploaded as evidence for a property tax protest. Report only what the document actually says about the property's value. Never invent or estimate a number that is not printed on the page.

Return ONLY a JSON object with this exact shape:
{
  "kind": "<one of: independent_appraisal | income_statement | repair_estimate | comparable_sales | condition_photos | lease_or_rent_roll | market_report | zoning_or_land_use | site_survey_environmental | other_relevant | not_valuation_evidence>",
  "valuationDate": <"YYYY-MM-DD" | "YYYY" | null>,
  "indicatedValue": <number|null>,
  "costToCure": <number|null>,
  "netOperatingIncome": <number|null>,
  "capRatePct": <number|null>,
  "occupancyPct": <number|null>,
  "sales": [ { "address": <string|null>, "price": <number>, "date": <string|null>, "sqft": <number|null> } ],
  "conditionIssues": [<"short plain description of a physical defect or deferred-maintenance problem that is visible or stated">],
  "confidence": "<high | medium | low>",
  "summary": "<one plain sentence saying what this document is and what it shows about value>",
  "assessment": {
    "relevance": <integer 0-100>,
    "quality": <integer 0-100>,
    "independence": "<third_party_licensed | third_party | owner_prepared | unknown>",
    "currentness": "<current | recent | stale | undated>",
    "supports": "<protest | county_value | neutral>",
    "modules": [<any of: "comps" | "site" | "improvement" | "income" | "zoning">],
    "importance": "<critical | strong | moderate | minor | negligible>",
    "rationale": "<one plain sentence explaining the importance level>"
  }
}

Rules:
- "indicatedValue": ONLY the total market value of THIS property that the document itself concludes (an appraisal's value conclusion, a broker opinion of value). Not a tax figure, not a loan amount, not a price for a different property.
- "costToCure": ONLY the total estimated cost to repair the problems the document describes (a contractor bid, an inspection report's total estimate). Otherwise null.
- "netOperatingIncome" and "capRatePct": ONLY when printed (or clearly totalled) on the document. capRatePct is a percentage such as 7.5.
- "sales": comparable properties that SOLD, each with its real sale price. [] if none.
- "confidence": high = the number is clearly printed, for this property, current; medium = plausible but partly unclear; low = illegible, stale, for another property, or you are unsure.
- If the file is not evidence about value (a form, a receipt, an unrelated photo), use kind "not_valuation_evidence" and leave every number null.
- "assessment" judges how much this document should matter to a Texas commercial property tax protest for THIS property:
  - relevance: is it clearly about this property and this tax year? 0 = unrelated, 100 = squarely about this property.
  - quality: how trustworthy and complete? A signed report by a licensed appraiser, a contractor bid, or a certified statement scores high; an unsigned, undated, partial, blurry or self-written note scores low.
  - independence: third_party_licensed (licensed professional), third_party (an outside company or agency), owner_prepared (written by the owner or their staff), unknown.
  - currentness: current = about the current tax year; recent = within about 2 years; stale = older; undated = no date.
  - supports: protest if it indicates the county value is too high or the property is worth less; county_value if it supports the county value; neutral otherwise.
  - modules: which analyses it informs: comps (sales/market values), site (flood, access, land, environmental), improvement (building condition, age, repairs), income (rent, expenses, NOI), zoning (zoning, permitted use, restrictions).
  - importance: critical = an independent conclusion of value for this property; strong = hard numbers that directly move the value (a contractor bid, an income statement with NOI, several closed sales); moderate = useful support (rent roll, condition photos with visible defects); minor = weak or indirect; negligible = barely relevant.
- Plain prose, no markdown.`;

const num = (v: unknown, lo = 0, hi = 1e12): number | null => {
  const n =
    typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^0-9.-]/g, "")) : NaN;
  return Number.isFinite(n) && n > lo && n < hi ? n : null;
};
const str = (v: unknown, len: number): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, len) : null;
};

function base64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function extOf(name: string): string {
  const e = name.toLowerCase().split(".").pop();
  return e && e.length <= 5 ? e : "pdf";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { documentId, force } = (await req.json()) as { documentId?: string; force?: boolean };
    if (typeof documentId !== "string" || !documentId) {
      return new Response(JSON.stringify({ error: "documentId is required" }), {
        status: 400,
        headers: corsHeaders,
      });
    }
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );
    const {
      data: { user },
      error: userErr,
    } = await callerClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "unauthenticated" }), {
        status: 401,
        headers: corsHeaders,
      });
    }
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: doc } = await adminClient
      .from("documents")
      .select("id, user_id, property_id, file_name, storage_path, value_signal")
      .eq("id", documentId)
      .maybeSingle();
    if (!doc) {
      return new Response(JSON.stringify({ error: "Document not found." }), {
        status: 404,
        headers: corsHeaders,
      });
    }
    if (doc.user_id !== user.id) {
      const { data: me } = await adminClient
        .from("profiles")
        .select("is_admin")
        .eq("id", user.id)
        .maybeSingle();
      if (!me?.is_admin) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403,
          headers: corsHeaders,
        });
      }
    }
    // Already read: serve the stored result. Same file => same answer, every time.
    const stored = doc.value_signal as { schemaVersion?: number } | null;
    if (stored && stored.schemaVersion === SCHEMA_VERSION && !force) {
      return new Response(JSON.stringify({ documentId, signal: doc.value_signal, cached: true }), {
        status: 200,
        headers: corsHeaders,
      });
    }

    const { data: property } = await adminClient
      .from("properties")
      .select("address, total_value, tax_year, property_type")
      .eq("id", doc.property_id)
      .maybeSingle();

    const { data: blob, error: dlErr } = await adminClient.storage
      .from("documents")
      .download(doc.storage_path);
    if (dlErr || !blob) {
      return new Response(JSON.stringify({ error: "Could not read the stored file." }), {
        status: 400,
        headers: corsHeaders,
      });
    }
    if (blob.size > 18 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: "File is too large to read (over 18 MB)." }), {
        status: 413,
        headers: corsHeaders,
      });
    }
    const ext = extOf(doc.file_name);
    const mimeType =
      blob.type ||
      (ext === "pdf"
        ? "application/pdf"
        : ["jpg", "jpeg"].includes(ext)
          ? "image/jpeg"
          : ext === "png"
            ? "image/png"
            : "application/octet-stream");
    const data = base64(await blob.arrayBuffer());

    const context = [
      property?.address ? `Property: ${property.address}` : null,
      property?.property_type ? `Property type: ${property.property_type}` : null,
      property?.total_value != null
        ? `County assessed value: $${Number(property.total_value).toLocaleString()} (tax year ${property.tax_year ?? "unknown"})`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

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
                text: `${context}\n\nThe attached file is named "${doc.file_name}". Read it and return the JSON.`,
              },
              { inline_data: { mime_type: mimeType, data } },
            ],
          },
        ],
        generationConfig: { responseMimeType: "application/json", temperature: 0, seed: 7 },
      }),
    });
    if (!res.ok) {
      if (res.status === 429) {
        return new Response(
          JSON.stringify({ error: "AI is rate-limited. Please retry in a moment." }),
          { status: 429, headers: corsHeaders },
        );
      }
      throw new Error(`Gemini API error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : {};
    }

    // ---- Deterministic sanity checks on what the model reported ------------------------------
    const assessed = property?.total_value != null ? Number(property.total_value) : null;
    const kind: Kind = (KINDS as readonly string[]).includes(parsed.kind as string)
      ? (parsed.kind as Kind)
      : "other_relevant";
    let confidence: "high" | "medium" | "low" = ["high", "medium", "low"].includes(
      parsed.confidence as string,
    )
      ? (parsed.confidence as "high" | "medium" | "low")
      : "low";
    const notes: string[] = [];

    let indicatedValue = num(parsed.indicatedValue);
    // A value that is wildly off the assessed value is far more likely a misread (a loan amount,
    // a different property, wrong units) than a real conclusion — keep it out of the math.
    if (indicatedValue != null && assessed != null && (indicatedValue < assessed * 0.3 || indicatedValue > assessed * 3)) {
      notes.push("The value on this document is far from the county's value, so it was not used.");
      indicatedValue = null;
      confidence = "low";
    }
    let costToCure = num(parsed.costToCure);
    if (costToCure != null && assessed != null && costToCure > assessed * 0.5) {
      notes.push("The repair total is unusually large next to the assessed value, so it was not used.");
      costToCure = null;
      confidence = "low";
    }
    const noi = num(parsed.netOperatingIncome);
    let capRatePct = num(parsed.capRatePct, 0, 100);
    if (capRatePct != null && (capRatePct < 3 || capRatePct > 15)) {
      notes.push("The cap rate is outside the normal 3%–15% range, so it was not used.");
      capRatePct = null;
    }
    const sales = (Array.isArray(parsed.sales) ? parsed.sales : [])
      .map((s) => {
        const o = (s ?? {}) as Record<string, unknown>;
        const price = num(o.price);
        return price == null
          ? null
          : {
              address: str(o.address, 160),
              price,
              date: str(o.date, 20),
              sqft: num(o.sqft, 0, 1e8),
            };
      })
      .filter((s): s is NonNullable<typeof s> => s != null)
      .slice(0, 12);
    const conditionIssues = (Array.isArray(parsed.conditionIssues) ? parsed.conditionIssues : [])
      .map((x) => str(x, 200))
      .filter((x): x is string => !!x)
      .slice(0, 8);

    // ---- The model's judgement of how much this document should matter ---------------------
    const a = (parsed.assessment ?? {}) as Record<string, unknown>;
    const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
      (allowed as readonly string[]).includes(v as string) ? (v as T) : fallback;
    const int = (v: unknown, fallback: number) => {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : fallback;
    };
    const MODS = ["comps", "site", "improvement", "income", "zoning"] as const;
    const assessment = {
      relevance: int(a.relevance, 50),
      quality: int(a.quality, 50),
      independence: pick(a.independence, ["third_party_licensed", "third_party", "owner_prepared", "unknown"] as const, "unknown"),
      currentness: pick(a.currentness, ["current", "recent", "stale", "undated"] as const, "undated"),
      supports: pick(a.supports, ["protest", "county_value", "neutral"] as const, "neutral"),
      modules: (Array.isArray(a.modules) ? a.modules : [])
        .filter((m): m is (typeof MODS)[number] => (MODS as readonly string[]).includes(m as string))
        .slice(0, 5),
      importance: pick(a.importance, ["critical", "strong", "moderate", "minor", "negligible"] as const, "minor"),
      rationale: str(a.rationale, 240) ?? "",
    };

    const signal = {
      schemaVersion: SCHEMA_VERSION,
      kind,
      valuationDate: str(parsed.valuationDate, 12),
      indicatedValue,
      costToCure,
      netOperatingIncome: noi,
      capRatePct,
      occupancyPct: num(parsed.occupancyPct, 0, 100.0001),
      sales,
      conditionIssues,
      confidence,
      assessment,
      summary: str(parsed.summary, 300) ?? "Evidence document.",
      notes,
      readAt: new Date().toISOString(),
    };

    await adminClient
      .from("documents")
      .update({ value_signal: signal, value_signal_at: signal.readAt })
      .eq("id", documentId);

    return new Response(JSON.stringify({ documentId, signal, cached: false }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
