// Design & Code Compliance Checker — client side. A pre-submission quality
// check of a project's drawing set (see supabase/dp/compliance-checker.sql for
// the flow); the AI work happens in the compliance-check Edge Function.
import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";
import { storageSafeName } from "./storage-key";
import { parseDxf, isBinaryDxf, type DxfSummary } from "./dxf";

export type Discipline =
  "architectural" | "civil" | "structural" | "mep" | "fire" | "survey" | "landscape" | "other";

export const DISCIPLINES: { id: Discipline; label: string; category: string }[] = [
  { id: "architectural", label: "Architectural", category: "Architectural" },
  { id: "civil", label: "Civil", category: "Site / Civil" },
  { id: "structural", label: "Structural", category: "Structural" },
  { id: "mep", label: "MEP", category: "MEP" },
  { id: "fire", label: "Fire Protection", category: "Fire Protection" },
  { id: "survey", label: "Survey", category: "Survey" },
  { id: "landscape", label: "Landscape", category: "Supporting" },
  { id: "other", label: "Supporting", category: "Supporting" },
];

export const disciplineLabel = (d: string | null | undefined) =>
  DISCIPLINES.find((x) => x.id === d)?.label ?? "Supporting";

export type ComplianceArea =
  "zoning" | "building_fire" | "civil" | "mep" | "accessibility" | "state" | "plat";

export const AREAS: { id: ComplianceArea; label: string }[] = [
  { id: "zoning", label: "Zoning & UDC" },
  { id: "building_fire", label: "Building & fire codes" },
  { id: "civil", label: "Civil & infrastructure" },
  { id: "mep", label: "Mechanical, electrical & plumbing" },
  { id: "accessibility", label: "Accessibility (ADA / TAS)" },
  { id: "state", label: "State requirements" },
  { id: "plat", label: "Plats & special conditions" },
];

export const areaLabel = (a: string) => AREAS.find((x) => x.id === a)?.label ?? a;

// The measurable values the checks rely on. Same keys as VALUE_KEYS in
// supabase/dp/functions/compliance-check/index.ts — keep the two in step.
export type ValueDef = {
  key: string;
  label: string;
  unit: string;
  group: string;
  daycare?: boolean;
};
export const VALUE_DEFS: ValueDef[] = [
  { key: "lot_area", label: "Lot area", unit: "sf", group: "Site & zoning" },
  { key: "building_footprint", label: "Building footprint", unit: "sf", group: "Site & zoning" },
  { key: "gross_floor_area", label: "Gross floor area", unit: "sf", group: "Site & zoning" },
  { key: "building_height", label: "Building height", unit: "ft", group: "Site & zoning" },
  { key: "stories", label: "Stories", unit: "", group: "Site & zoning" },
  { key: "lot_coverage", label: "Lot coverage", unit: "%", group: "Site & zoning" },
  { key: "far", label: "Floor area ratio", unit: "", group: "Site & zoning" },
  { key: "setback_front", label: "Front setback", unit: "ft", group: "Site & zoning" },
  { key: "setback_rear", label: "Rear setback", unit: "ft", group: "Site & zoning" },
  { key: "setback_side_left", label: "Side setback (left)", unit: "ft", group: "Site & zoning" },
  { key: "setback_side_right", label: "Side setback (right)", unit: "ft", group: "Site & zoning" },
  { key: "parking_spaces", label: "Parking spaces", unit: "", group: "Site & zoning" },
  { key: "landscape_area", label: "Landscape area", unit: "sf", group: "Site & zoning" },
  { key: "impervious_cover", label: "Impervious cover", unit: "%", group: "Civil" },
  { key: "fire_lane_width", label: "Fire lane width", unit: "ft", group: "Civil" },
  { key: "hydrant_distance", label: "Distance to nearest hydrant", unit: "ft", group: "Civil" },
  { key: "occupancy_group", label: "Occupancy group", unit: "", group: "Building & fire" },
  { key: "construction_type", label: "Construction type", unit: "", group: "Building & fire" },
  { key: "sprinklered", label: "Sprinklered", unit: "", group: "Building & fire" },
  { key: "occupant_load", label: "Occupant load", unit: "", group: "Building & fire" },
  { key: "exits", label: "Number of exits", unit: "", group: "Building & fire" },
  {
    key: "travel_distance",
    label: "Max exit travel distance",
    unit: "ft",
    group: "Building & fire",
  },
  { key: "corridor_width", label: "Min corridor width", unit: "in", group: "Building & fire" },
  {
    key: "accessible_parking",
    label: "Accessible parking spaces",
    unit: "",
    group: "Accessibility",
  },
  { key: "door_clear_width", label: "Min door clear width", unit: "in", group: "Accessibility" },
  { key: "accessible_restrooms", label: "Accessible restrooms", unit: "", group: "Accessibility" },
  { key: "electrical_service", label: "Electrical service", unit: "A", group: "MEP" },
  { key: "water_meter", label: "Water meter size", unit: "in", group: "MEP" },
  { key: "plumbing_fixtures", label: "Plumbing fixture count", unit: "", group: "MEP" },
  {
    key: "licensed_capacity",
    label: "Licensed child capacity",
    unit: "",
    group: "Daycare",
    daycare: true,
  },
  {
    key: "outdoor_play_area",
    label: "Outdoor play area",
    unit: "sf",
    group: "Daycare",
    daycare: true,
  },
  {
    key: "indoor_activity_area",
    label: "Indoor activity space",
    unit: "sf",
    group: "Daycare",
    daycare: true,
  },
];

