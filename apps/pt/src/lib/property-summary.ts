import { invokeEdgeFunction } from "./edge-functions";
import { buildTextPdf } from "./pdf-text";

// One AI-written property profile for the whole report (not per-module) —
// restates the REAL property record and whatever real analysis has already
// run, grounded only in given data. See
// supabase/functions/generate-property-summary for the actual prompt.
export const PROPERTY_SUMMARY_DOCUMENT_TYPE = "AI Property Summary";

export type PropertySummary = { title: string; markdown: string };

export async function generatePropertySummary(
  property: {
    address?: string | null;
    cad?: string | null;
    ownerName?: string | null;
    accountNumber?: string | null;
    propertyType?: string | null;
    landValue?: number | null;
    improvementValue?: number | null;
    totalValue?: number | null;
    taxYear?: number | null;
    valueHistory?: { year: number; total: number }[] | null;
  },
  analysis: {
    healthScore?: number | null;
    healthConclusion?: string | null;
    strategyRecommendation?: string | null;
    compsCount?: number | null;
    estimatedSavings?: number | null;
  },
): Promise<PropertySummary> {
  const result = await invokeEdgeFunction<PropertySummary>("generate-property-summary", {
    property,
    analysis,
  });
  return {
    title: result.title || `${property.address ?? "Property"} — Property Summary`,
    markdown: result.markdown || "",
  };
}

export async function buildPropertySummaryFile(summary: PropertySummary): Promise<File> {
  const bytes = await buildTextPdf(summary.title, summary.markdown);
  const safe =
    summary.title
      .replace(/[^\w\- ]+/g, "")
      .trim()
      .slice(0, 60) || "property-summary";
  return new File([bytes as BlobPart], `${safe}.pdf`, { type: "application/pdf" });
}
