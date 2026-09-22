// Deploy via CLI: `supabase functions deploy summarize-beta-feedback`
// (JWT-verified — same caller-JWT -> service-role is_admin check shape every
// other admin-only function here uses, e.g. admin-impersonate-user).
//
// Admin-triggered ("Regenerate insights" button in the admin Feedback tab,
// see regenerateFeedbackInsights() in src/lib/beta-feedback.ts), not
// automatic on every submission — clusters three free-text answer sets
// across every COMPLETED beta_feedback_responses row into themed, ranked
// insights via Gemini:
//   q48 — "What was the most frustrating part of [their old] process?"    -> painPoints
//   q46 — "If you could make Corvus do ONE thing..."                     -> featureRequests
//   q45 — "...tomorrow it disappeared. What would you miss?"             -> wouldMiss
// (q40, "biggest reason you'd hesitate to trust Corvus," is a closed-form
// select — the admin UI tallies that directly, no AI needed for it.)
//
// Writes the one-row singleton public.beta_feedback_insights (replaced
// wholesale each run) and returns the same shape the client reads back.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GEMINI_MODEL_REASONING, geminiUrl } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const GEMINI_TIMEOUT_MS = 75_000;

type Theme = { theme: string; count: number; examples: string[] };
type Insights = { painPoints: Theme[]; featureRequests: Theme[]; wouldMiss: Theme[] };

async function clusterTheme(
  apiKey: string,
  label: string,
  answers: string[],
): Promise<Theme[]> {
  if (answers.length === 0) return [];
  const system =
    `You're analyzing open-ended answers from beta testers of Corvus, an AI property-tax-protest ` +
    `platform, to the question "${label}". Group the answers below into 3-8 recurring THEMES ` +
    `(not one theme per answer) — merge near-duplicates, ignore one-off noise. For each theme, ` +
    `count how many of the given answers genuinely belong to it and pick up to 3 short verbatim ` +
    `example quotes (trim but don't paraphrase). Order themes by count, descending.\n\n` +
    `Return ONLY a JSON object: {"themes": [{"theme": "<short label, <=8 words>", "count": <int>, ` +
    `"examples": ["<verbatim quote>", ...]}]}`;
  const numbered = answers.map((a, i) => `${i + 1}. ${a.slice(0, 500)}`).join("\n");

  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: numbered }] }],
    generationConfig: {
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 1024 },
      temperature: 0,
      topK: 1,
      topP: 0,
      seed: 7,
    },
  };

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(geminiUrl(GEMINI_MODEL_REASONING, apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  let parsed: { themes?: Theme[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : {};
  }
  return Array.isArray(parsed.themes) ? parsed.themes : [];
}

function collectAnswers(rows: { answers: Record<string, unknown> }[], questionId: string): string[] {
  return rows
    .map((r) => r.answers?.[questionId])
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
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

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: profile } = await admin.from("profiles").select("is_admin").eq("id", user.id).single();
    if (!profile?.is_admin) {
      return new Response(JSON.stringify({ error: "not authorized" }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

    const { data: rows, error: rowsErr } = await admin
      .from("beta_feedback_responses")
      .select("answers")
      .not("completed_at", "is", null);
    if (rowsErr) throw rowsErr;
    const responses = (rows ?? []) as { answers: Record<string, unknown> }[];

    const [painPoints, featureRequests, wouldMiss] = await Promise.all([
      clusterTheme(apiKey, "What was the most frustrating part of that process?", collectAnswers(responses, "q48")),
      clusterTheme(
        apiKey,
        "If you could make Corvus do ONE thing it doesn't do today, what would it be?",
        collectAnswers(responses, "q46"),
      ),
      clusterTheme(
        apiKey,
        "If Corvus disappeared tomorrow, what would you miss?",
        collectAnswers(responses, "q45"),
      ),
    ]);

    const insights: Insights = { painPoints, featureRequests, wouldMiss };
    const generatedAt = new Date().toISOString();

    const { error: upsertErr } = await admin.from("beta_feedback_insights").upsert({
      id: 1,
      insights,
      response_count: responses.length,
      generated_at: generatedAt,
    });
    if (upsertErr) throw upsertErr;

    return new Response(
      JSON.stringify({ insights, responseCount: responses.length, generatedAt }),
      { status: 200, headers: corsHeaders },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
