import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";
import { uploadDocument } from "./documents";

// Land Condition (Module 4) "Upload Inspection Report" — see
// supabase/pt/site-reports.sql and the site-report-extract edge function.
// A report is uploaded to Data & Evidence, AI reads all of it and suggests
// findings per land factor (with the page), and the owner confirms, edits or
// rejects each before it counts. Confirmed findings feed the module's factor
// statuses and documentation priority (siteDocumentFindings in loadModule).

export const SITE_REPORT_DOCUMENT_TYPE = "Site: Inspection Report";

// Fired after a report is read or a finding decided, so every panel on screen
// (the module re-renders while a report uploads) shows the latest.
export const SITE_REPORTS_CHANGED = "corvuspt:site-reports-changed";
const changed = () => window.dispatchEvent(new Event(SITE_REPORTS_CHANGED));

export type SiteReport = {
  id: string;
  documentId: string | null;
  fileName: string;
  status: "reading" | "read" | "failed";
  title: string | null;
  reportType: string | null;
  reportDate: string | null;
  pages: number | null;
  summary: string | null;
  unreadable: string | null;
  error: string | null;
  createdAt: string;
};

export type SiteFinding = {
  id: string;
  reportId: string;
  factor: string;
  label: string | null;
  finding: string;
  details: { name: string; value: string }[];
  page: number | null;
  sourceType: string | null;
  confidence: "High" | "Moderate" | "Low";
  needsReview: string | null;
  conflict: string | null;
  matchesRecord: boolean;
  status: "suggested" | "confirmed" | "rejected";
  editedFinding: string | null;
};

type ReportRow = {
  id: string;
  document_id: string | null;
  file_name: string;
  status: SiteReport["status"];
  title: string | null;
  report_type: string | null;
  report_date: string | null;
  pages: number | null;
  summary: string | null;
  unreadable: string | null;
  error: string | null;
  created_at: string;
};
type FindingRow = {
  id: string;
  report_id: string;
  factor: string;
  label: string | null;
  finding: string;
  details: { name: string; value: string }[] | null;
  page: number | null;
  source_type: string | null;
  confidence: SiteFinding["confidence"];
  needs_review: string | null;
  conflict: string | null;
  matches_record: boolean;
  status: SiteFinding["status"];
  edited_finding: string | null;
};

const REPORT_COLS =
  "id, document_id, file_name, status, title, report_type, report_date, pages, summary, unreadable, error, created_at";
const FINDING_COLS =
  "id, report_id, factor, label, finding, details, page, source_type, confidence, needs_review, conflict, matches_record, status, edited_finding";

const toReport = (r: ReportRow): SiteReport => ({
  id: r.id,
  documentId: r.document_id,
  fileName: r.file_name,
  status: r.status,
  title: r.title,
  reportType: r.report_type,
  reportDate: r.report_date,
  pages: r.pages,
  summary: r.summary,
  unreadable: r.unreadable,
  error: r.error,
  createdAt: r.created_at,
});
const toFinding = (r: FindingRow): SiteFinding => ({
  id: r.id,
  reportId: r.report_id,
  factor: r.factor,
  label: r.label,
  finding: r.finding,
  details: Array.isArray(r.details) ? r.details : [],
  page: r.page,
  sourceType: r.source_type,
  confidence: r.confidence,
  needsReview: r.needs_review,
  conflict: r.conflict,
  matchesRecord: r.matches_record,
  status: r.status,
  editedFinding: r.edited_finding,
});

export async function listSiteReports(
  propertyId: string,
): Promise<{ reports: SiteReport[]; findings: SiteFinding[] }> {
  const [reports, findings] = await Promise.all([
    supabase
      .from("site_reports")
      .select(REPORT_COLS)
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false }),
    supabase
      .from("site_report_findings")
      .select(FINDING_COLS)
      .eq("property_id", propertyId)
      .order("created_at", { ascending: true }),
  ]);
  if (reports.error) throw reports.error;
  if (findings.error) throw findings.error;
  return {
    reports: (reports.data as ReportRow[]).map(toReport),
    findings: (findings.data as FindingRow[]).map(toFinding),
  };
}

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type SiteReportFacts = {
  address?: string | null;
  cad?: string | null;
  floodZone?: string | null;
  elevationFt?: number | null;
  acres?: number | null;
  nearestHighwayMi?: number | null;
  nearestRailMi?: number | null;
};

/**
 * Uploads a report to Data & Evidence and has AI read it. The same file
 * uploaded again is recognised by its content and not read twice.
 */
export async function uploadSiteReport(args: {
  userId: string;
  propertyId: string;
  file: File;
  facts: SiteReportFacts;
}): Promise<{ duplicateOf?: SiteReport; found?: number; added?: number }> {
  const { userId, propertyId, file, facts } = args;
  const hash = await sha256Hex(file);
  const { data: same } = await supabase
    .from("site_reports")
    .select(REPORT_COLS)
    .eq("property_id", propertyId)
    .eq("content_hash", hash)
    .maybeSingle();
  if (same && (same as ReportRow).status !== "failed") {
    return { duplicateOf: toReport(same as ReportRow) };
  }
  let reportId = (same as ReportRow | null)?.id ?? null;
  if (!reportId) {
    const doc = await uploadDocument(userId, propertyId, file, SITE_REPORT_DOCUMENT_TYPE);
    const { data, error } = await supabase
      .from("site_reports")
      .insert({
        property_id: propertyId,
        document_id: doc.id,
        file_name: file.name,
        content_hash: hash,
      })
      .select("id")
      .single();
    if (error) throw error;
    reportId = (data as { id: string }).id;
  } else {
    await supabase
      .from("site_reports")
      .update({ status: "reading", error: null })
      .eq("id", reportId);
  }
  try {
    return await invokeEdgeFunction<{ found: number; added: number }>("site-report-extract", {
      reportId,
      facts,
    });
  } finally {
    changed();
  }
}

/** Re-reads a report whose reading failed. */
export async function retrySiteReport(reportId: string, facts: SiteReportFacts) {
  await supabase.from("site_reports").update({ status: "reading", error: null }).eq("id", reportId);
  try {
    return await invokeEdgeFunction<{ found: number; added: number }>("site-report-extract", {
      reportId,
      facts,
    });
  } finally {
    changed();
  }
}

export async function decideSiteFinding(
  id: string,
  status: SiteFinding["status"],
  editedFinding?: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (editedFinding !== undefined) patch.edited_finding = editedFinding?.trim() || null;
  const { error } = await supabase.from("site_report_findings").update(patch).eq("id", id);
  if (error) throw error;
  changed();
}

/** The text a finding stands for: the owner's own wording when they edited it. */
export const findingText = (f: SiteFinding) => f.editedFinding ?? f.finding;

/** Confirmed findings, in the shape the Land Condition module's AI input takes. */
export function confirmedForModule(
  findings: SiteFinding[],
  reports: SiteReport[],
): { factor: string; finding: string; source: string }[] {
  const byId = new Map(reports.map((r) => [r.id, r]));
  return findings
    .filter((f) => f.status === "confirmed")
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((f) => {
      const r = byId.get(f.reportId);
      const name = r?.title || r?.fileName || "uploaded report";
      return {
        factor: f.factor,
        finding: findingText(f),
        source: `${name}${f.page ? `, p. ${f.page}` : ""}`,
      };
    });
}
