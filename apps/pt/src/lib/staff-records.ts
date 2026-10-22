import { useEffect, useRef } from "react";
import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";

// Shared admin records (supabase/pt/shared-admin.sql): one owner per work
// item, handoffs that carry their context and must be accepted, the shared
// history, and Super-Admin approvals for sensitive actions.

export type Department = "marketing" | "support" | "operations";
export type EntityType = "lead" | "followup" | "onboarding" | "escalation" | "case";

export const DEPARTMENT_LABEL: Record<Department | "super_admin" | "shared", string> = {
  marketing: "Marketing",
  support: "Customer Support",
  operations: "Operations",
  super_admin: "Super Admin",
  shared: "Shared",
};

export const ENTITY_LABEL: Record<EntityType, string> = {
  lead: "Lead",
  followup: "Follow-up",
  onboarding: "Onboarding",
  escalation: "Support ticket",
  case: "Protest case",
};

/** Where each kind of item may be handed (mirrors transfer_allowed() in SQL). */
export const TRANSFER_TARGETS: Record<EntityType, Department[]> = {
  lead: ["marketing", "support"],
  followup: ["marketing"],
  onboarding: ["support", "marketing"],
  escalation: ["support", "operations"],
  case: ["operations"],
};

export type StaffMember = {
  id: string;
  name: string;
  email: string;
  departments: Department[];
  isSuperAdmin: boolean;
};

export async function staffDirectory(department?: Department): Promise<StaffMember[]> {
  const { data, error } = await supabase.rpc("staff_directory", {
    p_department: department ?? null,
  });
  if (error) throw error;
  return (
    (data ?? []) as {
      id: string;
      name: string;
      email: string;
      departments: Department[];
      is_super_admin: boolean;
    }[]
  ).map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    departments: r.departments ?? [],
    isSuperAdmin: r.is_super_admin,
  }));
}

// ── handoffs ────────────────────────────────────────────────────────────────
export type Transfer = {
  id: string;
  createdAt: string;
  entityType: EntityType;
  entityId: string;
  entityLabel: string | null;
  leadId: string | null;
  profileId: string | null;
  fromDepartment: Department;
  toDepartment: Department;
  fromOwner: string | null;
  toOwner: string | null;
  reason: string;
  history: { at: string; by: string; what: string }[];
  pendingActions: { kind: string; what: string; due: string | null }[];
  status: "pending" | "accepted" | "declined" | "cancelled";
  requestedBy: string;
  respondedBy: string | null;
  respondedAt: string | null;
  responseNote: string | null;
  pausedOutreach: boolean;
};

type TransferRow = {
  id: string;
  created_at: string;
  entity_type: EntityType;
  entity_id: string;
  entity_label: string | null;
  lead_id: string | null;
  profile_id: string | null;
  from_department: Department;
  to_department: Department;
  from_owner: string | null;
  to_owner: string | null;
  reason: string;
  history: Transfer["history"];
  pending_actions: Transfer["pendingActions"];
  status: Transfer["status"];
  requested_by: string;
  responded_by: string | null;
  responded_at: string | null;
  response_note: string | null;
  paused_outreach: boolean;
};

const fromTransferRow = (r: TransferRow): Transfer => ({
  id: r.id,
  createdAt: r.created_at,
  entityType: r.entity_type,
  entityId: r.entity_id,
  entityLabel: r.entity_label,
  leadId: r.lead_id,
  profileId: r.profile_id,
  fromDepartment: r.from_department,
  toDepartment: r.to_department,
  fromOwner: r.from_owner,
  toOwner: r.to_owner,
  reason: r.reason,
  history: r.history ?? [],
  pendingActions: r.pending_actions ?? [],
  status: r.status,
  requestedBy: r.requested_by,
  respondedBy: r.responded_by,
  respondedAt: r.responded_at,
  responseNote: r.response_note,
  pausedOutreach: r.paused_outreach,
});

/** Handoffs this person can see (RLS: their departments, or sent / received by them). */
export async function listTransfers(
  opts: { pendingOnly?: boolean; entityId?: string; limit?: number } = {},
) {
  let q = supabase
    .from("record_transfers")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 100);
  if (opts.pendingOnly) q = q.eq("status", "pending");
  if (opts.entityId) q = q.eq("entity_id", opts.entityId);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as TransferRow[]).map(fromTransferRow);
}

