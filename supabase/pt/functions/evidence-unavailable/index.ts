// Deploy via CLI: `supabase functions deploy evidence-unavailable`.
// Requires the GEMINI_API_KEY secret (shared with the other AI functions).
//
// Module 8's "Document not available": the owner says they can't provide one
// checklist item (never had it, lost it, can't get it in time, doesn't apply).
// This answers what the gap means for THIS case and what to do instead —
// substitutes that prove the same fact, how the protest strategy shifts, and
// the next steps — grounded in the property record, the rest of the evidence
// checklist (what's already on file) and the strategies on file. The caller
// stores the answer in public.evidence_unavailable (see evidence-unavailable.sql).
import { PROSE_STYLE } from "../_shared/prose-style.ts";
import { GEMINI_MODEL_FAST, geminiUrl } from "../_shared/gemini.ts";
import { requireUser, isFilledObject } from "../_shared/require-user.ts";
import { rateLimitUser } from "../_shared/rate-limit.ts";
import { withAdvisoryTone } from "../_shared/advisory-tone.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const REASONS: Record<string, string> = {
  never_had: "The owner never had this document.",
  lost: "The owner had it once but can't find it now.",
  too_slow: "The owner can't get it before the protest/hearing deadline.",
  not_applicable: "The owner says this document doesn't apply to this property.",
  other: "Other reason (see the owner's note).",
};

const SYSTEM = `You are CorvusPT's Texas property tax protest assistant. The owner has told you they can NOT provide one item on this property's evidence checklist. Explain what that gap means for this specific case and what they can do instead.

Rules:
- Ground everything in the property record, the evidence checklist (with each item's status) and the strategies on file given below. Never invent a fact, a dollar figure, a deadline or a contact.
- impact: "High" if the missing item was the main proof for the leading strategy and nothing on file covers the same fact; "Medium" if other evidence partly covers it; "Low" if the case stands on other evidence. Take what is already on file (status Verified/Found) into account.
- impactSummary: 1-2 sentences — what fact this document would have proved and how much of the case rests on it now.
- alternatives: 2-4 substitutes that prove the same fact (e.g. for a closing statement: the recorded deed, the purchase contract, a lender's appraisal, bank wire records, the county's own sales record). Each has evidence (the document), howItHelps (one sentence: what it proves in place of the missing one) and whereToGet (who holds it — county clerk, title company, lender, CAD, the owner's own records). Don't suggest an item already marked Verified/Found on the checklist as a new substitute; you may say an on-file item already covers part of the gap in impactSummary.
- strategyChange: 1-3 sentences — how the protest argument shifts without this document: which strategy on file to lead with instead, or how to present the same argument with the substitutes. If it doesn't apply to this property (reason "not_applicable"), confirm whether it can simply be dropped.
- nextSteps: 2-4 concrete actions to take now, most important first, each one short.
- canProceed: true if the protest can still go ahead on the evidence available (it almost always can — a missing document weakens a point, it doesn't stop a protest), false only if nothing at all supports any strategy.
- Return ONLY a JSON object: {"impact":"High|Medium|Low","impactSummary":"...","alternatives":[{"evidence":"...","howItHelps":"...","whereToGet":"..."}],"strategyChange":"...","nextSteps":["..."],"canProceed":true}

${PROSE_STYLE}`;

type ChecklistItem = { item?: string; priority?: string; status?: string; category?: string };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // signed-in only, and capped per account — each call is a paid AI request
  const who = await requireUser(req, corsHeaders);
  if (who instanceof Response) return who;
  const limited = await rateLimitUser(who.id, "evidence-unavailable", 30, corsHeaders);
  if (limited) return limited;

  try {
    const { property, item, reason, note, checklist, strategies } = await req.json();
    if (!isFilledObject(property) || !isFilledObject(item) || typeof item.item !== "string") {
      return new Response(JSON.stringify({ error: "property and item are required." }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

    const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
    const list: ChecklistItem[] = Array.isArray(checklist) ? checklist.slice(0, 30) : [];
    const strategyNames: string[] = Array.isArray(strategies)
      ? strategies.filter((s: unknown): s is string => typeof s === "string").slice(0, 5)
      : [];

    const lines = [
      property.address ? `Property address: ${clip(property.address, 200)}` : null,
      property.cad ? `Appraisal district: ${clip(property.cad, 120)}` : null,
      property.propertyType ? `Property type: ${clip(property.propertyType, 120)}` : null,
      property.taxYear ? `Tax year: ${property.taxYear}` : null,
      property.totalValue ? `Assessed value: $${property.totalValue}` : null,
      property.landValue ? `Land value: $${property.landValue}` : null,
      property.improvementValue ? `Improvement value: $${property.improvementValue}` : null,
      strategyNames.length
        ? `Protest strategies on file (strongest first): ${strategyNames.join("; ")}`
        : "No protest strategy generated yet.",
      "",
      `Missing item the owner can't provide: ${clip(item.item, 200)}`,
      item.priority ? `Its priority: ${clip(item.priority, 20)}` : null,
      item.category ? `Its category: ${clip(item.category, 80)}` : null,
      item.whyNeeded ? `Why it was requested: ${clip(item.whyNeeded, 400)}` : null,
      `Owner's reason: ${REASONS[reason] ?? REASONS.other}`,
      note ? `Owner's note: ${clip(note, 500)}` : null,
      "",
      "Rest of the evidence checklist:",
      ...list
        .filter((x) => x.item && x.item !== item.item)
        .map(
          (x) =>
            `- ${clip(x.item, 160)} — ${clip(x.priority, 20) || "Supporting"}, ${clip(x.status, 20) || "Missing"}`,
        ),
    ].filter((l) => l !== null);

    const body = {
      systemInstruction: { parts: [{ text: withAdvisoryTone(SYSTEM) }] },
      contents: [
        {
          role: "user",
          parts: [{ text: `${lines.join("\n")}\n\nProduce the full JSON response.` }],
        },
      ],
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    };

    const res = await fetch(geminiUrl(GEMINI_MODEL_FAST, apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    }).catch((e) => {
      if (e instanceof DOMException && e.name === "TimeoutError") return null;
      throw e;
    });
    if (!res) {
      return new Response(JSON.stringify({ error: "AI took too long. Please retry." }), {
        status: 504,
        headers: corsHeaders,
      });
    }
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
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : {};
    }

    const str = (v: unknown, len: number): string =>
      typeof v === "string" ? v.trim().slice(0, len) : "";
    const impact = (["High", "Medium", "Low"] as const).includes(
      parsed.impact as "High" | "Medium" | "Low",
    )
      ? (parsed.impact as "High" | "Medium" | "Low")
      : "Medium";
    const alternatives = Array.isArray(parsed.alternatives)
      ? parsed.alternatives
          .map((a: Record<string, unknown>) => ({
            evidence: str(a?.evidence, 140),
            howItHelps: str(a?.howItHelps, 300),
            whereToGet: str(a?.whereToGet, 200),
          }))
          .filter((a) => a.evidence)
          .slice(0, 4)
      : [];
    const nextSteps = Array.isArray(parsed.nextSteps)
      ? parsed.nextSteps
          .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
          .map((x) => x.trim().slice(0, 240))
          .slice(0, 4)
      : [];

    const result = {
      impact,
      impactSummary: str(parsed.impactSummary, 500),
      alternatives,
      strategyChange: str(parsed.strategyChange, 600),
      nextSteps,
      canProceed: parsed.canProceed !== false,
    };
    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
