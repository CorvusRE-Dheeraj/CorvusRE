import { invokeEdgeFunction } from "./edge-functions";

export type EvidenceLinkResult = {
  accepted: boolean;
  reason: string;
  summary: string;
};

// Module 1's "Add Information Link" — see
// supabase/functions/analyze-evidence-link/index.ts for the real fetch +
// Gemini review this calls. Never throws on a rejected link (that's a normal
// outcome, not an error) — only on a genuine failure to reach the function.
export async function analyzeEvidenceLink(opts: {
  url: string;
  missingItem: string;
  propertyAddress?: string | null;
  taxYear?: number | null;
}): Promise<EvidenceLinkResult> {
  return invokeEdgeFunction<EvidenceLinkResult>("analyze-evidence-link", opts);
}