export async function requestTransfer(input: {
  entityType: EntityType;
  entityId: string;
  toDepartment: Department;
  toOwner: string | null;
  reason: string;
  pending?: string[];
}): Promise<string> {
  const { data, error } = await supabase.rpc("request_transfer", {
    p_entity_type: input.entityType,
    p_entity_id: input.entityId,
    p_to_department: input.toDepartment,
    p_to_owner: input.toOwner,
    p_reason: input.reason,
    p_pending: input.pending ?? [],
  });
  if (error) throw error;
  return data as string;
}

export async function respondTransfer(id: string, accept: boolean, note?: string) {
  const { error } = await supabase.rpc("respond_transfer", {
    p_id: id,
    p_accept: accept,
    p_note: note ?? null,
  });
  if (error) throw error;
}

/** Give an unowned item its owner (a Super Admin may also reassign directly). */
export async function assignOwner(entityType: EntityType, entityId: string, owner: string) {
  const { error } = await supabase.rpc("assign_owner", {
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_owner: owner,
  });
  if (error) throw error;
}

/** Department that owns each kind of item. */
export const ENTITY_DEPARTMENT: Record<EntityType, Department> = {
  lead: "marketing",
  followup: "marketing",
  onboarding: "support",
  escalation: "support",
  case: "operations",
};

export async function cancelTransfer(id: string) {
  const { error } = await supabase.rpc("cancel_transfer", { p_id: id });
  if (error) throw error;
}

/** Can this person accept / decline the handoff? (mirrors respond_transfer) */
export function canRespond(
  t: Transfer,
  me: string,
  myDepartments: Department[],
  isSuperAdmin: boolean,
) {
  if (t.status !== "pending") return false;
  if (isSuperAdmin) return true;
  return t.toOwner ? t.toOwner === me : myDepartments.includes(t.toDepartment);
}

// ── shared history ──────────────────────────────────────────────────────────
export type RecordEvent = {
  id: string;
  createdAt: string;
  department: Department | "super_admin" | "shared";
  entityType: string;
  entityId: string | null;
  profileId: string | null;
  leadId: string | null;
  actorLabel: string | null;
  action: string;
  summary: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  approvalId: string | null;
};

type EventRow = {
  id: string;
  created_at: string;
  department: RecordEvent["department"];
  entity_type: string;
  entity_id: string | null;
  profile_id: string | null;
  lead_id: string | null;
  actor_label: string | null;
  action: string;
  summary: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  approval_id: string | null;
};

/** History for a customer, a lead and/or one item — whatever RLS lets this person see. */
export async function listEvents(filter: {
  profileId?: string | null;
  leadId?: string | null;
  entityId?: string | null;
  limit?: number;
}) {
  const ors = [
    filter.profileId ? `profile_id.eq.${filter.profileId}` : null,
    filter.leadId ? `lead_id.eq.${filter.leadId}` : null,
    filter.entityId ? `entity_id.eq.${filter.entityId}` : null,
  ].filter(Boolean);
  let q = supabase
    .from("record_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(filter.limit ?? 50);
  if (ors.length) q = q.or(ors.join(","));
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as EventRow[]).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    department: r.department,
    entityType: r.entity_type,
    entityId: r.entity_id,
    profileId: r.profile_id,
    leadId: r.lead_id,
    actorLabel: r.actor_label,
    action: r.action,
    summary: r.summary,
    before: r.before,
    after: r.after,
    approvalId: r.approval_id,
  }));
}

// ── approvals ───────────────────────────────────────────────────────────────
export type ApprovalKind =
  "access_change" | "pricing_exception" | "refund" | "agreement_change" | "automation_permission";

export const APPROVAL_KIND_LABEL: Record<ApprovalKind, string> = {
  pricing_exception: "Pricing exception",
  refund: "Refund",
  agreement_change: "Agreement change",
  automation_permission: "Automation permission",
  access_change: "Access change",
};

export type Approval = {
  id: string;
  createdAt: string;
  kind: ApprovalKind;
  status: "pending" | "approved" | "rejected" | "executed" | "failed" | "cancelled";
  source: "staff" | "ai";
  requestedBy: string;
  targetProfile: string | null;
  title: string;
  payload: Record<string, unknown>;
  reason: string;
  aiRationale: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
};

type ApprovalRow = {
  id: string;
  created_at: string;
  kind: ApprovalKind;
  status: Approval["status"];
  source: Approval["source"];
  requested_by: string;
  target_profile: string | null;
  title: string;
  payload: Record<string, unknown>;
  reason: string;
  ai_rationale: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
};

