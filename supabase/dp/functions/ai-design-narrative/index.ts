// Deploy via CLI: `supabase functions deploy ai-design-narrative`.
// Requires the GEMINI_API_KEY secret.
//
// Turns the deterministic design brief already computed client-side
// (src/lib/design.ts — inclusions, space plan, timeline, budget, cost
// drivers) into a short written scope narrative an architect or the client
// could read as-is. Never invents a discipline, a budget figure, or a
// timeline number of its own — only narrates the real, already-computed
// brief it's given.
import { PROSE_STYLE, STRUCTURED_BULLET_STYLE } from "../_shared/prose-style.ts";
import { callGemini, parseJsonLoose, str, arr, aiErrorResponse } from "../_shared/gemini.ts";
import { corsHeaders, preflight } from "../_shared/cors.ts";
import { logAiCall } from "../_shared/ai-log.ts";

const SYSTEM = `You are CorvusDP's design assistant, writing a short scope narrative from a real, already-computed design brief. You will be given the real project scope/sector/size, the real disciplines included, the real timeline, and the real budget range — all already determined by CorvusDP's own brief generator, never by you.

Rules:
- NEVER invent a discipline, a budget number, a timeline figure, or a deliverable that isn't in the input. Narrate only what's given.
- Ground every sentence in a specific fact from the input (the real building area, the real disciplines listed, the real budget range, the real functional/special requirements text if given).
- Return ONLY a JSON object with this exact shape: {"scopeSummary":<string>,"narrative":<string>,"designConsiderations":[<string>,...]}
  - scopeSummary: one sentence naming the project type, size, and sector.
  - narrative: 3-5 sentences describing what the design brief covers and how the disciplines fit together for this specific project.
  - designConsiderations: 2-5 short items — real, concrete considerations this project's stated requirements raise (e.g. from functionalRequirements/specialRequirements text), not generic design advice. Empty array only if there's truly nothing specific to flag.

${PROSE_STYLE}

${STRUCTURED_BULLET_STYLE}`;

Deno.serve(async (req: Request) => {
  const pf = preflight(req);
  if (pf) return pf;

  try {
    const input = await req.json();
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

    const {
      scope,
      sector,
      approxSiteArea,
      buildingArea,
      floors,
      rooms,
      functionalRequirements,
      specialRequirements,
      inclusions,
      budgetLow,
      budgetHigh,
      timelineWeeksMin,
      timelineWeeksMax,
      costDrivers,
    } = input ?? {};

    const lines: string[] = [];
    if (scope) lines.push(`Project scope: ${scope}`);
    if (sector) lines.push(`Sector: ${sector}`);
    if (buildingArea) lines.push(`Building area: ${buildingArea}`);
    if (approxSiteArea) lines.push(`Site area: ${approxSiteArea}`);
    if (floors) lines.push(`Floors: ${floors}`);
    if (rooms) lines.push(`Rooms / units: ${rooms}`);
    if (functionalRequirements) lines.push(`Functional requirements: ${functionalRequirements}`);
    if (specialRequirements) lines.push(`Special requirements: ${specialRequirements}`);
    if (Array.isArray(inclusions) && inclusions.length > 0) {
      lines.push(
        `Real design-brief inclusions: ${inclusions
          .map((i: { title?: string; detail?: string }) => i.title)
          .filter(Boolean)
          .join(", ")}`,
      );
    }
    if (budgetLow != null && budgetHigh != null) {
      lines.push(`Real design-fee budget range: $${budgetLow}–$${budgetHigh}`);
    }
    if (timelineWeeksMin != null && timelineWeeksMax != null) {
      lines.push(`Real timeline: ${timelineWeeksMin}–${timelineWeeksMax} weeks`);
    }
    if (Array.isArray(costDrivers) && costDrivers.length > 0) {
      lines.push(`Real cost drivers: ${costDrivers.join("; ")}`);
    }
    if (lines.length === 0) lines.push("No design inputs provided yet.");

    const raw = await callGemini(
      apiKey,
      SYSTEM,
      `${lines.join("\n")}\n\nProduce the JSON design narrative.`,
    );
    const parsed = parseJsonLoose(raw);
    const result = {
      scopeSummary: str(parsed.scopeSummary, 220),
      narrative: str(parsed.narrative, 900),
      designConsiderations: arr(parsed.designConsiderations, 220, 5),
    };

    await logAiCall("design_narrative", input, result);

    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders });
  } catch (err) {
    return aiErrorResponse(err, corsHeaders);
  }
});
