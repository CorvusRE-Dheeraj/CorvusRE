// Deploy: verify_jwt on. Requires the GEMINI_API_KEY secret.
//
// Design & Code Compliance Checker (see supabase/dp/compliance-checker.sql).
// A pre-submission quality-control pass — it never claims to be the city's
// review or a licensed professional's judgement.
//
// POST { action: "read", documentId }
//   Reads one uploaded PDF drawing set sheet by sheet: sheet numbers/titles,
//   discipline, stated scale (and whether a graphic scale bar backs it up),
//   schedules, room labels, dimensions, equipment and cross-references — plus
//   the measurable design values the checks need, each with its source text,
//   basis and confidence. Stored on project_documents.drawing_index.
//
// POST { action: "check", projectId, documentIds }
//   Starts a check run (compliance_reviews) and returns its id at once; the
//   run continues in the background and the page polls it. Corvus AI reviews
//   the drawings against zoning/UDC, building & fire codes, civil standards,
//   MEP codes, ADA/TAS, Texas state rules (daycare licensing where it
//   applies) and plats/special conditions, using the values the team has
//   confirmed first. Each issue is assigned to the project's consultant for
//   its discipline.
//
// Code text: every citation is Corvus AI's own (code_source "ai", shown as
// "verify against the adopted code"). Licensed code text (ICC Code Connect)
// plugs in here once that agreement and token exist.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GEMINI_MODEL_FAST, geminiUrl, parseJsonLoose, aiErrorResponse } from "../_shared/gemini.ts";
import { corsHeaders, preflight } from "../_shared/cors.ts";
import { rateLimitUser } from "../_shared/rate-limit.ts";
import { logAiCall } from "../_shared/ai-log.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const READ_TIMEOUT_MS = 140_000;
const CHECK_TIMEOUT_MS = 330_000;
const INLINE_LIMIT = 14 * 1024 * 1024; // base64 inflates ~4/3; Gemini's inline request cap is 20 MB

const DISCIPLINES = ["architectural", "civil", "structural", "mep", "fire", "survey", "landscape", "other"] as const;
const AREAS = ["zoning", "building_fire", "civil", "mep", "accessibility", "state", "plat"] as const;
const SEVERITIES = ["critical", "high", "medium", "low"] as const;
const CONF = ["high", "medium", "low"] as const;

// Same keys as VALUE_DEFS in apps/dp/src/lib/compliance.ts — keep in step.
const VALUE_KEYS: Record<string, string> = {
  lot_area: "lot area (sf)",
  building_footprint: "building footprint (sf)",
  gross_floor_area: "gross floor area (sf)",
  building_height: "building height (ft)",
  stories: "number of stories",
  lot_coverage: "lot coverage (%)",
  far: "floor area ratio",
  setback_front: "front setback provided (ft)",
  setback_rear: "rear setback provided (ft)",
  setback_side_left: "left side setback provided (ft)",
  setback_side_right: "right side setback provided (ft)",
  parking_spaces: "parking spaces provided",
  landscape_area: "landscape area (sf)",
  impervious_cover: "impervious cover (%)",
  fire_lane_width: "fire lane width (ft)",
  hydrant_distance: "distance to nearest fire hydrant (ft)",
  occupancy_group: "IBC occupancy group(s), e.g. B, E, A-2",
  construction_type: "IBC construction type, e.g. V-B",
  sprinklered: "sprinklered (yes/no, NFPA 13/13R)",
  occupant_load: "occupant load",
  exits: "number of exits",
  travel_distance: "maximum exit access travel distance (ft)",
  corridor_width: "minimum corridor width (in)",
  accessible_parking: "accessible parking spaces provided",
  door_clear_width: "minimum door clear width (in)",
  accessible_restrooms: "accessible restrooms",
  electrical_service: "electrical service size (A)",
  water_meter: "water meter size (in)",
  plumbing_fixtures: "plumbing fixture count",
  licensed_capacity: "licensed child-care capacity (children)",
  outdoor_play_area: "outdoor play area (sf)",
  indoor_activity_area: "indoor activity space (sf)",
};

