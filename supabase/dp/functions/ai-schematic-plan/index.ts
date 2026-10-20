// Deploy: verify_jwt on. Requires the GEMINI_API_KEY secret.
//
// POST { designRequestId, site, program, instruction?, previous? } → an early
// concept layout for the lot: building footprint (one or two rectangles),
// parking, driveway/access, entrance side and open space, with its reasoning
// and the assumptions it made. Coordinates are feet from the FRONT-LEFT corner
// of the lot as seen from the street (x → right, y → toward the rear). The
// app clamps everything to the confirmed site geometry before showing it
// (apps/dp/src/lib/schematic.ts), so the building always stays inside the
// setbacks whatever comes back here. Only the request's owner can call it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GEMINI_MODEL_FAST, geminiUrl, parseJsonLoose, aiErrorResponse } from "../_shared/gemini.ts";
import { corsHeaders, preflight } from "../_shared/cors.ts";
import { rateLimit } from "../_shared/rate-limit.ts";
import { logAiCall } from "../_shared/ai-log.ts";

const SYSTEM = `You are an architect producing an EARLY CONCEPT site layout (a schematic, not a construction drawing) for a rectangular lot.

Coordinate system: feet. Origin (0,0) = the FRONT-LEFT corner of the lot, standing in the street facing the lot. x grows to the right (0 … lotWidth). y grows away from the street toward the rear (0 … lotDepth). The front property line is y = 0.

You are given the buildable envelope (the area inside every setback/easement). Rules:
- The building footprint MUST lie entirely inside the envelope. Use one rectangle, or two overlapping/adjoining rectangles for an L-shape when it serves the program.
- Aim for the target footprint area (building area ÷ floors), not more. If it can't fit, use the largest sensible footprint and say so.
- Commercial / mixed use: show surface parking (a rectangle) and a driveway from the street. Parking may sit outside the envelope but must stay inside the lot, must not overlap the building, and should avoid easement strips where possible. Use ~325 sf per stall including aisles.
- Residential: a driveway (12–20 ft wide) from the street to a garage or parking pad; no parking lot unless multifamily.
- The driveway runs from y = 0 into the lot; give its x position and width.
- Keep everything simple, orthogonal and buildable. Leave usable open space where possible.
- Follow the user's refinement instruction if given. If "previous" is given, produce a clearly DIFFERENT arrangement.

Return ONLY JSON:
{
 "title": string (3-6 words, e.g. "Front-loaded building, rear parking"),
 "building": [{"x": number, "y": number, "w": number, "d": number}],
 "parking": {"x": number, "y": number, "w": number, "d": number} | null,
 "driveway": {"x": number, "w": number, "toY": number} | null,
 "entrance": "front" | "left" | "right" | "rear",
 "openSpace": [{"x": number, "y": number, "w": number, "d": number, "label": string}],
 "rationale": string (2-4 sentences: why this placement — street presence, access, parking, light, open space),
 "assumptions": [string] (every assumption you made: parking ratio, driveway width, building shape, anything not given)
}`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const n = (v: unknown): number | null => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? Math.round(x * 10) / 10 : null;
};
const rect = (v: unknown) => {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const r = { x: n(o.x), y: n(o.y), w: n(o.w), d: n(o.d) };
  return r.x != null && r.y != null && r.w != null && r.d != null && r.w > 0 && r.d > 0
    ? (r as { x: number; y: number; w: number; d: number })
    : null;
};
const s = (v: unknown, len: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, len) : null);

