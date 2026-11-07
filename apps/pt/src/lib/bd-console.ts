import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";
import {
  ADDITIONAL_PROPERTY_DISCOUNT,
  TIER_BRACKET_PRICES,
  TIER_LABEL,
  type Tier,
} from "./billing";

// Business Development Admin console — data access and shared pure helpers.
// Server side: supabase/pt/bd-console.sql and the bd-console edge function.
// Built on the existing CRM: an account (crm_accounts) groups existing
// marketing_leads (contacts), their properties and their activity.

// ── stages ─────────────────────────────────────────────────────────────────

export type Stage =
  | "identification"
  | "qualification"
  | "meeting"
  | "proposal"
  | "negotiation"
  | "agreement"
  | "activation"
  | "active"
  | "on_hold"
  | "lost";

export const PIPELINE: Stage[] = [
  "identification",
  "qualification",
  "meeting",
  "proposal",
  "negotiation",
  "agreement",
  "activation",
  "active",
];
export const STAGE_LABEL: Record<Stage, string> = {
  identification: "Identification",
  qualification: "Qualification",
  meeting: "Meetings",
  proposal: "Proposal",
  negotiation: "Negotiation",
  agreement: "Agreement",
  activation: "Customer activation",
  active: "Active customer",
  on_hold: "On hold",
  lost: "Lost",
};

export type OpportunityKind =
  "portfolio" | "enterprise" | "partnership" | "referral_partner" | "single_property";
export const KIND_LABEL: Record<OpportunityKind, string> = {
  portfolio: "Portfolio",
  enterprise: "Enterprise",
  partnership: "Partnership",
  referral_partner: "Referral partner",
  single_property: "Single property",
};
export type AccountKind =
  "property_owner" | "management_company" | "broker" | "investment_group" | "partner" | "other";
export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  property_owner: "Property owner",
  management_company: "Management company",
  broker: "Broker",
  investment_group: "Investment group",
  partner: "Potential partner",
  other: "Other",
};
export const CHANNELS = [
  "research",
  "marketing",
  "partner",
  "inbound",
  "outbound",
  "event",
  "other",
] as const;

// What's needed before moving to a stage (the database enforces the same).
export function stageBlocker(
  o: Pick<Opportunity, "agreementVerifiedAt" | "paymentVerifiedAt">,
  to: Stage,
): string | null {
  if ((to === "activation" || to === "active") && !o.agreementVerifiedAt)
    return "Verify the agreement first (a signed proposal, or a supervisor confirming a signed copy).";
  if (to === "active" && !o.paymentVerifiedAt)
    return "Verify payment first (a paid subscription on the customer's account).";
  return null;
}

// No movement and no activity for 21 days = stalled (same rule as the dashboard).
export function isStalled(
  o: Pick<Opportunity, "stage" | "stageChangedAt" | "lastActivityAt">,
  now = Date.now(),
): boolean {
  if (o.stage === "active" || o.stage === "lost" || o.stage === "on_hold") return false;
  const last = Math.max(
    Date.parse(o.stageChangedAt),
    o.lastActivityAt ? Date.parse(o.lastActivityAt) : 0,
  );
  return now - last > 21 * 864e5;
}

// ── approved pricing (same as checkout) ────────────────────────────────────

export type ProposalPricing = {
  tier: Tier;
  interval: "month" | "year";
  properties: number;
  discountPct: number;
  commitmentMonths: number | null;
  customTerms: string;
};

export function approvedQuote(tier: Tier, properties: number, interval: "month" | "year") {
  const first = TIER_BRACKET_PRICES[tier].upTo5m;
  const n = Math.max(1, Math.floor(properties || 1));
  const additional = Math.round(first * (1 - ADDITIONAL_PROPERTY_DISCOUNT) * 100) / 100;
  const monthly = Math.round((first + (n - 1) * additional) * 100) / 100;
  return {
    plan: TIER_LABEL[tier],
    first,
    additional,
    properties: n,
    monthly,
    annual: Math.round(monthly * 12),
    // yearly upfront: 50% off the first year
    firstYear: interval === "year" ? Math.round(monthly * 12 * 0.5) : Math.round(monthly * 12),
  };
}

