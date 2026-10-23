// CorvusPT CRM ↔ Podio contacts. Reading builds proposals (marketing-crm.ts
// podioProposals); nothing changes on either side until staff approve a
// proposal here. Podio writes go through the podio function, which re-checks
// that each Podio field is still empty before filling it.
import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";
import {
  addProperties,
  createLead,
  logActivity,
  updateLead,
  type FieldSource,
  type Lead,
  type LeadInput,
  type SyncChange,
} from "./marketing";
import {
  cleanEmail,
  cleanPhone,
  importProperties,
  podioProperty,
  tidyName,
  type PodioContactItem,
  type PodioValues,
  type SyncProposal,
} from "./marketing-crm";

export type PodioAppFields = { externalId: string; label: string; type: string }[];

export const podioContacts = (appId: number) =>
  invokeEdgeFunction<{
    fields: PodioAppFields;
    items: PodioContactItem[];
    total: number;
    truncated: boolean;
  }>("podio", { action: "contacts", appId });

const podioUpdateItem = (itemId: number, values: Record<string, string>) =>
  invokeEdgeFunction<{ updated: string[]; skipped: string[] }>("podio", {
    action: "update-item",
    itemId,
    values,
  });

/** Replaces the pending proposals for this Podio app with a fresh set. */
export async function saveProposals(appId: number, proposals: SyncProposal[]): Promise<void> {
  const del = await supabase
    .from("marketing_sync_changes")
    .delete()
    .eq("status", "pending")
    .eq("podio_app_id", appId);
  if (del.error) throw del.error;
  if (!proposals.length) return;
  const { error } = await supabase.from("marketing_sync_changes").insert(
    proposals.map((p) => ({
      direction: p.direction,
      kind: p.kind,
      lead_id: p.leadId,
      podio_app_id: p.podioAppId,
      podio_item_id: p.podioItemId,
      title: p.title,
      changes: p.changes,
      payload: p.payload,
      match_confidence: p.matchConfidence,
      match_reason: p.matchReason,
    })),
  );
  if (error) throw error;
}

const podioSource = (c: SyncChange): FieldSource => ({
  source: "Podio",
  detail: `Item ${c.podioItemId}`,
  confidence: 0.9,
  verified: false,
  at: new Date().toISOString(),
});

const leadValue = (field: string, v: string): unknown =>
  field === "email"
    ? cleanEmail(v).value
    : field === "phone"
      ? (cleanPhone(v).value ?? v)
      : field === "fullName" || field === "company" || field === "ownerNames"
        ? tidyName(v)
        : v;

const LEAD_FIELDS = new Set([
  "fullName",
  "company",
  "email",
  "phone",
  "ownerNames",
  "mailingAddress",
  "city",
  "zip",
]);

async function mark(c: SyncChange, status: SyncChange["status"], error?: string) {
  const { data: u } = await supabase.auth.getUser();
  const { error: e } = await supabase
    .from("marketing_sync_changes")
    .update({
      status,
      error: error ?? null,
      reviewed_by: u.user?.id ?? null,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", c.id);
  if (e) throw e;
}

/**
 * Applies an approved proposal. `fields` = the field changes staff ticked
 * (fill-blank ones are ticked by default; conflicting values only if ticked).
 */
export async function applyChange(c: SyncChange, leads: Lead[], fields: string[]): Promise<void> {
  try {
    const picked = c.changes.filter((x) => fields.includes(x.field));
    if (c.direction === "crm_to_podio") {
      if (!c.podioItemId) throw new Error("Missing Podio item");
      const values = Object.fromEntries(
        picked.filter((x) => x.podioExternalId).map((x) => [x.podioExternalId!, x.to]),
      );
      const r = await podioUpdateItem(c.podioItemId, values);
      await mark(
        c,
        "applied",
        r.skipped.length
          ? `Skipped (no longer empty in Podio): ${r.skipped.join(", ")}`
          : undefined,
      );
      if (c.leadId)
        await logActivity({
          leadId: c.leadId,
          kind: "sync",
          summary: `Podio updated: ${picked.map((x) => x.label).join(", ")}`,
        });
      return;
    }
    if (c.kind === "create") {
      const v = (c.payload ?? {}) as PodioValues;
      const input: LeadInput = {
        source: "podio",
        podioItemId: c.podioItemId,
        podioAppId: c.podioAppId,
        fieldSources: {},
      };
      for (const [k, val] of Object.entries(v))
        if (LEAD_FIELDS.has(k) && val && fields.includes(k)) {
          (input as Record<string, unknown>)[k] = leadValue(k, val);
          input.fieldSources![k] = podioSource(c);
        }
      if (!input.fullName && !input.company && !input.email)
        throw new Error("Nothing to create a lead from");
      const lead = await createLead(input);
      const prop = podioProperty(v);
      if (prop)
        await addProperties(
          importProperties(lead.id, [prop], "podio", `Podio item ${c.podioItemId}`),
        );
      await logActivity({ leadId: lead.id, kind: "sync", summary: "Lead created from Podio" });
      await mark(c, "applied");
      return;
    }
    const lead = leads.find((l) => l.id === c.leadId);
    if (!lead) throw new Error("The lead no longer exists");
    const patch: LeadInput = { podioItemId: c.podioItemId, podioAppId: c.podioAppId };
    const sources = { ...lead.fieldSources };
    for (const x of picked)
      if (LEAD_FIELDS.has(x.field)) {
        (patch as Record<string, unknown>)[x.field] = leadValue(x.field, x.to);
        sources[x.field] = podioSource(c);
      }
    if (c.kind === "link" && c.payload && !("link" in c.payload)) {
      // a confirmed possible match: link and fill blanks only
      for (const [k, val] of Object.entries(c.payload as PodioValues))
        if (LEAD_FIELDS.has(k) && val && !lead[k as keyof Lead]) {
          (patch as Record<string, unknown>)[k] = leadValue(k, val);
          sources[k] = podioSource(c);
        }
    }
    patch.fieldSources = sources;
    await updateLead(lead.id, patch);
    await logActivity({
      leadId: lead.id,
      kind: "sync",
      summary: picked.length
        ? `Updated from Podio: ${picked.map((x) => x.label.replace(/ \(differs.*$/, "")).join(", ")}`
        : "Linked to Podio",
    });
    await mark(c, "applied");
  } catch (err) {
    await mark(c, "failed", err instanceof Error ? err.message : String(err)).catch(
      () => undefined,
    );
    throw err;
  }
}

export const rejectChange = (c: SyncChange) => mark(c, "rejected");
