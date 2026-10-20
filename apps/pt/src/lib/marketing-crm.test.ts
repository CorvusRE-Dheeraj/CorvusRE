import { describe, expect, it } from "vitest";
import type { Activity, Lead, LeadProperty, MarketingData, Template } from "./marketing";
import {
  applyFilters,
  bestTiming,
  effectiveness,
  followupQueue,
  journeyFunnel,
  journeyLinks,
  journeySteps,
  assessmentFlags,
  deadlineInfo,
  groupProspects,
  leadsCsv,
  personalize,
  pickObjective,
  pickTemplate,
  rankLead,
  shownPriority,
  statutoryDeadline,
  summarizeComps,
  buildImport,
  cleanCounty,
  cleanEmail,
  cleanPhone,
  guessPodioMapping,
  mapLeadColumns,
  matchPodio,
  mergePatch,
  nameSimilarity,
  ownerKey,
  podioProposals,
  podioValues,
  portfolios,
  propertyKey,
  recommend,
  splitAddress,
  splitOwners,
  tidyName,
  type PodioContactItem,
} from "./marketing-crm";

const lead = (p: Partial<Lead>): Lead => ({
  id: "l1",
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  fullName: null,
  email: null,
  phone: null,
  company: null,
  source: "manual",
  stage: "new",
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
  portfolioCount: 0,
  portfolioValue: null,
  counties: [],
  cities: [],
  zips: [],
  propertyTypes: [],
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
  lastEngagedAt: null,
  emailBouncedAt: null,
  ...p,
});

const prop = (p: Partial<LeadProperty>): LeadProperty => ({
  id: "p1",
  leadId: "l1",
  createdAt: "2026-10-01T00:00:00Z",
  address: null,
  city: null,
  zip: null,
  county: null,
  cad: null,
  accountNumber: null,
  propertyType: null,
  assessedValue: null,
  landValue: null,
  improvementValue: null,
  priorValue: null,
  taxYear: null,
  ownerName: null,
  mailingAddress: null,
  protestDeadline: null,
  source: "manual",
  sourceDetail: null,
  verified: false,
  confidence: null,
  notes: null,
  dedupeKey: "",
  valueYear: null,
  priorYear: null,
  refreshedAt: null,
  analysis: null,
  analyzedAt: null,
  changePct: null,
  flagged: false,
  planTier: null,
  valueBracket: null,
  subscriptionStatus: null,
  ...p,
});

describe("cleaning", () => {
  it("fixes common email domain typos and flags invalid ones", () => {
    expect(cleanEmail(" Bob@GMIAL.com ")).toMatchObject({ value: "bob@gmail.com", valid: true });
    expect(cleanEmail("bob@gmial.com").correction?.to).toBe("bob@gmail.com");
    expect(cleanEmail("not-an-email").valid).toBe(false);
    expect(cleanEmail("").value).toBeNull();
  });
  it("formats US phones", () => {
    expect(cleanPhone("+1 214.555.0100")).toEqual({ value: "(214) 555-0100", valid: true });
    expect(cleanPhone("214-555-0100 ext 12").value).toBe("(214) 555-0100 x12");
    expect(cleanPhone("5550100").valid).toBe(false);
  });
  it("tidies all-caps names, keeps entity suffixes", () => {
    expect(tidyName("ACME HOLDINGS LLC")).toBe("Acme Holdings LLC");
    expect(tidyName("O'BRIEN MARY-ANN")).toBe("O'Brien Mary-Ann");
    expect(tidyName("McDonald Ranch")).toBe("McDonald Ranch");
  });
  it("standardises county names", () => {
    expect(cleanCounty("DALLAS COUNTY")).toBe("Dallas");
    expect(cleanCounty("Collin Central Appraisal District")).toBe("Collin");
    expect(cleanCounty("fort bend cad")).toBe("Fort Bend");
  });
  it("splits city and ZIP from an address", () => {
    expect(splitAddress("2200 Ross Ave, Dallas, TX 75201-2708")).toEqual({
      city: "Dallas",
      zip: "75201",
    });
    expect(splitAddress("12 Elm St, Plano TX 75074")).toEqual({ city: "Plano", zip: "75074" });
  });
});

