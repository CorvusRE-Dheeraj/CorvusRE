import { describe, expect, it } from "vitest";
import { casePreview, RANGE_SPREAD, UNLOCKS, type PreviewInput } from "./case-preview";
import { computeComparableStats } from "./comps-analysis";
import type { CompProperty } from "./cad-comps";
import type { PropertyRecord } from "./properties";
import { directivePhrases } from "../../../../supabase/pt/functions/_shared/advisory-tone";

const property: PropertyRecord = {
  id: "p1",
  address: "100 Main St, Austin, TX",
  cad: "Travis CAD",
  accountNumber: "123456",
  ownerName: "Main St LLC",
  propertyType: "F1 Commercial",
  landValue: 600_000,
  improvementValue: 1_900_000,
  totalValue: 2_500_000,
  taxYear: 2026,
  protestDeadline: "2026-05-15",
  paymentDueDate: null,
  taxAmountDue: null,
  paidAt: null,
  estimatedSavings: 10_000,
  savingsBasis: "comps",
  createdAt: "2026-04-01T00:00:00Z",
  valueHistory: [
    {
      year: 2025,
      landValue: 550_000,
      improvementValue: 1_550_000,
      marketValue: 2_100_000,
      appraisedValue: 2_100_000,
    },
    {
      year: 2024,
      landValue: 500_000,
      improvementValue: 1_500_000,
      marketValue: 2_000_000,
      appraisedValue: 2_000_000,
    },
  ],
};

const at = (lat: number, lng: number, v: number, pid: number, address: string): CompProperty => ({
  pid,
  address,
  latitude: lat,
  longitude: lng,
  marketValue: v,
  ownerName: null,
  legalAcreage: 1,
  landValue: v * 0.25,
  improvementValue: v * 0.75,
  appraisedValue: v,
  propType: "F1",
});
const subject = at(30.27, -97.74, 2_500_000, 1, property.address);
const comps = [
  at(30.271, -97.741, 2_100_000, 2, "102 Main St"),
  at(30.272, -97.742, 2_200_000, 3, "104 Main St"),
  at(30.273, -97.743, 2_150_000, 4, "106 Main St"),
  at(30.274, -97.744, 2_600_000, 5, "108 Main St"),
];

const base: PreviewInput = {
  property,
  score: {
    score: 78,
    summary: "",
    factors: ["Assessed 15% above comparables", "Value up 19% in a year"],
  },
  comps: { subject, comps },
  compStats: computeComparableStats(subject, comps, property.totalValue),
  evidenceDocuments: 0,
};

describe("casePreview", () => {
  const p = casePreview(base);

  it("shows the official assessment and the year-over-year change", () => {
    expect(p.assessment.total).toBe(2_500_000);
    expect(p.assessment.priorYear).toEqual({ year: 2025, total: 2_100_000 });
    expect(p.assessment.changePct).toBe(19);
  });

  it("states the opportunity as Corvus AI's analysis, never an instruction", () => {
    expect(p.opportunity.level).toBe("potential");
    expect(p.opportunity.label).toBe("Corvus AI identifies a potential protest opportunity");
    expect(p.opportunity.reasons).toHaveLength(2);
  });

  it("gives a savings range, not a single precise figure", () => {
    expect(p.savingsRange).toEqual({
      low: 10_000 * (1 - RANGE_SPREAD.comps),
      high: 10_000 * (1 + RANGE_SPREAD.comps),
      basis: expect.stringContaining("county comparables"),
    });
  });

  it("counts and grades the comps and samples only two of them", () => {
    expect(p.comps.count).toBe(4);
    expect(p.comps.belowSubject).toBe(3);
    expect(p.comps.sample).toHaveLength(2);
    expect(p.comps.lockedCount).toBe(2);
    expect(["Strong", "Moderate"]).toContain(p.comps.quality);
  });

  it("lists evidence found and missing, and the sources used", () => {
    const found = Object.fromEntries(p.evidence.map((e) => [e.label, e.found]));
    expect(found["Official appraisal record"]).toBe(true);
    expect(found["Equal & uniform comparables"]).toBe(true);
    expect(found["Your documents"]).toBe(false);
    expect(p.sources.map((s) => s.name)).toContain("Travis CAD appraisal roll");
    expect(p.sources.map((s) => s.name)).toContain("County comparable parcels");
  });

  it("fills the first hearing-plan steps and locks the rest", () => {
    expect(p.hearingPlan[1].title).toBe(
      "Argument Corvus AI rates first: Equal & uniform comparison",
    );
    expect(p.hearingPlan[1].detail).toContain("3 of 4 comparables");
    expect(p.hearingPlan.filter((s) => !s.locked)).toHaveLength(2);
  });

  it("says so when there's no data instead of inventing it", () => {
    const empty = casePreview({
      property: { ...property, estimatedSavings: null, valueHistory: null, totalValue: null },
      score: null,
      comps: null,
      compStats: null,
      evidenceDocuments: 0,
    });
    expect(empty.opportunity.level).toBe("not_yet");
    expect(empty.savingsRange).toBeNull();
    expect(empty.comps.quality).toBe("None");
    expect(empty.hearingPlan[1].title).toBe(
      "Argument Corvus AI rates first: Market value evidence",
    );
  });

  it("uses no directive wording", () => {
    const text = [
      p.opportunity.label,
      ...p.hearingPlan.flatMap((s) => [s.title, s.detail]),
      ...UNLOCKS.flatMap((u) => [u.title, u.detail]),
    ];
    expect(text.flatMap(directivePhrases)).toEqual([]);
  });
});
