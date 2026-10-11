// Deploy via CLI: `supabase functions deploy analyze-property-issue`.
// Requires the GEMINI_API_KEY secret (shared with the other AI functions).
//
// Property Issues: reads a city/county notice the owner uploaded (code
// violation, high-grass notice, court order, inspection letter, fine…) and
// returns (1) the notice's real facts — dates, fine, required action,
// issuing authority — and (2) plain-language guidance: what happened, what
// to do, by when, and what happens if it isn't resolved.
// It also prices the fix (typical Texas cost range) and names the kinds of
// local providers to search for.
//
// With no document, it writes guidance for an issue the owner typed in (or
// one pulled from city data) from the facts the caller passes.
//
// Every extracted field is clamped by _shared/property-issue.ts (category to
// the table's enum, dates to real calendar dates) — the model never writes
// straight into the row.
import { GEMINI_MODEL_FAST, geminiUrl } from "../_shared/gemini.ts";
import { withAdvisoryTone } from "../_shared/advisory-tone.ts";
import {
  ISSUE_CATEGORY_IDS,
  sanitizeIssueAnalysis,
} from "../_shared/property-issue.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const MAX_DOCS = 3;

const SYSTEM = `You are CorvusPT's property issues assistant for Texas property owners. An owner has a notice or issue from a city, county or court about their property (code violation, illegal dumping, high grass/weeds, property maintenance, court order, inspection, fine, compliance deadline).

Rules for "fields":
- When a notice document is attached, extract ONLY what it actually says. Any field the notice doesn't state is null — never guess a date, amount or name.
- When no document is attached, copy the facts you are given; leave the rest null.
- category: one of ${ISSUE_CATEGORY_IDS.join(", ")}.
- title: a short plain label for the issue, e.g. "High grass and weeds violation".
- Dates as YYYY-MM-DD. fineAmount as a number (no $).
- requiredAction: exactly what the notice requires the owner to do.
- consequences: what the notice says happens if it isn't resolved (re-inspection fee, city abatement and lien, citation, court appearance…).
- authority / authorityContact: who issued it and how to reach them (inspector name, phone, email, case number) as printed.

Rules for "guidance" (plain language for a busy owner, no legal jargon, no markdown):
- whatHappened: 1-2 sentences.
- whatToDo: 1-3 sentences, concrete.
- byWhen: the real deadline in words, or "No deadline is stated — act promptly" if none.
- ifNotResolved: 1-2 sentences, based on the notice when it says; otherwise typical Texas municipal consequences, clearly phrased as "typically".
- nextSteps: 3-5 short ordered steps, including keeping proof (dated photos, receipts) and confirming with the authority.
- whoToHire: the kind of service provider that usually fixes this (e.g. "lawn care / mowing service", "junk removal / hauling", "licensed general contractor"), or "No outside help needed" when the owner can do it.

Rules for "costEstimate" and "providerTypes":
- costEstimate: the typical cost in Texas to hire someone to fix THIS issue (not the fine) — {"service":"<what is being priced, e.g. one-time mow and trim of an overgrown lot>","low":<number>,"high":<number>,"basis":"<1 sentence: what drives the price, e.g. lot size, haul volume>"}. null when no outside service is needed.
- providerTypes: 1-3 short search phrases for finding local providers, e.g. ["lawn mowing service","lot clearing"]; [] when no outside service is needed.

Return ONLY JSON: {"fields":{"category":"...","title":"...","description":<string|null>,"issuedOn":<date|null>,"deadline":<date|null>,"inspectionDate":<date|null>,"courtDate":<date|null>,"fineAmount":<number|null>,"fineDue":<date|null>,"requiredAction":<string|null>,"authority":<string|null>,"authorityContact":<string|null>,"consequences":<string|null>},"guidance":{"whatHappened":"...","whatToDo":"...","byWhen":"...","ifNotResolved":"...","nextSteps":["..."],"whoToHire":"..."},"costEstimate":{"service":"...","low":<number>,"high":<number>,"basis":"..."}|null,"providerTypes":["..."]}`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  try {
    const { property, issue, documents } = await req.json();
    const docs = (Array.isArray(documents) ? documents : [])
      .slice(0, MAX_DOCS)
      .filter((d: { dataUrl?: string }) =>
        String(d.dataUrl ?? "").includes(","),
      );
    if (docs.length === 0 && !issue?.title) {
      return new Response(
        JSON.stringify({ error: "Attach the notice or describe the issue." }),
        {
          status: 400,
          headers: corsHeaders,
        },
      );
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

    const context = [
      `Today: ${new Date().toISOString().slice(0, 10)}`,
      property?.address ? `Property: ${property.address}` : null,
      property?.county ? `County: ${property.county}` : null,
      issue
        ? `Facts already known about this issue: ${JSON.stringify(issue)}`
        : null,
    ].filter(Boolean);

    const parts: Array<{
      text?: string;
      inline_data?: { mime_type: string; data: string };
    }> = [
      {
        text: `${context.join("\n")}\n\n${
          docs.length > 0
            ? "Read the attached notice and produce the full JSON response."
            : "No document is attached. Produce guidance for this issue from the known facts."
        }`,
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
        systemInstruction: { parts: [{ text: withAdvisoryTone(SYSTEM) }] },
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

    return new Response(JSON.stringify(sanitizeIssueAnalysis(parsed)), {
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
