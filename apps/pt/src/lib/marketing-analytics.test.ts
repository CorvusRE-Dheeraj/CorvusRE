import { describe, expect, it } from "vitest";
import type { Activity, Campaign, Lead, LeadProperty, MarketingData } from "./marketing";
import {
  audienceEligibility,
  campaignRows,
  cleanSpec,
  customerAcv,
  eligibility,
  kpis,
  leadDimension,
  previousPeriod,
  runReport,
  suggestAssignments,
  touchDimension,
} from "./marketing-analytics";

const lead = (p: Partial<Lead>): Lead =>
  ({
    id: "l1",
    createdAt: "2026-10-05T12:00:00Z",
    updatedAt: "",
    fullName: null,
    email: "a@b.com",
    phone: null,
    company: null,
    source: "manual",
    stage: "contacted",
    propertyAddress: null,
    county: null,
    propertyType: null,
    appraisedValue: null,
    protestDeadline: null,
    ownerNames: null,
    profileId: null,
    tags: [],
    notes: null,
    aiSummary: null,
    aiSummaryAt: null,
    lastContactedAt: null,
    unsubscribedAt: null,
    city: null,
    zip: null,
    mailingAddress: null,
    podioItemId: null,
    podioAppId: null,
    assignedTo: null,
    priority: null,
    priorityReason: null,
    nextAction: null,
    nextActionAt: null,
    suggestedStage: null,
    suggestedStageReason: null,
    suggestionDismissed: null,
    dncReason: null,
    fieldSources: {},
    researchFlags: [],
    researchedAt: null,
    portfolioCount: 1,
    portfolioValue: 1e6,
    counties: ["Harris"],
    cities: [],
    zips: [],
    propertyTypes: ["Commercial"],
    maxChangePct: null,
    flaggedCount: 0,
    lastRefreshedAt: null,
    inviteToken: null,
    registrationStartedAt: null,
    registeredAt: null,
    propertyAddedAt: null,
    subscriptionStartedAt: null,
    subscribedAt: null,
    emailConsent: "unknown",
    smsConsent: "unknown",
    consentSource: null,
    consentUpdatedAt: null,
    ...p,
  }) as Lead;
const prop = (p: Partial<LeadProperty>): LeadProperty =>
  ({
    id: Math.random().toString(36),
    leadId: "l1",
    createdAt: "2026-10-01T00:00:00Z",
    source: "account",
    planTier: "owner_managed",
    valueBracket: "upTo5m",
    subscriptionStatus: "active",
    ...p,
  }) as LeadProperty;
const act = (p: Partial<Activity>): Activity =>
  ({
    id: Math.random().toString(36),
    createdAt: "2026-10-06T12:00:00Z",
    leadId: "l1",
    campaignId: null,
    kind: "email",
    summary: "x",
    body: null,
    outcome: null,
    createdBy: "s",
    templateId: null,
    ...p,
  }) as Activity;
const camp = (p: Partial<Campaign>): Campaign =>
  ({
    id: "c1",
    createdAt: "2026-10-01",
    updatedAt: "",
    name: "Fall push",
    channel: "email",
    status: "sent",
    audience: {},
    subject: "s",
    body: "b",
    scheduledAt: null,
    approvedAt: null,
    sentAt: "2026-10-06T10:00:00Z",
    pausedAt: null,
    stats: { targeted: 2 },
    templateId: null,
    ownerId: null,
    budget: null,
    ...p,
  }) as Campaign;
const md = (p: Partial<MarketingData>): MarketingData =>
  ({
    leads: [],
    properties: [],
    activities: [],
    campaigns: [],
    followups: [],
    aiRuns: [],
    segments: [],
    templates: [],
    handoffs: [],
    expenses: [],
    recommendations: [],
    reports: [],
    syncChanges: [],
    notifications: [],
    staff: [],
    me: null,
    settings: { rules: {}, inactiveDays: 14, notifyEmail: true, podio: {} },
    ...p,
  }) as MarketingData;
const F = { from: "2026-10-01", to: "2026-10-31" };

