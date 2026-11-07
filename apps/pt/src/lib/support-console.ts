import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";
import { propertyFromRow, type PropertyRecord, type PropertyRow } from "./properties";
import { protestFromRow, type ProtestRecord, type ProtestRow } from "./protests";

// Customer Support Admin console — data access and the pure helpers its
// views share. Server side: supabase/pt/support-console.sql (RPCs, tables,
// Super Admin switches) and the support-console edge function (AI, emails,
// billing, documents).

// ── shared types ──────────────────────────────────────────────────────────

export type OnboardingStep = { key: string; label: string; done: boolean; detail?: string | null };

export type SupportCustomer = {
  profileId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  createdAt: string;
  ownerEntities: string[];
  properties: number;
  subscribed: number;
  pastDue: number;
  subscriptionStatus: string | null;
  plan: string | null;
  onboarding: OnboardingStep[];
  onboardingDone: number;
  onboardingTotal: number;
  onboardingOwner: string | null;
  onboardingOwnerLabel: string | null;
  onboardingStatus: string | null;
  lastReminderAt: string | null;
  source: string;
  leadId: string | null;
  handoffId: string | null;
  openTickets: number;
  nextDeadline: string | null;
};

export type TicketCategory =
  | "onboarding"
  | "billing"
  | "documents"
  | "protest"
  | "deadlines"
  | "pay_taxes"
  | "account"
  | "technical"
  | "other";
export const CATEGORY_LABEL: Record<TicketCategory, string> = {
  onboarding: "Onboarding",
  billing: "Billing",
  documents: "Documents",
  protest: "Protest",
  deadlines: "Deadlines",
  pay_taxes: "Pay Taxes",
  account: "Account",
  technical: "Technical",
  other: "Other",
};
export type TicketPriority = "low" | "normal" | "high" | "urgent";
export const PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};
export type TicketStatus =
  "open" | "in_progress" | "waiting_on_customer" | "escalated" | "resolved" | "closed";
export const STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting_on_customer: "Waiting on customer",
  escalated: "Escalated",
  resolved: "Resolved",
  closed: "Closed",
};
// response deadline by priority — mirrors support_sla_hours() in SQL
export const SLA_HOURS: Record<TicketPriority, number> = {
  urgent: 4,
  high: 8,
  normal: 24,
  low: 72,
};

export type Ticket = {
  id: string;
  number: number;
  createdAt: string;
  updatedAt: string;
  profileId: string | null;
  propertyId: string | null;
  subject: string;
  category: TicketCategory | null;
  priority: TicketPriority;
  status: TicketStatus;
  source: "staff" | "chat_escalation" | "email" | "phone";
  assignedTo: string | null;
  createdBy: string | null;
  dueAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  reopenedCount: number;
  escalatedTo: "operations" | "super_admin" | "marketing" | null;
  escalationReason: string | null;
  aiSummary: string | null;
  rating: number | null;
  ratingComment: string | null;
  feedbackToken: string | null;
};

type TicketRow = {
  id: string;
  number: number;
  created_at: string;
  updated_at: string;
  profile_id: string | null;
  property_id: string | null;
  subject: string;
  category: TicketCategory | null;
  priority: TicketPriority;
  status: TicketStatus;
  source: Ticket["source"];
  assigned_to: string | null;
  created_by: string | null;
  due_at: string;
  first_response_at: string | null;
  resolved_at: string | null;
  reopened_count: number;
  escalated_to: Ticket["escalatedTo"];
  escalation_reason: string | null;
  ai_summary: string | null;
  rating: number | null;
  rating_comment: string | null;
  feedback_token: string | null;
};

export const ticketFromRow = (r: TicketRow): Ticket => ({
  id: r.id,
  number: r.number,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  profileId: r.profile_id,
  propertyId: r.property_id,
  subject: r.subject,
  category: r.category,
  priority: r.priority,
  status: r.status,
  source: r.source,
  assignedTo: r.assigned_to,
  createdBy: r.created_by,
  dueAt: r.due_at,
  firstResponseAt: r.first_response_at,
  resolvedAt: r.resolved_at,
  reopenedCount: r.reopened_count,
  escalatedTo: r.escalated_to,
  escalationReason: r.escalation_reason,
  aiSummary: r.ai_summary,
  rating: r.rating,
  ratingComment: r.rating_comment,
  feedbackToken: r.feedback_token,
});

