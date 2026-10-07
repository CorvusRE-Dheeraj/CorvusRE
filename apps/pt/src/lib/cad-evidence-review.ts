import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";
import { bytesToBase64 } from "./pdf-utils";
import { uploadDocument, notifyDocumentsChanged } from "./documents";
import type { PropertyRecord } from "./properties";
import type { ProtestRecord } from "./protests";
import type {
  CadEvidenceReview,
  CadWeakness,
} from "../../../../supabase/pt/functions/_shared/cad-evidence-review";

export type { CadEvidenceReview, CadWeakness };
export {
  analyzeCadEvidence as analyzeCadEvidencePacket,
  strongestPoints,
  LIMITS as CAD_EVIDENCE_LIMITS,
  type CadEvidenceAnalysis,
  type CompMetrics,
  type HearingPoint,
} from "../../../../supabase/pt/functions/_shared/cad-evidence-analysis";
import {
  sanitizeExtraction,
  type CadExtraction,
} from "../../../../supabase/pt/functions/_shared/cad-evidence-analysis";
export {
  WEAKNESS_LABEL,
  weaknessCounts,
} from "../../../../supabase/pt/functions/_shared/cad-evidence-review";

// The appraisal district's hearing evidence (Tax Code §41.461), read by
// analyze-cad-evidence for its weaknesses and a recommended hearing response.
// One current review per protest (public.cad_evidence_reviews).

export const CAD_EVIDENCE_DOCUMENT_TYPE = "CAD Hearing Evidence";

export type StoredCadEvidenceReview = CadEvidenceReview & {
  protestId: string;
  createdAt: string;
};

type Row = {
  protest_id: string;
  summary: string | null;
  weaknesses: CadWeakness[];
  hearing_response: string | null;
  cad_indicated_value: number | null;
  extraction: CadExtraction | null;
  created_at: string;
};

const fromRow = (r: Row): StoredCadEvidenceReview => ({
  protestId: r.protest_id,
  summary: r.summary ?? "",
  weaknesses: r.weaknesses ?? [],
  hearingResponse: r.hearing_response ?? "",
  cadIndicatedValue: r.cad_indicated_value == null ? null : Number(r.cad_indicated_value),
  extraction: r.extraction ?? sanitizeExtraction(null),
  createdAt: r.created_at,
});

const COLUMNS =
  "protest_id, summary, weaknesses, hearing_response, cad_indicated_value, extraction, created_at";

export async function listCadEvidenceReviews(
  protestIds: string[],
): Promise<Map<string, StoredCadEvidenceReview>> {
  const out = new Map<string, StoredCadEvidenceReview>();
  if (protestIds.length === 0) return out;
  const { data, error } = await supabase
    .from("cad_evidence_reviews")
    .select(COLUMNS)
    .in("protest_id", protestIds);
  if (error) throw error;
  for (const r of (data ?? []) as Row[]) out.set(r.protest_id, fromRow(r));
  return out;
}

// The facts the district's packet is checked against — only what's on file.
export type SubjectFacts = {
  address: string;
  cad: string | null;
  accountNumber: string | null;
  appraisedValue: number | null;
  landValue: number | null;
  improvementValue: number | null;
  buildingSqft: number | null;
  yearBuilt: number | null;
  acres: number | null;
  noi: number | null;
  capRatePct: number | null;
  propertyType: string | null;
  taxYear: number | null;
};

// Uploads the packet to the case's documents, has it analyzed, and saves the review.
export async function analyzeCadEvidence(
  userId: string,
  property: PropertyRecord,
  protest: ProtestRecord,
  files: File[],
  subject: SubjectFacts,
): Promise<StoredCadEvidenceReview> {
  const documents = [];
  const documentIds: string[] = [];
  for (const file of files.slice(0, 3)) {
    const doc = await uploadDocument(userId, property.id, file, CAD_EVIDENCE_DOCUMENT_TYPE);
    documentIds.push(doc.id);
    const mimeType = file.type || "application/pdf";
    documents.push({
      fileName: file.name,
      mimeType,
      dataUrl: `data:${mimeType};base64,${bytesToBase64(new Uint8Array(await file.arrayBuffer()))}`,
    });
  }
  notifyDocumentsChanged();
  const review = await invokeEdgeFunction<CadEvidenceReview>("analyze-cad-evidence", {
    subject,
    documents,
  });
  const { data, error } = await supabase
    .from("cad_evidence_reviews")
    .upsert(
      {
        protest_id: protest.id,
        user_id: userId,
        document_ids: documentIds,
        summary: review.summary,
        weaknesses: review.weaknesses,
        hearing_response: review.hearingResponse,
        cad_indicated_value: review.cadIndicatedValue,
        extraction: review.extraction,
        created_at: new Date().toISOString(),
      },
      { onConflict: "protest_id" },
    )
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return fromRow(data as Row);
}
