// Marketing analytics — pure (no network), so it's tested
// (marketing-analytics.test.ts). Filters, KPIs vs the previous period, spend
// → CAC / revenue per customer / ROMI, campaign and dimension performance,
// trends, contact eligibility, team workload + assignment suggestions, and
// the custom-report engine the AI report builder drives.
import {
  LEGACY_TIER_BRACKET_PRICES,
  TIER_BRACKET_PRICES,
  type PropertyValueBracket,
  type Tier,
} from "./billing";
import type {
  Activity,
  Campaign,
  Lead,
  LeadProperty,
  MarketingData,
  Source,
  Stage,
} from "./marketing";
import { STAGE_LABEL, SOURCE_LABEL } from "./marketing";
import { leadName, type Ranking, shownPriority } from "./marketing-crm";

// ── Filters ─────────────────────────────────────────────────────────────────
export type AFilters = {
  from: string; // yyyy-mm-dd, inclusive
  to: string; // yyyy-mm-dd, inclusive
  campaignId?: string | null;
  county?: string | null;
  propertyType?: string | null;
  source?: Source | null;
};
const t0 = (d: string) => new Date(`${d}T00:00:00`).getTime();
const t1 = (d: string) => new Date(`${d}T23:59:59.999`).getTime();
export const inRange = (iso: string | null | undefined, f: Pick<AFilters, "from" | "to">) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= t0(f.from) && t <= t1(f.to);
};
/** The same-length period just before. */
export function previousPeriod(f: AFilters): AFilters {
  const days = Math.round((t0(f.to) - t0(f.from)) / 864e5) + 1;
  const to = new Date(t0(f.from) - 864e5);
  const from = new Date(to.getTime() - (days - 1) * 864e5);
  const iso = (d: Date) =>
    new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  return { ...f, from: iso(from), to: iso(to) };
}

export function campaignRecipients(
  d: Pick<MarketingData, "activities" | "campaigns">,
  id: string,
): Set<string> {
  const s = new Set<string>();
  for (const a of d.activities) if (a.campaignId === id && a.leadId) s.add(a.leadId);
  for (const l of d.campaigns.find((c) => c.id === id)?.audience.leadIds ?? []) s.add(l);
  return s;
}

/** Leads in scope for the non-date filters. */
export function scopeLeads(d: MarketingData, f: AFilters): Lead[] {
  const inCampaign = f.campaignId ? campaignRecipients(d, f.campaignId) : null;
  return d.leads.filter(
    (l) =>
      (!f.county || l.county === f.county || l.counties.includes(f.county)) &&
      (!f.propertyType ||
        l.propertyType === f.propertyType ||
        l.propertyTypes.includes(f.propertyType)) &&
      (!f.source || l.source === f.source) &&
      (!inCampaign || inCampaign.has(l.id)),
  );
}

// ── Revenue ─────────────────────────────────────────────────────────────────
const PAID = ["active", "trialing", "past_due"];
/** Annual list value of a customer's paid properties (2nd+ in a tier+bracket 15% off), before launch discounts. */
export function customerAcv(props: LeadProperty[]): number {
  const seen = new Map<string, number>();
  let total = 0;
  for (const p of [...props]
    .filter((x) => PAID.includes(x.subscriptionStatus ?? ""))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const tier = (p.planTier ?? "owner_managed") as Tier;
    const bracket = p.valueBracket ?? "upTo5m";
    const monthly =
      TIER_BRACKET_PRICES[tier]?.[bracket as PropertyValueBracket] ??
      LEGACY_TIER_BRACKET_PRICES[tier]?.[bracket] ??
      299;
    const k = `${tier}:${bracket}`;
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    total += monthly * 12 * (n > 0 ? 0.85 : 1);
  }
  return Math.round(total);
}
export function acvByLead(d: Pick<MarketingData, "properties">): Map<string, number> {
  const by = new Map<string, LeadProperty[]>();
  for (const p of d.properties) by.set(p.leadId, [...(by.get(p.leadId) ?? []), p]);
  const out = new Map<string, number>();
  for (const [id, ps] of by) out.set(id, customerAcv(ps));
  return out;
}