export type TicketMessage = {
  id: string;
  ticketId: string;
  createdAt: string;
  authorId: string | null;
  kind: "internal_note" | "customer_reply" | "customer_message" | "system";
  body: string;
  aiDrafted: boolean;
  automated: boolean;
  sentAt: string | null;
  sendError: string | null;
};

export type TeamMember = { id: string; name: string; supervisor: boolean; superAdmin: boolean };

export type SupportPermission = {
  key: string;
  label: string;
  description: string | null;
  enabled: boolean;
};

export type SupportTemplate = {
  id: string;
  key: string | null;
  purpose:
    | "onboarding"
    | "documents"
    | "correction"
    | "billing"
    | "acknowledgement"
    | "resolved"
    | "other";
  name: string;
  subject: string;
  body: string;
  approved: boolean;
};

export type KnowledgeEntry = {
  id: string;
  kind: "faq" | "instruction" | "policy";
  title: string;
  body: string;
  active: boolean;
};

export type DiscountPolicy = {
  id: string;
  label: string;
  stripe_coupon_id: string;
  description: string | null;
  active: boolean;
};

// ── pure helpers ───────────────────────────────────────────────────────────

export type SlaState = {
  label: string;
  tone: "ok" | "soon" | "overdue" | "met" | "closed";
  minutes: number;
};

// Where a ticket stands against its response deadline.
export function slaState(
  t: Pick<Ticket, "status" | "dueAt" | "firstResponseAt">,
  now = Date.now(),
): SlaState {
  if (t.status === "resolved" || t.status === "closed")
    return { label: "Closed", tone: "closed", minutes: 0 };
  if (t.firstResponseAt) return { label: "Responded", tone: "met", minutes: 0 };
  const minutes = Math.round((Date.parse(t.dueAt) - now) / 60000);
  const span = (m: number) => {
    const a = Math.abs(m);
    return a >= 1440 ? `${Math.round(a / 1440)}d` : a >= 60 ? `${Math.round(a / 60)}h` : `${a}m`;
  };
  if (minutes < 0) return { label: `Overdue by ${span(minutes)}`, tone: "overdue", minutes };
  if (minutes <= 120) return { label: `Due in ${span(minutes)}`, tone: "soon", minutes };
  return { label: `Due in ${span(minutes)}`, tone: "ok", minutes };
}

export const isOpenTicket = (t: Pick<Ticket, "status">) =>
  t.status !== "resolved" && t.status !== "closed";

export function onboardingPercent(
  c: Pick<SupportCustomer, "onboardingDone" | "onboardingTotal">,
): number {
  return c.onboardingTotal ? Math.round((100 * c.onboardingDone) / c.onboardingTotal) : 0;
}

// The first onboarding step not done, phrased for a reminder ("{{next_step}}").
export function nextOnboardingStep(steps: OnboardingStep[]): OnboardingStep | null {
  return steps.find((s) => !s.done) ?? null;
}

export type DocumentInfo = {
  id: string;
  propertyId: string;
  fileName: string;
  type: string | null;
  category: string | null;
  uploadedAt: string;
  aiVerdict: "valid" | "issues" | "invalid" | null;
  aiNotes: string | null;
  verificationStatus: string | null;
  verificationFlags: unknown;
  editedFrom: string | null;
  duplicateOf: string | null;
  deletedAt: string | null;
};

export type DocumentIssue = {
  documentId: string;
  propertyId: string;
  fileName: string;
  kind: "unreadable" | "extraction" | "confirm" | "conflict" | "duplicate";
  label: string;
  detail: string | null;
};

function flagTexts(flags: unknown): string[] {
  if (!Array.isArray(flags)) return [];
  return flags
    .map((f) =>
      typeof f === "string"
        ? f
        : f && typeof f === "object"
          ? String(
              (f as Record<string, unknown>).message ??
                (f as Record<string, unknown>).detail ??
                (f as Record<string, unknown>).field ??
                JSON.stringify(f),
            )
          : "",
    )
    .filter(Boolean);
}

const CONFLICT = /address|account|owner|value|date|mismatch|differ|conflict/i;

