import { describe, expect, it } from "vitest";
import {
  countedAmount,
  estimateRange,
  impactSummary,
  importableBids,
  usedUpShare,
} from "./impairment-builder";
import { impairmentsApproach, type Impairment } from "./commercial-valuation";

const item = (x: Partial<Impairment>): Impairment => ({
  id: x.id ?? "i",
  label: x.label ?? "item",
  costToCure: x.costToCure ?? 0,
  ...x,
});

describe("estimateRange", () => {
  it("prices a category by quantity from its typical range", () => {
    expect(estimateRange("roof", 20_000)).toEqual({ low: 160_000, high: 280_000 });
    expect(estimateRange("hvac", 30)).toEqual({ low: 54_000, high: 90_000 });
  });

  it("has no range for per-job work or a missing quantity", () => {
    expect(estimateRange("foundation", 100)).toBeNull();
    expect(estimateRange("roof", null)).toBeNull();
  });
});

describe("usedUpShare", () => {
  it("credits a short-lived component by how much of its life is gone", () => {
    expect(usedUpShare("roof", 5)).toBe(0.75); // 5 of 20 years left
    expect(usedUpShare("roof", 0)).toBe(1); // failed
    expect(usedUpShare("roof", undefined)).toBe(1);
    expect(usedUpShare("roof", 30)).toBe(0);
    expect(usedUpShare("foundation", 5)).toBe(1); // not a short-lived item
  });
});

describe("countedAmount", () => {
  it("counts a bid in full and an estimate at the low end", () => {
    expect(countedAmount(item({ support: "bid", costToCure: 84_000 }))).toBe(84_000);
    expect(
      countedAmount(item({ support: "estimate", costToCure: 280_000, costLow: 160_000 })),
    ).toBe(160_000);
    expect(countedAmount(item({ support: "photos", costToCure: 280_000, costLow: 160_000 }))).toBe(
      160_000,
    );
  });

  it("applies remaining life", () => {
    expect(
      countedAmount(
        item({ category: "roof", support: "bid", costToCure: 200_000, remainingLifeYrs: 5 }),
      ),
    ).toBe(150_000);
  });

  it("keeps counting items saved before the builder in full", () => {
    expect(countedAmount(item({ costToCure: 50_000 }))).toBe(50_000);
  });
});

describe("impactSummary", () => {
  it("rates support by the documented share of the impact", () => {
    const strong = impactSummary([
      item({ id: "a", support: "bid", costToCure: 90_000 }),
      item({ id: "b", support: "estimate", costToCure: 20_000, costLow: 10_000 }),
    ]);
    expect(strong.total).toBe(100_000);
    expect(strong.documented).toBe(90_000);
    expect(strong.strength).toBe("Strong");
    expect(strong.byItem[1].note).toBe("Owner estimate · low end of the range");

    expect(impactSummary([item({ support: "photos", costToCure: 9, costLow: 5 })]).strength).toBe(
      "Weak",
    );
    expect(impactSummary([]).strength).toBe("None");
  });
});

describe("impairmentsApproach", () => {
  it("takes the counted impact off the county value and says how much is documented", () => {
    const r = impairmentsApproach(
      2_000_000,
      [
        item({ id: "a", label: "Roof bid", support: "bid", costToCure: 100_000 }),
        item({
          id: "b",
          label: "Paving",
          support: "estimate",
          costToCure: 40_000,
          costLow: 20_000,
        }),
      ],
      [],
    );
    expect(r.indicatedValue).toBe(1_880_000);
    expect(r.steps.at(-1)).toContain("$100,000 of the $120,000 is backed by bids");
  });
});

describe("importableBids", () => {
  it("offers uploaded repair bids not already in the builder", () => {
    const docs = [
      { id: "d1", fileName: "Roof bid.pdf", costToCure: 84_000, kind: "repair_estimate" },
      { id: "d2", fileName: "Rent roll.pdf", costToCure: null, kind: "lease_or_rent_roll" },
      { id: "d3", fileName: "HVAC.pdf", costToCure: 40_000, kind: "repair_estimate" },
    ];
    expect(importableBids(docs, [item({ documentId: "d3" })]).map((b) => b.id)).toEqual(["d1"]);
  });
});