Deno.serve(async (req: Request) => {
  const pf = preflight(req);
  if (pf) return pf;
  const limited = await rateLimit(req, "ai-schematic-plan", 20, corsHeaders);
  if (limited) return limited;
  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: who } = await admin.auth.getUser(jwt);
    if (!who?.user) return json({ error: "Sign in first." }, 401);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = typeof body.designRequestId === "string" ? body.designRequestId : "";
    const { data: dr } = await admin
      .from("design_requests")
      .select("id, user_id, sector, scope, rooms, functional_requirements, special_requirements")
      .eq("id", id)
      .maybeSingle();
    if (!dr || dr.user_id !== who.user.id) return json({ error: "Design request not found." }, 404);

    const site = (body.site ?? {}) as Record<string, unknown>;
    const program = (body.program ?? {}) as Record<string, unknown>;
    const lines = [
      `Lot: ${site.lotWidthFt} ft wide (along the street) × ${site.lotDepthFt} ft deep.`,
      `Kept clear from each property line (setback or wider easement): front ${site.front} ft, rear ${site.rear} ft, left ${site.left} ft, right ${site.right} ft.`,
      `Buildable envelope: x ${site.envX0}…${site.envX1}, y ${site.envY0}…${site.envY1} (${site.envW} × ${site.envD} ft).`,
      site.street ? `Street: ${site.street}${site.cornerLot ? " (corner lot)" : ""}.` : "",
      site.frontFaces ? `The street side faces ${site.frontFaces}.` : "",
      Array.isArray(site.easements) && site.easements.length ? `Easements: ${(site.easements as string[]).join("; ")}.` : "",
      `Project: ${dr.scope ?? "new construction"}, ${dr.sector ?? "commercial"}.`,
      `Building area ${program.buildingAreaSqFt ?? "unknown"} sf on ${program.floors ?? 1} floor(s) → target footprint ${program.footprintSqFt ?? "unknown"} sf.`,
      program.parkingStalls ? `Parking needed: about ${program.parkingStalls} stalls.` : "",
      dr.rooms ? `Rooms / spaces: ${String(dr.rooms).slice(0, 400)}` : "",
      dr.functional_requirements ? `Functional requirements: ${String(dr.functional_requirements).slice(0, 600)}` : "",
      dr.special_requirements ? `Special requirements: ${String(dr.special_requirements).slice(0, 600)}` : "",
      s(body.instruction, 500) ? `Refinement requested by the user: ${s(body.instruction, 500)}` : "",
      s(body.previous, 600) ? `Previous option (make a different one): ${s(body.previous, 600)}` : "",
    ].filter(Boolean);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    let raw = "";
    try {
      const res = await fetch(geminiUrl(GEMINI_MODEL_FAST, apiKey), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: "user", parts: [{ text: `${lines.join("\n")}\n\nReturn the JSON layout.` }] }],
          generationConfig: { responseMimeType: "application/json", temperature: body.previous ? 0.8 : 0.4 },
        }),
      });
      if (!res.ok) {
        const err = new Error(`Gemini API error ${res.status}: ${(await res.text()).slice(0, 200)}`);
        (err as Error & { status?: number }).status = res.status;
        throw err;
      }
      const j = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      raw = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        const err = new Error("Generating the plan took too long — try again.");
        (err as Error & { status?: number }).status = 504;
        throw err;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
    const p = parseJsonLoose(raw);
    const dw = (p.driveway ?? null) as Record<string, unknown> | null;
    const layout = {
      title: s(p.title, 80) ?? "Concept layout",
      building: (Array.isArray(p.building) ? p.building : []).map(rect).filter(Boolean).slice(0, 2),
      parking: rect(p.parking),
      driveway: dw && n(dw.x) != null && n(dw.w) ? { x: n(dw.x)!, w: n(dw.w)!, toY: n(dw.toY) ?? 0 } : null,
      entrance: ["front", "left", "right", "rear"].includes(p.entrance as string) ? (p.entrance as string) : "front",
      openSpace: (Array.isArray(p.openSpace) ? p.openSpace : [])
        .map((o) => {
          const r = rect(o);
          return r ? { ...r, label: s((o as Record<string, unknown>).label, 40) ?? "Open space" } : null;
        })
        .filter(Boolean)
        .slice(0, 4),
      rationale: s(p.rationale, 800) ?? "",
      assumptions: (Array.isArray(p.assumptions) ? p.assumptions : []).map((a) => s(a, 240)).filter(Boolean).slice(0, 10),
    };
    if (!layout.building.length) throw new Error("Corvus AI didn't return a usable layout — try again.");
    await logAiCall("schematic_plan", { designRequestId: dr.id, site, program, instruction: body.instruction ?? null }, layout, who.user.id);
    return json({ layout });
  } catch (err) {
    return aiErrorResponse(err, corsHeaders);
  }
});