const READ_SYSTEM = `You read construction drawing sets (architectural, civil, structural, MEP, fire protection, survey) for a pre-submission quality-control tool. Report ONLY what is printed on the sheets.

For every page, identify: sheet number (e.g. "A-101", "C2.0"), sheet title, discipline, the stated drawing scale(s), whether a graphic scale bar is drawn, schedules (door, window, finish, fixture, panel, equipment, parking, area tabulations...), room labels, key dimension strings, equipment tags, and references to other sheets/details (e.g. "3/A-501").

Scale and units — strict rules:
- Never assume a dimension or scale is right because you recognise a line. Do NOT measure or scale anything off the drawing.
- Report the scale exactly as printed ("1/8\\" = 1'-0\\"", "1\\" = 20'"). If it says NTS / not to scale, if several scales conflict on one view, if a graphic scale bar disagrees with the written scale, or if the sheet notes it is a reduced/half-size print, describe it in scaleIssue.
- Keep annotations (printed dimension strings, notes, tables) apart from geometry. Values come from annotations.

Design values: extract these keys when the drawings state them: ${Object.entries(VALUE_KEYS)
  .map(([k, d]) => `${k} = ${d}`)
  .join("; ")}.
For each value give: the value as printed (number only where possible), its unit, page, sheet number, the exact source text quoted, basis ("annotation" if printed on the sheet, "derived" if you calculated it from other printed values — say how in source), and confidence (high only when clearly printed and unambiguous). Never invent a value; if a key isn't on the drawings, leave it out — the app lists missing keys itself.

Return ONLY JSON:
{
 "quality": "clear" | "partly_readable" | "unreadable",
 "pageCount": number,
 "sheets": [{ "page": number, "number": string|null, "title": string|null, "discipline": "architectural"|"civil"|"structural"|"mep"|"fire"|"survey"|"landscape"|"other", "scale": string|null, "scaleBar": boolean, "scaleIssue": string|null, "schedules": [string], "rooms": [string], "dimensions": [string], "equipment": [string], "references": [string] }],
 "values": [{ "key": string, "value": string, "unit": string|null, "page": number|null, "sheet": string|null, "source": string|null, "basis": "annotation"|"derived", "confidence": "high"|"medium"|"low" }],
 "flags": [{ "field": string, "issue": string }]
}
Keep lists short (at most 25 rooms, 25 dimensions, 20 equipment tags, 20 references per sheet). "flags" lists anything unreadable, inconsistent between sheets (e.g. a value that differs between the site plan and the code analysis), or missing that a reviewer would expect (no code analysis sheet, no sheet index, unsigned/unsealed sheets).`;