// Processing problems on a customer's documents — flagged for staff, never
// fixed silently. A document's own AI verdict, its verification flags, and
// duplicates; deleted files are kept (history) but not listed as issues.
export function documentIssues(docs: DocumentInfo[]): DocumentIssue[] {
  const out: DocumentIssue[] = [];
  for (const d of docs) {
    if (d.deletedAt) continue;
    const base = { documentId: d.id, propertyId: d.propertyId, fileName: d.fileName };
    if (d.aiVerdict === "invalid")
      out.push({
        ...base,
        kind: "unreadable",
        label: "Unreadable or not the right document",
        detail: d.aiNotes,
      });
    else if (d.aiVerdict === "issues")
      out.push({
        ...base,
        kind: "extraction",
        label: "AI couldn't read everything",
        detail: d.aiNotes,
      });
    const flags = flagTexts(d.verificationFlags);
    if (d.verificationStatus === "needs_review" || d.verificationStatus === "rejected") {
      const conflicts = flags.filter((f) => CONFLICT.test(f));
      if (conflicts.length)
        out.push({
          ...base,
          kind: "conflict",
          label: "Doesn't match the record",
          detail: conflicts.join(" · "),
        });
      else
        out.push({
          ...base,
          kind: "confirm",
          label: d.verificationStatus === "rejected" ? "Rejected in review" : "Needs confirmation",
          detail: flags.join(" · ") || null,
        });
    }
    if (d.duplicateOf)
      out.push({ ...base, kind: "duplicate", label: "Possible duplicate upload", detail: null });
  }
  return out;
}

// Property-level conflicts the county check raised (address, account number,
// values, dates) — shown side by side, the record is never overwritten here.
export function propertyConflicts(
  p: Pick<PropertyRecord, "address"> & { verification_flags?: unknown },
): string[] {
  return flagTexts(p.verification_flags).filter((f) => CONFLICT.test(f));
}

// ── data access ───────────────────────────────────────────────────────────

export async function supportDashboard() {
  const { data, error } = await supabase.rpc("support_dashboard");
  if (error) throw error;
  return data as {
    openTickets: number;
    overdueTickets: number;
    urgentTickets: number;
    escalatedTickets: number;
    unassignedTickets: number;
    incompleteOnboarding: number;
    failedPayments: number;
    upcomingDeadlines: number;
    deadlines: {
      kind: string;
      date: string;
      profileId: string;
      propertyId: string;
      address: string;
      customer: string | null;
    }[];
    priorityActions: {
      rank: number;
      kind: "ticket" | "payment" | "deadline";
      id: string;
      profileId: string | null;
      label: string;
      reason: string;
      at: string;
    }[];
  };
}

type CustomerRow = {
  profile_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  created_at: string;
  owner_entities: string[] | null;
  properties: number;
  subscribed: number;
  past_due: number;
  subscription_status: string | null;
  plan: string | null;
  onboarding: OnboardingStep[] | null;
  onboarding_done: number;
  onboarding_total: number;
  onboarding_owner: string | null;
  onboarding_owner_label: string | null;
  onboarding_status: string | null;
  last_reminder_at: string | null;
  source: string;
  lead_id: string | null;
  handoff_id: string | null;
  open_tickets: number;
  next_deadline: string | null;
};

export async function listSupportCustomers(): Promise<SupportCustomer[]> {
  const { data, error } = await supabase.rpc("support_customers");
  if (error) throw error;
  return ((data ?? []) as CustomerRow[]).map((r) => ({
    profileId: r.profile_id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    company: r.company,
    createdAt: r.created_at,
    ownerEntities: r.owner_entities ?? [],
    properties: r.properties,
    subscribed: r.subscribed,
    pastDue: r.past_due,
    subscriptionStatus: r.subscription_status,
    plan: r.plan,
    onboarding: r.onboarding ?? [],
    onboardingDone: r.onboarding_done,
    onboardingTotal: r.onboarding_total,
    onboardingOwner: r.onboarding_owner,
    onboardingOwnerLabel: r.onboarding_owner_label,
    onboardingStatus: r.onboarding_status,
    lastReminderAt: r.last_reminder_at,
    source: r.source,
    leadId: r.lead_id,
    handoffId: r.handoff_id,
    openTickets: r.open_tickets,
    nextDeadline: r.next_deadline,
  }));
}

