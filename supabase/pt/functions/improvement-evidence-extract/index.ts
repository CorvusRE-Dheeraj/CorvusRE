// Deploy via CLI: `supabase functions deploy improvement-evidence-extract`.
// Requires the GEMINI_API_KEY secret (shared with the other AI functions).
//
// Improvement Condition (Module 5): reads one uploaded inspection report (PDF,
// incl. scans), photo or short video and suggests condition records — building
// details, component conditions, defects, repair recommendations and repair
// estimates the report explicitly states — mapped to the property's buildings
// and to the module's own sections / components (sent in by the page from
// src/lib/improvement-fields.ts). Everything is written as a 'suggested'
// improvement_items row the owner confirms, edits or rejects (see
// improvement-records.sql). Photos and video are visual observations only:
// no hidden damage, performance, safety, compliance or cost is inferred, and
// blurry / incomplete media gets a note on what's needed instead of a guess.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GEMINI_MODEL_REASONING, geminiUrl } from "../_shared/gemini.ts";
import { requireUser } from "../_shared/require-user.ts";
import { rateLimitUser } from "../_shared/rate-limit.ts";
import { PROSE_STYLE } from "../_shared/prose-style.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

const MAX_BYTES = 18 * 1024 * 1024;
const CONDITIONS = ["Good", "Fair", "Poor", "Not Assessed", "Not Applicable"];
const DETAIL_FIELDS: Record<string, string> = {
  buildingAreaSqft: "Building area (SF)",
  floors: "Number of floors",
  constructionType: "Construction type",
  yearBuilt: "Year built",
  renovations: "Renovations",
  replacements: "Major component replacements",
};

const COMMON = `Rules for everything you return:
- Only what the document / image / video actually shows or states. Never infer hidden damage, equipment performance, structural safety, code compliance or repair cost.
- condition (Good | Fair | Poor | Not Assessed): give Good/Fair/Poor only when clearly supported; otherwise "Not Assessed". "No visible issue" is not the same as defect-free — say so in observation rather than rating Good on thin evidence.
- section / component: use EXACTLY one of the allowed pairs listed below. If something doesn't fit any, use section "uncategorized" with your best component name and set uncertain.
- building: the building name from the list below it belongs to, or "" when unclear (then set uncertain if there are several buildings).
- uncertain: null, or a short reason the owner should check (unclear image, conflicting statements, guessed building or component).
- needsProfessional: true when the item calls for a licensed inspector / engineer / contractor to evaluate.
- fixedOrMovable: "fixed" for building improvements (built-in, attached), "movable" for equipment that can be removed, null when not relevant.
${PROSE_STYLE}`;

const REPORT_PROMPT = `You read a commercial property inspection report (possibly scanned) for a Texas property tax protest. Read every page, tables and photos included.
Extract:
1. buildingDetails: facts about each building — field is one of ${Object.keys(DETAIL_FIELDS).join(", ")} — with the value exactly as stated and the page.
2. items: each component's condition, each defect / deficiency, each repair recommendation, and any repair estimate the report EXPLICITLY states (estimate as a number in dollars, estimateSource quoting where it came from, e.g. "Inspection report p.14 — contractor quote"). Never compute, total or guess an estimate. Include the page number.
3. reportDate: the inspection date as written. title, summary (1-2 sentences), qualityNote (pages or parts that couldn't be read, or null).
${COMMON}
Return ONLY JSON: {"title":"...","reportDate":"...|null","summary":"...","qualityNote":"...|null","buildingDetails":[{"building":"...","field":"...","value":"...","page":<n|null>}],"items":[{"building":"...","section":"...","component":"...","condition":"...","issue":"...|null","observation":"...","estimate":<number|null>,"estimateSource":"...|null","fixedOrMovable":"fixed|movable|null","page":<n|null>,"needsProfessional":false,"uncertain":"...|null"}]}`;