const CHECK_SYSTEM = `You are a pre-submission plan reviewer for Texas development projects. You check a drawing set BEFORE it goes to the city, to cut city review comments and consultant revisions. You are a quality-control aid — never the city's reviewer and never a substitute for the licensed design professional.

Check the drawings against, where they apply to this project:
- zoning: the city's zoning ordinance / Unified Development Code for the project's district (use, setbacks, height, coverage, FAR, parking, landscaping, screening, signage)
- building_fire: the International Building Code / International Fire Code editions the city has adopted plus its local amendments (occupancy, construction type, allowable area/height, egress, fire separation, sprinklers, fire lanes and hydrants)
- civil: civil engineering & infrastructure design standards (grading, drainage/detention, utilities, driveways, sidewalks, fire lanes, erosion control)
- mep: mechanical, electrical, plumbing and energy codes (IMC, NEC, IPC, IECC as adopted; fixture counts)
- accessibility: 2010 ADA Standards and the Texas Accessibility Standards (TDLR registration for projects over $50,000, accessible routes, parking, restrooms, door clearances)
- state: other Texas state requirements — including HHSC child-care licensing minimum standards (26 TAC chapter 746) when the project is a daycare/child-care center
- plat: the approved plat, platted easements and building lines, special zoning conditions (PD/SUP conditions) and project-specific restrictions

Rules:
- Only raise an issue you can tie to something in the drawings or the confirmed/extracted values: a value that fails a requirement, a required item that is missing, or values that conflict between sheets.
- Use team-CONFIRMED values first. If an issue depends on a value that is only AI-extracted or has a scale/unit concern, set needsConfirmation true.
- Cite the requirement as precisely as you reliably can (code + edition + section, e.g. "IBC 2021 §1006.2.1" or "Frisco Zoning Ordinance — SF-16 setbacks"). If you are not sure of the exact section or of the edition the city adopted, say so in the citation — never invent section numbers. Local amendments vary: when a requirement depends on a city amendment you can't confirm, lower confidence.
- Locate each issue: document number from the list given, sheet number, and where on the sheet (detail/area/grid/room).
- Suggest a concrete correction, and the discipline responsible for making it.
- Do not repeat the same issue for every sheet; one issue, list the sheets in location.
- Severity: critical = will almost certainly be rejected / life-safety; high = likely city comment; medium = possible comment or incomplete information; low = best practice / clarity.

Return ONLY JSON:
{
 "overview": string (3–5 sentences: what the set covers, the biggest risks, what's missing),
 "codeBasis": string (which codes/editions you assumed and why),
 "missing": [string] (information needed for a complete check that the set doesn't show),
 "issues": [{ "area": "zoning"|"building_fire"|"civil"|"mep"|"accessibility"|"state"|"plat", "discipline": "architectural"|"civil"|"structural"|"mep"|"fire"|"survey"|"landscape"|"other", "severity": "critical"|"high"|"medium"|"low", "title": string, "requirement": string, "codeReference": string, "document": number|null, "sheet": string|null, "location": string, "problem": string, "suggestedFix": string, "confidence": "high"|"medium"|"low", "needsConfirmation": boolean }]
}
At most 60 issues, most important first.`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// ── sanitizers ────────────────────────────────────────────────────────────
const txt = (v: unknown, len = 300): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, len) : null;
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const list = (v: unknown, max: number): Record<string, unknown>[] =>
  (Array.isArray(v) ? v : []).filter((x) => x && typeof x === "object").slice(0, max) as Record<string, unknown>[];
const strs = (v: unknown, max: number, len = 120): string[] =>
  (Array.isArray(v) ? v : []).map((x) => txt(x, len)).filter((x): x is string => !!x).slice(0, max);
const int = (v: unknown, max = 5000): number | null => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 && n <= max ? n : null;
};

export function cleanIndex(raw: Record<string, unknown>) {
  return {
    quality: pick(raw.quality, ["clear", "partly_readable", "unreadable"] as const, "partly_readable"),
    pageCount: int(raw.pageCount),
    sheets: list(raw.sheets, 400).map((s) => ({
      page: int(s.page) ?? 1,
      number: txt(s.number, 30),
      title: txt(s.title, 160),
      discipline: pick(s.discipline, DISCIPLINES, "other"),
      scale: txt(s.scale, 120),
      scaleBar: s.scaleBar === true,
      scaleIssue: txt(s.scaleIssue, 300),
      schedules: strs(s.schedules, 15),
      rooms: strs(s.rooms, 25, 80),
      dimensions: strs(s.dimensions, 25, 80),
      equipment: strs(s.equipment, 20, 80),
      references: strs(s.references, 20, 60),
    })),
    values: list(raw.values, 120)
      .filter((v) => typeof v.key === "string" && v.key in VALUE_KEYS && txt(v.value, 80))
      .map((v) => ({
        key: v.key as string,
        value: txt(v.value, 80)!,
        unit: txt(v.unit, 20),
        page: int(v.page),
        sheet: txt(v.sheet, 30),
        source: txt(v.source, 240),
        basis: pick(v.basis, ["annotation", "derived"] as const, "derived"),
        confidence: pick(v.confidence, CONF, "low"),
      })),
    flags: list(raw.flags, 40)
      .map((f) => ({ field: txt(f.field, 60) ?? "drawings", issue: txt(f.issue, 400) ?? "" }))
      .filter((f) => f.issue),
  };
}

