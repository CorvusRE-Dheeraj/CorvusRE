// Deploy via CLI: `supabase functions deploy ai-translate-review-comment`.
// Requires the GEMINI_API_KEY secret.
//
// Takes one raw plan-review comment as the city/county actually wrote it and
// drafts the same fields the Reviews tab already lets a user type by hand
// (src/routes/dashboard/_layout.reviews.tsx / review_comments table): a
// plain-language explanation, why it matters, the required action, which
// discipline should own it, and a priority. The user reviews and edits the
// draft before saving — this fills the form, it doesn't write the record.
import { PROSE_STYLE } from "../_shared/prose-style.ts";
import { callGemini, parseJsonLoose, str, aiErrorResponse } from "../_shared/gemini.ts";
import { corsHeaders, preflight } from "../_shared/cors.ts";
import { logAiCall } from "../_shared/ai-log.ts";

const SYSTEM = `You are CorvusDP's permitting assistant. A user pasted one real plan-review comment exactly as their city or county building/planning department wrote it, for one real permit on their project. Draft a plain-language translation of that one comment.

Rules:
- Work only from the pasted comment text (and the permit/jurisdiction context if given). Never invent a code section, a dimension, or a requirement the comment doesn't state.
- If the comment is vague or you can't tell what's required, say that plainly in requiredAction (e.g. "Comment doesn't specify — ask the reviewer what dimension/document they need") rather than guessing.
- responsible should name the type of consultant/discipline who'd normally resolve this (e.g. "Structural engineer", "Civil engineer", "Architect", "Applicant / owner"), not a person's name.
- priority: "critical" if it blocks resubmission or approval outright, "high" if it requires real design/document rework, "medium" for a moderate fix, "low" for a minor clarification or typo-level item.
- Return ONLY a JSON object with this exact shape: {"plainLanguage":<string>,"whyItMatters":<string>,"requiredAction":<string>,"responsible":<string>,"priority":"low"|"medium"|"high"|"critical"}
  Each of plainLanguage/whyItMatters/requiredAction is one short sentence, plain language, no jargon repeated back unexplained.

${PROSE_STYLE}`;

Deno.serve(async (req: Request) => {
  const pf = preflight(req);
  if (pf) return pf;

  try {
    const input = await req.json();
    const { comment, permitName, jurisdiction } = input ?? {};
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
    if (!comment || typeof comment !== "string" || !comment.trim()) {
      throw new Error("A review comment is required.");
    }

    const lines = [`Real review comment from the reviewing agency:\n"${comment.trim()}"`];
    if (permitName) lines.push(`This comment is on permit: ${permitName}`);
    if (jurisdiction) lines.push(`Jurisdiction: ${jurisdiction}`);

    const raw = await callGemini(apiKey, SYSTEM, `${lines.join("\n")}\n\nProduce the JSON translation.`);
    const parsed = parseJsonLoose(raw);

    const priority = ["low", "medium", "high", "critical"].includes(String(parsed.priority))
      ? (parsed.priority as string)
      : "medium";

    const result = {
      plainLanguage: str(parsed.plainLanguage, 400),
      whyItMatters: str(parsed.whyItMatters, 400),
      requiredAction: str(parsed.requiredAction, 400),
      responsible: str(parsed.responsible, 120),
      priority,
    };

    await logAiCall("review_comment_translation", input, result);

    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders });
  } catch (err) {
    return aiErrorResponse(err, corsHeaders);
  }
});
