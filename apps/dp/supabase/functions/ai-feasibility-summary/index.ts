// Deploy via CLI: `supabase functions deploy ai-feasibility-summary`.
// Requires the GEMINI_API_KEY secret (shared with the other CorvusDP AI
// functions — see supabase/functions/_shared/gemini.ts).
//
// Turns the deterministic permitting analysis already computed client-side
// (src/lib/analysis.ts — zoning, feasibility risks, permit list, complexity,
// site constraints) into a short plain-English narrative. The model never
// invents a permit, a fee, or a risk of its own — it only narrates around
// the real, already-computed facts it's given, same discipline as the
// CorvusPT door's hearing-prep-guide function.
import { PROSE_STYLE, STRUCTURED_BULLET_STYLE } from "../_shared/prose-style.ts";
import { callGemini, parseJsonLoose, str, arr, aiErrorResponse } from "../_shared/gemini.ts";
import { corsHeaders, preflight } from "../_shared/cors.ts";
import { logAiCall } from "../_shared/ai-log.ts";

const SYSTEM = `You are CorvusDP's permitting assistant, explaining a real, already-computed feasibility analysis to the person planning this project. You will be given the real property location, project intent, zoning classification, feasibility status and risks, the identified permits, and site constraints — all already determined by CorvusDP's own analysis engine, never by you.

Rules:
- NEVER invent a permit, an agency, a fee, a code section, or a risk that isn't in the input. Narrate only what's given.
- If zoning wasn't determined (category is "unknown"), say plainly that zoning needs to be confirmed with the local planning department before proceeding — don't guess a classification.
- Ground every sentence in a specific fact from the input (the real zoning code, the real risk titles, the real permit count, the real constraint names).
- Return ONLY a JSON object with this exact shape: {"narrative":<string>,"keyRisks":[<string>,...],"recommendedNextStep":<string>}
  - narrative: 3-5 sentences summarizing feasibility, the zoning fit, and overall complexity.
  - keyRisks: 2-5 short items, each naming one real risk/constraint and its practical consequence. Empty array only if there are truly none in the input.
  - recommendedNextStep: one concrete, specific next action (e.g. which permit to start, or which department to confirm zoning with).

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
      address,
      city,
      county,
      state,
      intent,
      sector,
      zoning,
      feasibility,
      permits,
      complexity,
      constraints,
    } = input ?? {};

    const lines: string[] = [];
    lines.push(
      `Property: ${[address, city, county && `${county} County`, state].filter(Boolean).join(", ") || "address not yet entered"}`,
    );
    if (intent) lines.push(`Project intent: ${intent}`);
    if (sector) lines.push(`Sector: ${sector}`);
    if (zoning?.category) {
      lines.push(
        `Zoning: ${zoning.code || "(no code entered)"} — ${zoning.label} (category: ${zoning.category})`,
      );
    }
    if (feasibility) {
      lines.push(
        `Feasibility status: ${feasibility.status} (confidence ${Math.round((feasibility.confidence ?? 0) * 100)}%) — ${feasibility.summary ?? ""}`,
      );
      if (Array.isArray(feasibility.risks) && feasibility.risks.length > 0) {
        lines.push(
          `Real feasibility risks: ${feasibility.risks
            .map(
              (r: { title?: string; plainLanguage?: string; approval?: string }) =>
                `${r.title} (${r.approval}) — ${r.plainLanguage}`,
            )
            .join(" | ")}`,
        );
      }
    }
    if (Array.isArray(permits) && permits.length > 0) {
      lines.push(
        `Real identified permits (${permits.length}): ${permits
          .slice(0, 20)
          .map((p: { name?: string; category?: string }) => `${p.name} (${p.category})`)
          .join(", ")}`,
      );
    }
    if (complexity) {
      lines.push(
        `Complexity: ${complexity.level}, ~${complexity.estimatedApprovals} approvals, ~${complexity.estimatedReviewCycles} review cycle(s)`,
      );
    }
    if (Array.isArray(constraints?.criticalWarnings) && constraints.criticalWarnings.length > 0) {
      lines.push(`Real critical site-constraint warnings: ${constraints.criticalWarnings.join(" | ")}`);
    }
    if (Array.isArray(constraints?.utilities) && constraints.utilities.length > 0) {
      const constrained = constraints.utilities.filter(
        (u: { status?: string }) => u.status !== "likely_available",
      );
      if (constrained.length > 0) {
        lines.push(
          `Utilities needing verification: ${constrained
            .map((u: { name?: string; status?: string }) => `${u.name} (${u.status})`)
            .join(", ")}`,
        );
      }
    }

    const raw = await callGemini(
      apiKey,
      SYSTEM,
      `${lines.join("\n")}\n\nProduce the JSON feasibility summary.`,
    );
    const parsed = parseJsonLoose(raw);
    const result = {
      narrative: str(parsed.narrative, 900),
      keyRisks: arr(parsed.keyRisks, 220, 6),
      recommendedNextStep: str(parsed.recommendedNextStep, 300),
    };

    await logAiCall("feasibility_summary", input, result);

    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders });
  } catch (err) {
    return aiErrorResponse(err, corsHeaders);
  }
});