function cleanIssues(raw: Record<string, unknown>, docCount: number) {
  return list(raw.issues, 60)
    .map((i) => {
      const docNo = int(i.document, docCount);
      return {
        area: pick(i.area, AREAS, "building_fire"),
        discipline: pick(i.discipline, DISCIPLINES, "architectural"),
        severity: pick(i.severity, SEVERITIES, "medium"),
        title: txt(i.title, 200) ?? "",
        requirement: txt(i.requirement, 1200),
        code_reference: txt(i.codeReference, 240),
        docIndex: docNo ? docNo - 1 : null,
        sheet: txt(i.sheet, 60),
        location: txt(i.location, 400),
        problem: txt(i.problem, 1200),
        suggested_fix: txt(i.suggestedFix, 1200),
        confidence: pick(i.confidence, CONF, "medium"),
        needs_confirmation: i.needsConfirmation === true,
      };
    })
    .filter((i) => i.title);
}

// ── Gemini ────────────────────────────────────────────────────────────────
function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Large sets go through the Gemini Files API (up to 50 MB / 1,000 pages per PDF).
async function uploadToGemini(apiKey: string, bytes: Uint8Array, name: string): Promise<string> {
  const start = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.length),
      "X-Goog-Upload-Header-Content-Type": "application/pdf",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: name.slice(0, 120) } }),
  });
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!start.ok || !uploadUrl) throw new Error(`Couldn't send ${name} to Corvus AI (${start.status}).`);
  const done = await fetch(uploadUrl, {
    method: "POST",
    headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
    body: bytes,
  });
  const info = (await done.json().catch(() => ({}))) as { file?: { uri?: string; name?: string; state?: string } };
  if (!done.ok || !info.file?.uri) throw new Error(`Couldn't send ${name} to Corvus AI (${done.status}).`);
  let state = info.file.state;
  for (let i = 0; state === "PROCESSING" && i < 40; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/${info.file.name}?key=${apiKey}`);
    state = ((await r.json().catch(() => ({}))) as { state?: string }).state;
  }
  if (state === "FAILED") throw new Error(`Corvus AI couldn't open ${name}.`);
  return info.file.uri;
}

type Part = Record<string, unknown>;

async function pdfParts(apiKey: string, files: { name: string; bytes: Uint8Array }[]): Promise<Part[]> {
  const total = files.reduce((n, f) => n + f.bytes.length, 0);
  const parts: Part[] = [];
  for (const f of files) {
    if (total <= INLINE_LIMIT) parts.push({ inline_data: { mime_type: "application/pdf", data: toBase64(f.bytes) } });
    else parts.push({ file_data: { mime_type: "application/pdf", file_uri: await uploadToGemini(apiKey, f.bytes, f.name) } });
  }
  return parts;
}

async function gemini(apiKey: string, system: string, parts: Part[], timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(geminiUrl(GEMINI_MODEL_FAST, apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts }],
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
    return j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      const err = new Error("Corvus AI took too long on this drawing set — try fewer or smaller files.");
      (err as Error & { status?: number }).status = 504;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ── data ──────────────────────────────────────────────────────────────────
type Doc = {
  id: string;
  project_id: string;
  name: string;
  storage_path: string | null;
  discipline: string | null;
  mime_type: string | null;
  cad_summary: Record<string, unknown> | null;
  drawing_index: ReturnType<typeof cleanIndex> | null;
};

async function ownedProject(admin: SupabaseClient, projectId: string, userId: string) {
  const { data: p } = await admin.from("projects").select("*").eq("id", projectId).maybeSingle();
  if (!p) return null;
  if (p.user_id === userId) return p;
  const { data: prof } = await admin.from("profiles").select("is_admin").eq("id", userId).maybeSingle();
  return prof?.is_admin ? p : null;
}

const isPdf = (d: Doc) => d.mime_type === "application/pdf" || /\.pdf$/i.test(d.storage_path ?? "");

async function download(admin: SupabaseClient, d: Doc): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from("project-docs").download(d.storage_path!);
  if (error || !data) throw new Error(`Couldn't open ${d.name}.`);
  return new Uint8Array(await data.arrayBuffer());
}

