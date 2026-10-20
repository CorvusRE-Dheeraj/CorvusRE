// Deploy: verify_jwt on. Requires the GEMINI_API_KEY secret.
//
// POST { designRequestId } → reads the land survey uploaded to that design
// request (PNG, JPEG or PDF in the private design-surveys bucket) with Gemini
// and stores what it could read on design_requests.survey_reading: boundary
// shape and sides, lot dimensions/area, orientation, road frontage/access,
// easements and no-build areas, setback lines, the building envelope, and the
// labels/notes on the drawing — plus a list of what it could NOT read clearly,
// which the app asks the user to confirm or enter. Only the request's owner
// can run it; nothing is guessed — unreadable values come back as null.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GEMINI_MODEL_FAST, geminiUrl, parseJsonLoose, aiErrorResponse } from "../_shared/gemini.ts";
import { corsHeaders, preflight } from "../_shared/cors.ts";
import { rateLimit } from "../_shared/rate-limit.ts";
import { logAiCall } from "../_shared/ai-log.ts";

const TIMEOUT_MS = 90_000; // a multi-page PDF survey takes longer than a text prompt
const SIDES = ["front", "rear", "left", "right", "interior", "unknown"] as const;
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

const SYSTEM = `You read land surveys (boundary / topographic surveys and plats) for an early site-design tool. Extract ONLY what is actually printed or drawn on the survey.

Conventions:
- "front" is the property line along the street the lot is addressed on / takes access from. "rear" is opposite. "left" and "right" are as seen standing in that street, facing the lot.
- All lengths in feet (convert metres if the survey is metric; say so in notes). Areas in square feet (convert acres: 1 ac = 43,560 sf).
- Lot width = length of the front property line; lot depth = the side line(s) running back from the street (average if they differ, and say so).

Hard rules:
- NEVER guess or infer a number that is not legible on the survey. Use null and add a flag instead.
- Quote the source text for every number you give (e.g. "N 89°45'12\\" E 75.00'" or "15' B.L.").
- A setback is only reported if a setback / building line is drawn or written on the survey (e.g. "25' B.L.", "Building Setback Line"). Do not apply zoning defaults.
- Easements: utility (U.E.), drainage (D.E.), access, sanitary, landscape, etc. Give the side and width only if shown.
- If the image is not a land survey, or is unreadable, set quality to "unreadable" and explain in flags.

Return ONLY JSON with exactly this shape:
{
 "quality": "clear" | "partly_readable" | "unreadable",
 "isSurvey": boolean,
 "boundary": { "shape": "rectangular" | "irregular" | "unknown", "description": string|null,
   "sides": [{ "side": "front"|"rear"|"left"|"right"|"unknown", "lengthFt": number|null, "bearing": string|null, "source": string|null }] },
 "lot": { "widthFt": number|null, "depthFt": number|null, "areaSqFt": number|null, "source": string|null },
 "orientation": { "northArrow": boolean, "frontFaces": "N"|"NE"|"E"|"SE"|"S"|"SW"|"W"|"NW"|null, "note": string|null },
 "frontage": { "street": string|null, "side": "front", "cornerLot": boolean, "secondStreet": string|null, "access": string|null },
 "easements": [{ "type": string, "side": "front"|"rear"|"left"|"right"|"interior"|"unknown", "widthFt": number|null, "label": string|null }],
 "noBuildAreas": [{ "description": string, "side": "front"|"rear"|"left"|"right"|"interior"|"unknown", "depthFt": number|null, "label": string|null }],
 "setbacks": { "front": {"ft": number|null, "label": string|null}, "rear": {"ft": number|null, "label": string|null}, "left": {"ft": number|null, "label": string|null}, "right": {"ft": number|null, "label": string|null} },
 "envelope": { "shown": boolean, "widthFt": number|null, "depthFt": number|null, "areaSqFt": number|null, "note": string|null },
 "existing": [string],
 "labels": { "legalDescription": string|null, "address": string|null, "surveyor": string|null, "date": string|null, "notes": [string] },
 "confidence": { "lot": "high"|"medium"|"low", "setbacks": "high"|"medium"|"low", "easements": "high"|"medium"|"low", "orientation": "high"|"medium"|"low" },
 "flags": [{ "field": string, "issue": string }],
 "placement": { "page": number, "box": [ymin, xmin, ymax, xmax] | null, "streetEdge": "top" | "bottom" | "left" | "right" | null }
}
"placement" locates the property boundary on the drawing so a plan can be overlaid on it: "page" = the 1-based page of the plan view; "box" = the tight bounding box of the lot's boundary lines on that page/image, as integers 0–1000 normalised to the image height (y) and width (x); "streetEdge" = which edge of that box is the front property line (the street side). Use null if you cannot locate it.
"existing" = buildings, pools, fences, driveways etc. already drawn on the lot. "noBuildAreas" = restricted areas that are NOT easements (e.g. flood zone, tree-preservation area, sight triangle) — never repeat an easement there. "flags" lists every item you could not read clearly or that looks inconsistent (e.g. lot area doesn't match the dimensions, side lines differ, scale unreadable).`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// ── validation: keep only well-formed values ─────────────────────────────────
const num = (v: unknown, max = 1e7): number | null => {
  const n = typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 && n < max ? Math.round(n * 100) / 100 : null;
};
const txt = (v: unknown, len = 300): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, len) : null;
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T | null = null): T | null =>
  allowed.includes(v as T) ? (v as T) : fallback;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const list = (v: unknown, max = 20): Record<string, unknown>[] =>
  (Array.isArray(v) ? v : []).filter((x) => x && typeof x === "object").slice(0, max) as Record<string, unknown>[];