// Departures from the approved terms — each needs a Super Admin approval
// before the proposal can be sent. Mirrors pricingDeviations() server side.
export function pricingDeviations(
  p: Partial<ProposalPricing>,
): { field: string; detail: string }[] {
  const out: { field: string; detail: string }[] = [];
  if (!p.tier) out.push({ field: "plan", detail: "No approved plan selected" });
  if ((p.discountPct ?? 0) > 0)
    out.push({ field: "discount", detail: `Custom discount of ${p.discountPct}%` });
  const commit = p.commitmentMonths;
  if (commit != null && commit !== 12)
    out.push({
      field: "commitment",
      detail:
        p.interval === "year"
          ? `${commit}-month term on a yearly plan`
          : `${commit}-month commitment instead of the standard 12`,
    });
  if ((p.customTerms ?? "").trim())
    out.push({ field: "terms", detail: `Custom terms: ${p.customTerms!.trim().slice(0, 160)}` });
  return out;
}

// Estimated vs confirmed vs registered vs subscribed — never mixed.
export type PropertyTiers = {
  estimated: number | null;
  identified: number;
  confirmed: number;
  registered: number;
  subscribed: number;
};

// ── types ──────────────────────────────────────────────────────────────────

export type Account = {
  id: string;
  name: string;
  kind: AccountKind;
  website: string | null;
  counties: string[];
  relationshipOwner: string | null;
  ownerLabel: string | null;
  contacts: number;
  decisionMakers: number;
  prospectProperties: number;
  registeredProperties: number;
  subscribedProperties: number;
  openOpportunities: number;
  pipelineValue: number;
  partner: boolean;
  lastContact: string | null;
  duplicateOfName: string | null;
  updatedAt: string;
};

export type Contact = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  title: string | null;
  decision_maker: boolean;
  profile_id: string | null;
  stage: string | null;
  source: string | null;
  unsubscribed_at: string | null;
  dnc_at: string | null;
  email_consent: "granted" | "unknown" | "withdrawn" | null;
  outreach_paused_at: string | null;
  account_id: string | null;
};

export type Opportunity = {
  id: string;
  createdAt: string;
  accountId: string;
  accountName?: string;
  primaryLeadId: string | null;
  title: string;
  kind: OpportunityKind;
  stage: Stage;
  stageReason: string | null;
  stageChangedAt: string;
  assignedTo: string | null;
  estPropertyCount: number | null;
  potentialValue: number | null;
  expectedClose: string | null;
  nextAction: string | null;
  nextActionAt: string | null;
  planTier: Tier | null;
  billingInterval: "month" | "year" | null;
  requirements: { multipleUsers?: boolean; centralizedBilling?: boolean; notes?: string };
  agreementVerifiedAt: string | null;
  agreementEvidence: string | null;
  paymentVerifiedAt: string | null;
  paymentEvidence: string | null;
  partnerId: string | null;
  sourceChannel: string | null;
  lastActivityAt: string | null;
};

type OppRow = {
  id: string;
  created_at: string;
  account_id: string;
  crm_accounts?: { name: string } | null;
  primary_lead_id: string | null;
  title: string;
  kind: OpportunityKind;
  stage: Stage;
  stage_reason: string | null;
  stage_changed_at: string;
  assigned_to: string | null;
  est_property_count: number | null;
  potential_value: number | null;
  expected_close: string | null;
  next_action: string | null;
  next_action_at: string | null;
  plan_tier: Tier | null;
  billing_interval: "month" | "year" | null;
  requirements: Opportunity["requirements"] | null;
  agreement_verified_at: string | null;
  agreement_evidence: string | null;
  payment_verified_at: string | null;
  payment_evidence: string | null;
  partner_id: string | null;
  source_channel: string | null;
  last_activity_at: string | null;
};

export const oppFromRow = (r: OppRow): Opportunity => ({
  id: r.id,
  createdAt: r.created_at,
  accountId: r.account_id,
  accountName: r.crm_accounts?.name,
  primaryLeadId: r.primary_lead_id,
  title: r.title,
  kind: r.kind,
  stage: r.stage,
  stageReason: r.stage_reason,
  stageChangedAt: r.stage_changed_at,
  assignedTo: r.assigned_to,
  estPropertyCount: r.est_property_count,
  potentialValue: r.potential_value == null ? null : Number(r.potential_value),
  expectedClose: r.expected_close,
  nextAction: r.next_action,
  nextActionAt: r.next_action_at,
  planTier: r.plan_tier,
  billingInterval: r.billing_interval,
  requirements: r.requirements ?? {},
  agreementVerifiedAt: r.agreement_verified_at,
  agreementEvidence: r.agreement_evidence,
  paymentVerifiedAt: r.payment_verified_at,
  paymentEvidence: r.payment_evidence,
  partnerId: r.partner_id,
  sourceChannel: r.source_channel,
  lastActivityAt: r.last_activity_at,
});