describe("marketing analytics", () => {
  it("values a customer at annual list price, 15% off a 2nd property in the same plan", () => {
    expect(customerAcv([prop({}), prop({ createdAt: "2026-10-02T00:00:00Z" })])).toBe(
      Math.round(299 * 12 + 299 * 12 * 0.85),
    );
    expect(customerAcv([prop({ subscriptionStatus: "canceled" })])).toBe(0);
  });
  it("computes funnel KPIs, CAC, revenue per customer and ROMI for the period", () => {
    const d = md({
      leads: [
        lead({
          id: "l1",
          registeredAt: "2026-10-07T00:00:00Z",
          subscribedAt: "2026-10-09T00:00:00Z",
        }),
        lead({ id: "l2", createdAt: "2026-09-01T00:00:00Z" }),
      ],
      properties: [prop({ leadId: "l1" })],
      activities: [
        act({ leadId: "l1" }),
        act({ leadId: "l1", kind: "call", outcome: "interested" }),
      ],
      expenses: [
        {
          id: "e",
          spentOn: "2026-10-03",
          amount: 1000,
          category: "ads",
          campaignId: null,
          vendor: null,
          description: null,
        },
      ],
    });
    const k = kpis(d, F);
    expect(k).toMatchObject({
      leads: 1,
      contacted: 1,
      interested: 1,
      registrations: 1,
      subscriptions: 1,
      spend: 1000,
      cac: 1000,
      revenue: 3588,
    });
    expect(k.romi).toBeCloseTo(2.588);
    expect(previousPeriod({ from: "2026-10-01", to: "2026-10-31" })).toMatchObject({
      from: "2026-08-31",
      to: "2026-09-30",
    });
  });
  it("credits campaigns with engagement, customers, spend and ROI", () => {
    const d = md({
      leads: [lead({ id: "l1", subscribedAt: "2026-10-12T00:00:00Z" }), lead({ id: "l2" })],
      properties: [prop({ leadId: "l1" })],
      campaigns: [camp({})],
      activities: [
        act({ leadId: "l1", campaignId: "c1", createdAt: "2026-10-06T10:00:00Z" }),
        act({ leadId: "l2", campaignId: "c1", createdAt: "2026-10-06T10:00:00Z" }),
        act({ leadId: "l1", kind: "call", outcome: "replied", createdAt: "2026-10-08T10:00:00Z" }),
      ],
      expenses: [
        {
          id: "e",
          spentOn: "2026-10-05",
          amount: 500,
          category: "email",
          campaignId: "c1",
          vendor: null,
          description: null,
        },
      ],
    });
    const [r] = campaignRows(d, F);
    expect(r).toMatchObject({
      recipients: 2,
      engaged: 1,
      customers: 1,
      spend: 500,
      cac: 500,
      revenue: 3588,
    });
    expect(r.engagement).toBe(0.5);
  });
  it("breaks results down by county and by channel", () => {
    const d = md({
      leads: [
        lead({ id: "l1", counties: ["Harris"], subscribedAt: "2026-10-12T00:00:00Z" }),
        lead({ id: "l2", counties: ["Collin"] }),
      ],
      activities: [
        act({ leadId: "l1", kind: "call" }),
        act({ leadId: "l1", kind: "call", outcome: "replied", createdAt: "2026-10-07T12:00:00Z" }),
        act({ leadId: "l2", kind: "email" }),
      ],
    });
    const c = leadDimension(d, F, "county");
    expect(c[0]).toMatchObject({ key: "Harris", customers: 1 });
    const ch = touchDimension(d, F, "channel");
    expect(ch.find((x) => x.key === "call")).toMatchObject({ sent: 2, engaged: 1 });
  });
  it("checks contact eligibility like the database", () => {
    expect(eligibility(lead({ smsConsent: "unknown", phone: "1" }), "sms")).toMatch(/SMS consent/);
    expect(eligibility(lead({ smsConsent: "granted", phone: "1" }), "sms")).toBeNull();
    expect(eligibility(lead({ emailConsent: "withdrawn" }), "email")).toMatch(/withdrawn/);
    expect(eligibility(lead({ stage: "do_not_contact" }), "call")).toBe("Do Not Contact");
    const a = audienceEligibility(
      [lead({}), lead({ unsubscribedAt: "x" }), lead({ email: null })],
      "email",
    );
    expect(a.eligible).toBe(1);
    expect(a.excluded).toHaveLength(2);
  });
  it("suggests assignments to the lightest-loaded teammate", () => {
    const d = md({
      leads: [
        lead({ id: "a", stage: "ready" }),
        lead({ id: "b", stage: "ready" }),
        lead({ id: "busy1", assignedTo: "s1" }),
        lead({ id: "busy2", assignedTo: "s1" }),
      ],
      staff: [
        { id: "s1", name: "Ann", email: "", isSuperAdmin: false, isSupervisor: false },
        { id: "s2", name: "Bo", email: "", isSuperAdmin: false, isSupervisor: false },
      ],
    });
    const s = suggestAssignments(d, new Map());
    expect(s.map((x) => x.toName)).toEqual(["Bo", "Ann"]); // Bo gets the first, then Ann is lighter
  });
  it("builds AI-requested reports from validated specs only", () => {
    expect(cleanSpec({ entity: "secrets" })).toBeNull();
    const spec = cleanSpec({
      entity: "leads",
      columns: ["name", "assessed", "password"],
      sort: { column: "assessed", dir: "desc" },
      limit: 1,
    })!;
    expect(spec.columns).toEqual(["name", "assessed"]);
    const t = runReport(
      spec,
      md({
        leads: [
          lead({ id: "1", company: "Small", portfolioValue: 1 }),
          lead({ id: "2", company: "Big", portfolioValue: 9 }),
        ],
      }),
      new Map(),
      F,
    );
    expect(t.headers).toEqual(["Owner / company", "Total assessed"]);
    expect(t.rows).toEqual([["Big", 9]]);
  });
});