describe("owner identity", () => {
  it("compares owners without suffixes or punctuation", () => {
    expect(ownerKey("Acme Holdings, L.L.C.")).toBe(ownerKey("ACME HOLDINGS LLC"));
    expect(nameSimilarity("Acme Holdings LLC", "Acme Holdings, Inc.")).toBe(1);
    expect(nameSimilarity("Acme Holdings", "Acme Holding")).toBeGreaterThan(0.85);
    expect(nameSimilarity("Acme Holdings", "Zenith Partners")).toBeLessThan(0.4);
  });
  it("finds every owner on a multi-owner record", () => {
    expect(splitOwners("SMITH JOHN & MARY")).toEqual(["SMITH JOHN", "MARY"]);
    expect(splitOwners("A LLC; B LP")).toEqual(["A LLC", "B LP"]);
    expect(splitOwners("JONES ROBERT ET AL")).toEqual(["JONES ROBERT"]);
  });
  it("keys a parcel by account when there is one", () => {
    expect(propertyKey({ accountNumber: "R123", county: "Collin", address: "x" })).toBe(
      "acct:collin:r123",
    );
    expect(propertyKey({ address: "12 Elm St." })).toBe("addr:12elmst");
  });
});

describe("import review", () => {
  const headers = [
    "Owner",
    "E-mail",
    "Phone Number",
    "Situs Address",
    "County",
    "Market Value",
    "Prop ID",
  ];
  const mapping = mapLeadColumns(headers);
  it("maps common headers without AI", () => {
    expect(mapping.map((m) => m.field)).toEqual([
      "ownerNames",
      "email",
      "phone",
      "address",
      "county",
      "assessedValue",
      "accountNumber",
    ]);
  });
  it("combines one owner's rows into a portfolio and corrects details", () => {
    const g = buildImport(
      [
        [
          "ACME HOLDINGS LLC",
          "ops@gmial.com",
          "2145550100",
          "1 Main St, Dallas, TX 75201",
          "DALLAS COUNTY",
          "$1,200,000",
          "A1",
        ],
        ["Acme Holdings, LLC", "", "", "2 Main St, Dallas, TX 75201", "Dallas", "800000", "A2"],
        ["", "", "", "", "", "", ""],
      ],
      mapping,
      [],
      [],
    );
    expect(g).toHaveLength(1); // the no-email row joins the same owner's group
    const acme = g[0];
    expect(acme.lead.email).toBe("ops@gmail.com");
    expect(acme.properties).toHaveLength(2);
    expect(acme.corrections.some((c) => c.field === "email")).toBe(true);
    expect(acme.properties[0]).toMatchObject({
      county: "Dallas",
      assessedValue: 1_200_000,
      zip: "75201",
      city: "Dallas",
    });
    expect(acme.action).toBe("add");
  });
  it("groups by owner name when there's no email, and flags missing contact details", () => {
    const g = buildImport(
      [
        ["Zenith LP", "", "", "1 A St, Plano, TX 75074", "Collin", "500000", "Z1"],
        ["ZENITH L.P.", "", "", "2 B St, Plano, TX 75074", "Collin", "700000", "Z2"],
      ],
      mapping,
      [],
      [],
    );
    expect(g).toHaveLength(1);
    expect(g[0].properties).toHaveLength(2);
    expect(g[0].missing).toContain("email or phone");
    expect(g[0].issues.some((i) => i.message.includes("2 rows combined"))).toBe(true);
  });
  it("merges into an existing lead by email, flags shared parcels", () => {
    const existing = [
      lead({ id: "x", email: "ops@acme.com", company: "Acme" }),
      lead({ id: "y", company: "Other Owner" }),
    ];
    const props = [prop({ leadId: "y", dedupeKey: "acct:collin:z1" })];
    const g = buildImport(
      [["Acme", "OPS@acme.com", "", "1 A St", "Collin", "1", "Z1"]],
      mapping,
      existing,
      props,
    );
    expect(g[0]).toMatchObject({ action: "merge", mergeInto: "x" });
    expect(g[0].sharedWith[0].leadId).toBe("y");
  });
  it("never overwrites existing details on merge", () => {
    const patch = mergePatch(lead({ email: "a@b.com", phone: null }), {
      fullName: "New",
      company: null,
      email: "c@d.com",
      phone: "(214) 555-0100",
      ownerNames: null,
      mailingAddress: null,
      notes: null,
    });
    expect(patch).toEqual({ fullName: "New", phone: "(214) 555-0100" });
  });
});

