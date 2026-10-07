// Street View condition comparison: rates the visible exterior condition in
// Street View images of the subject property and its nearest comparables.
// The browser fetches the images (Street View Static API, the app's own key)
// and sends them as data URLs; this function only rates what it sees, and
// _shared/streetview-condition.ts compares the ratings deterministically.
//
// POST { images: [{ key, address, dataUrl }] } → { ratings: { [key]: ConditionRating } }
import { GEMINI_MODEL_FAST, geminiUrl } from "../_shared/gemini.ts";
import { LIMITS, sanitizeRating } from "../_shared/streetview-condition.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const SYSTEM = `You rate the visible EXTERIOR condition of commercial buildings in Google Street View images, for a property tax condition comparison. Each image is labelled with a key.

For each image:
- usable: true only if a building is clearly visible and identifiable as the main subject (not blocked by trucks or trees, not just a road, not a different building).
- Rate 1-5 (1 poor, 2 fair, 3 average, 4 good, 5 excellent) only what you can actually see: facade (walls, windows, doors, signage), roof (only if visible, else null), paving (parking, drives, sidewalks; null if not visible), site (landscaping, fencing, general upkeep), overall.
- Judge condition and upkeep, not architectural style, size or age alone.
- defects: short phrases for visible problems only (e.g. "cracked parking surface", "faded, peeling paint", "boarded window"); empty if none.
- Rate every image on the same scale so they can be compared. Never guess about what isn't visible.

Return ONLY JSON: {"ratings": {"<key>": {"usable": bool, "overall": int|null, "facade": int|null, "roof": int|null, "paving": int|null, "site": int|null, "defects": [string]}}}`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  try {
    const { images } = await req.json();
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
    const list = (Array.isArray(images) ? images : [])
      .filter(
        (i: { key?: unknown; dataUrl?: unknown }) =>
          typeof i?.key === "string" &&
          typeof i?.dataUrl === "string" &&
          /^data:image\/(jpeg|png|webp);base64,/.test(i.dataUrl),
      )
      .slice(0, LIMITS.images) as {
      key: string;
      address?: string;
      dataUrl: string;
    }[];
    if (list.length === 0)
      return new Response(JSON.stringify({ error: "No images" }), {
        status: 400,
        headers: corsHeaders,
      });

    const parts: Array<{
      text?: string;
      inline_data?: { mime_type: string; data: string };
    }> = [];
    for (const i of list) {
      const [head, data] = i.dataUrl.split(",", 2);
      parts.push({
        text: `Image key: ${i.key}${i.key === "subject" ? " (the subject property)" : " (a comparable)"}`,
      });
      parts.push({
        inline_data: { mime_type: head.slice(5, head.indexOf(";")), data },
      });
    }
    parts.push({ text: "Rate every image above." });

    const res = await fetch(geminiUrl(GEMINI_MODEL_FAST, apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0,
        },
      }),
    });
    if (res.status === 429)
      return new Response(
        JSON.stringify({ error: "AI is busy — try again in a moment." }),
        {
          status: 429,
          headers: corsHeaders,
        },
      );
    if (!res.ok)
      throw new Error(
        `Gemini API error ${res.status}: ${(await res.text()).slice(0, 200)}`,
      );
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    let parsed: { ratings?: Record<string, unknown> };
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : {};
    }
    const ratings: Record<string, ReturnType<typeof sanitizeRating>> = {};
    for (const i of list)
      ratings[i.key] = sanitizeRating(parsed.ratings?.[i.key]);
    return new Response(JSON.stringify({ ratings }), {
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
