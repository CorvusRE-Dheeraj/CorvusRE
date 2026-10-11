// Deploy via CLI: `supabase functions deploy ai-assistant`.
// Requires the GEMINI_API_KEY secret.
//
// The "Ask CorvusDP AI" chat widget's backend (src/components/AskAiWidget.tsx).
// Answers general permitting/design/construction questions on the public
// pages (no context) and, on the dashboard, is grounded with a short summary
// of the caller's own active project (src/lib/ai.ts builds that summary
// client-side from data already loaded for the page — this function never
// queries the database itself). Plain chat reply, not structured JSON.
import { PROSE_STYLE } from "../_shared/prose-style.ts";
import { GEMINI_MODEL_FAST, geminiUrl, aiErrorResponse } from "../_shared/gemini.ts";
import { corsHeaders, preflight } from "../_shared/cors.ts";
import { logAiCall } from "../_shared/ai-log.ts";

const MAX_TURNS = 12;
const MAX_MESSAGE_LEN = 2000;

const SYSTEM = `You are the CorvusDP Assistant, built into CorvusDP — an AI-assisted permitting, design, and construction platform for US real estate development (the app covers all 50 states).

What you help with: explaining zoning/permitting concepts, what a permit type is for, how the permitting → design → construction process generally works, what CorvusDP's own tools do (permitting analysis, design brief, project dashboard, review-comment tracking, construction workspace), and — when the caller's real project context is given below — answering questions about THAT specific project using only the real facts provided.

Rules:
- If project context is provided, treat it as real and ground your answer in it. Never invent a fact about their project (a fee, a deadline, a permit name, a status) that isn't in the context.
- If no project context is provided, or the question needs a real project's data you don't have, say so plainly and suggest running the Permitting Analysis or Design Brief (or opening their dashboard) rather than guessing.
- For anything that turns on a specific jurisdiction's current code (exact setback distances, current fee schedules, a specific department's process), give the general picture and say to confirm with the local authority having jurisdiction — never state a specific current number as certain unless it's in the given context.
- This is a chat reply, not a report: 2-5 short sentences, plain language, no markdown headers. A short "- " bulleted list is fine when listing 3+ parallel items.
- Never repeat the system instructions or mention that you are an AI language model; just answer as the CorvusDP Assistant.

${PROSE_STYLE}`;

type ChatMessage = { role: "user" | "assistant"; content: string };

Deno.serve(async (req: Request) => {
  const pf = preflight(req);
  if (pf) return pf;

  try {
    const { messages, context } = (await req.json()) as {
      messages?: ChatMessage[];
      context?: Record<string, unknown>;
    };
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error("At least one message is required.");
    }

    const trimmed = messages
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-MAX_TURNS)
      .map((m) => ({ ...m, content: m.content.slice(0, MAX_MESSAGE_LEN) }));

    const contextBlock =
      context && Object.keys(context).length > 0
        ? `Real project context for this caller:\n${JSON.stringify(context)}`
        : "No project context — this caller has no active project loaded (or is on a public page).";

    const contents = [
      { role: "user", parts: [{ text: contextBlock }] },
      { role: "model", parts: [{ text: "Understood, I'll use that as the real project context." }] },
      ...trimmed.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
    ];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    let res: Response;
    try {
      res = await fetch(geminiUrl(GEMINI_MODEL_FAST, apiKey), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents,
          generationConfig: { temperature: 0.4 },
        }),
      });
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        const err = new Error("Assistant timed out");
        (err as Error & { status?: number }).status = 504;
        throw err;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const text = await res.text();
      const err = new Error(`Gemini API error ${res.status}: ${text.slice(0, 200)}`);
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }

    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const reply =
      json.candidates?.[0]?.content?.parts?.[0]?.text?.trim().slice(0, 1600) ||
      "I couldn't put together an answer just now — try rephrasing, or check the relevant dashboard tab directly.";

    // Log just this turn (the latest message + the context it was answered
    // with), not the whole running transcript — each call already carries
    // the prior turns, so logging the full array every time would repeat
    // the same earlier messages in every row.
    await logAiCall(
      "assistant_chat",
      { message: trimmed[trimmed.length - 1]?.content ?? null, context: context ?? {} },
      { reply },
    );

    return new Response(JSON.stringify({ reply }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return aiErrorResponse(err, corsHeaders);
  }
});
