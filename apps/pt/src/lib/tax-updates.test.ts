import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { PropertyRecord } from "./properties";
import type { ProtestRecord } from "./protests";
import {
  buildReportPdf,
  countiesIn,
  criticalUpdates,
  filterUpdates,
  NO_FILTER,
  propertiesAffected,
  toBullets,
  updatesForProperty,
  type TaxReport,
  type TaxUpdate,
} from "./tax-updates";

const u = (over: Partial<TaxUpdate>): TaxUpdate => ({
  id: over.id ?? "1",
  chapter: 1,
  title: "A change",
  whatChanged: "Something changed",
  effectiveDate: null,
  affects: "Owners",
  whyItMatters: "Matters",
  actionNeeded: "Act",
  status: "notice_guidance",
  tags: [],
  counties: [],
  sourceName: "Comptroller",
  sourceUrl: "https://comptroller.texas.gov/x",
  sourceCheckedAt: "2026-09-21T00:00:00Z",
  quote: "quote text here",
  isNew: true,
  ...over,
});

const prop = (over: Partial<PropertyRecord> = {}): PropertyRecord =>
  ({
    id: "p1",
    address: "1 Main St",
    cad: "Dallas Central Appraisal District",
    propertyType: "Commercial",
    ...over,
  }) as PropertyRecord;
const protest = (over: Partial<ProtestRecord> = {}): ProtestRecord =>
  ({ id: "x", status: "filed", ...over }) as ProtestRecord;

describe("filterUpdates", () => {
  const list = [
    u({ id: "a", title: "Statewide rule", tags: ["commercial"] }),
    u({
      id: "b",
      title: "Dallas ARB backlog",
      counties: ["Dallas County"],
      tags: ["arb", "protest"],
    }),
    u({ id: "c", title: "Fort Bend rate", counties: ["Fort Bend County"], tags: ["valuation"] }),
  ];

  it("scopes to Texas-wide or to a county", () => {
    expect(filterUpdates(list, { ...NO_FILTER, scope: "texas" }).map((x) => x.id)).toEqual(["a"]);
    expect(filterUpdates(list, { ...NO_FILTER, scope: "county" }).map((x) => x.id)).toEqual([
      "b",
      "c",
    ]);
    expect(
      filterUpdates(list, { ...NO_FILTER, scope: "county", county: "Dallas County" }).map(
        (x) => x.id,
      ),
    ).toEqual(["b"]);
  });

  it("filters by topic (any of the chosen) and by search words", () => {
    expect(
      filterUpdates(list, { ...NO_FILTER, tags: ["arb", "valuation"] }).map((x) => x.id),
    ).toEqual(["b", "c"]);
    expect(filterUpdates(list, { ...NO_FILTER, query: "dallas backlog" }).map((x) => x.id)).toEqual(
      ["b"],
    );
    expect(filterUpdates(list, { ...NO_FILTER, query: "nothing matches" })).toEqual([]);
  });

  it("lists the counties present", () => {
    expect(countiesIn(list)).toEqual(["Dallas County", "Fort Bend County"]);
  });
});

describe("propertiesAffected", () => {
  it("flags a county update only for properties in that county", () => {
    const upd = u({ counties: ["Dallas County"] });
    expect(propertiesAffected(upd, [{ property: prop(), protest: null }])).toHaveLength(1);
    expect(
      propertiesAffected(upd, [
        { property: prop({ cad: "Collin Central Appraisal District" }), protest: null },
      ]),
    ).toHaveLength(0);
  });

  it("flags statewide updates by property type and by case stage", () => {
    const commercial = u({ tags: ["commercial"] });
    expect(propertiesAffected(commercial, [{ property: prop(), protest: null }])).toHaveLength(1);
    expect(
      propertiesAffected(commercial, [
        { property: prop({ propertyType: "Single family residence" }), protest: null },
      ]),
    ).toHaveLength(0);

    const arb = u({ tags: ["arbitration"] });
    expect(propertiesAffected(arb, [{ property: prop(), protest: protest() }])).toHaveLength(0);
    expect(
      propertiesAffected(arb, [
        { property: prop(), protest: protest({ escalationPath: "arbitration" }) },
      ]),
    ).toHaveLength(1);

    const court = u({ tags: ["court"] });
    expect(
      propertiesAffected(court, [
        { property: prop(), protest: protest({ escalationPath: "appeal" }) },
      ]),
    ).toHaveLength(1);

    const protestTag = u({ tags: ["protest"] });
    expect(
      propertiesAffected(protestTag, [
        { property: prop(), protest: protest({ status: "resolved" }) },
      ]),
    ).toHaveLength(0);
  });

  it("narrows updates to one property and topic", () => {
    const list = [u({ id: "a", tags: ["court"] }), u({ id: "b", tags: ["commercial"] })];
    const ctx = { property: prop(), protest: protest({ escalationPath: "appeal" }) };
    expect(updatesForProperty(list, ctx, ["court"]).map((x) => x.id)).toEqual(["a"]);
    expect(
      updatesForProperty(list, ctx)
        .map((x) => x.id)
        .sort(),
    ).toEqual(["a", "b"]);
  });
});

describe("buildReportPdf", () => {
  it("builds a downloadable PDF with the chapters, sources and Explore link", async () => {
    const report: TaxReport = {
      id: "r",
      weekStart: "2026-09-21",
      title: "Texas Property Tax Law & Updates — week of 2026-09-21",
      summary: "1 verified update (1 new this week) from 2 of 3 official sources.",
      updates: [u({ chapter: 5, title: "ARB thresholds updated", tags: ["arb"] })],
      sources: [
        {
          name: "Comptroller",
          url: "https://comptroller.texas.gov/",
          county: null,
          ok: true,
          note: "",
        },
        {
          name: "Denton CAD",
          url: "https://www.dentoncad.com/",
          county: "Denton County",
          ok: false,
          note: "no text",
        },
      ],
      generatedAt: "2026-09-21T12:00:00Z",
    };
    const bytes = await buildReportPdf(report);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(0);
  });
});

describe("criticalUpdates", () => {
  it("keeps enacted law, adopted rules and deadline items; drops proposals and failed bills", () => {
    const list = [
      u({ id: "prop", status: "proposed_rule" }),
      u({ id: "fail", status: "failed_legislation", tags: ["deadlines"] }),
      u({ id: "rule", status: "adopted_rule" }),
      u({ id: "law", status: "enacted_law" }),
      u({ id: "dl", status: "notice_guidance", tags: ["deadlines"] }),
    ];
    expect(criticalUpdates(list).map((x) => x.id)).toEqual(["dl", "law", "rule"]);
    expect(criticalUpdates(list, 1)).toHaveLength(1);
  });
});

describe("toBullets", () => {
  it("splits sentences into short bullets and caps the count and length", () => {
    expect(toBullets("First thing. Second thing! Third? Fourth one.")).toEqual([
      "First thing",
      "Second thing",
      "Third",
    ]);
    expect(toBullets("x".repeat(300), 3, 20)[0]).toHaveLength(20);
    expect(toBullets("")).toEqual([]);
  });
});