export const isDaycare = (p: {
  proposed_use?: string | null;
  sector_subcategory?: string | null;
  intent?: string | null;
}) =>
  /day\s*care|child\s*care|daycare|pre-?school|early\s+learning/i.test(
    `${p.proposed_use ?? ""} ${p.sector_subcategory ?? ""} ${p.intent ?? ""}`,
  );

export type Confidence = "high" | "medium" | "low";
// annotation = printed on the drawing (dimension string, schedule, note);
// derived = calculated from other printed values; geometry = measured from a
// DXF's real geometry. Never "scaled off a PDF" — the AI isn't allowed to.
export type ValueBasis = "annotation" | "derived" | "geometry";

export type ExtractedValue = {
  key: string;
  value: string;
  unit: string | null;
  page: number | null;
  sheet: string | null;
  source: string | null;
  basis: ValueBasis;
  confidence: Confidence;
};

export type SheetInfo = {
  page: number;
  number: string | null;
  title: string | null;
  discipline: Discipline;
  scale: string | null;
  scaleBar: boolean;
  scaleIssue: string | null;
  schedules: string[];
  rooms: string[];
  dimensions: string[];
  equipment: string[];
  references: string[];
};

export type DrawingIndex = {
  quality: "clear" | "partly_readable" | "unreadable";
  pageCount: number | null;
  sheets: SheetInfo[];
  values: ExtractedValue[];
  flags: { field: string; issue: string }[];
};

export type ComplianceDoc = {
  id: string;
  project_id: string;
  name: string;
  category: string;
  storage_path: string | null;
  note: string | null;
  discipline: Discipline | null;
  mime_type: string | null;
  size_bytes: number | null;
  page_count: number | null;
  cad_summary: (DxfSummary | { format: "dwg"; warnings: string[] }) | null;
  drawing_index: DrawingIndex | null;
  drawing_read_at: string | null;
  drawing_read_error: string | null;
  created_at: string;
};

export type Consultant = {
  id: string;
  project_id: string;
  discipline: Discipline;
  firm: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
};

export type ConfirmedValue = {
  id: string;
  key: string;
  value: string | null;
  unit: string | null;
  status: "confirmed" | "corrected" | "not_applicable";
  consultant_id: string | null;
  note: string | null;
  updated_at: string;
};

export type ComplianceReview = {
  id: string;
  status: "running" | "done" | "failed";
  stage: string | null;
  document_ids: string[];
  summary: {
    overview?: string;
    counts?: Record<string, number>;
    missing?: string[];
    codeBasis?: string;
  } | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
};

export type IssueStatus = "open" | "in_progress" | "fixed" | "not_an_issue";
export type ComplianceIssue = {
  id: string;
  review_id: string;
  area: ComplianceArea;
  discipline: Discipline;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  requirement: string | null;
  code_reference: string | null;
  code_source: "ai" | "icc" | "city";
  document_id: string | null;
  sheet: string | null;
  location: string | null;
  problem: string | null;
  suggested_fix: string | null;
  confidence: Confidence;
  needs_confirmation: boolean;
  consultant_id: string | null;
  status: IssueStatus;
  note: string | null;
};

// ── files ──────────────────────────────────────────────────────────────────
export const ACCEPTED_DRAWINGS = ".pdf,.dxf,.dwg,application/pdf";
export const MAX_DRAWING_BYTES = 100 * 1024 * 1024;

