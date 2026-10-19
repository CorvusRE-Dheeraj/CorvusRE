// Marketing Admin data layer — shared by all six tabs of /marketing so every tab
// reads the same records (one lead per person; activities, follow-ups and
// campaigns all hang off leads) and nothing is entered twice.
// Tables + access rules: supabase/pt/marketing.sql (marketing-admin only).
import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";
import { askAboutDocument } from "./document-ai";
import { daysUntilIso } from "./local-day";

export const STAGES = ["new", "contacted", "interested", "registered", "customer", "lost"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = {
  new: "New",
  contacted: "Contacted",
  interested: "Interested",
  registered: "Registered",
  customer: "Paying customer",
  lost: "Lost",
};
export const SOURCES = [
  "manual",
  "beta_signup",
  "registered",
  "referral",
  "website",
  "import",
  "event",
] as const;
export type Source = (typeof SOURCES)[number];
export const SOURCE_LABEL: Record<Source, string> = {
  manual: "Added by hand",
  beta_signup: "Beta signup",
  registered: "Signed up",
  referral: "Referral",
  website: "Website",
  import: "Import",
  event: "Event",
};

export type Lead = {
  id: string;
  createdAt: string;
  updatedAt: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  source: Source;
  stage: Stage;
  propertyAddress: string | null;
  county: string | null;
  propertyType: string | null;
  appraisedValue: number | null;
  protestDeadline: string | null;
  ownerNames: string | null;
  profileId: string | null;
  tags: string[];
  notes: string | null;
  aiSummary: string | null;
  aiSummaryAt: string | null;
  lastContactedAt: string | null;
  unsubscribedAt: string | null;
};

export type Activity = {
  id: string;
  createdAt: string;
  leadId: string | null;
  campaignId: string | null;
  kind: "note" | "email" | "sms" | "call" | "stage" | "ai" | "follow_up" | "campaign";
  summary: string;
  body: string | null;
};

export type CampaignStatus = "draft" | "approved" | "scheduled" | "sending" | "sent" | "paused";
export type Audience = {
  stages?: Stage[];
  counties?: string[];
  propertyTypes?: string[];
  leadIds?: string[];
};
export type Campaign = {
  id: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  channel: "email" | "sms";
  status: CampaignStatus;
  audience: Audience;
  subject: string | null;
  body: string | null;
  scheduledAt: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  pausedAt: string | null;
  stats: { targeted?: number; sent?: number; failed?: number; errors?: string[] };
};

export type Followup = {
  id: string;
  createdAt: string;
  leadId: string;
  dueAt: string;
  channel: "email" | "sms" | "call" | "task";
  subject: string | null;
  message: string | null;
  status: "pending" | "done" | "skipped";
  sequenceName: string | null;
  sequenceStep: number | null;
  aiGenerated: boolean;
  completedAt: string | null;
};

export type AiRun = {
  id: string;
  createdAt: string;
  scope: string;
  instruction: string;
  result: string | null;
  leadId: string | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const toLead = (r: any): Lead => ({
  id: r.id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  fullName: r.full_name,
  email: r.email,
  phone: r.phone,
  company: r.company,
  source: r.source,
  stage: r.stage,
  propertyAddress: r.property_address,
  county: r.county,
  propertyType: r.property_type,
  appraisedValue: r.appraised_value == null ? null : Number(r.appraised_value),
  protestDeadline: r.protest_deadline,
  ownerNames: r.owner_names,
  profileId: r.profile_id,
  tags: r.tags ?? [],
  notes: r.notes,
  aiSummary: r.ai_summary,
  aiSummaryAt: r.ai_summary_at,
  lastContactedAt: r.last_contacted_at,
  unsubscribedAt: r.unsubscribed_at,
});
const toActivity = (r: any): Activity => ({
  id: r.id,
  createdAt: r.created_at,
  leadId: r.lead_id,
  campaignId: r.campaign_id,
  kind: r.kind,
  summary: r.summary,
  body: r.body,
});
const toCampaign = (r: any): Campaign => ({
  id: r.id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  name: r.name,
  channel: r.channel,
  status: r.status,
  audience: r.audience ?? {},
  subject: r.subject,
  body: r.body,
  scheduledAt: r.scheduled_at,
  approvedAt: r.approved_at,
  sentAt: r.sent_at,
  pausedAt: r.paused_at,
  stats: r.stats ?? {},
});
const toFollowup = (r: any): Followup => ({
  id: r.id,
  createdAt: r.created_at,
  leadId: r.lead_id,
  dueAt: r.due_at,
  channel: r.channel,
  subject: r.subject,
  message: r.message,
  status: r.status,
  sequenceName: r.sequence_name,
  sequenceStep: r.sequence_step,
  aiGenerated: r.ai_generated,
  completedAt: r.completed_at,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Role ────────────────────────────────────────────────────────────────────
export type StaffRole = { isSuperAdmin: boolean; isMarketingAdmin: boolean };
export async function getStaffRole(userId: string): Promise<StaffRole> {
  const { data } = await supabase
    .from("profiles")
    .select("is_admin, marketing_admin")
    .eq("id", userId)
    .maybeSingle();
  return { isSuperAdmin: !!data?.is_admin, isMarketingAdmin: !!data?.marketing_admin };
}

/** Super Admin only (enforced in the database). */
export async function setMarketingAdmin(userId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_marketing_admin", { target: userId, enabled });
  if (error) throw error;
}

// ── Load everything (small tables; one load keeps every tab in sync) ────────
export type MarketingData = {
  leads: Lead[];
  activities: Activity[];
  campaigns: Campaign[];
  followups: Followup[];
  aiRuns: AiRun[];
};

export async function syncLeads(): Promise<{ betaSignups: number; registeredUsers: number }> {
  const { data, error } = await supabase.rpc("marketing_sync_leads");
  if (error) throw error;
  return data as { betaSignups: number; registeredUsers: number };
}

export async function loadMarketing(): Promise<MarketingData> {
  const [l, a, c, f, r] = await Promise.all([
    supabase
      .from("marketing_leads")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(2000),
    supabase
      .from("marketing_activities")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase.from("marketing_campaigns").select("*").order("created_at", { ascending: false }),
    supabase
      .from("marketing_followups")
      .select("*")
      .order("due_at", { ascending: true })
      .limit(2000),
    supabase
      .from("marketing_ai_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  for (const res of [l, a, c, f, r]) if (res.error) throw res.error;
  return {
    leads: (l.data ?? []).map(toLead),
    activities: (a.data ?? []).map(toActivity),
    campaigns: (c.data ?? []).map(toCampaign),
    followups: (f.data ?? []).map(toFollowup),
    aiRuns: (r.data ?? []).map((x) => ({
      id: x.id,
      createdAt: x.created_at,
      scope: x.scope,
      instruction: x.instruction,
      result: x.result,
      leadId: x.lead_id,
    })),
  };
}

// ── Leads ───────────────────────────────────────────────────────────────────
export type LeadInput = Partial<
  Omit<Lead, "id" | "createdAt" | "updatedAt" | "profileId" | "unsubscribedAt">
>;
const leadRow = (p: LeadInput) => {
  const row: Record<string, unknown> = {};
  const map: [keyof LeadInput, string][] = [
    ["fullName", "full_name"],
    ["email", "email"],
    ["phone", "phone"],
    ["company", "company"],
    ["source", "source"],
    ["stage", "stage"],
    ["propertyAddress", "property_address"],
    ["county", "county"],
    ["propertyType", "property_type"],
    ["appraisedValue", "appraised_value"],
    ["protestDeadline", "protest_deadline"],
    ["ownerNames", "owner_names"],
    ["tags", "tags"],
    ["notes", "notes"],
    ["aiSummary", "ai_summary"],
    ["aiSummaryAt", "ai_summary_at"],
    ["lastContactedAt", "last_contacted_at"],
  ];
  for (const [k, col] of map) if (p[k] !== undefined) row[col] = p[k] === "" ? null : p[k];
  return row;
};

export async function createLead(input: LeadInput): Promise<Lead> {
  const { data, error } = await supabase
    .from("marketing_leads")
    .insert({ source: "manual", ...leadRow(input) })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505")
      throw new Error("A lead with this email already exists — open it instead.");
    throw error;
  }
  return toLead(data);
}

export async function updateLead(id: string, patch: LeadInput): Promise<Lead> {
  const { data, error } = await supabase
    .from("marketing_leads")
    .update(leadRow(patch))
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return toLead(data);
}

export async function deleteLead(id: string): Promise<void> {
  const { error } = await supabase.from("marketing_leads").delete().eq("id", id);
  if (error) throw error;
}

export async function logActivity(a: {
  leadId?: string | null;
  campaignId?: string | null;
  kind: Activity["kind"];
  summary: string;
  body?: string | null;
}): Promise<Activity> {
  const { data: u } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("marketing_activities")
    .insert({
      lead_id: a.leadId ?? null,
      campaign_id: a.campaignId ?? null,
      kind: a.kind,
      summary: a.summary,
      body: a.body ?? null,
      created_by: u.user?.id ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return toActivity(data);
}

/** Change stage and record it in the lead's history in one step. */
export async function setLeadStage(lead: Lead, stage: Stage): Promise<Lead> {
  const next = await updateLead(lead.id, { stage });
  await logActivity({
    leadId: lead.id,
    kind: "stage",
    summary: `Stage: ${STAGE_LABEL[lead.stage]} → ${STAGE_LABEL[stage]}`,
  });
  return next;
}

// ── Campaigns ───────────────────────────────────────────────────────────────
export type CampaignInput = Partial<
  Pick<Campaign, "name" | "channel" | "status" | "audience" | "subject" | "body" | "scheduledAt">
>;
export async function saveCampaign(id: string | null, input: CampaignInput): Promise<Campaign> {
  const row: Record<string, unknown> = {};
  if (input.name !== undefined) row.name = input.name;
  if (input.channel !== undefined) row.channel = input.channel;
  if (input.status !== undefined) row.status = input.status;
  if (input.audience !== undefined) row.audience = input.audience;
  if (input.subject !== undefined) row.subject = input.subject;
  if (input.body !== undefined) row.body = input.body;
  if (input.scheduledAt !== undefined) row.scheduled_at = input.scheduledAt;
  const { data: u } = await supabase.auth.getUser();
  const q = id
    ? supabase.from("marketing_campaigns").update(row).eq("id", id)
    : supabase.from("marketing_campaigns").insert({ created_by: u.user?.id ?? null, ...row });
  const { data, error } = await q.select("*").single();
  if (error) throw error;
  return toCampaign(data);
}

export async function setCampaignStatus(c: Campaign, status: CampaignStatus): Promise<Campaign> {
  const { data: u } = await supabase.auth.getUser();
  const row: Record<string, unknown> = { status };
  if (status === "approved") {
    row.approved_by = u.user?.id ?? null;
    row.approved_at = new Date().toISOString();
  }
  if (status === "paused") row.paused_at = new Date().toISOString();
  const { data, error } = await supabase
    .from("marketing_campaigns")
    .update(row)
    .eq("id", c.id)
    .select("*")
    .single();
  if (error) throw error;
  await logActivity({
    campaignId: c.id,
    kind: "campaign",
    summary: `Campaign "${c.name}" ${status}`,
  });
  return toCampaign(data);
}

export async function deleteCampaign(id: string): Promise<void> {
  const { error } = await supabase.from("marketing_campaigns").delete().eq("id", id);
  if (error) throw error;
}

export function audienceLeads(audience: Audience, leads: Lead[]): Lead[] {
  return leads.filter((l) => {
    if (!l.email || l.unsubscribedAt) return false;
    if (audience.leadIds?.length) return audience.leadIds.includes(l.id);
    if (audience.stages?.length ? !audience.stages.includes(l.stage) : l.stage === "lost")
      return false;
    if (audience.counties?.length && !audience.counties.includes(l.county ?? "")) return false;
    if (audience.propertyTypes?.length && !audience.propertyTypes.includes(l.propertyType ?? ""))
      return false;
    return true;
  });
}

export async function sendCampaign(campaignId: string) {
  return invokeEdgeFunction<{ targeted: number; sent: number; failed: number; errors?: string[] }>(
    "admin-update-plan?action=marketing-send",
    { campaignId },
  );
}

// ── Follow-ups ──────────────────────────────────────────────────────────────
export type FollowupInput = Partial<
  Pick<
    Followup,
    | "leadId"
    | "dueAt"
    | "channel"
    | "subject"
    | "message"
    | "status"
    | "sequenceName"
    | "sequenceStep"
    | "aiGenerated"
  >
>;
export async function saveFollowup(id: string | null, f: FollowupInput): Promise<Followup> {
  const row: Record<string, unknown> = {};
  if (f.leadId !== undefined) row.lead_id = f.leadId;
  if (f.dueAt !== undefined) row.due_at = f.dueAt;
  if (f.channel !== undefined) row.channel = f.channel;
  if (f.subject !== undefined) row.subject = f.subject;
  if (f.message !== undefined) row.message = f.message;
  if (f.status !== undefined) {
    row.status = f.status;
    row.completed_at = f.status === "pending" ? null : new Date().toISOString();
  }
  if (f.sequenceName !== undefined) row.sequence_name = f.sequenceName;
  if (f.sequenceStep !== undefined) row.sequence_step = f.sequenceStep;
  if (f.aiGenerated !== undefined) row.ai_generated = f.aiGenerated;
  const { data: u } = await supabase.auth.getUser();
  const q = id
    ? supabase.from("marketing_followups").update(row).eq("id", id)
    : supabase.from("marketing_followups").insert({ created_by: u.user?.id ?? null, ...row });
  const { data, error } = await q.select("*").single();
  if (error) throw error;
  return toFollowup(data);
}

export async function sendFollowupEmail(followupId: string) {
  return invokeEdgeFunction<{ sent: number }>("admin-update-plan?action=marketing-send", {
    followupId,
  });
}

// ── Scoring (one rule, used everywhere) ─────────────────────────────────────
export type Score = { score: number; reasons: string[] };
export function scoreLead(lead: Lead, activities: Activity[], now = new Date()): Score {
  if (lead.stage === "customer") return { score: 0, reasons: ["Already a paying customer"] };
  if (lead.stage === "lost") return { score: 0, reasons: ["Marked lost"] };
  let s = 0;
  const reasons: string[] = [];
  const v = lead.appraisedValue ?? 0;
  const valuePts = v >= 5e6 ? 30 : v >= 2e6 ? 25 : v >= 1e6 ? 20 : v >= 5e5 ? 12 : v > 0 ? 5 : 0;
  if (valuePts) {
    s += valuePts;
    reasons.push(`Property value $${Math.round(v).toLocaleString("en-US")}`);
  }
  const days = daysUntilIso(lead.protestDeadline, now);
  if (days != null && days >= 0 && days <= 60) {
    s += days <= 30 ? 20 : 12;
    reasons.push(`Protest deadline in ${days} days`);
  }
  const stagePts: Record<Stage, number> = {
    new: 5,
    contacted: 10,
    interested: 20,
    registered: 15,
    customer: 0,
    lost: 0,
  };
  s += stagePts[lead.stage];
  if (lead.stage === "interested") reasons.push("Said they're interested");
  if (lead.stage === "registered") reasons.push("Has an account, not paying yet");
  const recent = activities.filter(
    (a) => a.leadId === lead.id && now.getTime() - new Date(a.createdAt).getTime() < 14 * 864e5,
  ).length;
  if (recent) {
    s += Math.min(15, recent * 5);
    reasons.push(`${recent} touchpoint${recent === 1 ? "" : "s"} in the last 2 weeks`);
  }
  if (lead.email) s += 5;
  if (lead.phone) s += 5;
  if (lead.source === "referral" || lead.source === "registered") s += 5;
  return { score: Math.min(100, s), reasons };
}

export const scoreBand = (n: number) => (n >= 60 ? "high" : n >= 35 ? "medium" : "low");

// ── Metrics ─────────────────────────────────────────────────────────────────
export function funnel(leads: Lead[], now = new Date()) {
  const count = (st: Stage[]) => leads.filter((l) => st.includes(l.stage)).length;
  const total = leads.length;
  const newLeads = leads.filter(
    (l) => now.getTime() - new Date(l.createdAt).getTime() < 7 * 864e5,
  ).length;
  const registered = count(["registered", "customer"]);
  const paying = count(["customer"]);
  return {
    total,
    newLeads,
    activeProspects: count(["new", "contacted", "interested"]),
    // Someone actually reached out — a contacted/interested stage or a logged
    // contact. (Users who signed up on their own were never "contacted".)
    contacted: leads.filter(
      (l) => l.stage === "contacted" || l.stage === "interested" || !!l.lastContactedAt,
    ).length,
    interested: count(["interested"]),
    registered,
    paying,
    leadToRegistered: total ? registered / total : 0,
    registeredToPaying: registered ? paying / registered : 0,
    leadToPaying: total ? paying / total : 0,
  };
}

// ── AI monitor: what needs attention, with where to go ──────────────────────
export type Alert = {
  id: string;
  severity: "critical" | "warning" | "info";
  kind: "priority" | "overdue" | "deadline" | "campaign" | "opportunity";
  title: string;
  detail: string;
  tab: "leads" | "campaigns" | "followups";
  leadId?: string;
  campaignId?: string;
};

export function monitor(d: MarketingData, now = new Date()): Alert[] {
  const out: Alert[] = [];
  const name = (l: Lead) => l.fullName || l.email || "Unnamed lead";
  const leadById = new Map(d.leads.map((l) => [l.id, l]));
  for (const f of d.followups) {
    if (f.status !== "pending" || new Date(f.dueAt) >= now) continue;
    const l = leadById.get(f.leadId);
    const late = Math.max(1, Math.round((now.getTime() - new Date(f.dueAt).getTime()) / 864e5));
    out.push({
      id: `overdue-${f.id}`,
      severity: late > 3 ? "critical" : "warning",
      kind: "overdue",
      title: `Overdue ${f.channel === "task" ? "task" : f.channel}: ${l ? name(l) : "lead"}`,
      detail: `${late} day${late === 1 ? "" : "s"} late${f.subject ? ` · ${f.subject}` : ""}`,
      tab: "followups",
      leadId: f.leadId,
    });
  }
  for (const l of d.leads) {
    if (l.stage === "customer" || l.stage === "lost") continue;
    const days = daysUntilIso(l.protestDeadline, now);
    if (days != null && days >= 0 && days <= 21)
      out.push({
        id: `deadline-${l.id}`,
        severity: days <= 7 ? "critical" : "warning",
        kind: "deadline",
        title: `Protest deadline in ${days} day${days === 1 ? "" : "s"}: ${name(l)}`,
        detail:
          [l.propertyAddress, l.county && `${l.county} County`].filter(Boolean).join(" · ") ||
          "Contact before the deadline passes",
        tab: "leads",
        leadId: l.id,
      });
    const { score } = scoreLead(l, d.activities, now);
    const idle = l.lastContactedAt
      ? (now.getTime() - new Date(l.lastContactedAt).getTime()) / 864e5
      : Infinity;
    const hasPending = d.followups.some((f) => f.leadId === l.id && f.status === "pending");
    if (score >= 60 && idle > 3 && !hasPending)
      out.push({
        id: `priority-${l.id}`,
        severity: "warning",
        kind: "priority",
        title: `High-priority lead not contacted: ${name(l)}`,
        detail: `Score ${score}${Number.isFinite(idle) ? ` · last contact ${Math.round(idle)} days ago` : " · never contacted"}`,
        tab: "leads",
        leadId: l.id,
      });
    if (l.stage === "registered" && (l.appraisedValue ?? 0) >= 5e5 && !hasPending)
      out.push({
        id: `opp-${l.id}`,
        severity: "info",
        kind: "opportunity",
        title: `Conversion opportunity: ${name(l)}`,
        detail: `Signed up, not paying — $${Math.round(l.appraisedValue ?? 0).toLocaleString("en-US")} property`,
        tab: "leads",
        leadId: l.id,
      });
  }
  for (const c of d.campaigns) {
    if (
      c.status === "scheduled" &&
      c.scheduledAt &&
      now.getTime() - new Date(c.scheduledAt).getTime() > 2 * 36e5
    )
      out.push({
        id: `camp-late-${c.id}`,
        severity: "critical",
        kind: "campaign",
        title: `Scheduled campaign didn't send: ${c.name}`,
        detail: "Its send time passed — open it and send or reschedule.",
        tab: "campaigns",
        campaignId: c.id,
      });
    const t = c.stats.targeted ?? 0;
    if (c.status === "sent" && t > 0 && (c.stats.failed ?? 0) / t > 0.1)
      out.push({
        id: `camp-fail-${c.id}`,
        severity: "warning",
        kind: "campaign",
        title: `High failure rate: ${c.name}`,
        detail: `${c.stats.failed} of ${t} emails failed — check the addresses.`,
        tab: "campaigns",
        campaignId: c.id,
      });
    if (
      c.status === "approved" &&
      c.approvedAt &&
      now.getTime() - new Date(c.approvedAt).getTime() > 3 * 864e5
    )
      out.push({
        id: `camp-idle-${c.id}`,
        severity: "info",
        kind: "campaign",
        title: `Approved but not sent: ${c.name}`,
        detail: "Send it or schedule it.",
        tab: "campaigns",
        campaignId: c.id,
      });
    if (
      c.status === "paused" &&
      c.pausedAt &&
      now.getTime() - new Date(c.pausedAt).getTime() > 7 * 864e5
    )
      out.push({
        id: `camp-paused-${c.id}`,
        severity: "info",
        kind: "campaign",
        title: `Paused over a week: ${c.name}`,
        detail: "Resume it or remove it.",
        tab: "campaigns",
        campaignId: c.id,
      });
  }
  const rank = { critical: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

// ── AI (Corvus AI) ──────────────────────────────────────────────────────────
const AI_RULES =
  "You are Corvus AI, the marketing assistant for CorvusPT (Texas property tax protest software for property owners). " +
  "Use ONLY the facts given. Never invent leads, numbers, or results. Be concise and practical. " +
  "Never mention customers' protest cases or legal filings — you only see marketing data.";

export function leadFacts(l: Lead, acts: Activity[], fups: Followup[]): string {
  const hist = acts
    .filter((a) => a.leadId === l.id)
    .slice(0, 8)
    .map((a) => `- ${a.createdAt.slice(0, 10)} ${a.kind}: ${a.summary}`)
    .join("\n");
  const pending = fups
    .filter((f) => f.leadId === l.id && f.status === "pending")
    .map((f) => `- due ${f.dueAt.slice(0, 10)} ${f.channel}: ${f.subject ?? ""}`)
    .join("\n");
  return [
    `Name: ${l.fullName ?? "unknown"}; company: ${l.company ?? "-"}; email: ${l.email ? "yes" : "no"}; phone: ${l.phone ? "yes" : "no"}`,
    `Source: ${SOURCE_LABEL[l.source]}; stage: ${STAGE_LABEL[l.stage]}; created ${l.createdAt.slice(0, 10)}`,
    `Property: ${l.propertyAddress ?? "-"}; county: ${l.county ?? "-"}; type: ${l.propertyType ?? "-"}; appraised value: ${l.appraisedValue ?? "-"}; protest deadline: ${l.protestDeadline ?? "-"}`,
    `Notes: ${l.notes ?? "-"}`,
    `History:\n${hist || "- none"}`,
    `Pending follow-ups:\n${pending || "- none"}`,
  ].join("\n");
}

export async function runAi(opts: {
  scope: string;
  instruction: string;
  context: string;
  leadId?: string | null;
  campaignId?: string | null;
}): Promise<AiRun> {
  const { answer } = await askAboutDocument({
    question: `${AI_RULES}\n\nTask: ${opts.instruction}`,
    context: opts.context,
  });
  const { data: u } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("marketing_ai_runs")
    .insert({
      scope: opts.scope,
      instruction: opts.instruction,
      result: answer,
      lead_id: opts.leadId ?? null,
      campaign_id: opts.campaignId ?? null,
      created_by: u.user?.id ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return {
    id: data.id,
    createdAt: data.created_at,
    scope: data.scope,
    instruction: data.instruction,
    result: data.result,
    leadId: data.lead_id,
  };
}

/** Splits an AI email draft written as "Subject: …\n\n<body>". */
export function splitDraft(text: string): { subject: string; body: string } {
  const m = text.match(/^\s*\**subject\**\s*:\s*(.+)$/im);
  const subject = m ? m[1].replace(/\*+/g, "").trim() : "";
  const body = (m ? text.slice(text.indexOf(m[0]) + m[0].length) : text)
    .replace(/^\s*\**(body|message)\**\s*:\s*/im, "")
    .replace(/\*\*/g, "")
    .trim();
  return { subject, body };
}

export function summaryForAi(d: MarketingData, now = new Date()): string {
  const f = funnel(d.leads, now);
  const alerts = monitor(d, now).slice(0, 12);
  const top = d.leads
    .map((l) => ({ l, s: scoreLead(l, d.activities, now).score }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 8);
  return [
    `Funnel: ${f.total} leads, ${f.newLeads} new this week, ${f.activeProspects} active prospects, ${f.interested} interested, ${f.registered} registered, ${f.paying} paying. Lead→paying ${(f.leadToPaying * 100).toFixed(1)}%.`,
    `Campaigns: ${d.campaigns.map((c) => `${c.name} (${c.channel}, ${c.status}${c.stats.sent != null ? `, sent ${c.stats.sent}/${c.stats.targeted}` : ""})`).join("; ") || "none"}`,
    `Pending follow-ups: ${d.followups.filter((x) => x.status === "pending").length} (${d.followups.filter((x) => x.status === "pending" && new Date(x.dueAt) < now).length} overdue)`,
    `Alerts:\n${alerts.map((a) => `- [${a.severity}] ${a.title} — ${a.detail}`).join("\n") || "- none"}`,
    `Top leads by score:\n${top.map(({ l, s }) => `- ${l.fullName ?? l.email} (score ${s}, ${STAGE_LABEL[l.stage]}, ${l.county ?? "?"} County, value ${l.appraisedValue ?? "?"})`).join("\n") || "- none"}`,
  ].join("\n");
}

export const relDays = (iso: string | null, now = new Date()) => {
  if (!iso) return "never";
  const d = Math.round((now.getTime() - new Date(iso).getTime()) / 864e5);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
};
export const money = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`;
export const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 && x > 0 ? 1 : 0)}%`;
