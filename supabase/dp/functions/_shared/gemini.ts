// The one place the Gemini model version lives — a deliberate model change is
// a one-line edit here rather than a hunt through every function. Same
// provider/pattern as the CorvusPT door's Edge Functions (its
// _shared/gemini.ts), ported to CorvusDP's own separate Supabase project and
// its own GEMINI_API_KEY secret.
export const GEMINI_MODEL_FAST = "gemini-3.6-flash";

export function geminiUrl(model: string, apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
}

// Every AI function here calls Gemini with the same shape (a system
// instruction + one user turn, JSON-mode output) and needs the same
// deadline so a slow upstream call surfaces as a fast, retryable 504 instead
// of hanging the caller indefinitely — see src/lib/edge-functions.ts on the
// client for the matching retry policy.
export const GEMINI_TIMEOUT_MS = 20_000;

export async function callGemini(
  apiKey: string,
  system: string,
  userText: string,
  opts: { temperature?: number } = {},
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const res = await fetch(geminiUrl(GEMINI_MODEL_FAST, apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: userText }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: opts.temperature ?? 0.2,
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      const err = new Error(`Gemini API error ${res.status}: ${text.slice(0, 200)}`);
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return json.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  } catch (e) {
    // An aborted fetch (our own timeout firing) surfaces as a DOMException,
    // not an HTTP response — map it to a 504 so the client's retry policy
    // (src/lib/edge-functions.ts) treats it as "that one call was slow, try
    // again" rather than a hard failure.
    if (e instanceof Error && e.name === "AbortError") {
      const err = new Error("Gemini request timed out");
      (err as Error & { status?: number }).status = 504;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function parseJsonLoose(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        /* fall through */
      }
    }
    return {};
  }
}

// Defensive sanitizers — every function below runs the model's parsed JSON
// through these before it ever reaches the client, so a hallucinated shape
// (wrong type, runaway length, extra field) can't leak past this boundary.
export const str = (v: unknown, len = 600): string =>
  (typeof v === "string" ? v.trim() : "").slice(0, len);

export const arr = (v: unknown, itemLen = 240, max = 8): string[] =>
  Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((x) => x.trim().slice(0, itemLen))
        .slice(0, max)
    : [];

// One place every AI function maps a thrown error to an HTTP response, so
// the 429 ("rate-limited, retry shortly") and 504 (our own timeout) cases —
// the two src/lib/edge-functions.ts knows how to retry — are never
// accidentally flattened to a generic 500 in one function but not another.
export function aiErrorResponse(
  err: unknown,
  corsHeaders: Record<string, string>,
): Response {
  const status = (err as { status?: number })?.status;
  if (status === 429) {
    return new Response(
      JSON.stringify({ error: "AI is rate-limited. Please retry in a moment." }),
      { status: 429, headers: corsHeaders },
    );
  }
  if (status === 504) {
    return new Response(JSON.stringify({ error: "AI request timed out." }), {
      status: 504,
      headers: corsHeaders,
    });
  }
  return new Response(
    JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
    { status: 500, headers: corsHeaders },
  );
}