// ── KPIs ────────────────────────────────────────────────────────────────────
const OUTREACH = ["email", "sms", "call", "meeting"];
const FORWARD =
  /→ (Interested|Registration Started|Registered|Property Added|Subscription Started|Subscribed)$/;
export type Kpis = {
  leads: number;
  contacted: number;
  interested: number;
  registrations: number;
  subscriptions: number;
  leadToRegistered: number | null;
  registeredToPaid: number | null;
  leadToPaid: number | null;
  spend: number;
  cac: number | null;
  costPerLead: number | null;
  revenue: number;
  revenuePerCustomer: number | null;
  romi: number | null;
};
const ratio = (a: number, b: number) => (b ? a / b : null);
export function spendIn(d: Pick<MarketingData, "expenses">, f: AFilters): number {
  return d.expenses
    .filter(
      (e) =>
        e.spentOn >= f.from &&
        e.spentOn <= f.to &&
        (!f.campaignId || e.campaignId === f.campaignId),
    )
    .reduce((s, e) => s + e.amount, 0);
}
export function kpis(d: MarketingData, f: AFilters, acv = acvByLead(d)): Kpis {
  const scope = scopeLeads(d, f);
  const ids = new Set(scope.map((l) => l.id));
  const acts = d.activities.filter((a) => a.leadId && ids.has(a.leadId) && inRange(a.createdAt, f));
  const created = scope.filter((l) => inRange(l.createdAt, f));
  const subs = scope.filter((l) => inRange(l.subscribedAt, f));
  const regs = scope.filter((l) => inRange(l.registeredAt, f));
  const spend = spendIn(d, f);
  const revenue = subs.reduce((s, l) => s + (acv.get(l.id) ?? 0), 0);
  return {
    leads: created.length,
    contacted: new Set(acts.filter((a) => OUTREACH.includes(a.kind)).map((a) => a.leadId)).size,
    interested: new Set(
      acts
        .filter(
          (a) =>
            a.outcome === "interested" ||
            (a.kind === "stage" && a.summary.endsWith("→ Interested")),
        )
        .map((a) => a.leadId),
    ).size,
    registrations: regs.length,
    subscriptions: subs.length,
    leadToRegistered: ratio(created.filter((l) => !!l.registeredAt).length, created.length),
    registeredToPaid: ratio(regs.filter((l) => !!l.subscribedAt).length, regs.length),
    leadToPaid: ratio(created.filter((l) => !!l.subscribedAt).length, created.length),
    spend,
    cac: subs.length ? spend / subs.length : null,
    costPerLead: created.length ? spend / created.length : null,
    revenue,
    revenuePerCustomer: subs.length ? revenue / subs.length : null,
    romi: spend ? (revenue - spend) / spend : null,
  };
}
/** Change vs the previous period, as a fraction (null when there's nothing to compare). */
export const delta = (cur: number | null, prev: number | null) =>
  cur == null || prev == null || prev === 0 ? null : (cur - prev) / Math.abs(prev);

// ── Campaigns ───────────────────────────────────────────────────────────────
export type CampaignRow = {
  campaign: Campaign;
  recipients: number;
  engaged: number;
  engagement: number | null;
  registrations: number;
  customers: number;
  revenue: number;
  spend: number;
  cac: number | null;
  costPerEngaged: number | null;
  romi: number | null;
};
const engagedAfter = (acts: Activity[], since: number, days = 14) =>
  acts.some((a) => {
    const t = new Date(a.createdAt).getTime();
    return (
      t > since &&
      t < since + days * 864e5 &&
      (a.outcome === "replied" ||
        a.outcome === "interested" ||
        ((a.kind === "stage" || a.kind === "journey") && FORWARD.test(a.summary)))
    );
  });
