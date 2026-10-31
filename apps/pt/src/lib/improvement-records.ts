import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";
import { uploadDocument } from "./documents";
import {
  BUILDING_DETAIL_FIELDS,
  CARD_COMPONENTS,
  MEDIA_REQUESTS,
  sectionsFor,
  type BuildingDetails,
  type ItemCondition,
} from "./improvement-fields";

// Improvement Condition (Module 5) records — see supabase/pt/improvement-records.sql.

export type Building = {
  id: string;
  name: string;
  types: string[];
  customFeatures: string[];
  details: BuildingDetails & { overallCondition?: ItemCondition | null };
  sort: number;
};

export type ImprovementItem = {
  id: string;
  buildingId: string | null;
  mediaId: string | null;
  section: string;
  component: string;
  condition: ItemCondition;
  issue: string | null;
  observation: string | null;
  repairEstimate: number | null;
  estimateSource: string | null;
  fixedOrMovable: "fixed" | "movable" | null;
  page: number | null;
  videoTime: string | null;
  needsProfessional: boolean;
  uncertain: string | null;
  source: "owner" | "report" | "photo" | "video";
  status: "suggested" | "confirmed" | "rejected";
  createdAt: string;
};

export type ImprovementMedia = {
  id: string;
  documentId: string | null;
  buildingId: string | null;
  kind: "report" | "photo" | "video";
  fileName: string;
  status: "reading" | "read" | "failed";
  title: string | null;
  reportDate: string | null;
  captureDate: string | null;
  locationNote: string | null;
  summary: string | null;
  qualityNote: string | null;
  error: string | null;
  createdAt: string;
};

export type ImprovementData = {
  buildings: Building[];
  items: ImprovementItem[];
  media: ImprovementMedia[];
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const toBuilding = (r: any): Building => ({
  id: r.id,
  name: r.name,
  types: r.improvement_types ?? [],
  customFeatures: r.custom_features ?? [],
  details: r.details ?? {},
  sort: r.sort ?? 0,
});
const toItem = (r: any): ImprovementItem => ({
  id: r.id,
  buildingId: r.building_id,
  mediaId: r.media_id,
  section: r.section,
  component: r.component,
  condition: r.condition,
  issue: r.issue,
  observation: r.observation,
  repairEstimate: r.repair_estimate == null ? null : Number(r.repair_estimate),
  estimateSource: r.estimate_source,
  fixedOrMovable: r.fixed_or_movable,
  page: r.page,
  videoTime: r.video_time,
  needsProfessional: !!r.needs_professional,
  uncertain: r.uncertain,
  source: r.source,
  status: r.status,
  createdAt: r.created_at,
});
const toMedia = (r: any): ImprovementMedia => ({
  id: r.id,
  documentId: r.document_id,
  buildingId: r.building_id,
  kind: r.kind,
  fileName: r.file_name,
  status: r.status,
  title: r.title,
  reportDate: r.report_date,
  captureDate: r.capture_date,
  locationNote: r.location_note,
  summary: r.summary,
  qualityNote: r.quality_note,
  error: r.error,
  createdAt: r.created_at,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function loadImprovementData(propertyId: string): Promise<ImprovementData> {
  const [b, i, m] = await Promise.all([
    supabase.from("improvement_buildings").select("*").eq("property_id", propertyId).order("sort"),
    supabase
      .from("improvement_items")
      .select("*")
      .eq("property_id", propertyId)
      .order("created_at"),
    supabase
      .from("improvement_media")
      .select("*")
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false }),
  ]);
  if (b.error) throw b.error;
  if (i.error) throw i.error;
  if (m.error) throw m.error;
  return {
    buildings: (b.data ?? []).map(toBuilding),
    items: (i.data ?? []).map(toItem),
    media: (m.data ?? []).map(toMedia),
  };
}

export const IMPROVEMENTS_CHANGED = "corvuspt:improvements-changed";
const changed = () => window.dispatchEvent(new Event(IMPROVEMENTS_CHANGED));

export async function saveBuilding(
  propertyId: string,
  b: Partial<Building> & { id?: string },
): Promise<Building> {
  const row: Record<string, unknown> = { property_id: propertyId };
  if (b.name !== undefined) row.name = b.name.trim().slice(0, 80) || "Main building";
  if (b.types !== undefined) row.improvement_types = b.types;
  if (b.customFeatures !== undefined) row.custom_features = b.customFeatures;
  if (b.details !== undefined) row.details = b.details;
  if (b.sort !== undefined) row.sort = b.sort;
  const q = b.id
    ? supabase.from("improvement_buildings").update(row).eq("id", b.id)
    : supabase.from("improvement_buildings").insert(row);
  const { data, error } = await q.select("*").single();
  if (error) throw error;
  changed();
  return toBuilding(data);
}

export async function deleteBuilding(id: string): Promise<void> {
  const { error } = await supabase.from("improvement_buildings").delete().eq("id", id);
  if (error) throw error;
  changed();
}

export type ItemInput = {
  buildingId: string | null;
  section: string;
  component: string;
  condition?: ItemCondition;
  issue?: string | null;
  repairEstimate?: number | null;
  estimateSource?: string | null;
  fixedOrMovable?: "fixed" | "movable" | null;
};

/** The owner's own record for a component (one per building + component). */
export async function saveOwnerItem(
  propertyId: string,
  existing: ImprovementItem | undefined,
  input: ItemInput,
): Promise<void> {
  const row = {
    property_id: propertyId,
    building_id: input.buildingId,
    section: input.section,
    component: input.component,
    condition: input.condition ?? existing?.condition ?? "Not Assessed",
    issue: input.issue === undefined ? (existing?.issue ?? null) : input.issue?.trim() || null,
    repair_estimate:
      input.repairEstimate === undefined
        ? (existing?.repairEstimate ?? null)
        : input.repairEstimate,
    estimate_source:
      input.estimateSource === undefined
        ? (existing?.estimateSource ?? null)
        : input.estimateSource?.trim() || null,
    fixed_or_movable:
      input.fixedOrMovable === undefined
        ? (existing?.fixedOrMovable ?? null)
        : input.fixedOrMovable,
    source: "owner",
    status: "confirmed",
  };
  const q = existing
    ? supabase.from("improvement_items").update(row).eq("id", existing.id)
    : supabase.from("improvement_items").insert(row);
  const { error } = await q;
  if (error) throw error;
  changed();
}

export async function decideItem(
  item: ImprovementItem,
  status: ImprovementItem["status"],
  edits?: Partial<
    Pick<ImprovementItem, "condition" | "issue" | "buildingId" | "component" | "section">
  >,
): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (edits?.condition) patch.condition = edits.condition;
  if (edits?.issue !== undefined) patch.issue = edits.issue?.trim() || null;
  if (edits?.buildingId !== undefined) patch.building_id = edits.buildingId;
  if (edits?.component) patch.component = edits.component;
  if (edits?.section) patch.section = edits.section;
  const { error } = await supabase.from("improvement_items").update(patch).eq("id", item.id);
  if (error) throw error;
  changed();
}