describe("filters + portfolios", () => {
  const leads = [
    lead({
      id: "a",
      stage: "ready",
      counties: ["Dallas", "Collin"],
      portfolioCount: 3,
      portfolioValue: 3e6,
      zips: ["75201"],
    }),
    lead({
      id: "b",
      stage: "contacted",
      counties: ["Harris"],
      portfolioCount: 1,
      portfolioValue: 4e5,
      assignedTo: "me1",
    }),
  ];
  const ctx = { activities: [], campaigns: [], me: "me1" };
  it("matches any county in the portfolio, value, size, ZIP and staff", () => {
    expect(applyFilters(leads, { counties: ["collin"] }, ctx).map((l) => l.id)).toEqual(["a"]);
    expect(applyFilters(leads, { minValue: 1e6, minProperties: 2 }, ctx).map((l) => l.id)).toEqual([
      "a",
    ]);
    expect(applyFilters(leads, { zips: ["75201"] }, ctx).map((l) => l.id)).toEqual(["a"]);
    expect(applyFilters(leads, { assignedTo: "me" }, ctx).map((l) => l.id)).toEqual(["b"]);
    expect(applyFilters(leads, { assignedTo: "none" }, ctx).map((l) => l.id)).toEqual(["a"]);
  });
  it("totals portfolios and spots co-owned parcels", () => {
    const rows = portfolios({
      leads: [lead({ id: "a", company: "Acme" }), lead({ id: "b", company: "Smith" })],
      properties: [
        prop({ id: "1", leadId: "a", assessedValue: 4e6, dedupeKey: "k1", county: "Dallas" }),
        prop({ id: "2", leadId: "a", assessedValue: 2e6, dedupeKey: "k2", county: "Collin" }),
        prop({ id: "3", leadId: "b", assessedValue: 2e6, dedupeKey: "k2", county: "Collin" }),
      ],
    });
    expect(rows[0]).toMatchObject({ total: 6e6, highValue: true, coOwned: 1 });
    expect(rows[0].counties.sort()).toEqual(["Collin", "Dallas"]);
  });
});

describe("recommendations", () => {
  const d = { activities: [], followups: [], campaigns: [] };
  it("never recommends outreach to Do Not Contact", () => {
    const r = recommend(lead({ stage: "do_not_contact", email: "a@b.com" }), d, 90);
    expect(r.channel).toBe("none");
  });
  it("research first when contact details are missing", () => {
    expect(recommend(lead({ stage: "researching" }), d, 10).action).toMatch(/Research/);
  });
  it("calls high-priority reachable leads", () => {
    const r = recommend(
      lead({ stage: "ready", phone: "(214) 555-0100", portfolioCount: 6, portfolioValue: 9e6 }),
      d,
      70,
    );
    expect(r).toMatchObject({ priority: "high", channel: "call", dueInDays: 0 });
  });
});

describe("Podio sync proposals", () => {
  const fields = [
    { externalId: "name", label: "Name", type: "text" },
    { externalId: "email", label: "Email", type: "email" },
    { externalId: "phone", label: "Phone", type: "phone" },
    { externalId: "company", label: "Company", type: "text" },
  ];
  const mapping = guessPodioMapping(fields);
  const item = (id: number, vals: Record<string, string>): PodioContactItem => ({
    itemId: id,
    appId: 9,
    title: vals.name ?? "",
    fields: fields.map((f) => ({ ...f, text: vals[f.externalId] ?? "" })),
  });
  it("maps fields by type and label", () => {
    expect(mapping).toEqual({
      name: "fullName",
      email: "email",
      phone: "phone",
      company: "company",
    });
  });
  it("matches by email, fills blanks both ways, never overwrites", () => {
    const leads = [
      lead({ id: "x", email: "pat@acme.com", fullName: "Pat Lee", phone: "(214) 555-0100" }),
    ];
    const p = podioProposals(
      [item(1, { name: "Patricia Lee", email: "PAT@acme.com", company: "Acme LLC" })],
      mapping,
      leads,
    );
    const toCrm = p.find((x) => x.direction === "podio_to_crm")!;
    expect(toCrm.leadId).toBe("x");
    expect(toCrm.changes.find((c) => c.field === "company")).toMatchObject({
      from: null,
      to: "Acme LLC",
    });
    expect(toCrm.changes.find((c) => c.field === "fullName")?.label).toMatch(/differs/);
    const toPodio = p.find((x) => x.direction === "crm_to_podio")!;
    expect(toPodio.changes).toEqual([
      expect.objectContaining({
        field: "phone",
        to: "(214) 555-0100",
        podioExternalId: "phone",
        podioType: "phone",
      }),
    ]);
  });
  it("proposes a new lead when nothing matches, and only a link for a name-only match", () => {
    const leads = [lead({ id: "y", company: "Zenith Partners" })];
    const p = podioProposals(
      [
        item(2, { name: "New Person", email: "new@x.com" }),
        item(3, { company: "Zenith Partners" }),
      ],
      mapping,
      leads,
    );
    expect(p.find((x) => x.podioItemId === 2)).toMatchObject({ kind: "create", leadId: null });
    expect(p.find((x) => x.podioItemId === 3)).toMatchObject({
      kind: "link",
      leadId: "y",
      changes: [],
    });
  });
  it("prefers the already-linked lead", () => {
    const it2 = item(5, { email: "z@z.com" });
    const m = matchPodio(it2, podioValues(it2, mapping), [
      lead({ id: "q", podioItemId: 5, podioAppId: 9 }),
    ]);
    expect(m).toMatchObject({ confidence: 1 });
  });
});