export type Activity = {
  id: string;
  account_id: string | null;
  opportunity_id: string | null;
  lead_id: string | null;
  kind:
    "call" | "meeting" | "demo" | "proposal_reminder" | "relationship_review" | "email" | "note";
  subject: string;
  due_at: string | null;
  owner: string | null;
  priority: "low" | "normal" | "high";
  status: "planned" | "done" | "missed" | "canceled";
  outcome: string | null;
  notes: string | null;
  ai_summary: string | null;
  completed_at: string | null;
  created_at: string;
};
export const ACTIVITY_LABEL: Record<Activity["kind"], string> = {
  call: "Call",
  meeting: "Meeting",
  demo: "Demo",
  proposal_reminder: "Proposal reminder",
  relationship_review: "Relationship review",
  email: "Email",
  note: "Note",
};

export type Proposal = {
  id: string;
  created_at: string;
  opportunity_id: string;
  version: number;
  status:
    | "draft"
    | "pending_approval"
    | "approved"
    | "sent"
    | "superseded"
    | "accepted"
    | "signed"
    | "declined";
  title: string;
  body: string;
  pricing: Partial<ProposalPricing> & { monthlyTotal?: number };
  deviations: { field: string; detail: string; ai?: boolean }[];
  template_id: string | null;
  approval_id: string | null;
  approved_at: string | null;
  sent_to: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  signer_name: string | null;
  signer_title: string | null;
  signed_at: string | null;
  declined_reason: string | null;
};

export type Template = {
  id: string;
  name: string;
  kind: OpportunityKind;
  intro: string;
  product: string;
  terms: string;
  approved: boolean;
};

export type Partner = {
  id: string;
  account_id: string;
  category: string;
  manager: string | null;
  agreement_status: "none" | "proposed" | "signed" | "terminated";
  agreement_proposal_id: string | null;
  agreement_signed_at: string | null;
  agreement_terms: string | null;
  referral_code: string;
  notes: string | null;
  crm_accounts?: { name: string } | null;
};

export type TeamMember = { id: string; name: string; supervisor: boolean; superAdmin: boolean };

// ── data access ────────────────────────────────────────────────────────────

const OPP_COLS =
  "id, created_at, account_id, crm_accounts(name), primary_lead_id, title, kind, stage, stage_reason, stage_changed_at, assigned_to, est_property_count, potential_value, expected_close, next_action, next_action_at, plan_tier, billing_interval, requirements, agreement_verified_at, agreement_evidence, payment_verified_at, payment_evidence, partner_id, source_channel, last_activity_at";

export async function bdDashboard() {
  const { data, error } = await supabase.rpc("bd_dashboard");
  if (error) throw error;
  return data as {
    activeOpportunities: number;
    onHold: number;
    pipelineValue: number;
    weightedValue: number;
    pendingProposals: number;
    awaitingApproval: number;
    upcomingMeetings: {
      id: string;
      subject: string;
      kind: string;
      dueAt: string;
      opportunityId: string | null;
      accountId: string | null;
      account: string | null;
      owner: string | null;
    }[];
    overdue: {
      kind: "activity" | "next_action";
      id: string;
      label: string;
      due: string;
      opportunityId: string | null;
      accountId: string | null;
      owner: string | null;
    }[];
    stalled: { id: string; title: string; stage: Stage; days: number; accountId: string }[];
    byStage: Record<string, number>;
  };
}