async function sha256Hex(file: File): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(d))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const mediaKindOf = (file: File): "report" | "photo" | "video" | null =>
  file.type === "application/pdf" || /\.pdf$/i.test(file.name)
    ? "report"
    : file.type.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(file.name)
      ? "video"
      : file.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)
        ? "photo"
        : null;

/** Uploads a report / photo / video to Data & Evidence and has AI read it. */
export async function uploadImprovementEvidence(args: {
  userId: string;
  propertyId: string;
  file: File;
  buildingId: string | null;
  // set when uploaded from a component card
  hint?: { section: string; component: string } | null;
  // "report" when uploaded with Upload Inspection Report
  asReport?: boolean;
  context: Record<string, unknown>;
}): Promise<{ duplicate?: ImprovementMedia; found?: number; added?: number }> {
  const kind = args.asReport ? "report" : mediaKindOf(args.file);
  if (!kind) throw new Error(`${args.file.name}: only PDF reports, photos and videos can be read.`);
  const hash = await sha256Hex(args.file);
  const { data: same } = await supabase
    .from("improvement_media")
    .select("*")
    .eq("property_id", args.propertyId)
    .eq("content_hash", hash)
    .maybeSingle();
  if (same && same.status !== "failed") return { duplicate: toMedia(same) };
  let mediaId = same?.id as string | undefined;
  if (!mediaId) {
    const doc = await uploadDocument(
      args.userId,
      args.propertyId,
      args.file,
      kind === "report" ? "Improvement: Inspection Report" : "Improvement: Photo / Video",
    );
    const { data, error } = await supabase
      .from("improvement_media")
      .insert({
        property_id: args.propertyId,
        document_id: doc.id,
        building_id: args.buildingId,
        kind,
        file_name: args.file.name,
        content_hash: hash,
      })
      .select("id")
      .single();
    if (error) throw error;
    mediaId = data.id as string;
  } else {
    await supabase
      .from("improvement_media")
      .update({ status: "reading", error: null })
      .eq("id", mediaId);
  }
  try {
    return await invokeEdgeFunction<{ found: number; added: number }>(
      "improvement-evidence-extract",
      { mediaId, hint: args.hint ?? null, context: args.context },
    );
  } finally {
    changed();
  }
}

