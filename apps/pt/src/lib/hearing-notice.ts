import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";
import { bytesToBase64 } from "./pdf-utils";
import type { PropertyRecord } from "./properties";
import type { CountyProtestInfo } from "./county-protest-info";

// Real, AI-extracted content from an actual hearing notice the user
// uploads once their case is filed — see extract-hearing-notice/index.ts
// for the prompt/discipline. hearingMode is the fixed 5-value enum the UI
// renders; discrepancies is computed server-side (deterministic string
// comparison against the case's own known facts), never just the model's
// own say-so.
export type HearingMode = "In Person" | "Phone" | "Videoconference" | "Affidavit" | "Unknown";

export type HearingNoticeExtraction = {
  hearingDate: string | null;
  hearingTime: string | null;
  hearingLocation: string | null;
  hearingMode: HearingMode;
  evidenceSubmissionDeadline: string | null;
  hearingType: string | null;
  accountNumber: string | null;
  taxYear: string | null;
  propertyAddress: string | null;
  countyContact: string | null;
  appraiserContact: string | null;
  submissionInstructions: string | null;
  requiredDocuments: string[];
  appealDeadline: string | null;
  discrepancies: string[];
  informalReviewAvailable: "Yes" | "No" | "Unclear";
  proceduralDifferences: string;
};

export type HearingNoticeRecord = HearingNoticeExtraction & {
  id: string;
  protestId: string;
  documentId: string | null;
  createdAt: string;
};

async function fileToDataUrl(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}

// Real case facts, threaded through so the edge function can flag a
// genuine discrepancy (never fabricated — see its own deterministic
// comparison) and inform its informalReviewAvailable read. Never the
// source of the extracted fields themselves, which come only from the
// document.
export async function extractHearingNotice(
  property: PropertyRecord,
  file: File,
  countyInfo: CountyProtestInfo | null,
): Promise<HearingNoticeExtraction> {
  const dataUrl = await fileToDataUrl(file);
  return invokeEdgeFunction<HearingNoticeExtraction>("extract-hearing-notice", {
    caseContext: {
      address: property.address,
      cad: property.cad,
      accountNumber: property.accountNumber,
      taxYear: property.taxYear,
    },
    countyReference: countyInfo
      ? { informalReview: countyInfo.informalReview, arbContact: countyInfo.arbContact }
      : null,
    documents: [
      { fileName: file.name, mimeType: file.type || "application/octet-stream", dataUrl },
    ],
  });
}

type HearingNoticeRow = {
  id: string;
  protest_id: string;
  document_id: string | null;
  hearing_date: string | null;
  hearing_time: string | null;
  hearing_location: string | null;
  hearing_mode: string | null;
  evidence_submission_deadline: string | null;
  hearing_type: string | null;
  extracted_account_number: string | null;
  extracted_tax_year: string | null;
  extracted_property_address: string | null;
  county_contact: string | null;
  appraiser_contact: string | null;
  submission_instructions: string | null;
  required_documents: string | null;
  appeal_deadline: string | null;
  discrepancies: string | null;
  informal_review_available: string | null;
  informal_review_notes: string | null;
  created_at: string;
};

function fromRow(row: HearingNoticeRow): HearingNoticeRecord {
  const parseArray = (v: string | null): string[] => {
    if (!v) return [];
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  };
  return {
    id: row.id,
    protestId: row.protest_id,
    documentId: row.document_id,
    hearingDate: row.hearing_date,
    hearingTime: row.hearing_time,
    hearingLocation: row.hearing_location,
    hearingMode: (row.hearing_mode as HearingMode) ?? "Unknown",
    evidenceSubmissionDeadline: row.evidence_submission_deadline,
    hearingType: row.hearing_type,
    accountNumber: row.extracted_account_number,
    taxYear: row.extracted_tax_year,
    propertyAddress: row.extracted_property_address,
    countyContact: row.county_contact,
    appraiserContact: row.appraiser_contact,
    submissionInstructions: row.submission_instructions,
    requiredDocuments: parseArray(row.required_documents),
    appealDeadline: row.appeal_deadline,
    discrepancies: parseArray(row.discrepancies),
    informalReviewAvailable:
      (row.informal_review_available as "Yes" | "No" | "Unclear") ?? "Unclear",
    proceduralDifferences: row.informal_review_notes ?? "",
    createdAt: row.created_at,
  };
}

export async function saveHearingNotice(
  userId: string,
  protestId: string,
  documentId: string | null,
  extraction: HearingNoticeExtraction,
): Promise<HearingNoticeRecord> {
  const { data, error } = await supabase
    .from("hearing_notices")
    .insert({
      protest_id: protestId,
      user_id: userId,
      document_id: documentId,
      hearing_date: extraction.hearingDate,
      hearing_time: extraction.hearingTime,
      hearing_location: extraction.hearingLocation,
      hearing_mode: extraction.hearingMode,
      evidence_submission_deadline: extraction.evidenceSubmissionDeadline,
      hearing_type: extraction.hearingType,
      extracted_account_number: extraction.accountNumber,
      extracted_tax_year: extraction.taxYear,
      extracted_property_address: extraction.propertyAddress,
      county_contact: extraction.countyContact,
      appraiser_contact: extraction.appraiserContact,
      submission_instructions: extraction.submissionInstructions,
      required_documents: JSON.stringify(extraction.requiredDocuments),
      appeal_deadline: extraction.appealDeadline,
      discrepancies: JSON.stringify(extraction.discrepancies),
      informal_review_available: extraction.informalReviewAvailable,
      informal_review_notes: extraction.proceduralDifferences,
    })
    .select()
    .single();
  if (error) throw error;
  return fromRow(data as HearingNoticeRow);
}

// Most recent notice on file for this case — a case can genuinely receive
// more than one real notice over its life (an initial one, then a
// rescheduled one), and the latest is what the UI shows.
export async function getLatestHearingNotice(
  protestId: string,
): Promise<HearingNoticeRecord | null> {
  const { data, error } = await supabase
    .from("hearing_notices")
    .select("*")
    .eq("protest_id", protestId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? fromRow(data as HearingNoticeRow) : null;
}