const MEDIA_PROMPT = (kind: string) => `You look at a ${kind} of a commercial building for a Texas property tax protest and record visible condition observations — AI-assisted visual observations, not a professional inspection.
For each visible issue (damage, deterioration, staining, cracking, corrosion, deferred maintenance) or clearly visible component: an item with the observation, a suggested condition only where the picture supports it, and in "issue" a one-line recommended next step (e.g. "Have a roofer inspect the ponding area").${kind === "video" ? ' Include videoTime ("m:ss") where it\'s visible.' : ""}
If the ${kind} is blurry, too dark, too far away or doesn't show enough, say what additional photo or video is needed in qualityNote (e.g. "a close-up of the crack with something for scale") instead of drawing conclusions, and return no item for what you can't see.
Never return repair estimates (estimate is always null). Also return captureDate if a date is visible (timestamp overlay), locationNote (where in the building it seems to be), summary (1 sentence).
${COMMON}
Return ONLY JSON: {"summary":"...","captureDate":"...|null","locationNote":"...|null","qualityNote":"...|null","items":[{"building":"...","section":"...","component":"...","condition":"...","issue":"...|null","observation":"...","estimate":null,"estimateSource":null,"fixedOrMovable":"fixed|movable|null","page":null,"videoTime":"...|null","needsProfessional":false,"uncertain":"...|null"}]}`;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const who = await requireUser(req, corsHeaders);
  if (who instanceof Response) return who;
  const limited = await rateLimitUser(who.id, "improvement-evidence-extract", 30, corsHeaders);
  if (limited) return limited;

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  let mediaId: string | null = null;
  const fail = async (message: string, status = 400) => {
    if (mediaId) await admin.from("improvement_media").update({ status: "failed", error: message }).eq("id", mediaId);
    return json({ error: message }, status);
  };

  try {
    const body = await req.json();
    mediaId = typeof body.mediaId === "string" ? body.mediaId : null;
    if (!mediaId) return json({ error: "mediaId is required." }, 400);
    // read as the caller: row-level security decides access
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false },
    });
    const { data: media } = await userClient
      .from("improvement_media")
      .select("id, property_id, document_id, building_id, kind, file_name")
      .eq("id", mediaId)
      .maybeSingle();
    if (!media?.document_id) {
      mediaId = null;
      return json({ error: "Upload not found." }, 404);
    }
    const { data: doc } = await admin
      .from("documents")
      .select("storage_path, file_name, property_id")
      .eq("id", media.document_id)
      .maybeSingle();
    if (!doc || doc.property_id !== media.property_id) return await fail("The uploaded file wasn't found.");
    const { data: file } = await admin.storage.from("documents").download(doc.storage_path);
    if (!file) return await fail("Couldn't open the uploaded file.");
    if (file.size > MAX_BYTES) {
      return await fail(
        media.kind === "video"
          ? "This video is larger than 18 MB — trim it to the part showing the issue (a few seconds is enough)."
          : "This file is larger than 18 MB — split the report into smaller PDFs and upload them separately.",
      );
    }
    const name = String(doc.file_name ?? "").toLowerCase();
    const ext = name.split(".").pop() ?? "";
    const byExt: Record<string, string> = {
      pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
      heic: "image/heic", heif: "image/heif", mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm",
    };
    const mime = file.type && file.type !== "application/octet-stream" ? file.type : (byExt[ext] ?? "");
    if (!/^(application\/pdf|image\/(jpeg|png|webp|heic|heif)|video\/(mp4|quicktime|webm))$/.test(mime)) {
      return await fail("Only PDF reports, photos (JPG, PNG, WebP, HEIC) and videos (MP4, MOV, WebM) can be read.");
    }

    // what the page allows: buildings and section/component pairs
    const ctx = (body.context ?? {}) as Record<string, unknown>;
    const { data: buildings } = await admin
      .from("improvement_buildings")
      .select("id, name, improvement_types")
      .eq("property_id", media.property_id);
    const allowed = (Array.isArray(ctx.allowed) ? ctx.allowed : [])
      .filter((a: Record<string, unknown>) => typeof a?.section === "string" && typeof a?.component === "string")
      .slice(0, 200) as { section: string; component: string; sectionLabel?: string }[];
    const hint = body.hint && typeof body.hint.component === "string" ? body.hint : null;
    const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
    const contextText = [
      ctx.address ? `Property: ${clip(ctx.address, 200)}` : null,
      ctx.propertyType ? `County property type: ${clip(ctx.propertyType, 80)}` : null,
      `Buildings: ${(buildings ?? []).map((b) => `"${b.name}" (${(b.improvement_types ?? []).join(", ") || "type not set"})`).join("; ") || "none named yet"}`,
      `Allowed section / component pairs:\n${allowed.map((a) => `- ${a.section} / ${a.component}`).join("\n")}`,
      hint ? `The owner uploaded this from the "${clip(hint.component, 80)}" card (${clip(hint.section, 40)}) — expect it to show that.` : null,
    ].filter(Boolean).join("\n");

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
    const kind = media.kind as "report" | "photo" | "video";
    const res = await fetch(geminiUrl(GEMINI_MODEL_REASONING, apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: kind === "report" ? REPORT_PROMPT : MEDIA_PROMPT(kind) }] },
        contents: [{
          role: "user",
          parts: [
            { text: `${contextText}\n\nFile: ${doc.file_name}\nProduce the JSON.` },
            { inline_data: { mime_type: mime, data: toBase64(new Uint8Array(await file.arrayBuffer())) } },
          ],
        }],
        generationConfig: { responseMimeType: "application/json", temperature: 0, thinkingConfig: { thinkingBudget: 2048 } },
      }),
      signal: AbortSignal.timeout(140_000),
    }).catch((e) => {
      if (e instanceof DOMException && e.name === "TimeoutError") return null;
      throw e;
    });
    if (!res) return await fail("Reading this took too long — try a smaller file.", 504);
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 429) return await fail("AI is busy right now. Please try again in a moment.", 429);
      throw new Error(`Gemini API error ${res.status}: ${text.slice(0, 200)}`);
    }
    const out = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> };
    const raw = out.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? "").join("") ?? "{}";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : {};
    }

    const str = (v: unknown, n: number) => (typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null" ? v.trim().slice(0, n) : null);
    const byName = new Map((buildings ?? []).map((b) => [String(b.name).toLowerCase(), b.id as string]));
    const onlyBuilding = (buildings ?? []).length === 1 ? (buildings![0].id as string) : null;
    const buildingFor = (name: unknown) =>
      (typeof name === "string" && byName.get(name.trim().toLowerCase())) || media.building_id || onlyBuilding || null;
    const pairKey = (s: string, c: string) => `${s.toLowerCase()}|${c.toLowerCase()}`;
    const allowedMap = new Map(allowed.map((a) => [pairKey(a.section, a.component), a]));
    const byComponent = new Map(allowed.map((a) => [a.component.toLowerCase(), a]));

    const rows: Record<string, unknown>[] = [];
    for (const it of (Array.isArray(parsed.items) ? parsed.items : []).slice(0, 80) as Record<string, unknown>[]) {
      const sec = String(it?.section ?? ""), comp = String(it?.component ?? "");
      const match = allowedMap.get(pairKey(sec, comp)) ?? byComponent.get(comp.toLowerCase());
      const observation = str(it?.observation, 1000);
      const issue = str(it?.issue, 1000);
      if (!observation && !issue) continue;
      const condition = CONDITIONS.includes(String(it?.condition)) ? String(it.condition) : "Not Assessed";
      const estimate = kind === "report" && typeof it?.estimate === "number" && it.estimate > 0 && it.estimate < 1e9 ? Math.round(it.estimate) : null;
      const page = Number(it?.page);
      const bId = buildingFor(it?.building);
      const uncertain = str(it?.uncertain, 300) ??
        (!match ? "AI couldn't match this to one of the module's components — check the category." : null) ??
        (!bId && (buildings ?? []).length > 1 ? "Which building this belongs to isn't clear." : null);
      rows.push({
        property_id: media.property_id,
        building_id: bId,
        media_id: media.id,
        section: match?.section ?? "uncategorized",
        component: (match?.component ?? comp.slice(0, 80)) || "Other",
        condition,
        issue,
        observation,
        repair_estimate: estimate,
        estimate_source: estimate ? (str(it?.estimateSource, 200) ?? `${doc.file_name}${Number.isInteger(page) ? ` p.${page}` : ""}`) : null,
        fixed_or_movable: it?.fixedOrMovable === "fixed" || it?.fixedOrMovable === "movable" ? it.fixedOrMovable : null,
        page: kind === "report" && Number.isInteger(page) && page > 0 && page < 5000 ? page : null,
        video_time: kind === "video" ? str(it?.videoTime, 12) : null,
        needs_professional: it?.needsProfessional === true,
        uncertain,
        source: kind,
        status: "suggested",
      });
    }
    // building facts from a report → reviewable "details" suggestions
    if (kind === "report") {
      for (const d of (Array.isArray(parsed.buildingDetails) ? parsed.buildingDetails : []).slice(0, 30) as Record<string, unknown>[]) {
        const field = String(d?.field ?? "");
        const value = str(d?.value, 300);
        if (!DETAIL_FIELDS[field] || !value) continue;
        const page = Number(d?.page);
        const bId = buildingFor(d?.building);
        rows.push({
          property_id: media.property_id, building_id: bId, media_id: media.id,
          section: "details", component: field, condition: "Not Assessed",
          issue: null, observation: value,
          repair_estimate: null, estimate_source: null, fixed_or_movable: null,
          video_time: null, needs_professional: false,
          page: Number.isInteger(page) && page > 0 ? page : null,
          uncertain: !bId && (buildings ?? []).length > 1 ? "Which building this belongs to isn't clear." : null,
          source: "report", status: "suggested",
        });
      }
    }
    for (const r of rows) {
      r.content_key = await sha256Hex(
        [r.building_id ?? "", r.section, String(r.component).toLowerCase(), String(r.issue ?? r.observation ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 200)].join("|"),
      );
    }
    const unique = [...new Map(rows.map((r) => [r.content_key as string, r])).values()];
    let added = 0;
    if (unique.length) {
      const { data: ins, error } = await admin
        .from("improvement_items")
        .upsert(unique, { onConflict: "property_id,content_key", ignoreDuplicates: true })
        .select("id");
      if (error) throw error;
      added = ins?.length ?? 0;
    }
    await admin.from("improvement_media").update({
      status: "read", error: null,
      title: str(parsed.title, 200),
      report_date: str(parsed.reportDate, 60),
      capture_date: str(parsed.captureDate, 60),
      location_note: str(parsed.locationNote, 200),
      summary: str(parsed.summary, 600),
      quality_note: str(parsed.qualityNote, 600),
      read_at: new Date().toISOString(),
    }).eq("id", media.id);
    return json({ found: unique.length, added, qualityNote: str(parsed.qualityNote, 600) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : (err as { message?: string })?.message;
    console.error("improvement-evidence-extract:", msg ?? err);
    return await fail(msg || "Couldn't read this file.", 500);
  }
});