describe("AI-powered leads", () => {
  const now = new Date("2026-10-19T12:00:00");
  it("flags assessment increases and above-comparables values, without promising savings", () => {
    const comps = summarizeComps({ value: 3e6, acres: 2 }, [
      { marketValue: 1e6, legalAcreage: 1 },
      { marketValue: 1.1e6, legalAcreage: 1 },
      { marketValue: 1.2e6, legalAcreage: 1 },
    ]);
    expect(comps).toMatchObject({ count: 3, medianPerAcre: 1.1e6, subjectPerAcre: 1.5e6 });
    const f = assessmentFlags(
      {
        assessedValue: 3e6,
        priorValue: 2.5e6,
        valueYear: 2026,
        priorYear: 2025,
        protestDeadline: null,
      },
      comps,
      now,
    );
    expect(f.map((x) => [x.kind, x.level])).toEqual([
      ["increase", "strong"],
      ["comparables", "strong"],
    ]);
    expect(f[0].text).toContain("up 20.0% (2025 → 2026)");
    expect(f.map((x) => x.text).join(" ")).not.toMatch(/save|guarantee|will be reduced/i);
    expect(
      assessmentFlags({ assessedValue: 2e6, priorValue: null, protestDeadline: null }, null, now)[0]
        .kind,
    ).toBe("high_value");
  });
  it("ranks with explained factors and lets staff override", () => {
    const l = lead({
      id: "a",
      stage: "ready",
      email: "a@b.com",
      portfolioCount: 6,
      portfolioValue: 30e6,
      counties: ["Harris"],
    });
    const props = [
      prop({
        leadId: "a",
        changePct: 15,
        priorValue: 1,
        analysis: {
          flags: [{ kind: "increase", level: "strong", text: "Assessed value up 15%." }],
          analyzedAt: "",
          sources: [],
        },
      }),
    ];
    const r = rankLead(l, props, [], now);
    expect(r.level).toBe("high");
    expect(r.strongest).toBe("Assessed value up 15%.");
    expect(r.factors[0].points).toBeGreaterThan(0);
    expect(shownPriority(l, r)).toBe("high");
    expect(
      shownPriority({ ...l, priority: "low", fieldSources: { priority: { source: "Staff" } } }, r),
    ).toBe("low");
    expect(rankLead(lead({ stage: "do_not_contact" }), [], [], now).level).toBe("low");
  });
  it("uses the notice deadline when known, else the statutory one (next business day)", () => {
    expect(statutoryDeadline(2027).toDateString()).toBe(new Date(2027, 4, 17).toDateString()); // May 15 2027 is a Saturday
    expect(deadlineInfo(lead({}), now)).toMatchObject({ basis: "statutory", date: "2027-05-17" });
    expect(deadlineInfo(lead({ protestDeadline: "2026-11-10" }), now)).toMatchObject({
      basis: "notice",
    });
  });
  it("groups county results by owner and marks known owners and parcels", () => {
    const rec = (o: string, acct: string, v: number, prior: number | null = null) => ({
      ownerName: o,
      propertyAddress: `${acct} Main St, Houston, TX 77002`,
      city: "HOUSTON",
      zip: "77002",
      county: "Harris",
      cad: "Harris Central Appraisal District",
      accountNumber: acct,
      stateCode: "F1",
      propertyType: "Commercial",
      assessedValue: v,
      priorValue: prior,
      valueYear: 2026,
      mailingAddress: "PO Box 1",
    });
    const g = groupProspects(
      [
        rec("BLOCK 58 LLC", "1", 5e6, 4e6),
        rec("Block 58, L.L.C.", "2", 2e6),
        rec("OTHER LP", "3", 1e6),
      ],
      [lead({ id: "x", company: "Other LP" })],
      [prop({ leadId: "x", dedupeKey: "acct:harris:3" })],
    );
    expect(g).toHaveLength(2);
    expect(g[0]).toMatchObject({
      owner: "Block 58 LLC",
      total: 7e6,
      maxChangePct: 25,
      existing: null,
    });
    expect(g[0].newRecords).toHaveLength(2);
    expect(g[1]).toMatchObject({ existing: { leadId: "x" }, known: 1 });
    expect(g[1].newRecords).toHaveLength(0);
  });
  it("picks the objective and template that fit, avoiding ones already sent", () => {
    const tpl = (id: string, objective: Template["objective"], uses = 0): Template => ({
      id,
      name: id,
      objective,
      channel: "email",
      subject: "s",
      body: "Hi {{first_name}}, {{company}} {{value_change}}",
      active: true,
      isDefault: false,
      aiGenerated: false,
      uses,
      lastUsedAt: null,
      updatedAt: "",
    });
    const l = lead({
      id: "a",
      fullName: "Pat Lee",
      company: "Acme LLC",
      maxChangePct: 12,
      stage: "ready",
    });
    expect(pickObjective(l, [], now).objective).toBe("assessment_increase");
    expect(pickObjective({ ...l, stage: "property_added" }, [], now).objective).toBe(
      "subscription_promo",
    );
    expect(pickObjective({ ...l, maxChangePct: null }, [], now).objective).toBe("initial_outreach");
    const sent = [
      {
        id: "1",
        createdAt: "",
        leadId: "a",
        campaignId: null,
        kind: "email" as const,
        summary: "x",
        body: null,
        outcome: null,
        createdBy: null,
        templateId: "t1",
      },
    ];
    const pick = pickTemplate(
      l,
      [tpl("t1", "assessment_increase", 9), tpl("t2", "assessment_increase")],
      sent,
      "email",
    );
    expect(pick.template?.id).toBe("t2");
    expect(personalize("Hi {{first_name}}, {{company}} up {{value_change}}", l)).toBe(
      "Hi Pat, Acme LLC up 12%",
    );
  });
  it("filters by value change, protest potential and engagement; exports CSV without DNC contact details", () => {
    const leads = [
      lead({ id: "a", maxChangePct: 12, flaggedCount: 1 }),
      lead({
        id: "b",
        maxChangePct: 2,
        stage: "do_not_contact",
        email: "x@y.com",
        company: 'Quote "Co"',
      }),
    ];
    const ctx = { activities: [], campaigns: [], me: null };
    expect(applyFilters(leads, { minChangePct: 10 }, ctx).map((l) => l.id)).toEqual(["a"]);
    expect(applyFilters(leads, { flaggedOnly: true }, ctx).map((l) => l.id)).toEqual(["a"]);
    expect(applyFilters(leads, { engagement: "never_contacted" }, ctx)).toHaveLength(2);
    const csv = leadsCsv(leads, { properties: [], staff: [] }, () => "low");
    expect(csv.split("\n")[0]).toContain("Deadline basis");
    expect(csv).toContain('"Quote ""Co"""');
    expect(csv).not.toContain("x@y.com");
  });
});