export type CustomerDetail = {
  profile: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    company: string | null;
    createdAt: string;
    plan: string | null;
    subscriptionStatus: string | null;
    hasStripeCustomer: boolean;
    source: string | null;
  };
  onboarding: {
    steps: OnboardingStep[];
    record: {
      owner: string | null;
      ownerLabel: string | null;
      status: string;
      notes: string | null;
      last_reminder_at: string | null;
      reminders_sent: number;
      completed_at: string | null;
    } | null;
  };
  lead: {
    id: string;
    source: string;
    stage: string;
    createdAt: string;
    ownerNames: string | null;
    assignedTo: string | null;
  } | null;
  handoff: { id: string; status: string; summary: string | null; assignedTo: string | null } | null;
  properties: (PropertyRecord & { raw: PropertyRow & { verification_flags?: unknown } })[];
  protests: ProtestRecord[];
  bills: {
    id: string;
    propertyId: string;
    taxYear: number | null;
    amountDue: number | null;
    dueDate: string | null;
    status: string | null;
    paidAt: string | null;
  }[];
  documents: DocumentInfo[];
  packetSigned: boolean;
  tickets: {
    id: string;
    number: number;
    subject: string;
    status: TicketStatus;
    priority: TicketPriority;
    category: TicketCategory | null;
    createdAt: string;
    dueAt: string;
    propertyId: string | null;
  }[];
  events: {
    at: string;
    department: string;
    action: string;
    summary: string;
    actor: string | null;
  }[];
  subscriptionEvents: {
    id: string;
    created_at: string;
    kind: string;
    amount_cents: number | null;
    detail: string | null;
    property_id: string | null;
  }[];
};

export async function getCustomerDetail(profileId: string): Promise<CustomerDetail> {
  const { data, error } = await supabase.rpc("support_customer_detail", { p_profile: profileId });
  if (error) throw error;
  const d = data as Omit<CustomerDetail, "properties" | "protests"> & {
    properties: (PropertyRow & { verification_flags?: unknown })[];
    protests: ProtestRow[];
  };
  return {
    ...d,
    properties: (d.properties ?? []).map((r) => ({ ...propertyFromRow(r), raw: r })),
    protests: (d.protests ?? []).map((r) => protestFromRow(r)),
    documents: d.documents ?? [],
    tickets: d.tickets ?? [],
    events: d.events ?? [],
    bills: d.bills ?? [],
    subscriptionEvents: d.subscriptionEvents ?? [],
  };
}

export async function listTeam(): Promise<TeamMember[]> {
  const { data, error } = await supabase.rpc("support_team");
  if (error) throw error;
  return (
    (data ?? []) as { id: string; name: string; supervisor: boolean; super_admin: boolean }[]
  ).map((r) => ({
    id: r.id,
    name: r.name,
    supervisor: r.supervisor,
    superAdmin: r.super_admin,
  }));
}

export async function setOnboarding(
  profileId: string,
  patch: {
    owner?: string | null;
    status?: "not_started" | "in_progress" | "complete";
    notes?: string | null;
  },
) {
  const row: Record<string, unknown> = {
    profile_id: profileId,
    updated_at: new Date().toISOString(),
  };
  if (patch.owner !== undefined) row.owner = patch.owner;
  if (patch.notes !== undefined) row.notes = patch.notes;
  if (patch.status !== undefined) {
    row.status = patch.status;
    row.completed_at = patch.status === "complete" ? new Date().toISOString() : null;
  }
  const { error } = await supabase
    .from("support_onboarding")
    .upsert(row, { onConflict: "profile_id" });
  if (error) throw error;
}

const TICKET_COLUMNS =
  "id, number, created_at, updated_at, profile_id, property_id, subject, category, priority, status, source, assigned_to, created_by, due_at, first_response_at, resolved_at, reopened_count, escalated_to, escalation_reason, ai_summary, rating, rating_comment, feedback_token";

export async function listTickets(
  opts: { profileId?: string; includeClosed?: boolean } = {},
): Promise<Ticket[]> {
  let q = supabase
    .from("support_tickets")
    .select(TICKET_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(500);
  if (opts.profileId) q = q.eq("profile_id", opts.profileId);
  if (!opts.includeClosed) q = q.not("status", "in", "(resolved,closed)");
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as TicketRow[]).map(ticketFromRow);
}

