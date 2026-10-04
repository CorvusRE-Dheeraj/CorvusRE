// Deploy via CLI: `supabase functions deploy ask-about-document`.
// Requires the GEMINI_API_KEY secret (shared with classify-document).
import { PROSE_STYLE, BULLET_STYLE } from "../_shared/prose-style.ts";
import { GEMINI_MODEL_FAST, geminiUrl } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  // Without this, supabase-js's functions.invoke() parses the body as plain text
  // (a JSON string) instead of a parsed object, based on the response Content-Type.
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { question, context, conversational, personaName } = await req.json();
    if (!question) {
      return new Response(JSON.stringify({ error: "question is required" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

    // conversational: the answer is going to be spoken aloud and shown in a
    // chat bubble — reply the way a person talks, not as a bulleted report.
    // personaName (below) is its own separate, chattier style used only by
    // the support-bot persona — the two are never combined.
    const styleRule = conversational
      ? `FORMAT — your answer is read aloud and shown in a chat bubble:\n- Reply in 1-4 short, natural sentences, the way you'd say it out loud to the person. Lead with the direct answer.\n- NO bullet points, NO tables, NO markdown symbols (*, #, |, backticks), NO headings, NO numbered lists.\n- When you'd otherwise list several items, say them in a flowing sentence ("You have four properties: the one on Warren Pkwy, ..."). Round long figures for speech ("about 4.2 million dollars").\n- Warm and plain, like a knowledgeable friend — never robotic, never a data dump.`
      : BULLET_STYLE;

    // The Ask AI widget's human-support mode (personaName set) — a friendly
    // junior support associate having a live chat, not the generic analyst
    // voice every other caller of this function gets. Everything else about
    // the function (Gemini call, context handling, response shape) is
    // unchanged, so every other caller behaves exactly as before.
    const SUPPORT_STYLE = `FORMAT — you're chatting live with someone in a support widget:\n- Talk like a genuinely helpful person, not a formal report. Contractions are fine ("you'll", "that's", "let's").\n- If you're walking them through fixing something, short numbered steps (1. 2. 3.) are fine — the one exception to keeping everything in plain sentences.\n- Keep it tight: a few sentences or steps, never a wall of text.\n- No headings, no tables, no bullet-point dumps of unrelated facts.\n- Never say "As an AI" or "I don't have access to your account" flatly — if something needs a real look, say so warmly and that you can get a person to help.`;

    const systemText = personaName
      ? `You are ${personaName}, a friendly, patient support associate at CorvusPT — a platform that helps Texas commercial property owners protest their property-tax assessments. You're having a live chat with a real user who needs help using the product: answer their questions, walk them through common fixes step by step, and clear up confusion. Sound like a genuinely helpful person, warm and conversational, never robotic or corporate.\n\n${SUPPORT_STYLE}\n\nOnly use the context below for anything about their account, properties, or cases — never invent numbers or details. If the context doesn't cover something, say so honestly rather than guessing.`
      : `You are CorvusPT's Texas property tax assistant. Answer accurately and concisely. If unsure, say so. Do not invent numbers.\n\n${PROSE_STYLE}\n\n${styleRule}`;

    const body = {
      systemInstruction: {
        parts: [{ text: systemText }],
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Context:\n${context ?? "(none)"}\n\nQuestion: ${question}`,
            },
          ],
        },
      ],
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
    const answer = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "No response.";

    return new Response(JSON.stringify({ answer }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