async function readDocument(admin: SupabaseClient, apiKey: string, d: Doc, userId: string) {
  const bytes = await download(admin, d);
  const parts = await pdfParts(apiKey, [{ name: d.name, bytes }]);
  parts.push({
    text: `Read this drawing set ("${d.name}"${d.discipline ? `, uploaded as ${d.discipline}` : ""}) and return the JSON.`,
  });
  const index = cleanIndex(parseJsonLoose(await gemini(apiKey, READ_SYSTEM, parts, READ_TIMEOUT_MS)));
  await admin
    .from("project_documents")
    .update({
      drawing_index: index,
      drawing_read_at: new Date().toISOString(),
      drawing_read_error: null,
      page_count: index.pageCount ?? undefined,
    })
    .eq("id", d.id);
  await logAiCall("drawing_reading", { documentId: d.id, file: d.name }, index, userId);
  return index;
}

// what the check is told about the project — every line from saved data
function projectBrief(p: Record<string, unknown>): string {
  const a = obj(p.analysis);
  const lines = [
    `Project: ${p.name ?? ""}`,
    `Address: ${[p.address, p.city, p.county ? `${p.county} County` : null, p.state].filter(Boolean).join(", ")}`,
    `Jurisdiction: ${p.jurisdiction ?? "unknown"}${p.jurisdiction_level ? ` (${p.jurisdiction_level})` : ""}`,
    `Zoning district: ${p.zoning ?? "unknown"}${p.zoning_category ? ` (${p.zoning_category})` : ""}`,
    `Sector / use: ${[p.sector, p.sector_subcategory, p.existing_use && `existing ${p.existing_use}`, p.proposed_use && `proposed ${p.proposed_use}`, p.intent].filter(Boolean).join("; ")}`,
    `Lot size: ${p.lot_size ?? "—"}; building area: ${p.building_area ?? "—"}; floors: ${p.floors ?? "—"}`,
  ];
  // same test as isDaycare() in apps/dp/src/lib/compliance.ts
  if (/day\s*care|child\s*care|daycare|pre-?school|early\s+learning/i.test(`${p.proposed_use ?? ""} ${p.sector_subcategory ?? ""} ${p.intent ?? ""}`))
    lines.push(
      "This is a child-care facility: Texas HHSC child-care licensing minimum standards (26 TAC chapter 746) apply — check indoor activity space and outdoor play space per child against the licensed capacity, and anything else on the drawings the licensing standards govern (state area).",
    );
  if (a.zoning) lines.push(`Zoning analysis on file: ${JSON.stringify(a.zoning).slice(0, 2500)}`);
  if (a.constraints) lines.push(`Site constraints on file: ${JSON.stringify(a.constraints).slice(0, 2000)}`);
  return lines.join("\n");
}

function cadBrief(d: Doc): string | null {
  const c = d.cad_summary;
  if (!c) return null;
  if (c.format === "dwg") return `"${d.name}" is a DWG file that could not be read (needs a DXF/PDF export).`;
  const dims = (Array.isArray(c.dimensions) ? c.dimensions : []) as Record<string, unknown>[];
  return `"${d.name}" (${c.source === "dwg" ? "DWG" : "DXF"} geometry, parsed exactly): ${JSON.stringify({
    units: c.units,
    layers: c.layers,
    texts: (Array.isArray(c.texts) ? c.texts : []).slice(0, 200),
    dimensions: dims.slice(0, 150),
    overriddenDimensions: dims.filter((x) => x.overridden),
    closedAreas: (Array.isArray(c.closedAreas) ? c.closedAreas : []).slice(0, 80),
    warnings: c.warnings,
  }).slice(0, 12000)}`;
}