export async function getTicket(
  id: string,
): Promise<{ ticket: Ticket; messages: TicketMessage[] }> {
  const [t, m] = await Promise.all([
    supabase.from("support_tickets").select(TICKET_COLUMNS).eq("id", id).single(),
    supabase
      .from("support_ticket_messages")
      .select(
        "id, ticket_id, created_at, author_id, kind, body, ai_drafted, automated, sent_at, send_error",
      )
      .eq("ticket_id", id)
      .order("created_at"),
  ]);
  if (t.error) throw t.error;
  type MsgRow = {
    id: string;
    ticket_id: string;
    created_at: string;
    author_id: string | null;
    kind: TicketMessage["kind"];
    body: string;
    ai_drafted: boolean;
    automated: boolean;
    sent_at: string | null;
    send_error: string | null;
  };
  return {
    ticket: ticketFromRow(t.data as TicketRow),
    messages: ((m.data ?? []) as MsgRow[]).map((r) => ({
      id: r.id,
      ticketId: r.ticket_id,
      createdAt: r.created_at,
      authorId: r.author_id,
      kind: r.kind,
      body: r.body,
      aiDrafted: r.ai_drafted,
      automated: r.automated,
      sentAt: r.sent_at,
      sendError: r.send_error,
    })),
  };
}

export async function createTicket(input: {
  profileId: string | null;
  propertyId: string | null;
  subject: string;
  category: TicketCategory | null;
  priority: TicketPriority;
  source: Ticket["source"];
  assignedTo: string | null;
  message: string;
}): Promise<Ticket> {
  const { data, error } = await supabase
    .from("support_tickets")
    .insert({
      profile_id: input.profileId,
      property_id: input.propertyId,
      subject: input.subject.trim(),
      category: input.category,
      priority: input.priority,
      source: input.source,
      assigned_to: input.assignedTo,
    })
    .select(TICKET_COLUMNS)
    .single();
  if (error) throw error;
  const t = ticketFromRow(data as TicketRow);
  if (input.message.trim()) {
    const { data: u } = await supabase.auth.getUser();
    await supabase.from("support_ticket_messages").insert({
      ticket_id: t.id,
      kind: input.source === "staff" ? "internal_note" : "customer_message",
      body: input.message.trim(),
      author_id: u.user?.id,
    });
  }
  return t;
}

export async function updateTicket(
  id: string,
  patch: Partial<{
    status: TicketStatus;
    priority: TicketPriority;
    category: TicketCategory | null;
    assigned_to: string | null;
    property_id: string | null;
    profile_id: string | null;
    escalated_to: Ticket["escalatedTo"];
    escalation_reason: string | null;
  }>,
) {
  const { error } = await supabase.from("support_tickets").update(patch).eq("id", id);
  if (error) throw error;
}

export async function addTicketNote(
  ticketId: string,
  kind: "internal_note" | "customer_message",
  body: string,
) {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("support_ticket_messages")
    .insert({ ticket_id: ticketId, kind, body: body.trim(), author_id: u.user?.id });
  if (error) throw error;
}

export async function listPermissions(): Promise<SupportPermission[]> {
  const { data, error } = await supabase
    .from("support_permissions")
    .select("key, label, description, enabled")
    .order("label");
  if (error) throw error;
  return (data ?? []) as SupportPermission[];
}
export async function setPermission(key: string, enabled: boolean) {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("support_permissions")
    .update({ enabled, updated_at: new Date().toISOString(), updated_by: u.user?.id })
    .eq("key", key);
  if (error) throw error;
}

export async function listTemplates(): Promise<SupportTemplate[]> {
  const { data, error } = await supabase
    .from("support_templates")
    .select("id, key, purpose, name, subject, body, approved")
    .order("purpose");
  if (error) throw error;
  return (data ?? []) as SupportTemplate[];
}
export async function saveTemplate(
  t: Partial<SupportTemplate> & {
    name: string;
    subject: string;
    body: string;
    purpose: SupportTemplate["purpose"];
  },
) {
  const row = { ...t, updated_at: new Date().toISOString() };
  const { error } = t.id
    ? await supabase.from("support_templates").update(row).eq("id", t.id)
    : await supabase.from("support_templates").insert(row);
  if (error) throw error;
}

