import { describe, expect, it } from "vitest";
import type { Lead, LeadProperty } from "./marketing";
import {
  applyFilters,
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