async function runCheck(
  admin: SupabaseClient,
  apiKey: string,
  reviewId: string,
  project: Record<string, unknown>,
  docs: Doc[],
  userId: string,
) {
  const stage = (s: string) => admin.from("compliance_reviews").update({ stage: s }).eq("id", reviewId);
  try {
    // read any PDF that hasn't been read yet (normally done right after upload)
    for (const d of docs) {
      if (isPdf(d) && !d.drawing_index) {
        await stage(`Reading ${d.name}…`);
        d.drawing_index = await readDocument(admin, apiKey, d, userId).catch(() => null);
      }
    }
    const [{ data: consultants }, { data: confirmed }] = await Promise.all([
      admin.from("project_consultants").select("id, discipline").eq("project_id", project.id),
      admin.from("compliance_values").select("key, value, unit, status").eq("project_id", project.id),
    ]);

    await stage("Checking the drawings against the codes…");
    const pdfs = docs.filter(isPdf);
    const files = await Promise.all(pdfs.map(async (d) => ({ name: d.name, bytes: await download(admin, d) })));
    const parts = await pdfParts(apiKey, files);
    const docList = docs
      .map((d, i) => `Document ${i + 1}: "${d.name}" — ${d.discipline ?? "unspecified"}${isPdf(d) ? ` (PDF, attached as file ${pdfs.indexOf(d) + 1})` : " (CAD)"}`)
      .join("\n");
    const sheetIndex = docs
      .filter((d) => d.drawing_index)
      .map((d) => `Document ${docs.indexOf(d) + 1} sheets: ${JSON.stringify(d.drawing_index!.sheets.map((s) => ({ page: s.page, number: s.number, title: s.title, discipline: s.discipline, scale: s.scale, scaleBar: s.scaleBar, scaleIssue: s.scaleIssue })))}`)
      .join("\n");
    const extracted = docs.flatMap((d) =>
      (d.drawing_index?.values ?? []).map((v) => ({ document: docs.indexOf(d) + 1, ...v })),
    );
    const cad = docs.map(cadBrief).filter(Boolean).join("\n");
    parts.push({
      text: [
        projectBrief(project),
        "",
        "Documents:",
        docList,
        "",
        sheetIndex && `Sheet index:\n${sheetIndex}`,
        `Values CONFIRMED by the project team (authoritative): ${JSON.stringify(confirmed ?? [])}`,
        `Values extracted by Corvus AI (not yet confirmed unless listed above): ${JSON.stringify(extracted).slice(0, 15000)}`,
        cad && `CAD geometry:\n${cad}`,
        "",
        "Review the drawing set and return the JSON.",
      ]
        .filter((x) => x !== false && x !== null)
        .join("\n"),
    });

    const raw = parseJsonLoose(await gemini(apiKey, CHECK_SYSTEM, parts, CHECK_TIMEOUT_MS));
    const issues = cleanIssues(raw, docs.length);
    const byDiscipline = new Map<string, string>();
    for (const c of consultants ?? []) if (!byDiscipline.has(c.discipline)) byDiscipline.set(c.discipline, c.id);
    if (issues.length) {
      const { error } = await admin.from("compliance_issues").insert(
        issues.map(({ docIndex, ...i }) => ({
          ...i,
          review_id: reviewId,
          project_id: project.id,
          code_source: "ai",
          document_id: docIndex != null ? docs[docIndex]?.id ?? null : null,
          consultant_id: byDiscipline.get(i.discipline) ?? null,
        })),
      );
      if (error) throw new Error(`Couldn't save the issues: ${error.message}`);
    }
    const counts: Record<string, number> = {};
    for (const i of issues) counts[i.severity] = (counts[i.severity] ?? 0) + 1;
    const summary = {
      overview: txt(raw.overview, 1500),
      codeBasis: txt(raw.codeBasis, 800),
      missing: strs(raw.missing, 20, 300),
      counts,
    };
    await admin
      .from("compliance_reviews")
      .update({ status: "done", stage: null, summary, finished_at: new Date().toISOString() })
      .eq("id", reviewId);
    await logAiCall("compliance_check", { reviewId, projectId: project.id, documents: docs.map((d) => d.name) }, { summary, issues: issues.length }, userId);
  } catch (err) {
    console.error("compliance check failed:", err);
    await admin
      .from("compliance_reviews")
      .update({
        status: "failed",
        stage: null,
        error: err instanceof Error ? err.message.slice(0, 400) : "The check couldn't finish.",
        finished_at: new Date().toISOString(),
      })
      .eq("id", reviewId);
  }
}