export async function listKnowledge(): Promise<KnowledgeEntry[]> {
  const { data, error } = await supabase
    .from("support_knowledge")
    .select("id, kind, title, body, active")
    .order("kind")
    .order("title");
  if (error) throw error;
  return (data ?? []) as KnowledgeEntry[];
}
export async function saveKnowledge(
  k: Partial<KnowledgeEntry> & { kind: KnowledgeEntry["kind"]; title: string; body: string },
) {
  const row = { ...k, updated_at: new Date().toISOString() };
  const { error } = k.id
    ? await supabase.from("support_knowledge").update(row).eq("id", k.id)
    : await supabase.from("support_knowledge").insert(row);
  if (error) throw error;
}

export async function listDiscountPolicies(): Promise<DiscountPolicy[]> {
  const { data, error } = await supabase
    .from("support_discount_policies")
    .select("id, label, stripe_coupon_id, description, active")
    .order("label");
  if (error) throw error;
  return (data ?? []) as DiscountPolicy[];
}
export async function saveDiscountPolicy(
  p: Partial<DiscountPolicy> & { label: string; stripe_coupon_id: string },
) {
  const { error } = p.id
    ? await supabase.from("support_discount_policies").update(p).eq("id", p.id)
    : await supabase.from("support_discount_policies").insert(p);
  if (error) throw error;
}

export async function setSupervisor(profileId: string, enabled: boolean) {
  const { error } = await supabase.rpc("set_support_supervisor", { target: profileId, enabled });
  if (error) throw error;
}

export type Analytics = {
  ticketsOpened: number;
  ticketsResolved: number;
  openNow: number;
  overdueNow: number;
  avgFirstResponseHours: number | null;
  avgResolutionHours: number | null;
  withinSla: number | null;
  reopened: number;
  avgRating: number | null;
  ratings: number;
  byCategory: Record<string, number>;
  onboardingOwned: number;
  onboardingCompleted: number;
  onboardingInProgress: number;
  renewals: number;
  cancellations: number;
  cancelScheduled: number;
  failedPayments: number;
  feedbackResponses: number;
  workload: {
    id: string;
    name: string;
    supervisor: boolean;
    openTickets: number;
    overdue: number;
    resolvedInRange: number;
    onboarding: number;
  }[];
  recurring: { subject: string; count: number }[];
};
export async function supportAnalytics(
  from: string,
  to: string,
  staff: string | null,
): Promise<Analytics> {
  const { data, error } = await supabase.rpc("support_analytics", {
    p_from: from,
    p_to: to,
    p_staff: staff,
  });
  if (error) throw error;
  return data as Analytics;
}

// ── server function ───────────────────────────────────────────────────────

export function supportAction<T = Record<string, unknown>>(
  action: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  return invokeEdgeFunction<T>("support-console", { action, ...body });
}

export type Billing = {
  mode: "test" | "live";
  customer: string | null;
  covered: {
    kind: string;
    id: string;
    label: string;
    subscriptionId: string | null;
    status: string | null;
    plan: string | null;
  }[];
  subscriptions: {
    id: string;
    covers: string | null;
    status: string;
    interval: string | null;
    amountCents: number | null;
    startedAt: string;
    currentPeriodEnd: string;
    cancelAt: string | null;
    cancelAtPeriodEnd: boolean;
    committed: boolean;
    discount: string | null;
  }[];
  invoices: {
    id: string;
    number: string | null;
    status: string | null;
    amountDueCents: number;
    amountPaidCents: number;
    createdAt: string;
    dueAt: string | null;
    covers: string | null;
    url: string | null;
    attempts: number;
  }[];
  payments: {
    id: string;
    amountCents: number;
    refundedCents: number;
    status: string;
    createdAt: string;
    card: string | null;
    failure: string | null;
    receiptUrl: string | null;
  }[];
  permissions: {
    resendInvoices: boolean;
    paymentLinks: boolean;
    discounts: boolean;
    cancellations: boolean;
  };
  discountPolicies: { id: string; label: string; description: string | null }[];
};

export const cents = (n: number | null | undefined) =>
  n == null
    ? "—"
    : `$${(n / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const shortDate = (iso: string | null | undefined) =>
  iso
    ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

// CSV for permission-controlled exports (the page checks the permission).
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(cell).join(",")).join("\n");
}
