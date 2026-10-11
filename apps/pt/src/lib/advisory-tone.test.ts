import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADVISORY_TONE,
  directivePhrases,
  withAdvisoryTone,
} from "../../../../supabase/pt/functions/_shared/advisory-tone";
import { OFFER_LABEL, VERDICT_LABEL } from "./decision-card";
import { RECOMMENDED_ACTION_LABEL } from "./ai-report-modules";

// Texas licenses property tax consulting (Occupations Code ch. 1152): Corvus
// presents analysis and options, and the owner decides. These guard the
// customer-facing wording against directive phrasing creeping back in.

const CUSTOMER_COPY = [
  "src/lib/protest-intelligence.ts",
  "src/lib/decision-card.ts",
  "src/lib/post-hearing.ts",
  "src/lib/case-pipeline.ts",
  "src/lib/escalation-eval.ts",
  "src/components/ProtestIntelligenceCard.tsx",
  "src/components/PostHearingDecision.tsx",
  "src/components/CasePipeline.tsx",
  "../../supabase/pt/functions/_shared/cad-evidence-analysis.ts",
];

// The text inside string and template literals — the words a customer sees.
const literals = (src: string) =>
  [...src.matchAll(/"([^"\n]*)"|`([^`]*)`/g)].map((m) => m[1] ?? m[2] ?? "");

describe("advisory tone", () => {
  it("appends the analysis-not-advice rules to every system prompt", () => {
    const p = withAdvisoryTone("You are CorvusPT's analyst.");
    expect(p.startsWith("You are CorvusPT's analyst.")).toBe(true);
    expect(p).toContain(ADVISORY_TONE);
    expect(ADVISORY_TONE).toContain("Occupations Code ch. 1152");
    expect(ADVISORY_TONE).toContain("Corvus AI estimates $3.6M as a potential value to consider");
  });

  it("flags directive phrasing", () => {
    expect(directivePhrases("You should protest this year.")).not.toHaveLength(0);
    expect(directivePhrases("Accept $6.9M or lower")).not.toHaveLength(0);
    expect(directivePhrases("Above $7.8M: decline and go to the ARB.")).not.toHaveLength(0);
    expect(
      directivePhrases("Corvus AI identifies this as a potential protest opportunity."),
    ).toHaveLength(0);
  });

  it.each(CUSTOMER_COPY)("%s has no directive wording", (file) => {
    const src = readFileSync(resolve(__dirname, "../..", file), "utf8");
    const hits = literals(src).flatMap((t) => directivePhrases(t).map((p) => `${p}: ${t}`));
    expect(hits).toEqual([]);
  });

  it("labels verdicts, offers and report actions as analysis", () => {
    for (const label of [
      ...Object.values(VERDICT_LABEL),
      ...Object.values(OFFER_LABEL),
      ...Object.values(RECOMMENDED_ACTION_LABEL),
    ]) {
      expect(directivePhrases(label)).toEqual([]);
      expect(label).not.toMatch(/^(Proceed|Accept|Reject|Protest)\b/);
    }
  });
});