export function campaignRows(d: MarketingData, f: AFilters, acv = acvByLead(d)): CampaignRow[] {
  const byLead = new Map<string, Activity[]>();
  for (const a of d.activities)
    if (a.leadId) byLead.set(a.leadId, [...(byLead.get(a.leadId) ?? []), a]);
  const leadById = new Map(d.leads.map((l) => [l.id, l]));
  return d.campaigns
    .filter(
      (c) =>
        (!f.campaignId || c.id === f.campaignId) &&
        (c.status !== "sent" || inRange(c.sentAt, f) || !c.sentAt),
    )
    .map((c) => {
      const rec = [...campaignRecipients(d, c.id)]
        .map((id) => leadById.get(id))
        .filter(Boolean) as Lead[];
      const since = c.sentAt ? new Date(c.sentAt).getTime() : null;
      const engaged =
        since == null ? 0 : rec.filter((l) => engagedAfter(byLead.get(l.id) ?? [], since)).length;
      const custs =
        since == null
          ? []
          : rec.filter((l) => l.subscribedAt && new Date(l.subscribedAt).getTime() > since);
      const regs =
        since == null
          ? 0
          : rec.filter((l) => l.registeredAt && new Date(l.registeredAt).getTime() > since).length;
      const spend = d.expenses
        .filter((e) => e.campaignId === c.id)
        .reduce((s, e) => s + e.amount, 0);
      const revenue = custs.reduce((s, l) => s + (acv.get(l.id) ?? 0), 0);
      const n = c.stats.targeted ?? rec.length;
      return {
        campaign: c,
        recipients: n,
        engaged,
        engagement: ratio(engaged, n),
        registrations: regs,
        customers: custs.length,
        revenue,
        spend,
        cac: custs.length ? spend / custs.length : null,
        costPerEngaged: engaged ? spend / engaged : null,
        romi: spend ? (revenue - spend) / spend : null,
      };
    })
    .sort((a, b) =>
      (b.campaign.sentAt ?? b.campaign.createdAt).localeCompare(
        a.campaign.sentAt ?? a.campaign.createdAt,
      ),
    );
}

