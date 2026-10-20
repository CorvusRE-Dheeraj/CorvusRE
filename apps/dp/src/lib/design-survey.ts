// The land survey attached to a design request: one PNG, JPEG or PDF (up to
// 15 MB) in the private "design-surveys" bucket under
// <user id>/<design request id>/…, with its name/type/size on the request.
// The bucket itself enforces the same types and size (design-survey.sql).
import { supabase } from "./supabase";
import { storageSafeName } from "./storage-key";
import type { DesignRequestRow } from "./design-requests";

export const SURVEY_BUCKET = "design-surveys";
export const SURVEY_MAX_BYTES = 15 * 1024 * 1024;
export const SURVEY_TYPES: Record<string, string> = {
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "application/pdf": "PDF",
};
export const SURVEY_ACCEPT = ".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf";

/** The file's real type: browsers sometimes leave `type` empty, so fall back to the extension. */
export function surveyMime(file: { name: string; type: string }): string | null {
  if (SURVEY_TYPES[file.type]) return file.type;
  const ext = file.name.toLowerCase().split(".").pop();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "pdf") return "application/pdf";
  return null;
}

/** Why a file can't be used as a survey, or null when it can. */
export function surveyFileProblem(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  if (!surveyMime(file)) return "Upload the survey as a PNG, JPG/JPEG or PDF file.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > SURVEY_MAX_BYTES)
    return `That file is ${formatBytes(file.size)} — the limit is 15 MB. Export a smaller PDF or image.`;
  return null;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export type SurveyFields = Pick<
  DesignRequestRow,
  "survey_path" | "survey_name" | "survey_type" | "survey_size" | "survey_uploaded_at"
>;

/** Uploads (or replaces) the request's survey and records it on the request. */
export async function uploadSurvey(
  dr: Pick<DesignRequestRow, "id" | "survey_path">,
  userId: string,
  file: File,
): Promise<SurveyFields> {
  const problem = surveyFileProblem(file);
  if (problem) throw new Error(problem);
  const mime = surveyMime(file)!;
  const path = `${userId}/${dr.id}/${Date.now()}-${storageSafeName(file.name)}`;
  const { error: upErr } = await supabase.storage
    .from(SURVEY_BUCKET)
    .upload(path, file, { contentType: mime, upsert: false });
  if (upErr) throw upErr;
  const fields: SurveyFields = {
    survey_path: path,
    survey_name: file.name,
    survey_type: mime,
    survey_size: file.size,
    survey_uploaded_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("design_requests").update(fields).eq("id", dr.id);
  if (error) {
    await supabase.storage.from(SURVEY_BUCKET).remove([path]);
    throw error;
  }
  // the previous file is replaced, not kept
  if (dr.survey_path && dr.survey_path !== path)
    await supabase.storage.from(SURVEY_BUCKET).remove([dr.survey_path]);
  return fields;
}

export async function removeSurvey(dr: Pick<DesignRequestRow, "id" | "survey_path">) {
  const { error } = await supabase
    .from("design_requests")
    .update({
      survey_path: null,
      survey_name: null,
      survey_type: null,
      survey_size: null,
      survey_uploaded_at: null,
    })
    .eq("id", dr.id);
  if (error) throw error;
  if (dr.survey_path) await supabase.storage.from(SURVEY_BUCKET).remove([dr.survey_path]);
}

/** A short-lived link to view or download the survey. */
export async function surveyUrl(path: string, download?: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(SURVEY_BUCKET)
    .createSignedUrl(path, 600, download ? { download } : undefined);
  if (error || !data) throw error ?? new Error("Couldn't open the survey.");
  return data.signedUrl;
}