type AccountRow = {
  id: string;
  name: string;
  kind: AccountKind;
  website: string | null;
  counties: string[] | null;
  relationship_owner: string | null;
  owner_label: string | null;
  contacts: number;
  decision_makers: number;
  prospect_properties: number;
  registered_properties: number;
  subscribed_properties: number;
  open_opportunities: number;
  pipeline_value: number | string;
  partner: boolean;
  last_contact: string | null;
  duplicate_of_name: string | null;
  updated_at: string;
};
export async function listAccounts(): Promise<Account[]> {
  const { data, error } = await supabase.rpc("bd_accounts");
  if (error) throw error;
  return ((data ?? []) as AccountRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    website: r.website,
    counties: r.counties ?? [],
    relationshipOwner: r.relationship_owner,
    ownerLabel: r.owner_label,
    contacts: r.contacts,
    decisionMakers: r.decision_makers,
    prospectProperties: r.prospect_properties,
    registeredProperties: r.registered_properties,
    subscribedProperties: r.subscribed_properties,
    openOpportunities: r.open_opportunities,
    pipelineValue: Number(r.pipeline_value ?? 0),
    partner: r.partner,
    lastContact: r.last_contact,
    duplicateOfName: r.duplicate_of_name,
    updatedAt: r.updated_at,
  }));
}

export async function getAccount(id: string) {
  const [a, c, o, p] = await Promise.all([
    supabase.from("crm_accounts").select("*").eq("id", id).single(),
    supabase
      .from("marketing_leads")
      .select(
        "id, full_name, email, phone, company, title, decision_maker, profile_id, stage, source, unsubscribed_at, dnc_at, email_consent, outreach_paused_at, account_id",
      )
      .eq("account_id", id)
      .order("decision_maker", { ascending: false }),
    supabase
      .from("bd_opportunities")
      .select(OPP_COLS)
      .eq("account_id", id)
      .order("created_at", { ascending: false }),
    supabase.from("bd_partners").select("*").eq("account_id", id).maybeSingle(),
  ]);
  if (a.error) throw a.error;
  const contacts = (c.data ?? []) as Contact[];
  const leadIds = contacts.map((x) => x.id);
  const [props, acts, bdActs] = await Promise.all([
    leadIds.length
      ? supabase
          .from("marketing_lead_properties")
          .select(
            "id, lead_id, address, county, cad, account_number, property_type, assessed_value, verified, owner_name, subscription_status",
          )
          .in("lead_id", leadIds)
      : Promise.resolve({ data: [] }),
    leadIds.length
      ? supabase
          .from("marketing_activities")
          .select("id, created_at, lead_id, kind, summary, body, outcome")
          .in("lead_id", leadIds)
          .order("created_at", { ascending: false })
          .limit(80)
      : Promise.resolve({ data: [] }),
    supabase
      .from("bd_activities")
      .select("*")
      .eq("account_id", id)
      .order("due_at", { ascending: true, nullsFirst: false }),
  ]);
  return {
    account: a.data as {
      id: string;
      name: string;
      kind: AccountKind;
      website: string | null;
      phone: string | null;
      address: string | null;
      counties: string[];
      notes: string | null;
      relationship_owner: string | null;
      ai_suggestions: {
        duplicates?: { id: string; name: string; reason: string }[];
        info?: {
          kind?: string;
          description?: string;
          decisionMakers?: { name: string; title: string | null; source: string }[];
          portfolio?: string | null;
        };
        sources?: string[];
        at?: string;
      } | null;
      created_at: string;
    },
    contacts,
    opportunities: ((o.data ?? []) as unknown as OppRow[]).map(oppFromRow),
    partner: (p.data ?? null) as Partner | null,
    properties: (props.data ?? []) as {
      id: string;
      lead_id: string;
      address: string;
      county: string | null;
      cad: string | null;
      account_number: string | null;
      property_type: string | null;
      assessed_value: number | null;
      verified: boolean | null;
      owner_name: string | null;
      subscription_status: string | null;
    }[],
    history: (acts.data ?? []) as {
      id: string;
      created_at: string;
      lead_id: string;
      kind: string;
      summary: string;
      body: string | null;
      outcome: string | null;
    }[],
    activities: (bdActs.data ?? []) as Activity[],
  };
}

