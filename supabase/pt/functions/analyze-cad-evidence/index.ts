// Deploy via CLI: `supabase functions deploy analyze-cad-evidence`.
// Requires the GEMINI_API_KEY secret (shared with the other AI functions).
//
// Reads the appraisal district's hearing evidence packet (what the owner
// received after requesting it under Tax Code §41.461) against the property's
// own facts, and lists the packet's weaknesses — comps in materially better
// locations, comps far larger or smaller, inconsistent cap rates or expense
// assumptions, stale sales, wrong facts about the owner's property — plus a
// recommended hearing response. Every weakness must point at something
// actually printed in the packet; the owner's facts are supplied by the
// caller, never guessed. Output is clamped by _shared/cad-evidence-review.ts.
import { GEMINI_MODEL_FAST, geminiUrl } from "../_shared/gemini.ts";
import {
  WEAKNESS_CATEGORIES,
  sanitizeCadEvidenceReview,
} from "../_shared/cad-evidence-review.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const MAX_DOCS = 3;

const SYSTEM = `You are CorvusPT's Texas commercial property tax hearing analyst. The owner received the appraisal district's hearing evidence (Tax Code §41.461) and uploaded it. Find the weaknesses in the district's case for THIS property and draft the owner's response.

Rules:
- Every weakness must refer to something actually in the district's packet (a specific comp, figure, assumption or statement). Never invent a comp, number or fact.
- Compare against the subject facts provided (building size, year built, land, income, cap rate, address). If the packet states a subject fact that disagrees with the provided facts, that is a "subject_data" weakness.
- category: one of ${WEAKNESS_CATEGORIES.join(", ")}.
  location = a comp in a materially better/different location; size = a comp much larger/smaller (say by how much, e.g. "42% smaller"); age_condition; cap_rate = cap rates inconsistent with each other or the market; income = rent/vacancy/expense assumptions; time = stale or unadjusted sale dates; property_type = different use/class.
- finding: one plain line naming the comp/item. detail: why it matters and what to say at the hearing (1-3 sentences).
- item: which comp / page / exhibit it concerns, or null.
- cadIndicatedValue: the value the district's packet argues for, as a number, or null if not stated.
- summary: 1-2 sentences on the overall strength of the district's case.
- extraction: read EVERY comparable in the packet (sales, equity/appraisal comps, rent comps) into extraction.comps with exactly the figures printed — label as the packet names it ("Comp 3", "Sale 2"), kind (sale|equity|rent|other), salePrice, saleDate (YYYY-MM-DD), appraisedValue, buildingSqft, yearBuilt, acres, propertyType, distanceMi, every adjustment as {factor, pct} (pct as a signed percent, e.g. -10), adjustedValue, capRatePct. extraction.subjectAsStated: the facts the packet states about the OWNER'S property (buildingSqft, yearBuilt, acres, propertyType, condition). extraction.income: the district's income assumptions (marketRentPerSf, vacancyPct, expensePct, capRatePct). extraction.proposedValue: the value the district proposes. Use null for anything not printed — never estimate.
- hearingResponse: a concise, professional response the owner can present at the ARB hearing, organized point by point, citing the weaknesses. Plain text, no markdown.
Return ONLY JSON: {"summary":"...","cadIndicatedValue":<number|null>,"extraction":{"proposedValue":<number|null>,"subjectAsStated":{"buildingSqft":null,"yearBuilt":null,"acres":null,"propertyType":null,"condition":null},"comps":[{"label":"...","address":null,"kind":"sale","salePrice":null,"saleDate":null,"appraisedValue":null,"buildingSqft":null,"yearBuilt":null,"acres":null,"propertyType":null,"distanceMi":null,"adjustments":[{"factor":"...","pct":0}],"adjustedValue":null,"capRatePct":null}],"income":{"marketRentPerSf":null,"vacancyPct":null,"expensePct":null,"capRatePct":null}},"weaknesses":[{"category":"...","finding":"...","detail":"...","item":<string|null>}],"hearingResponse":"..."}`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  try {
    const { subject, documents } = await req.json();
    const docs = (Array.isArray(documents) ? documents : [])
      .slice(0, MAX_DOCS)
      .filter((d: { dataUrl?: string }) =>
        String(d.dataUrl ?? "").includes(","),
      );
    if (docs.length === 0) {
      return new Response(
        JSON.stringify({ error: "Upload the district's evidence packet." }),
        {
          status: 400,
          headers: corsHeaders,
        },
      );
    }
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

    const parts: Array<{
      text?: string;
      inline_data?: { mime_type: string; data: string };
    }> = [
      {
        text: `Subject property facts (from the county record and the owner's documents):\n${JSON.stringify(subject ?? {}, null, 1)}\n\nThe attached file(s) are the appraisal district's hearing evidence. Produce the full JSON response.`,
      },
    ];
    for (const d of docs) {
      parts.push({
        inline_data: {
          mime_type: d.mimeType || "application/pdf",
          data: String(d.dataUrl).split(",", 2)[1],
        },
      });
    }

    const res = await fetch(geminiUrl(GEMINI_MODEL_FAST, apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0,
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 429) {
        return new Response(
          JSON.stringify({
            error: "AI is rate-limited. Please retry in a moment.",
          }),
          { status: 429, headers: corsHeaders },
        );
      }
      throw new Error(`Gemini API error ${res.status}: ${text.slice(0, 200)}`);
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
    return new Response(JSON.stringify(sanitizeCadEvidenceReview(parsed)), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "unknown error",
      }),
      { status: 500, headers: corsHeaders },
    );
  }
});
