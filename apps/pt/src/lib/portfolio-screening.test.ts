import { describe, expect, it } from "vitest";
import { screenPortfolio, screenProperty } from "./portfolio-screening";
import { propertyAnnualPrice } from "./billing";
import type { PropertyRecord } from "./properties";
import { directivePhrases } from "../../../../supabase/pt/functions/_shared/advisory-tone";

const PLAN = propertyAnnualPrice("owner_managed", "upTo5m", false);

const prop = (
  id: string,
  estimatedSavings: number | null,
  totalValue = 2_000_000,
): PropertyRecord => ({
  id,
  address: `${id} Main St`,
  cad: "Travis CAD",
  accountNumber: id,
  ownerName: null,
  propertyType: "F1",
  landValue: null,
  improvementValue: null,
  totalValue,
  taxYear: 2026,
  protestDeadline: null,
  paymentDueDate: null,
  taxAmountDue: null,
  paidAt: null,
  estimatedSavings,
  savingsBasis: "formula",
  createdAt: "",
  valueHistory: null,
});
const score = (n: number) => ({ score: n, summary: "", factors: [] });

describe("screenProperty", () => {
  it("rates a strong case whose savings cover the plan twice over as high priority", () => {
    const s = screenProperty(prop("a", 14_000), score(82));
    expect(s.tier).toBe("high");
    expect(s.reason).toContain("× the plan cost");
  });

  it("calls a case low priority when savings wouldn't cover the plan", () => {
    const s = screenProperty(prop("b", PLAN - 1), score(90));
    expect(s.tier).toBe("low");
    expect(s.reason).toContain("below the");
  });

  it("calls a weak county-data case low priority", () => {
    expect(screenProperty(prop("c", 9_000), score(30)).tier).toBe("low");
  });

  it("treats no savings estimate as low priority", () => {
    expect(screenProperty(prop("d", null), score(80)).tier).toBe("low");
  });

  it("leaves a strong case with a thin margin, or an unscored one, moderate", () => {
    expect(screenProperty(prop("e", PLAN * 1.5), score(85)).tier).toBe("moderate");
    expect(screenProperty(prop("f", 12_000), null).tier).toBe("moderate");
    expect(screenProperty(prop("g", 9_000), score(55)).tier).toBe("moderate");
  });

  it("has no plan cost for custom-priced $5M+ properties", () => {
    const s = screenProperty(prop("h", 40_000, 8_000_000), score(75));
    expect(s.planCost).toBeNull();
    expect(s.tier).toBe("high");
  });
});

describe("screenPortfolio", () => {
  // Ten properties: 4 low, 3 moderate, 3 high worth ~$42,000 a year.
  const props = [
    prop("1", 15_000),
    prop("2", 14_000),
    prop("3", 13_000),
    prop("4", 9_000),
    prop("5", 8_000),
    prop("6", 7_500),
    prop("7", 1_000),
    prop("8", null),
    prop("9", 9_000),
    prop("10", 2_000),
  ];
  const scores = {
    "1": score(85),
    "2": score(78),
    "3": score(72),
    "4": score(60),
    "5": score(50),
    "6": score(45),
    "7": score(80),
    "8": score(70),
    "9": score(25),
    "10": score(65),
  };
  const r = screenPortfolio(props, scores);

  it("sorts the portfolio into the three tiers", () => {
    expect(r.counts).toEqual({ high: 3, moderate: 3, low: 4 });
    expect(r.highSavings).toBe(42_000);
    expect(r.screened.slice(0, 3).map((s) => s.property.id)).toEqual(["1", "2", "3"]);
  });

  it("counts properties still waiting on a score and an estimate", () => {
    expect(screenPortfolio([prop("x", null)], {}).pending).toBe(1);
    expect(r.pending).toBe(0);
  });

  it("explains every tier as analysis, not an instruction", () => {
    expect(r.screened.flatMap((s) => directivePhrases(s.reason))).toEqual([]);
  });
});