/** Super Admins see all requests; everyone else sees their own (RLS). */
export async function listApprovals(opts: { status?: Approval["status"]; limit?: number } = {}) {
  let q = supabase
    .from("approval_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 100);
  if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as ApprovalRow[]).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    kind: r.kind,
    status: r.status,
    source: r.source,
    requestedBy: r.requested_by,
    targetProfile: r.target_profile,
    title: r.title,
    payload: r.payload ?? {},
    reason: r.reason,
    aiRationale: r.ai_rationale,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
    decisionNote: r.decision_note,
    result: r.result,
    error: r.error,
  }));
}

type ApprovalResponse = { id?: string; status: string; result?: unknown; error?: string | null };

export function requestApproval(input: {
  kind: ApprovalKind;
  payload: Record<string, unknown>;
  reason: string;
  source?: "staff" | "ai";
  aiRationale?: string;
  /** Super Admin acting directly: approve and carry it out in one step. */
  decideNow?: boolean;
}) {
  return invokeEdgeFunction<ApprovalResponse>("admin-update-plan?action=staff-approvals", {
    op: "request",
    ...input,
  });
}

export type CustomerLookup = {
  email: string;
  properties: { id: string; address: string; subscribed: boolean; status: string | null }[];
  engagementPacket: { id: string; signedAt: string } | null;
  serviceAgreements: { id: string; address: string | null; acceptedAt: string }[];
};

/** The customer's properties and signed agreements, for the request form. */
export function lookupCustomer(email: string) {
  return invokeEdgeFunction<CustomerLookup>("admin-update-plan?action=staff-approvals", {
    op: "lookup",
    email,
  });
}

export function decideApproval(id: string, approve: boolean, note?: string) {
  return invokeEdgeFunction<ApprovalResponse>("admin-update-plan?action=staff-approvals", {
    op: "decide",
    id,
    approve,
    note,
  });
}

export function cancelApproval(id: string) {
  return invokeEdgeFunction<ApprovalResponse>("admin-update-plan?action=staff-approvals", {
    op: "cancel",
    id,
  });
}

// ── automations & routing ───────────────────────────────────────────────────
export type AutomationPermission = {
  key: string;
  label: string;
  description: string | null;
  enabled: boolean;
  updatedAt: string;
  approvalId: string | null;
};

export async function listAutomations(): Promise<AutomationPermission[]> {
  const { data, error } = await supabase.from("automation_permissions").select("*").order("label");
  if (error) throw error;
  return (
    (data ?? []) as {
      key: string;
      label: string;
      description: string | null;
      enabled: boolean;
      updated_at: string;
      approval_id: string | null;
    }[]
  ).map((r) => ({
    key: r.key,
    label: r.label,
    description: r.description,
    enabled: r.enabled,
    updatedAt: r.updated_at,
    approvalId: r.approval_id,
  }));
}

export type Routing = { department: Department; defaultOwner: string | null };

export async function listRouting(): Promise<Routing[]> {
  const { data, error } = await supabase.from("staff_routing").select("department, default_owner");
  if (error) throw error;
  return ((data ?? []) as { department: Department; default_owner: string | null }[]).map((r) => ({
    department: r.department,
    defaultOwner: r.default_owner,
  }));
}

export async function setDefaultOwner(department: Department, owner: string | null) {
  const { error } = await supabase.rpc("set_default_owner", {
    p_department: department,
    p_owner: owner,
  });
  if (error) throw error;
}

/**
 * Re-runs `onChange` when any of these tables change (Supabase Realtime, which
 * applies the same row security) — so a handoff, approval or new ticket shows
 * up on every open dashboard without a reload. Debounced; falls back silently.
 */
export function useLiveRefresh(tables: string[], onChange: () => void, enabled = true) {
  const cb = useRef(onChange);
  cb.current = onChange;
  const key = tables.join(",");
  useEffect(() => {
    if (!enabled) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => cb.current(), 600);
    };
    const channel = supabase.channel(`live:${key}:${Math.random().toString(36).slice(2)}`);
    for (const table of key.split(",")) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, fire);
    }
    channel.subscribe();
    return () => {
      if (t) clearTimeout(t);
      void supabase.removeChannel(channel);
    };
  }, [key, enabled]);
}