export async function saveAccount(a: {
  id?: string;
  name: string;
  kind: AccountKind;
  website?: string | null;
  phone?: string | null;
  address?: string | null;
  counties?: string[];
  notes?: string | null;
  relationship_owner?: string | null;
}): Promise<string> {
  const row = { ...a, updated_at: new Date().toISOString() };
  if (a.id) {
    const { error } = await supabase.from("crm_accounts").update(row).eq("id", a.id);
    if (error) throw error;
    return a.id;
  }
  const { data: u } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("crm_accounts")
    .insert({
      ...row,
      created_by: u.user?.id,
      relationship_owner: a.relationship_owner ?? u.user?.id,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

// Merge a duplicate into the kept account: its contacts and opportunities move over.
export async function mergeAccounts(keepId: string, dupId: string) {
  const { error: e1 } = await supabase
    .from("marketing_leads")
    .update({ account_id: keepId })
    .eq("account_id", dupId);
  if (e1) throw e1;
  const { error: e2 } = await supabase
    .from("bd_opportunities")
    .update({ account_id: keepId })
    .eq("account_id", dupId);
  if (e2) throw e2;
  const { error: e3 } = await supabase
    .from("crm_accounts")
    .update({ merged_into: keepId })
    .eq("id", dupId);
  if (e3) throw e3;
}

export async function saveContact(c: Partial<Contact> & { account_id: string }) {
  if (c.id) {
    const { id, ...rest } = c;
    const { error } = await supabase.from("marketing_leads").update(rest).eq("id", id);
    if (error) throw error;
    return id;
  }
  // an existing CRM contact with that email joins the account instead of a
  // duplicate — the one linked to a registered account first
  if (c.email) {
    const { data: ex } = await supabase
      .from("marketing_leads")
      .select("id, full_name, profile_id")
      .ilike("email", c.email.trim())
      .order("profile_id", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (ex) {
      const { error } = await supabase
        .from("marketing_leads")
        .update({
          account_id: c.account_id,
          title: c.title ?? null,
          decision_maker: !!c.decision_maker,
          ...(ex.full_name ? {} : { full_name: c.full_name ?? null }),
          ...(c.phone ? { phone: c.phone } : {}),
        })
        .eq("id", ex.id);
      if (error) throw error;
      return ex.id as string;
    }
  }
  const { data, error } = await supabase
    .from("marketing_leads")
    .insert({ ...c, source: c.source ?? "business_development", stage: "new" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function listOpportunities(): Promise<Opportunity[]> {
  const { data, error } = await supabase
    .from("bd_opportunities")
    .select(OPP_COLS)
    .order("updated_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return ((data ?? []) as unknown as OppRow[]).map(oppFromRow);
}

export async function getOpportunity(id: string) {
  const [o, p, a] = await Promise.all([
    supabase.from("bd_opportunities").select(OPP_COLS).eq("id", id).single(),
    supabase
      .from("bd_proposals")
      .select("*")
      .eq("opportunity_id", id)
      .order("version", { ascending: false }),
    supabase
      .from("bd_activities")
      .select("*")
      .eq("opportunity_id", id)
      .order("due_at", { ascending: true, nullsFirst: false }),
  ]);
  if (o.error) throw o.error;
  const opp = oppFromRow(o.data as unknown as OppRow);
  const { data: handoff } = await supabase
    .from("support_handoffs")
    .select("id, status, assigned_to, accepted_at, done_at, created_at")
    .eq("bd_opportunity_id", id)
    .maybeSingle();
  const { data: requests } = await supabase
    .from("product_requests")
    .select("id, feature, detail, status, created_at")
    .eq("opportunity_id", id);
  return {
    opportunity: opp,
    proposals: (p.data ?? []) as Proposal[],
    activities: (a.data ?? []) as Activity[],
    handoff: handoff as {
      id: string;
      status: string;
      assigned_to: string | null;
      accepted_at: string | null;
      done_at: string | null;
      created_at: string;
    } | null,
    featureRequests: (requests ?? []) as {
      id: string;
      feature: string;
      detail: string | null;
      status: string;
      created_at: string;
    }[],
  };
}

export async function saveOpportunity(
  o: Partial<{
    id: string;
    account_id: string;
    primary_lead_id: string | null;
    title: string;
    kind: OpportunityKind;
    stage: Stage;
    stage_reason: string | null;
    assigned_to: string | null;
    est_property_count: number | null;
    potential_value: number | null;
    expected_close: string | null;
    next_action: string | null;
    next_action_at: string | null;
    plan_tier: Tier | null;
    billing_interval: "month" | "year" | null;
    requirements: Opportunity["requirements"];
    partner_id: string | null;
    source_channel: string | null;
  }>,
): Promise<string> {
  if (o.id) {
    const { id, ...rest } = o;
    const { error } = await supabase.from("bd_opportunities").update(rest).eq("id", id);
    if (error) throw error;
    return id;
  }
  const { data, error } = await supabase.from("bd_opportunities").insert(o).select("id").single();
  if (error) throw error;
  return data.id as string;
}

export async function verifyAgreement(oppId: string, evidence?: string) {
  const { data, error } = await supabase.rpc("bd_verify_agreement", {
    p_opp: oppId,
    p_evidence: evidence ?? null,
  });
  if (error) throw error;
  return data as string;
}
export async function verifyPayment(oppId: string) {
  const { data, error } = await supabase.rpc("bd_verify_payment", { p_opp: oppId });
  if (error) throw error;
  return data as string;
}
export async function handoffToSupport(oppId: string, owner: string | null) {
  const { data, error } = await supabase.rpc("bd_handoff_to_support", {
    p_opp: oppId,
    p_owner: owner,
  });
  if (error) throw error;
  return data as string;
}

export async function saveActivity(a: Partial<Activity>): Promise<string> {
  if (a.id) {
    const { id, ...rest } = a;
    const { error } = await supabase.from("bd_activities").update(rest).eq("id", id);
    if (error) throw error;
    return id;
  }
  const { data, error } = await supabase.from("bd_activities").insert(a).select("id").single();
  if (error) throw error;
  return data.id as string;
}
export async function listActivities(
  opts: { status?: Activity["status"] } = {},
): Promise<(Activity & { crm_accounts?: { name: string } | null })[]> {
  let q = supabase
    .from("bd_activities")
    .select("*, crm_accounts(name)")
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(500);
  if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as (Activity & { crm_accounts?: { name: string } | null })[];
}

export async function listTemplates(): Promise<Template[]> {
  const { data, error } = await supabase
    .from("bd_proposal_templates")
    .select("id, name, kind, intro, product, terms, approved")
    .order("name");
  if (error) throw error;
  return (data ?? []) as Template[];
}
export async function saveTemplate(t: Partial<Template> & { name: string }) {
  const row = { ...t, updated_at: new Date().toISOString() };
  const { error } = t.id
    ? await supabase.from("bd_proposal_templates").update(row).eq("id", t.id)
    : await supabase.from("bd_proposal_templates").insert(row);
  if (error) throw error;
}

export async function createProposal(p: {
  opportunity_id: string;
  template_id: string | null;
  title: string;
  body: string;
  pricing: Partial<ProposalPricing>;
}) {
  const { data, error } = await supabase
    .from("bd_proposals")
    .insert({ ...p, deviations: pricingDeviations(p.pricing) })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}
export async function updateProposal(
  id: string,
  patch: { title?: string; body?: string; pricing?: Partial<ProposalPricing> },
) {
  const { error } = await supabase
    .from("bd_proposals")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function listPartners(): Promise<Partner[]> {
  const { data, error } = await supabase
    .from("bd_partners")
    .select("*, crm_accounts(name)")
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as Partner[];
}
export async function savePartner(p: Partial<Partner> & { account_id: string }) {
  const { crm_accounts: _drop, ...row } = p;
  void _drop;
  const { error } = p.id
    ? await supabase.from("bd_partners").update(row).eq("id", p.id)
    : await supabase.from("bd_partners").insert(row);
  if (error) throw error;
}
export async function partnerReferrals(partnerId: string) {
  const { data, error } = await supabase
    .from("bd_partner_referrals")
    .select(
      "id, created_at, method, note, lead_id, marketing_leads(full_name, email, company, profile_id, stage)",
    )
    .eq("partner_id", partnerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as {
    id: string;
    created_at: string;
    method: string;
    note: string | null;
    lead_id: string;
    marketing_leads: {
      full_name: string | null;
      email: string | null;
      company: string | null;
      profile_id: string | null;
      stage: string | null;
    } | null;
  }[];
}
export async function recordReferral(
  partnerId: string,
  leadId: string,
  method: "link" | "code" | "introduction",
  note?: string,
) {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from("bd_partner_referrals").insert({
    partner_id: partnerId,
    lead_id: leadId,
    method,
    note: note ?? null,
    recorded_by: u.user?.id,
  });
  if (error) {
    if (/duplicate key/.test(error.message))
      throw new Error(
        "That prospect is already attributed to a partner — one source per prospect, so revenue isn't counted twice.",
      );
    throw error;
  }
}
export async function partnerCommissions(partnerId: string) {
  const { data, error } = await supabase
    .from("bd_partner_commissions")
    .select("*")
    .eq("partner_id", partnerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as {
    id: string;
    created_at: string;
    amount: number;
    basis: string;
    status: string;
  }[];
}
export async function recordCommission(
  partnerId: string,
  amount: number,
  basis: string,
  referralId?: string | null,
) {
  const { error } = await supabase
    .from("bd_partner_commissions")
    .insert({ partner_id: partnerId, amount, basis, referral_id: referralId ?? null });
  if (error) throw error;
}

export async function addFeatureRequest(r: {
  opportunity_id?: string | null;
  account_id?: string | null;
  feature: string;
  detail?: string | null;
}) {
  const { error } = await supabase
    .from("product_requests")
    .insert({ ...r, department: "business_development" });
  if (error) throw error;
}

export async function listResearch() {
  const { data, error } = await supabase
    .from("bd_research")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  return (data ?? []) as ResearchRow[];
}
export type ResearchFinding = {
  name: string;
  kind: string;
  properties: number | null;
  marketValue: number | null;
  counties: string[];
  sampleAddresses?: string[];
  decisionMakers?: { name: string; title: string | null; source: string }[];
  ownership?: string | null;
  whyCorvus?: string | null;
  sources: { label: string; url: string }[];
  assumptions: string[];
  reviewed?: boolean;
  accountId?: string;
};
export type ResearchRow = {
  id: string;
  created_at: string;
  params: Record<string, unknown>;
  status: "running" | "done" | "failed";
  findings: ResearchFinding[];
  summary: string | null;
  sources: { label: string; url: string }[];
  coverage_note: string | null;
  error: string | null;
  researched_at: string | null;
  reviewed_at: string | null;
};
export async function markFinding(researchId: string, findings: ResearchFinding[]) {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("bd_research")
    .update({ findings, reviewed_by: u.user?.id, reviewed_at: new Date().toISOString() })
    .eq("id", researchId);
  if (error) throw error;
}

export async function listTeam(): Promise<TeamMember[]> {
  const { data, error } = await supabase.rpc("bd_team");
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
export async function listSupportTeam(): Promise<{ id: string; name: string }[]> {
  const { data } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, email")
    .or("support_admin.eq.true,is_admin.eq.true");
  return (
    (data ?? []) as {
      id: string;
      first_name: string | null;
      last_name: string | null;
      email: string;
    }[]
  ).map((p) => ({
    id: p.id,
    name: [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email,
  }));
}
export async function setBdSupervisor(profileId: string, enabled: boolean) {
  const { error } = await supabase.rpc("set_bd_role", {
    target: profileId,
    p_role: "bd_supervisor",
    enabled,
  });
  if (error) throw error;
}

export type BdAnalytics = {
  forecast: { openPipeline: number; expectedInRange: number; estimatedProperties: number };
  actual: {
    subscribedProperties: number;
    registeredProperties: number;
    confirmedRevenueCents: number;
    customersActivated: number;
  };
  byStage: Record<string, number>;
  lostReasons: { reason: string; n: number }[];
  proposals: { created: number; sent: number; accepted: number; declined: number };
  avgSalesCycleDays: number | null;
  byChannel: Record<string, { opportunities: number; won: number }>;
  partners: {
    id: string;
    name: string;
    agreement: string;
    manager: string | null;
    referred: number;
    converted: number;
    subscribedProperties: number;
    revenueCents: number;
    lastReferral: string | null;
  }[];
  workload: {
    id: string;
    name: string;
    open: number;
    pipeline: number;
    overdue: number;
    accounts: number;
  }[];
};
export async function bdAnalytics(
  from: string,
  to: string,
  staff: string | null,
): Promise<BdAnalytics> {
  const { data, error } = await supabase.rpc("bd_analytics", {
    p_from: from,
    p_to: to,
    p_staff: staff,
  });
  if (error) throw error;
  return data as BdAnalytics;
}

export function bdAction<T = Record<string, unknown>>(
  action: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  return invokeEdgeFunction<T>("bd-console", { action, ...body });
}

export const usd0 = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`;
export const dateShort = (iso: string | null | undefined) =>
  iso
    ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

export function csv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(cell).join(",")).join("\n");
}