describe("follow-ups + journey", () => {
  const now = new Date("2026-10-21T15:00:00"); // a Wednesday
  const act = (p: Partial<Activity>): Activity => ({
    id: Math.random().toString(36),
    createdAt: "2026-10-10T15:00:00Z",
    leadId: "a",
    campaignId: null,
    kind: "email",
    summary: "x",
    body: null,
    outcome: null,
    createdBy: "staff",
    templateId: null,
    ...p,
  });
  const md = (p: Partial<MarketingData>): MarketingData => ({
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
    campaignMetrics: new Map(),
    syncChanges: [],
    notifications: [],
    staff: [],
    me: null,
    settings: { rules: {}, inactiveDays: 14, notifyEmail: true, podio: {}, postalAddress: null },
    ...p,
  });
  it("tracks journey steps — self sign-ups pass the marketing steps", () => {
    const l = lead({
      id: "a",
      stage: "property_added",
      registrationStartedAt: "2026-10-01",
      registeredAt: "2026-10-02",
      propertyAddedAt: "2026-10-03",
    });
    const s = journeySteps(l, []);
    expect(s.map((x) => x.done)).toEqual([true, true, true, true, true, false, false]);
    expect(s.find((x) => x.current)?.key).toBe("property_added");
  });
  it("shows where prospects drop off", () => {
    const f = journeyFunnel(
      [
        lead({ id: "1", stage: "contacted" }),
        lead({ id: "2", stage: "interested" }),
        lead({ id: "3", stage: "registered" }),
      ],
      [],
    );
    expect(f.map((x) => x.count)).toEqual([3, 2, 1, 1, 0, 0, 0]);
    expect(f[1].conversion).toBeCloseTo(2 / 3);
    expect(f.find((x) => x.key === "registered")?.stuck).toBe(1);
  });
  it("links back to the unfinished step with the lead token", () => {
    const k = journeyLinks(
      {
        email: "pat@x.com",
        fullName: "Pat Lee",
        inviteToken: "11111111-2222-3333-4444-555555555555",
      },
      "https://corvusre.com/corvuspt",
    );
    expect(k.registration).toBe(
      "https://corvusre.com/corvuspt/sign-in?mode=signup&email=pat%40x.com&firstName=Pat&lead=11111111-2222-3333-4444-555555555555",
    );
    expect(k.addProperty).toContain("/dashboard/properties");
  });
  it("suggests a call after an unanswered email, at their usual reply hour", () => {
    const l = lead({ id: "a", stage: "contacted", email: "a@b.com", phone: "(214) 555-0100" });
    expect(bestTiming(l, [act({ kind: "email" })], "medium", now).channel).toBe("call");
    const t = bestTiming(
      l,
      [act({ kind: "call", outcome: "replied", createdAt: "2026-10-05T14:00:00" })],
      "high",
      now,
    );
    expect(t.channel).toBe("call");
    expect(t.at.getHours()).toBe(14);
    expect(t.at.getTime()).toBeGreaterThan(now.getTime());
    expect([1, 2, 3, 4, 5]).toContain(t.at.getDay());
  });
  it("recommends the next step for each journey stage", () => {
    const d = { activities: [], followups: [], campaigns: [] };
    expect(recommend(lead({ stage: "interested", email: "a@b.com" }), d, 50).action).toMatch(
      /registration link/,
    );
    expect(recommend(lead({ stage: "registered", portfolioCount: 4 }), d, 50).action).toMatch(
      /own 4/,
    );
    expect(recommend(lead({ stage: "subscription_started", phone: "1" }), d, 50)).toMatchObject({
      channel: "call",
    });
    expect(pickObjective(lead({ stage: "subscription_started" }), [], now).objective).toBe(
      "finish_checkout",
    );
    expect(pickObjective(lead({ stage: "registered" }), [], now).objective).toBe("add_property");
  });
  it("queues who needs a follow-up, hottest first, skipping planned and opted-out", () => {
    const leads = [
      lead({
        id: "chk",
        stage: "subscription_started",
        subscriptionStartedAt: "2026-10-21T10:00:00",
        email: "c@x.com",
      }),
      lead({ id: "nr", stage: "contacted", email: "n@x.com" }),
      lead({ id: "dnc", stage: "do_not_contact" }),
      lead({ id: "planned", stage: "registered", registeredAt: "2026-10-01" }),
    ];
    const d = md({
      leads,
      activities: [act({ leadId: "nr", kind: "email", createdAt: "2026-10-10T10:00:00" })],
      followups: [{ id: "f", leadId: "planned", status: "pending" } as never],
    });
    const q = followupQueue(d, new Map(), now);
    expect(q.map((x) => x.lead.id)).toEqual(["chk", "nr"]);
    expect(q[0]).toMatchObject({ kind: "checkout", objective: "finish_checkout" });
    expect(q[1].kind).toBe("no_response");
  });
  it("measures response rate and abandoned onboarding", () => {
    const d = md({
      leads: [
        lead({
          id: "a",
          stage: "subscription_started",
          subscriptionStartedAt: "2026-10-20T10:00:00",
          registeredAt: "2026-10-15",
        }),
      ],
      activities: [
        act({
          kind: "stage",
          summary: "Status: Contacted → Interested",
          createdAt: "2026-10-12T10:00:00",
        }),
        act({ kind: "email", createdAt: "2026-10-11T10:00:00" }),
        act({ kind: "call", createdAt: "2026-10-01T10:00:00", leadId: "a" }),
      ],
    });
    const e = effectiveness(d, 30, now);
    expect(e.outreach).toBe(2);
    expect(e.responses).toBe(1);
    expect(e.byChannel.find((c) => c.key === "email")?.rate).toBe(1);
    expect(e.abandoned.checkout).toBe(1);
    expect(e.registrations).toBe(1);
  });
});