const conf = (v: unknown) => pick(v, ["high", "medium", "low"] as const, "low");

export function cleanReading(raw: Record<string, unknown>) {
  const b = obj(raw.boundary), lot = obj(raw.lot), o = obj(raw.orientation), f = obj(raw.frontage);
  const sb = obj(raw.setbacks), env = obj(raw.envelope), lab = obj(raw.labels), c = obj(raw.confidence);
  const setback = (k: string) => ({ ft: num(obj(sb[k]).ft, 2000), label: txt(obj(sb[k]).label, 120) });
  const easements = list(raw.easements).map((e) => ({
    type: txt(e.type, 60) ?? "easement",
    side: pick(e.side, SIDES, "unknown")!,
    widthFt: num(e.widthFt, 1000),
    label: txt(e.label, 160),
  }));
  // an easement sometimes comes back a second time as a "no-build area" — show it once
  const isEasement = (n: { side: string; depthFt: number | null; description: string; label: string | null }) =>
    /easement|\bu\.?e\.?\b|\bd\.?e\.?\b/i.test(`${n.description} ${n.label ?? ""}`) ||
    easements.some((e) => e.side === n.side && e.widthFt != null && e.widthFt === n.depthFt);
  return {
    quality: pick(raw.quality, ["clear", "partly_readable", "unreadable"] as const, "partly_readable"),
    isSurvey: raw.isSurvey !== false,
    boundary: {
      shape: pick(b.shape, ["rectangular", "irregular", "unknown"] as const, "unknown"),
      description: txt(b.description, 400),
      sides: list(b.sides, 12).map((s) => ({
        side: pick(s.side, ["front", "rear", "left", "right", "unknown"] as const, "unknown"),
        lengthFt: num(s.lengthFt, 1e5),
        bearing: txt(s.bearing, 60),
        source: txt(s.source, 120),
      })),
    },
    lot: { widthFt: num(lot.widthFt, 1e5), depthFt: num(lot.depthFt, 1e5), areaSqFt: num(lot.areaSqFt, 1e9), source: txt(lot.source, 200) },
    orientation: { northArrow: o.northArrow === true, frontFaces: pick(o.frontFaces, COMPASS), note: txt(o.note, 200) },
    frontage: {
      street: txt(f.street, 120),
      cornerLot: f.cornerLot === true,
      secondStreet: txt(f.secondStreet, 120),
      access: txt(f.access, 200),
    },
    easements,
    noBuildAreas: list(raw.noBuildAreas).map((e) => ({
      description: txt(e.description, 200) ?? "No-build area",
      side: pick(e.side, SIDES, "unknown")!,
      depthFt: num(e.depthFt, 2000),
      label: txt(e.label, 160),
    })).filter((n) => !isEasement(n)),
    setbacks: { front: setback("front"), rear: setback("rear"), left: setback("left"), right: setback("right") },
    envelope: {
      shown: env.shown === true,
      widthFt: num(env.widthFt, 1e5),
      depthFt: num(env.depthFt, 1e5),
      areaSqFt: num(env.areaSqFt, 1e9),
      note: txt(env.note, 300),
    },
    existing: (Array.isArray(raw.existing) ? raw.existing : []).map((x) => txt(x, 160)).filter(Boolean).slice(0, 15),
    labels: {
      legalDescription: txt(lab.legalDescription, 400),
      address: txt(lab.address, 200),
      surveyor: txt(lab.surveyor, 160),
      date: txt(lab.date, 40),
      notes: (Array.isArray(lab.notes) ? lab.notes : []).map((x) => txt(x, 300)).filter(Boolean).slice(0, 15),
    },
    confidence: { lot: conf(c.lot), setbacks: conf(c.setbacks), easements: conf(c.easements), orientation: conf(c.orientation) },
    placement: (() => {
      const pl = obj(raw.placement);
      const box = Array.isArray(pl.box) ? pl.box.map((v) => Math.round(Number(v))) : null;
      const ok =
        box?.length === 4 && box.every((v) => Number.isFinite(v) && v >= 0 && v <= 1000) && box[0] < box[2] && box[1] < box[3] &&
        box[2] - box[0] >= 20 && box[3] - box[1] >= 20;
      return {
        page: Math.max(1, Math.min(50, Math.round(Number(pl.page)) || 1)),
        box: ok ? (box as [number, number, number, number]) : null,
        streetEdge: pick(pl.streetEdge, ["top", "bottom", "left", "right"] as const),
      };
    })(),
    flags: list(raw.flags, 20)
      .map((x) => ({ field: txt(x.field, 60) ?? "survey", issue: txt(x.issue, 300) ?? "" }))
      .filter((x) => x.issue),
  };
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

Deno.serve(async (req: Request) => {
  const pf = preflight(req);
  if (pf) return pf;
  const limited = await rateLimit(req, "ai-survey-read", 12, corsHeaders);
  if (limited) return limited;

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let requestId: string | null = null;
  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: who } = await admin.auth.getUser(jwt);
    if (!who?.user) return json({ error: "Sign in first." }, 401);

    const body = (await req.json().catch(() => ({}))) as { designRequestId?: string };
    requestId = typeof body.designRequestId === "string" ? body.designRequestId : null;
    if (!requestId) return json({ error: "designRequestId is required" }, 400);
    const { data: dr } = await admin
      .from("design_requests")
      .select("id, user_id, survey_path, survey_type, survey_name, address, city")
      .eq("id", requestId)
      .maybeSingle();
    if (!dr || dr.user_id !== who.user.id) return json({ error: "Design request not found." }, 404);
    if (!dr.survey_path) return json({ error: "Upload a survey first." }, 400);

    const { data: file, error: dlErr } = await admin.storage.from("design-surveys").download(dr.survey_path);
    if (dlErr || !file) throw new Error("Couldn't open the uploaded survey.");
    const mime = ["image/png", "image/jpeg", "application/pdf"].includes(dr.survey_type ?? "") ? dr.survey_type! : file.type;
    const data = toBase64(new Uint8Array(await file.arrayBuffer()));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let raw: string;
    try {
      const res = await fetch(geminiUrl(GEMINI_MODEL_FAST, apiKey), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [
            {
              role: "user",
              parts: [
                { inline_data: { mime_type: mime, data } },
                {
                  text: `Read this land survey${dr.address ? ` (project address given by the user: ${dr.address}${dr.city ? `, ${dr.city}` : ""})` : ""} and return the JSON.`,
                },
              ],
            },
          ],
          generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        const err = new Error(`Gemini API error ${res.status}: ${t.slice(0, 200)}`);
        (err as Error & { status?: number }).status = res.status;
        throw err;
      }
      const j = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      raw = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        const err = new Error("Reading the survey took too long — try again, or upload a smaller/clearer file.");
        (err as Error & { status?: number }).status = 504;
        throw err;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }

    const reading = cleanReading(parseJsonLoose(raw));
    const now = new Date().toISOString();
    await admin
      .from("design_requests")
      .update({ survey_reading: reading, survey_read_at: now, survey_read_error: null })
      .eq("id", dr.id);
    await logAiCall("survey_reading", { designRequestId: dr.id, file: dr.survey_name, type: mime }, reading, who.user.id);
    return json({ reading, readAt: now });
  } catch (err) {
    if (requestId)
      await admin
        .from("design_requests")
        .update({ survey_read_error: err instanceof Error ? err.message.slice(0, 300) : "Couldn't read the survey." })
        .eq("id", requestId);
    return aiErrorResponse(err, corsHeaders);
  }
});
