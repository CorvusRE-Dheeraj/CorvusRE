// Deploy via CLI: `supabase functions deploy analyze-evidence-link`.
// Requires the GEMINI_API_KEY secret (shared with draft-protest-reason,
// classify-document, ask-about-document).
//
// Module 1's "Help Corvus AI Complete the Analysis" — the customer pastes a
// URL instead of uploading a file (e.g. a county appraisal page, a listing
// with photos, a rent-roll spreadsheet hosted somewhere) for one specific
// missing evidence item. This fetches the page, strips it to plain text, and
// asks Gemini whether it actually helps — accept/reject + a one-sentence
// reason, matching the flow the spec calls for: "Open and analyze the link.
// Determine whether it contains useful information for the missing
// requirement. Accept it if relevant. Reject it if it does not contain
// usable information. Explain briefly why it was accepted or rejected."
//
// On accept, the client (ai-report.tsx) uploads the returned summary as a
// small real document tagged to the same evidence category the missing item
// needs — same "AI drafts a document" pattern ModuleDataSheetButton already
// uses — so the existing evidence module picks it up next time it runs,
// with no new storage/DB concept needed here.
//
// Stateless AI proxy: reads no stored data, writes nothing, so it's safe for
// any signed-in user to call (same accepted-risk category as
// draft-protest-reason/classify-document) — default JWT verification only.
import { PROSE_STYLE } from "../_shared/prose-style.ts";
import { GEMINI_MODEL_FAST, geminiUrl } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

// Generous but bounded — a real appraisal/listing page, not an attacker's
// endless stream. 8s covers a slow county site without holding the function
// open indefinitely.
const MAX_FETCH_BYTES = 2_000_000;
const MAX_TEXT_CHARS = 6_000;
const FETCH_TIMEOUT_MS = 8_000;

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const SYSTEM = `You are CorvusPT's Texas property tax protest assistant. A property owner pasted a URL as a possible source for one specific piece of missing evidence their protest analysis still needs. You are given the page's extracted text content. Decide honestly whether it actually helps.

Rules:
- Base your decision ONLY on what the extracted text actually contains. Never assume a page is useful just because it seems related.
- Accept only if the content plausibly provides real, checkable information for the specific missing item named (a number, a date, a description, a photo caption, a record match) — not just a page that mentions the property or the topic in passing.
- Reject a paywalled/blocked/empty/irrelevant page, a generic homepage, a login screen, or anything that doesn't actually contain usable information for this specific missing item.
- reason: one plain sentence explaining the decision, specific to what the page actually contains (or doesn't).
- summary: if accepted, 2-4 sentences capturing the specific facts from the page relevant to the missing item, written as a plain factual note (not "the page says..."). If rejected, an empty string.
- Return ONLY a JSON object matching this exact shape: {"accepted": true or false, "reason": "...", "summary": "..."}

${PROSE_STYLE}`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { url, missingItem, propertyAddress, taxYear } = await req.json();
    if (typeof url !== "string" || !url.trim()) {
      return new Response(JSON.stringify({ error: "A URL is required." }), {
        status: 400,
        headers: corsHeaders,
      });
    }
    if (typeof missingItem !== "string" || !missingItem.trim()) {
      return new Response(JSON.stringify({ error: "missingItem is required." }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return new Response(JSON.stringify({ error: "That doesn't look like a valid URL." }), {
        status: 400,
        headers: corsHeaders,
      });
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return new Response(JSON.stringify({ error: "Only http/https links are supported." }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

    let pageText: string;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const pageRes = await fetch(parsed.toString(), {
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; CorvusPT-EvidenceLinkBot/1.0)" },
      });
      clearTimeout(timeout);
      if (!pageRes.ok) {
        return new Response(
          JSON.stringify({
            accepted: false,
            reason: `Could not open that link (site returned ${pageRes.status}).`,
            summary: "",
          }),
          { status: 200, headers: corsHeaders },
        );
      }
      const buf = await pageRes.arrayBuffer();
      const bytes =
        buf.byteLength > MAX_FETCH_BYTES ? buf.slice(0, MAX_FETCH_BYTES) : buf;
      const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      pageText = htmlToText(raw).slice(0, MAX_TEXT_CHARS);
    } catch (fetchErr) {
      return new Response(
        JSON.stringify({
          accepted: false,
          reason:
            fetchErr instanceof Error && fetchErr.name === "AbortError"
              ? "That link took too long to load."
              : "Could not open that link.",
          summary: "",
        }),
        { status: 200, headers: corsHeaders },
      );
    }

    if (!pageText || pageText.length < 20) {
      return new Response(
        JSON.stringify({
          accepted: false,
          reason: "That page didn't have any readable content to check.",
          summary: "",
        }),
        { status: 200, headers: corsHeaders },
      );
    }

    const contextLines = [
      propertyAddress ? `Property address: ${propertyAddress}` : null,
      taxYear ? `Tax year: ${taxYear}` : null,
      `Missing item this link is being offered for: ${missingItem}`,
    ].filter(Boolean);

    const body = {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Case context:\n${contextLines.join("\n")}\n\nExtracted page text:\n${pageText}`,
            },
          ],
        },
      ],
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
    const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    let out: { accepted?: boolean; reason?: string; summary?: string };
    try {
      out = JSON.parse(rawText);
    } catch {
      const m = rawText.match(/\{[\s\S]*\}/);
      out = m ? JSON.parse(m[0]) : {};
    }

    const result = {
      accepted: out.accepted === true,
      reason: out.reason ?? "Could not determine whether this link helps.",
      summary: out.accepted === true ? (out.summary ?? "") : "",
    };

    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