export function drawingKind(name: string, type: string): "pdf" | "dxf" | "dwg" | null {
  const ext = name.toLowerCase().split(".").pop();
  if (type === "application/pdf" || ext === "pdf") return "pdf";
  if (ext === "dxf") return "dxf";
  if (ext === "dwg") return "dwg";
  return null;
}

// Page count from the PDF's own page objects — good enough to show "24 sheets"
// right after upload; the AI reading reports the authoritative count.
export function countPdfPages(bytes: Uint8Array): number | null {
  const text = new TextDecoder("latin1").decode(bytes);
  const n = (text.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
  return n > 0 ? n : null;
}

export async function listComplianceDocs(projectId: string): Promise<ComplianceDoc[]> {
  const { data, error } = await supabase
    .from("project_documents")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as ComplianceDoc[]).filter(
    (d) => d.discipline || /\.(pdf|dxf|dwg)$/i.test(d.storage_path ?? ""),
  );
}

export async function uploadDrawing(input: {
  userId: string;
  projectId: string;
  file: File;
  discipline: Discipline;
}): Promise<void> {
  const { file } = input;
  const kind = drawingKind(file.name, file.type);
  if (!kind) throw new Error(`${file.name}: upload a PDF, DXF or DWG file.`);
  if (file.size > MAX_DRAWING_BYTES) throw new Error(`${file.name} is over 100 MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let pageCount: number | null = null;
  let cadSummary: ComplianceDoc["cad_summary"] = null;
  if (kind === "pdf") pageCount = countPdfPages(bytes);
  if (kind === "dxf") {
    const text = new TextDecoder().decode(bytes);
    if (isBinaryDxf(text.slice(0, 32)))
      throw new Error(
        `${file.name} is a binary DXF — export it as an ASCII DXF (or PDF) and upload that.`,
      );
    cadSummary = parseDxf(text);
  }
  if (kind === "dwg")
    cadSummary = {
      format: "dwg",
      warnings: [
        "DWG files are stored but can't be read yet — export the sheets as DXF or PDF so they can be checked.",
      ],
    };
  const path = `${input.userId}/${input.projectId}/${Date.now()}-${storageSafeName(file.name)}`;
  const { error: upErr } = await supabase.storage.from("project-docs").upload(path, file, {
    contentType: kind === "pdf" ? "application/pdf" : "application/octet-stream",
  });
  if (upErr) throw upErr;
  const category = DISCIPLINES.find((d) => d.id === input.discipline)?.category ?? "General";
  const { error } = await supabase.from("project_documents").insert({
    project_id: input.projectId,
    name: file.name,
    category,
    storage_path: path,
    discipline: input.discipline,
    mime_type:
      kind === "pdf" ? "application/pdf" : kind === "dxf" ? "image/vnd.dxf" : "image/vnd.dwg",
    size_bytes: file.size,
    page_count: pageCount,
    cad_summary: cadSummary,
  });
  if (error) throw error;
}

export async function setDocDiscipline(id: string, discipline: Discipline): Promise<void> {
  const category = DISCIPLINES.find((d) => d.id === discipline)?.category ?? "General";
  const { error } = await supabase
    .from("project_documents")
    .update({ discipline, category })
    .eq("id", id);
  if (error) throw error;
}

export function readDrawing(documentId: string): Promise<{ drawingIndex: DrawingIndex }> {
  return invokeEdgeFunction("compliance-check", { action: "read", documentId });
}

// ── consultants ────────────────────────────────────────────────────────────
export async function listConsultants(projectId: string): Promise<Consultant[]> {
  const { data, error } = await supabase
    .from("project_consultants")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Consultant[];
}

export async function addConsultant(input: Omit<Consultant, "id">): Promise<Consultant> {
  const { data, error } = await supabase
    .from("project_consultants")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  // open, unassigned issues of that discipline go to the new consultant
  await supabase
    .from("compliance_issues")
    .update({ consultant_id: data.id, updated_at: new Date().toISOString() })
    .eq("project_id", input.project_id)
    .eq("discipline", input.discipline)
    .is("consultant_id", null)
    .in("status", ["open", "in_progress"]);
  return data as Consultant;
}

export async function deleteConsultant(id: string): Promise<void> {
  const { error } = await supabase.from("project_consultants").delete().eq("id", id);
  if (error) throw error;
}

export const consultantName = (c: Consultant) =>
  [c.contact_name, c.firm].filter(Boolean).join(" · ") || disciplineLabel(c.discipline);

// ── extracted values: merge across documents, then apply confirmations ─────
const CONF_RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

export type MergedValue = {
  def: ValueDef;
  best: (ExtractedValue & { documentId: string; documentName: string }) | null;
  conflicts: (ExtractedValue & { documentId: string; documentName: string })[];
  confirmed: ConfirmedValue | null;
  // what the check will use, and how much to trust it
  state: "confirmed" | "not_applicable" | "needs_confirmation" | "extracted" | "missing";
};

const normalizeValue = (v: string) =>
  v
    .toLowerCase()
    .replace(/[,\s]/g, "")
    .replace(/(sf|sq\.?ft\.?|ft|')$/, "");

export function mergeValues(
  docs: Pick<ComplianceDoc, "id" | "name" | "drawing_index">[],
  confirmed: ConfirmedValue[],
  opts: { daycare: boolean },
): MergedValue[] {
  return VALUE_DEFS.filter((d) => !d.daycare || opts.daycare).map((def) => {
    const found = docs.flatMap((doc) =>
      (doc.drawing_index?.values ?? [])
        .filter((v) => v.key === def.key && v.value)
        .map((v) => ({ ...v, documentId: doc.id, documentName: doc.name })),
    );
    found.sort((a, b) => CONF_RANK[b.confidence] - CONF_RANK[a.confidence]);
    const best = found[0] ?? null;
    const conflicts = best
      ? found.filter((v) => normalizeValue(v.value) !== normalizeValue(best.value))
      : [];
    const conf = confirmed.find((c) => c.key === def.key) ?? null;
    let state: MergedValue["state"];
    if (conf) state = conf.status === "not_applicable" ? "not_applicable" : "confirmed";
    else if (!best) state = "missing";
    else if (conflicts.length || best.confidence !== "high" || best.basis === "derived")
      state = "needs_confirmation";
    else state = "extracted";
    return { def, best, conflicts, confirmed: conf, state };
  });
}

export async function listConfirmedValues(projectId: string): Promise<ConfirmedValue[]> {
  const { data, error } = await supabase
    .from("compliance_values")
    .select("*")
    .eq("project_id", projectId);
  if (error) throw error;
  return (data ?? []) as ConfirmedValue[];
}

export async function saveConfirmedValue(input: {
  projectId: string;
  key: string;
  value: string | null;
  unit: string | null;
  status: ConfirmedValue["status"];
  consultantId: string | null;
  note?: string | null;
}): Promise<void> {
  const { error } = await supabase.from("compliance_values").upsert(
    {
      project_id: input.projectId,
      key: input.key,
      value: input.value,
      unit: input.unit,
      status: input.status,
      consultant_id: input.consultantId,
      note: input.note ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "project_id,key" },
  );
  if (error) throw error;
}

export async function clearConfirmedValue(projectId: string, key: string): Promise<void> {
  const { error } = await supabase
    .from("compliance_values")
    .delete()
    .eq("project_id", projectId)
    .eq("key", key);
  if (error) throw error;
}

// ── check runs & issues ───────────────────────────────────────────────────
export function startComplianceCheck(
  projectId: string,
  documentIds: string[],
): Promise<{ reviewId: string }> {
  return invokeEdgeFunction("compliance-check", { action: "check", projectId, documentIds });
}

export async function latestReview(projectId: string): Promise<ComplianceReview | null> {
  const { data, error } = await supabase
    .from("compliance_reviews")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as ComplianceReview) ?? null;
}

export async function listIssues(reviewId: string): Promise<ComplianceIssue[]> {
  const { data, error } = await supabase
    .from("compliance_issues")
    .select("*")
    .eq("review_id", reviewId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ComplianceIssue[];
}

export async function updateIssue(
  id: string,
  patch: Partial<Pick<ComplianceIssue, "status" | "consultant_id" | "note">>,
): Promise<void> {
  const { error } = await supabase
    .from("compliance_issues")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 } as const;

export function groupIssuesByDiscipline(issues: ComplianceIssue[]) {
  const groups = new Map<Discipline, ComplianceIssue[]>();
  for (const i of [...issues].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  )) {
    const list = groups.get(i.discipline) ?? [];
    list.push(i);
    groups.set(i.discipline, list);
  }
  return DISCIPLINES.filter((d) => groups.has(d.id)).map((d) => ({
    discipline: d,
    issues: groups.get(d.id)!,
  }));
}

export function issueCounts(issues: ComplianceIssue[]) {
  const open = issues.filter((i) => i.status === "open" || i.status === "in_progress");
  return {
    total: issues.length,
    open: open.length,
    critical: open.filter((i) => i.severity === "critical" || i.severity === "high").length,
    resolved: issues.length - open.length,
  };
}