// ── What works: by county, type, source, audience, message, channel ─────────
export type DimRow = {
  key: string;
  leads: number;
  engaged: number;
  registrations: number;
  customers: number;
  revenue: number;
  conversion: number | null;
};
export type LeadDim = "county" | "propertyType" | "source" | "stage";
export function leadDimension(
  d: MarketingData,
  f: AFilters,
  dim: LeadDim,
  acv = acvByLead(d),
): DimRow[] {
  const byLead = new Map<string, Activity[]>();
  for (const a of d.activities)
    if (a.leadId) byLead.set(a.leadId, [...(byLead.get(a.leadId) ?? []), a]);
  const m = new Map<string, DimRow>();
  const keysOf = (l: Lead): string[] =>
    dim === "county"
      ? l.counties.length
        ? l.counties
        : [l.county ?? "Unknown"]
      : dim === "propertyType"
        ? l.propertyTypes.length
          ? l.propertyTypes
          : [l.propertyType ?? "Unknown"]
        : dim === "source"
          ? [SOURCE_LABEL[l.source]]
          : [STAGE_LABEL[l.stage]];
  for (const l of scopeLeads(d, f).filter(
    (x) => inRange(x.createdAt, f) || inRange(x.subscribedAt, f) || inRange(x.registeredAt, f),
  )) {
    const acts = byLead.get(l.id) ?? [];
    const engaged = acts.some(
      (a) => inRange(a.createdAt, f) && (a.outcome === "replied" || a.outcome === "interested"),
    );
    for (const k of keysOf(l)) {
      const r = m.get(k) ?? {
        key: k,
        leads: 0,
        engaged: 0,
        registrations: 0,
        customers: 0,
        revenue: 0,
        conversion: null,
      };
      r.leads++;
      if (engaged) r.engaged++;
      if (inRange(l.registeredAt, f)) r.registrations++;
      if (inRange(l.subscribedAt, f)) {
        r.customers++;
        r.revenue += acv.get(l.id) ?? 0;
      }
      m.set(k, r);
    }
  }
  return [...m.values()]
    .map((r) => ({ ...r, conversion: ratio(r.customers, r.leads) }))
    .sort((a, b) => b.customers - a.customers || b.leads - a.leads);
}
export type TouchDim = "channel" | "template" | "weekday" | "hour" | "audience";
export type TouchRow = {
  key: string;
  sent: number;
  engaged: number;
  rate: number | null;
  customers: number;
};
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function touchDimension(d: MarketingData, f: AFilters, dim: TouchDim): TouchRow[] {
  const ids = new Set(scopeLeads(d, f).map((l) => l.id));
  const byLead = new Map<string, Activity[]>();
  for (const a of d.activities)
    if (a.leadId) byLead.set(a.leadId, [...(byLead.get(a.leadId) ?? []), a]);
  const leadById = new Map(d.leads.map((l) => [l.id, l]));
  const tpl = new Map(d.templates.map((t) => [t.id, t.name]));
  const camp = new Map(d.campaigns.map((c) => [c.id, c]));
  const m = new Map<string, TouchRow>();
  for (const a of d.activities) {
    if (!a.leadId || !ids.has(a.leadId) || !OUTREACH.includes(a.kind) || !inRange(a.createdAt, f))
      continue;
    const when = new Date(a.createdAt);
    let key: string | null;
    if (dim === "channel") key = a.kind;
    else if (dim === "template")
      key = a.templateId ? (tpl.get(a.templateId) ?? "Template") : "No template";
    else if (dim === "weekday") key = WEEKDAY[when.getDay()];
    else if (dim === "hour")
      key = `${when.getHours() % 12 || 12}${when.getHours() < 12 ? "am" : "pm"}`;
    else {
      const c = a.campaignId ? camp.get(a.campaignId) : null;
      key = c
        ? (c.audience.segmentName ??
          (c.audience.stages?.length
            ? c.audience.stages.map((s: Stage) => STAGE_LABEL[s]).join(" + ")
            : c.audience.leadIds?.length
              ? "Hand-picked leads"
              : "Everyone"))
        : "One-to-one";
    }
    const r = m.get(key) ?? { key, sent: 0, engaged: 0, rate: null, customers: 0 };
    r.sent++;
    if (engagedAfter(byLead.get(a.leadId) ?? [], when.getTime(), 7)) r.engaged++;
    const l = leadById.get(a.leadId);
    if (l?.subscribedAt && new Date(l.subscribedAt) > when) r.customers++;
    m.set(key, r);
  }
  return [...m.values()]
    .map((r) => ({ ...r, rate: ratio(r.engaged, r.sent) }))
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
}

