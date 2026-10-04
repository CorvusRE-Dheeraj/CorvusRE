// Deploy via CLI: `supabase functions deploy generate-property-summary`.
// Requires the GEMINI_API_KEY secret (shared with the other AI functions).
//
// One AI-written property profile for the whole report — not per-module.
// Unlike generate-data-sheet (which drafts ASSUMED/typical values for
// missing inputs, clearly flagged as unverified), this restates the REAL
// property record already on file: address, CAD values, value history, and
// whatever real analysis has already run (Module 1's opportunity read,
// Module 2's strategy, comps count) — a factual profile a customer or staff
// member can skim, not a new analysis and not an assumptions aid.
import { PROSE_STYLE } from "../_shared/prose-style.ts";
import { GEMINI_MODEL_FAST, geminiUrl } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const SYSTEM = `You are CorvusPT's Texas property tax analyst. Write a concise, factual property summary from the real record given below — a profile document, not a new analysis.

Rules:
- State ONLY what's actually given below. Never invent a value, a comp, a date, or a finding that isn't present in the data.
- If a real analysis finding is given (health score, strategy, comps), restate it plainly as "Corvus AI's current read is..." — don't re-derive or contradict it.
- If a field is missing or null, simply omit it — never write "not available" as filler for every gap, and never guess a typical value (that's the separate starter-data-sheet feature, not this one).
- markdown: start with "# <title>" using the property address, then short sections: property record (address, CAD, owner, account #, values, tax year), value history if given, and current analysis (only if given). Plain prose and short bullet lists — no invented headers beyond what the data supports.
- Keep it skimmable: a customer or staff member should be able to read the whole thing in under a minute.
- Return ONLY a JSON object: {"title": "<short title>", "markdown": "<the summary>"}

${PROSE_STYLE}`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { property, analysis } = await req.json();
    if (!property?.address) {
      return new Response(JSON.stringify({ error: "property.address is required" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

    const recordLines = [
      `Address: ${property.address}`,
      property.cad ? `Appraisal district: ${property.cad}` : null,
      property.ownerName ? `Owner on record: ${property.ownerName}` : null,
      property.accountNumber ? `Account #: ${property.accountNumber}` : null,
      property.propertyType ? `Property type: ${property.propertyType}` : null,
      property.landValue ? `Land value: $${property.landValue}` : null,
      property.improvementValue ? `Improvement value: $${property.improvementValue}` : null,
      property.totalValue ? `Total assessed value: $${property.totalValue}` : null,
      property.taxYear ? `Tax year: ${property.taxYear}` : null,
    ].filter(Boolean);

    const historyLines = Array.isArray(property.valueHistory)
      ? property.valueHistory
          .filter((h: { year?: number; total?: number }) => h?.year && h?.total)
          .map((h: { year: number; total: number }) => `${h.year}: $${h.total}`)
      : [];

    const analysisLines = [
      analysis?.healthScore != null && analysis?.healthConclusion
        ? `Protest opportunity score: ${analysis.healthScore}/100 — ${analysis.healthConclusion}`
        : null,
      analysis?.strategyRecommendation ? `Recommended strategy: ${analysis.strategyRecommendation}` : null,
      analysis?.compsCount ? `Comparable properties on file: ${analysis.compsCount}` : null,
      analysis?.estimatedSavings ? `Estimated tax savings: $${analysis.estimatedSavings}` : null,
    ].filter(Boolean);

    const userText =
      `Property record:\n${recordLines.join("\n")}\n\n` +
      (historyLines.length ? `Value history:\n${historyLines.join("\n")}\n\n` : "") +
      (analysisLines.length ? `Current analysis on file:\n${analysisLines.join("\n")}\n\n` : "") +
      `Produce the full JSON response.`;

    const body = {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    };

    const res = await fetch(geminiUrl(GEMINI_MODEL_FAST, apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 429) {
        return new Response(
          JSON.stringify({ error: "AI is rate-limited. Please retry in a moment." }),
          { status: 429, headers: corsHeaders },
        );
      }
      throw new Error(`Gemini API error ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    let parsed: { title?: unknown; markdown?: unknown };
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : {};
    }

    const title =
      typeof parsed.title === "string" && parsed.title.trim()
        ? parsed.title.trim().slice(0, 120)
        : `${property.address} — Property Summary`;
    const markdown = typeof parsed.markdown === "string" ? parsed.markdown.slice(0, 8000) : "";

    return new Response(JSON.stringify({ title, markdown }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
