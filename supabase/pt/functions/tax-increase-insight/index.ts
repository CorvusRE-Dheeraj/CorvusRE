// Deploy via CLI: `supabase functions deploy tax-increase-insight`.
// Requires GEMINI_API_KEY (shared with the other AI functions).
//
// The AI insight for Module 1's tax increase triggers (10% / 20% / 30% — see
// ../_shared/tax-increase.ts). The app computes every figure deterministically
// (apps/pt/src/lib/tax-history.ts) and sends them; the AI only EXPLAINS them —
// what increased, by how much, how that compares with prior years, why it may
// matter, whether a review / protest may be warranted, and the next step. It is
// told never to introduce a number that isn't in the input. Signed-in callers only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GEMINI_MODEL_FAST, geminiUrl } from "../_shared/gemini.ts";
import { withAdvisoryTone } from "../_shared/advisory-tone.ts";
import {
  describeTrigger,
  increaseLabel,
  type IncreaseTrigger,
} from "../_shared/tax-increase.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

type HistoryRow = {
  year: number;
  appraised: number | null;
  taxable: number | null;
  taxes: number | null;
  taxesBasis: "bill" | "estimate" | null;
};

const SYSTEM = `You explain a Texas property's year-over-year tax increase to its owner, in plain English, for CorvusPT (an AI-assisted property tax protest app).

Rules:
- Use ONLY the figures provided. Never introduce a number, value, rate, comparable property or deadline that isn't in the input. Round percentages to whole numbers.
- Taxes marked "estimate" are CorvusPT estimates, not the county's bill — say so if you mention them.
- Texas context you may use, conditionally: a residence homestead's appraised value generally can't rise more than 10% a year; many non-homestead properties valued at about $5 million or less have a 20% annual limit (the "circuit breaker", currently through 2026). Never state that this property qualifies — say it "may apply if the property qualifies".
- Never promise a reduction or savings. The owner decides whether to protest.
- Be concise: each field 1-2 short sentences, no markdown.

Return ONLY JSON:
{"whatIncreased": "...", "byHowMuch": "...", "comparedToPriorYears": "...", "whyItMatters": "...", "warrantsReview": "yes" | "maybe" | "no", "reviewReason": "...", "recommendedNextStep": "..."}`;

function str(v: unknown, max = 400): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
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

    const input = (await req.json()) as {
      address?: string;
      cad?: string | null;
      propertyType?: string | null;
      triggers?: IncreaseTrigger[];
      history?: HistoryRow[];
    };
    const triggers = Array.isArray(input.triggers) ? input.triggers.slice(0, 3) : [];
    if (triggers.length === 0) return json({ error: "No increase to explain." }, 400);
    const history = Array.isArray(input.history) ? input.history.slice(0, 12) : [];

    const money = (n: number | null) => (n == null ? "n/a" : `$${Math.round(n).toLocaleString("en-US")}`);
    const prompt = [
      `Property: ${input.address ?? "(address not given)"}${input.propertyType ? ` — ${input.propertyType}` : ""}${input.cad ? ` — ${input.cad}` : ""}`,
      "",
      "Increases detected (current year vs prior year):",
      ...triggers.map((t) => `- ${describeTrigger(t)} Level: ${increaseLabel(t.level)}.`),
      "",
      "Year-by-year history (newest first):",
      ...history.map(
        (h) =>
          `- ${h.year}: appraised ${money(h.appraised)}, taxable ${money(h.taxable)}, taxes ${money(h.taxes)}${h.taxesBasis === "estimate" ? " (CorvusPT estimate)" : h.taxesBasis === "bill" ? " (tax bill)" : ""}`,
      ),
    ].join("\n");

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
    const res = await fetch(geminiUrl(GEMINI_MODEL_FAST, apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: withAdvisoryTone(SYSTEM) }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
      }),
    });
    if (!res.ok) {
      if (res.status === 429) return json({ error: "AI is rate-limited. Please retry in a moment." }, 429);
      throw new Error(`Gemini API error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const out = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const raw = out.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : {};
    }
    const review = parsed.warrantsReview;
    return json({
      whatIncreased: str(parsed.whatIncreased),
      byHowMuch: str(parsed.byHowMuch),
      comparedToPriorYears: str(parsed.comparedToPriorYears),
      whyItMatters: str(parsed.whyItMatters),
      warrantsReview: review === "yes" || review === "maybe" || review === "no" ? review : "maybe",
      reviewReason: str(parsed.reviewReason),
      recommendedNextStep: str(parsed.recommendedNextStep),
    });
  } catch (err) {
    console.error("tax-increase-insight failed:", err);
    return json({ error: err instanceof Error ? err.message : "unknown error" }, 500);
  }
});