// ── Trend ───────────────────────────────────────────────────────────────────
export type TrendPoint = {
  label: string;
  start: string;
  leads: number;
  registrations: number;
  subscriptions: number;
  spend: number;
};
export function trend(d: MarketingData, f: AFilters): TrendPoint[] {
  const days = Math.round((t0(f.to) - t0(f.from)) / 864e5) + 1;
  const monthly = days > 120;
  const scope = scopeLeads(d, f);
  const out: TrendPoint[] = [];
  const iso = (x: Date) =>
    new Date(x.getTime() - x.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  let cur = new Date(t0(f.from));
  if (monthly) cur = new Date(cur.getFullYear(), cur.getMonth(), 1);
  while (cur.getTime() <= t1(f.to) && out.length < 60) {
    const next = monthly
      ? new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
      : new Date(cur.getTime() + 7 * 864e5);
    const b = { from: iso(cur), to: iso(new Date(next.getTime() - 864e5)) };
    out.push({
      label: monthly
        ? cur.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
        : cur.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      start: b.from,
      leads: scope.filter((l) => inRange(l.createdAt, b)).length,
      registrations: scope.filter((l) => inRange(l.registeredAt, b)).length,
      subscriptions: scope.filter((l) => inRange(l.subscribedAt, b)).length,
      spend: spendIn(d, { ...f, ...b }),
    });
    cur = next;
  }
  return out;
}

// ── Contact eligibility (same rule as marketing_can_contact in the DB) ──────
export function eligibility(l: Lead, channel: "email" | "sms" | "call"): string | null {
  if (l.stage === "do_not_contact") return "Do Not Contact";
  if (channel === "email") {
    if (!l.email) return "No email address";
    if (l.unsubscribedAt) return "Unsubscribed from email";
    if (l.emailConsent === "withdrawn") return "Email consent withdrawn";
  }
  if (channel === "sms") {
    if (!l.phone) return "No phone number";
    if (l.smsConsent !== "granted") return "No SMS consent on record";
  }
  if (channel === "call" && !l.phone) return "No phone number";
  return null;
}
export function audienceEligibility(leads: Lead[], channel: "email" | "sms" | "call") {
  const excluded = new Map<string, number>();
  let eligible = 0;
  for (const l of leads) {
    const why = eligibility(l, channel);
    if (why) excluded.set(why, (excluded.get(why) ?? 0) + 1);
    else eligible++;
  }
  return { eligible, excluded: [...excluded.entries()].sort((a, b) => b[1] - a[1]) };
}

// ── Team ────────────────────────────────────────────────────────────────────
export type Workload = {
  staffId: string;
  name: string;
  leads: number;
  campaigns: number;
  pending: number;
  overdue: number;
  done30: number;
  uncontactedHigh: number;
  load: number;
};
export function teamWorkload(
  d: MarketingData,
  ranks: Map<string, Ranking>,
  now = new Date(),
): Workload[] {
  const open = (l: Lead) => !["subscribed", "not_interested", "do_not_contact"].includes(l.stage);
  const leadById = new Map(d.leads.map((l) => [l.id, l]));
  return d.staff.map((s) => {
    const mine = d.leads.filter((l) => l.assignedTo === s.id && open(l));
    const fus = d.followups.filter(
      (f) => (f.assignedTo ?? leadById.get(f.leadId)?.assignedTo) === s.id,
    );
    const pending = fus.filter((f) => f.status === "pending" || f.status === "draft");
    const overdue = pending.filter((f) => f.status === "pending" && new Date(f.dueAt) < now).length;
    const contacted = new Set(
      d.activities.filter((a) => a.leadId && OUTREACH.includes(a.kind)).map((a) => a.leadId),
    );
    const uncontactedHigh = mine.filter(
      (l) =>
        !contacted.has(l.id) && ranks.get(l.id) && shownPriority(l, ranks.get(l.id)!) === "high",
    ).length;
    return {
      staffId: s.id,
      name: s.name,
      leads: mine.length,
      campaigns: d.campaigns.filter((c) => c.ownerId === s.id && c.status !== "sent").length,
      pending: pending.length,
      overdue,
      done30: fus.filter(
        (f) =>
          f.status === "done" &&
          f.completedAt &&
          now.getTime() - new Date(f.completedAt).getTime() < 30 * 864e5,
      ).length,
      uncontactedHigh,
      load: pending.length + overdue * 2 + mine.length * 0.5,
    };
  });
}
export type AssignmentSuggestion = { lead: Lead; to: string; toName: string; why: string };
/**
 * Unassigned open leads, highest priority first, each to whoever has the
 * lightest load right now (load updates as suggestions are made).
 */
export function suggestAssignments(
  d: MarketingData,
  ranks: Map<string, Ranking>,
  max = 20,
  now = new Date(),
): AssignmentSuggestion[] {
  // the marketing team first; Super Admins only when there is no one else
  const team = d.staff.filter((x) => !x.isSuperAdmin).map((x) => x.id);
  const load = new Map(
    teamWorkload(d, ranks, now)
      .filter((w) => !team.length || team.includes(w.staffId))
      .map((w) => [w.staffId, w]),
  );
  if (!load.size) return [];
  const rank = { high: 0, medium: 1, low: 2 } as const;
  const pool = d.leads
    .filter(
      (l) => !l.assignedTo && !["subscribed", "not_interested", "do_not_contact"].includes(l.stage),
    )
    .map((l) => ({
      l,
      p: ranks.get(l.id) ? shownPriority(l, ranks.get(l.id)!) : "low",
      pts: ranks.get(l.id)?.points ?? 0,
    }))
    .sort((a, b) => rank[a.p] - rank[b.p] || b.pts - a.pts)
    .slice(0, max);
  return pool.map(({ l, p }) => {
    const w = [...load.values()].sort((a, b) => a.load - b.load || a.overdue - b.overdue)[0];
    w.load += 1.5;
    w.leads += 1;
    return {
      lead: l,
      to: w.staffId,
      toName: w.name,
      why: `${p} priority · ${w.name} has the lightest load (${w.pending} open, ${w.overdue} overdue)`,
    };
  });
}

// ── Custom reports (driven by the AI report builder) ────────────────────────
export type ReportEntity = "leads" | "campaigns" | "followups" | "expenses" | "conversions";
type Col<T> = { key: string; label: string; get: (r: T) => string | number | null };
type Ctx = { d: MarketingData; acv: Map<string, number>; ranks: Map<string, Ranking> };
const staffName = (d: MarketingData, id: string | null) =>
  d.staff.find((s) => s.id === id)?.name ?? "";
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each entity has its own row type
export const REPORT_COLUMNS: { [K in ReportEntity]: Col<any>[] } = {
  leads: [
    { key: "name", label: "Owner / company", get: (l: Lead) => leadName(l) },
    { key: "contact", label: "Contact", get: (l: Lead) => (l.company ? l.fullName : "") },
    {
      key: "email",
      label: "Email",
      get: (l: Lead) => (l.stage === "do_not_contact" || l.unsubscribedAt ? "" : l.email),
    },
    {
      key: "phone",
      label: "Phone",
      get: (l: Lead) => (l.stage === "do_not_contact" ? "" : l.phone),
    },
    { key: "status", label: "Status", get: (l: Lead) => STAGE_LABEL[l.stage] },
    { key: "source", label: "Source", get: (l: Lead) => SOURCE_LABEL[l.source] },
    { key: "county", label: "Counties", get: (l: Lead) => l.counties.join("; ") || l.county },
    {
      key: "propertyType",
      label: "Property types",
      get: (l: Lead) => l.propertyTypes.join("; ") || l.propertyType,
    },
    { key: "properties", label: "Properties", get: (l: Lead) => l.portfolioCount },
    {
      key: "assessed",
      label: "Total assessed",
      get: (l: Lead) => (l.portfolioValue == null ? null : Math.round(l.portfolioValue)),
    },
    { key: "change", label: "Biggest value change %", get: (l: Lead) => l.maxChangePct },
    {
      key: "assignedTo",
      label: "Assigned to",
      get: (l: Lead) => staffName(ctxRef.d!, l.assignedTo),
    },
    { key: "created", label: "Added", get: (l: Lead) => day(l.createdAt) },
    { key: "registered", label: "Registered", get: (l: Lead) => day(l.registeredAt) },
    { key: "subscribed", label: "Subscribed", get: (l: Lead) => day(l.subscribedAt) },
    {
      key: "revenue",
      label: "Annual subscription value",
      get: (l: Lead) => ctxRef.acv?.get(l.id) ?? 0,
    },
    {
      key: "emailConsent",
      label: "Email consent",
      get: (l: Lead) => (l.unsubscribedAt ? "unsubscribed" : l.emailConsent),
    },
    { key: "smsConsent", label: "SMS consent", get: (l: Lead) => l.smsConsent },
  ],
  campaigns: [
    { key: "name", label: "Campaign", get: (r: CampaignRow) => r.campaign.name },
    { key: "status", label: "Status", get: (r: CampaignRow) => r.campaign.status },
    { key: "sent", label: "Sent", get: (r: CampaignRow) => day(r.campaign.sentAt) },
    { key: "recipients", label: "Recipients", get: (r: CampaignRow) => r.recipients },
    { key: "engaged", label: "Engaged", get: (r: CampaignRow) => r.engaged },
    {
      key: "engagement",
      label: "Engagement %",
      get: (r: CampaignRow) => (r.engagement == null ? null : Math.round(r.engagement * 1000) / 10),
    },
    { key: "registrations", label: "Registrations", get: (r: CampaignRow) => r.registrations },
    { key: "customers", label: "Customers", get: (r: CampaignRow) => r.customers },
    { key: "spend", label: "Spend", get: (r: CampaignRow) => r.spend },
    {
      key: "cac",
      label: "CAC",
      get: (r: CampaignRow) => (r.cac == null ? null : Math.round(r.cac)),
    },
    { key: "revenue", label: "Annual revenue", get: (r: CampaignRow) => r.revenue },
    {
      key: "romi",
      label: "ROMI %",
      get: (r: CampaignRow) => (r.romi == null ? null : Math.round(r.romi * 100)),
    },
    {
      key: "owner",
      label: "Owner",
      get: (r: CampaignRow) => staffName(ctxRef.d!, r.campaign.ownerId),
    },
  ],
  followups: [
    {
      key: "lead",
      label: "Lead",
      get: (f) => {
        const l = ctxRef.d!.leads.find((x) => x.id === f.leadId);
        return l ? leadName(l) : "";
      },
    },
    { key: "channel", label: "Type", get: (f) => f.channel },
    { key: "subject", label: "Subject", get: (f) => f.subject },
    { key: "status", label: "Status", get: (f) => f.status },
    { key: "priority", label: "Priority", get: (f) => f.priority },
    { key: "due", label: "Due", get: (f) => day(f.dueAt) },
    { key: "completed", label: "Completed", get: (f) => day(f.completedAt) },
    { key: "outcome", label: "Outcome", get: (f) => f.outcome },
    {
      key: "assignedTo",
      label: "Assigned to",
      get: (f) =>
        staffName(
          ctxRef.d!,
          f.assignedTo ?? ctxRef.d!.leads.find((x) => x.id === f.leadId)?.assignedTo ?? null,
        ),
    },
  ],
  expenses: [
    { key: "date", label: "Date", get: (e) => e.spentOn },
    { key: "amount", label: "Amount", get: (e) => e.amount },
    { key: "category", label: "Category", get: (e) => e.category },
    {
      key: "campaign",
      label: "Campaign",
      get: (e) => ctxRef.d!.campaigns.find((c) => c.id === e.campaignId)?.name ?? "",
    },
    { key: "vendor", label: "Vendor", get: (e) => e.vendor },
    { key: "description", label: "Description", get: (e) => e.description },
  ],
  conversions: [
    { key: "name", label: "Customer", get: (l: Lead) => leadName(l) },
    { key: "source", label: "Source", get: (l: Lead) => SOURCE_LABEL[l.source] },
    { key: "county", label: "Counties", get: (l: Lead) => l.counties.join("; ") },
    { key: "registered", label: "Registered", get: (l: Lead) => day(l.registeredAt) },
    { key: "subscribed", label: "Subscribed", get: (l: Lead) => day(l.subscribedAt) },
    {
      key: "days",
      label: "Days lead → paid",
      get: (l: Lead) =>
        l.subscribedAt
          ? Math.round(
              (new Date(l.subscribedAt).getTime() - new Date(l.createdAt).getTime()) / 864e5,
            )
          : null,
    },
    {
      key: "revenue",
      label: "Annual subscription value",
      get: (l: Lead) => ctxRef.acv?.get(l.id) ?? 0,
    },
    {
      key: "campaign",
      label: "Last campaign before paying",
      get: (l: Lead) => {
        const a = ctxRef.d!.activities.find(
          (x) =>
            x.leadId === l.id && x.campaignId && (!l.subscribedAt || x.createdAt < l.subscribedAt),
        );
        return a ? (ctxRef.d!.campaigns.find((c) => c.id === a.campaignId)?.name ?? "") : "";
      },
    },
  ],
};
// columns read the current data through this (set by runReport)
const ctxRef: Partial<Ctx> = {};

export type ReportSpec = {
  title?: string;
  entity: ReportEntity;
  filters?: Partial<AFilters> & { status?: string[]; stage?: Stage[]; assignedTo?: string | null };
  columns?: string[];
  sort?: { column: string; dir?: "asc" | "desc" };
  limit?: number;
};
/** Validates an AI-proposed spec against what exists; unknown parts are dropped. */
export function cleanSpec(raw: unknown): ReportSpec | null {
  const r = raw as Partial<ReportSpec> | null;
  if (!r || typeof r !== "object" || !r.entity || !(r.entity in REPORT_COLUMNS)) return null;
  const cols = REPORT_COLUMNS[r.entity].map((c) => c.key);
  return {
    title: typeof r.title === "string" ? r.title.slice(0, 120) : undefined,
    entity: r.entity,
    filters: typeof r.filters === "object" && r.filters ? r.filters : {},
    columns: Array.isArray(r.columns) ? r.columns.filter((c) => cols.includes(c)) : undefined,
    sort:
      r.sort && cols.includes(r.sort.column)
        ? { column: r.sort.column, dir: r.sort.dir === "asc" ? "asc" : "desc" }
        : undefined,
    limit:
      typeof r.limit === "number" ? Math.max(1, Math.min(5000, Math.round(r.limit))) : undefined,
  };
}
export function runReport(
  spec: ReportSpec,
  d: MarketingData,
  ranks: Map<string, Ranking>,
  defaults: AFilters,
) {
  const acv = acvByLead(d);
  Object.assign(ctxRef, { d, acv, ranks });
  const f: AFilters = { ...defaults, ...(spec.filters ?? {}) } as AFilters;
  const ff = spec.filters ?? {};
  let rows: unknown[];
  if (spec.entity === "leads")
    rows = scopeLeads(d, f).filter(
      (l) =>
        (!ff.stage?.length || ff.stage.includes(l.stage)) &&
        (!ff.assignedTo || l.assignedTo === ff.assignedTo) &&
        (spec.filters?.from ? inRange(l.createdAt, f) : true),
    );
  else if (spec.entity === "conversions")
    rows = scopeLeads(d, f).filter((l) => inRange(l.subscribedAt, f));
  else if (spec.entity === "campaigns") rows = campaignRows(d, f, acv);
  else if (spec.entity === "followups") {
    const ids = new Set(scopeLeads(d, f).map((l) => l.id));
    rows = d.followups.filter(
      (x) =>
        ids.has(x.leadId) &&
        (!ff.status?.length || ff.status.includes(x.status)) &&
        (inRange(x.dueAt, f) || inRange(x.completedAt, f)),
    );
  } else
    rows = d.expenses.filter(
      (e) =>
        e.spentOn >= f.from &&
        e.spentOn <= f.to &&
        (!f.campaignId || e.campaignId === f.campaignId),
    );
  const all = REPORT_COLUMNS[spec.entity];
  const cols = spec.columns?.length ? all.filter((c) => spec.columns!.includes(c.key)) : all;
  let table = rows.map((r) => cols.map((c) => c.get(r)));
  if (spec.sort) {
    const i = all.findIndex((c) => c.key === spec.sort!.column);
    const sortCol = all[i];
    const vals = rows.map((r) => sortCol.get(r));
    const order = table
      .map((_, k) => k)
      .sort((a, b) => {
        const x = vals[a],
          y = vals[b];
        const c =
          typeof x === "number" && typeof y === "number"
            ? x - y
            : String(x ?? "").localeCompare(String(y ?? ""));
        return spec.sort!.dir === "asc" ? c : -c;
      });
    table = order.map((k) => table[k]);
  }
  if (spec.limit) table = table.slice(0, spec.limit);
  return { headers: cols.map((c) => c.label), rows: table };
}
