import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";
import type { EvidenceItem } from "./ai-report-modules";
import type { PropertyRecord } from "./properties";
import { evidenceItemSlug } from "./evidence-categorize";

// Module 8's "Document not available" (public.evidence_unavailable, see
// supabase/pt/evidence-unavailable.sql). The owner says they can't provide a
// missing checklist item; the evidence-unavailable edge function answers what
// that means for the case and what to do instead, and the row is overlaid on
// the existing checklist — the checklist itself isn't regenerated.

export const UNAVAILABLE_REASONS = [
  { value: "never_had", label: "I never had it" },
  { value: "lost", label: "Lost / can't find it" },
  { value: "too_slow", label: "Can't get it in time" },
  { value: "not_applicable", label: "Doesn't apply to my property" },
  { value: "other", label: "Other" },
] as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number]["value"];

export type UnavailableGuidance = {
  impact: "High" | "Medium" | "Low";
  impactSummary: string;
  alternatives: { evidence: string; howItHelps: string; whereToGet: string }[];
  strategyChange: string;
  nextSteps: string[];
  canProceed: boolean;
};

export type UnavailableRecord = {
  id: string;
  itemSlug: string;
  item: string;
  priority: EvidenceItem["priority"] | null;
  reason: UnavailableReason;
  reasonNote: string | null;
  guidance: UnavailableGuidance | null;
  updatedAt: string;
};

export const reasonLabel = (r: UnavailableReason) =>
  UNAVAILABLE_REASONS.find((x) => x.value === r)?.label ?? "Other";

type Row = {
  id: string;
  item_slug: string;
  item: string;
  priority: EvidenceItem["priority"] | null;
  reason: UnavailableReason;
  reason_note: string | null;
  guidance: UnavailableGuidance | null;
  updated_at: string;
};
const toRecord = (r: Row): UnavailableRecord => ({
  id: r.id,
  itemSlug: r.item_slug,
  item: r.item,
  priority: r.priority,
  reason: r.reason,
  reasonNote: r.reason_note,
  guidance: r.guidance,
  updatedAt: r.updated_at,
});

/** The property's unavailable items, keyed by checklist slug. */
export async function listUnavailable(propertyId: string): Promise<Map<string, UnavailableRecord>> {
  const { data, error } = await supabase
    .from("evidence_unavailable")
    .select("id, item_slug, item, priority, reason, reason_note, guidance, updated_at")
    .eq("property_id", propertyId);
  if (error) throw error;
  return new Map(((data ?? []) as Row[]).map((r) => [r.item_slug, toRecord(r)]));
}

/** Asks the AI what to do without this document, then saves the answer. */
export async function markUnavailable(args: {
  property: PropertyRecord;
  item: EvidenceItem;
  checklist: EvidenceItem[];
  strategies: string[];
  reason: UnavailableReason;
  note: string;
}): Promise<UnavailableRecord> {
  const { property, item, checklist, strategies, reason } = args;
  const note = args.note.trim().slice(0, 500) || null;
  const guidance = await invokeEdgeFunction<UnavailableGuidance>("evidence-unavailable", {
    property: {
      address: property.address,
      cad: property.cad,
      propertyType: property.propertyType,
      taxYear: property.taxYear,
      totalValue: property.totalValue,
      landValue: property.landValue,
      improvementValue: property.improvementValue,
    },
    item: {
      item: item.item,
      priority: item.priority,
      category: item.category,
      whyNeeded: item.whyNeeded,
    },
    reason,
    note,
    checklist: checklist.map((c) => ({
      item: c.item,
      priority: c.priority ?? "Supporting",
      status: c.status ?? "Missing",
      category: c.category,
    })),
    strategies,
  });
  const { data, error } = await supabase
    .from("evidence_unavailable")
    .upsert(
      {
        // user_id is set by the database from the property's owner
        property_id: property.id,
        item_slug: evidenceItemSlug(item.item),
        item: item.item,
        priority: item.priority ?? null,
        reason,
        reason_note: note,
        guidance,
      },
      { onConflict: "property_id,item_slug" },
    )
    .select("id, item_slug, item, priority, reason, reason_note, guidance, updated_at")
    .single();
  if (error) throw error;
  return toRecord(data as Row);
}

/** "I found it" — the item goes back to Missing. */
export async function clearUnavailable(id: string): Promise<void> {
  const { error } = await supabase.from("evidence_unavailable").delete().eq("id", id);
  if (error) throw error;
}

/** Marks whose item a regenerated checklist no longer lists under the same
 *  name, as stand-in Missing items — so a mark never silently disappears. */
export function orphanedUnavailable(
  items: Pick<EvidenceItem, "item">[],
  unavailable: Map<string, UnavailableRecord>,
): EvidenceItem[] {
  const listed = new Set(items.map((i) => evidenceItemSlug(i.item)));
  return [...unavailable.values()]
    .filter((r) => !listed.has(r.itemSlug))
    .map((r) => ({
      item: r.item,
      priority: r.priority ?? "Supporting",
      status: "Missing",
      foundIn: null,
      whyNeeded: "",
      verificationNote: "",
      importance: r.priority === "Critical" || r.priority === "Important" ? "High" : "Low",
      availability: "Low",
      documentSuggestions: [],
    }));
}

/** A missing item the owner marked unavailable no longer asks for action. */
export const isUnavailable = (
  it: Pick<EvidenceItem, "item" | "status">,
  unavailable: Map<string, UnavailableRecord>,
) => (it.status ?? "Missing") === "Missing" && unavailable.has(evidenceItemSlug(it.item));