Deno.serve(async (req: Request) => {
  const pf = preflight(req);
  if (pf) return pf;
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let readingId: string | null = null;
  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: who } = await admin.auth.getUser(jwt);
    if (!who?.user) return json({ error: "Sign in first." }, 401);
    const userId = who.user.id;
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      documentId?: string;
      projectId?: string;
      documentIds?: unknown;
    };

    if (body.action === "read") {
      const limited = await rateLimitUser(userId, "compliance-read", 30, corsHeaders);
      if (limited) return limited;
      if (typeof body.documentId !== "string") return json({ error: "documentId is required" }, 400);
      const { data: d } = await admin.from("project_documents").select("*").eq("id", body.documentId).maybeSingle();
      if (!d || !(await ownedProject(admin, d.project_id, userId))) return json({ error: "Document not found." }, 404);
      if (!isPdf(d as Doc)) return json({ error: "Only PDF drawings are read by Corvus AI — DXF is read on upload." }, 400);
      readingId = d.id;
      const index = await readDocument(admin, apiKey, d as Doc, userId);
      return json({ drawingIndex: index });
    }

    if (body.action === "check") {
      const limited = await rateLimitUser(userId, "compliance-check", 6, corsHeaders);
      if (limited) return limited;
      if (typeof body.projectId !== "string") return json({ error: "projectId is required" }, 400);
      const project = await ownedProject(admin, body.projectId, userId);
      if (!project) return json({ error: "Project not found." }, 404);
      const ids = (Array.isArray(body.documentIds) ? body.documentIds : []).filter((x): x is string => typeof x === "string").slice(0, 20);
      if (!ids.length) return json({ error: "Pick at least one drawing to check." }, 400);
      const { data: docs } = await admin.from("project_documents").select("*").in("id", ids).eq("project_id", project.id);
      const usable = ((docs ?? []) as Doc[]).filter((d) => isPdf(d) || (d.cad_summary && d.cad_summary.format === "dxf"));
      if (!usable.length) return json({ error: "None of those files can be checked — upload PDF or DXF drawings." }, 400);
      const { data: running } = await admin
        .from("compliance_reviews")
        .select("id, created_at")
        .eq("project_id", project.id)
        .eq("status", "running")
        .gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString())
        .limit(1)
        .maybeSingle();
      if (running) return json({ reviewId: running.id });
      const { data: review, error } = await admin
        .from("compliance_reviews")
        .insert({ project_id: project.id, document_ids: usable.map((d) => d.id), created_by: userId, stage: "Starting…" })
        .select("id")
        .single();
      if (error || !review) throw new Error("Couldn't start the check.");
      const work = runCheck(admin, apiKey, review.id, project, usable, userId);
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work);
      else await work;
      return json({ reviewId: review.id });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (err) {
    if (readingId)
      await admin
        .from("project_documents")
        .update({ drawing_read_error: err instanceof Error ? err.message.slice(0, 300) : "Couldn't read the drawings." })
        .eq("id", readingId);
    return aiErrorResponse(err, corsHeaders);
  }
});