// ── Summary (pure) ────────────────────────────────────────────────────────

export const confirmedItems = (items: ImprovementItem[], buildingId?: string | null) =>
  items.filter(
    (i) => i.status === "confirmed" && (buildingId === undefined || i.buildingId === buildingId),
  );

export type ImprovementSummary = {
  overall: ItemCondition;
  overallBasis: string;
  issues: ImprovementItem[];
  estimates: { item: ImprovementItem; amount: number }[];
  estimateTotal: number;
  missing: { section: string; label: string; request: string }[];
  missingDetails: string[];
  hasAnyEvidence: boolean;
};

const RANK: Record<string, number> = { Good: 0, Fair: 1, Poor: 2 };

export function summarize(
  building: Building | null,
  items: ImprovementItem[],
  media: ImprovementMedia[],
): ImprovementSummary {
  const mine = confirmedItems(items, building?.id ?? null);
  const assessed = mine.filter((i) => i.condition in RANK);
  const ownerOverall = building?.details.overallCondition ?? null;
  const counts = { Good: 0, Fair: 0, Poor: 0 } as Record<string, number>;
  for (const i of assessed) counts[i.condition]++;
  const overall: ItemCondition =
    ownerOverall && ownerOverall !== "Not Assessed" ? ownerOverall : "Not Assessed";
  const overallBasis =
    ownerOverall && ownerOverall !== "Not Assessed"
      ? "Your assessment"
      : assessed.length > 0
        ? `Not assessed overall yet — ${Object.entries(counts)
            .filter(([, n]) => n > 0)
            .map(([k, n]) => `${n} ${k}`)
            .join(", ")} component${assessed.length === 1 ? "" : "s"} recorded`
        : "No component conditions recorded yet";
  const issues = mine.filter((i) => i.issue || i.condition === "Poor");
  const estimates = mine
    .filter((i) => i.repairEstimate != null && i.repairEstimate > 0)
    .map((i) => ({ item: i, amount: i.repairEstimate as number }));
  const sections = sectionsFor(building?.types ?? [], building?.customFeatures ?? []);
  const evidenced = new Set(
    mine.filter((i) => i.condition !== "Not Assessed").map((i) => i.section),
  );
  const missing = sections
    .filter((s) => !evidenced.has(s.key))
    .map((s) => ({ section: s.key, label: s.label, request: MEDIA_REQUESTS[s.key] ?? "" }));
  const details = building?.details ?? {};
  const missingDetails = building
    ? BUILDING_DETAIL_FIELDS.filter((f) => details[f.key] == null || details[f.key] === "").map(
        (f) => f.label,
      )
    : [];
  return {
    overall,
    overallBasis,
    issues,
    estimates,
    estimateTotal: estimates.reduce((t, e) => t + e.amount, 0),
    missing,
    missingDetails,
    hasAnyEvidence: assessed.length > 0 || media.some((m) => m.status === "read") || !!ownerOverall,
  };
}

/** Owner-confirmed records in the shape the module's AI input takes. */
export function recordsForModule(data: ImprovementData) {
  const names = new Map(data.buildings.map((b) => [b.id, b.name]));
  const items = confirmedItems(data.items)
    .filter((i) => i.condition !== "Not Assessed" || i.issue)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((i) => ({
      building: i.buildingId ? (names.get(i.buildingId) ?? "") : "",
      component: i.component,
      condition: i.condition,
      issue: i.issue,
      estimate: i.repairEstimate,
      source: i.source,
    }));
  const buildings = data.buildings.map((b) => ({
    name: b.name,
    types: b.types,
    details: b.details,
  }));
  return items.length > 0 || buildings.some((b) => b.types.length > 0)
    ? { buildings, items }
    : null;
}

/** For each AI photo card, the worst owner-confirmed condition among its components. */
export function cardConditions(
  items: ImprovementItem[],
): Partial<Record<keyof typeof CARD_COMPONENTS, string>> {
  const out: Partial<Record<keyof typeof CARD_COMPONENTS, string>> = {};
  for (const [card, comps] of Object.entries(CARD_COMPONENTS) as [
    keyof typeof CARD_COMPONENTS,
    string[],
  ][]) {
    const worst = confirmedItems(items)
      .filter((i) => comps.includes(i.component) && i.condition in RANK)
      .sort((a, b) => RANK[b.condition] - RANK[a.condition])[0];
    if (worst) out[card] = worst.condition;
  }
  return out;
}
