import { describe, expect, it } from "vitest";
import { computeSavingsAnalysis, EMPTY_TAX_INPUTS } from "./savings-analysis";
import { getProtestCost } from "./protest-cost";
import { buildSavingsFindings, getSavingsNextStep } from "./savings-dashboard";
import type { SavingsEstimate } from "./savings-estimate";

const compsEstimate: SavingsEstimate = {
  basis: "comps",
  amount: 0,
  compsCount: 6,
  compsMedian: 5_200_000,
  effectiveTaxRatePct: 1.8,
};
const base = {
  cadValue: 5_900_000,
  taxYear: 2026,
  cad: "Denton Central Appraisal District",
  estimate: compsEstimate,
  compsIndicated: { min: 4_800_000, median: 5_200_000, max: 5_600_000 },
  taxInputs: EMPTY_TAX_INPUTS,
};

describe("computeSavingsAnalysis — taxable value and plan cost", () => {
  it("counts only the part of a market-value cut that falls below a capped appraised value", () => {
    const a = computeSavingsAnalysis({ ...base, appraisedValue: 5_500_000 });
    expect(a.reductionBase).toBe(700_000);
    expect(a.appraisalCap).toBe(5_500_000);
    expect(a.taxableReduction).toBe(300_000); // 5.5M cap − 5.2M new market value
    expect(a.annualSavings).toBe(Math.round(300_000 * 0.018));
    // Conservative: market 5.6M stays above the 5.5M cap → no tax change.
    expect(a.scenarios[0].annualSavings).toBe(0);
  });

  it("ignores an appraised value that isn't below the market value", () => {
    const a = computeSavingsAnalysis({ ...base, appraisedValue: 5_900_000 });
    expect(a.appraisalCap).toBeNull();
    expect(a.taxableReduction).toBe(700_000);
  });

  it("uses the plan cost when given", () => {
    const a = computeSavingsAnalysis({ ...base, planCost: { total: 3588, label: "plan" } });
    expect(a.protestCostSource).toBe("plan");
    expect(a.protestCost).toBe(3588);
    expect(a.netBenefit).toBe(a.annualSavings - 3588);
  });

  it("flags uncertainty when the comparable range reaches the current value", () => {
    const a = computeSavingsAnalysis({
      ...base,
      compsIndicated: { min: 4_800_000, median: 5_200_000, max: 6_000_000 },
    });
    expect(a.uncertainReasons[0]).toMatch(/no reduction/);
    expect(computeSavingsAnalysis(base).uncertainReasons).toEqual([]);
  });
});

describe("getProtestCost", () => {
  const none = {
    planTier: null,
    subscriptionStatus: null,
    valueBracket: null,
    subscription: null,
    otherExpenses: null,
  };

  it("prices an unsubscribed property at the Owner-Managed plan", () => {
    const c = getProtestCost({ ...none, accountPlan: "free_ai_review" });
    expect(c.status).toBe("not_subscribed");
    expect(c.total).toBe(299 * 12);
  });

  it("uses Stripe's figure for an active subscription and adds other expenses", () => {
    const c = getProtestCost({
      ...none,
      accountPlan: "owner_managed",
      planTier: "owner_managed",
      subscriptionStatus: "active",
      valueBracket: "upTo5m",
      otherExpenses: 500,
      subscription: {
        id: "sub_1",
        status: "active",
        propertyId: "p1",
        bppAccountId: null,
        tier: "owner_managed",
        bracket: "upTo5m",
        productName: null,
        amountCents: 358800,
        currency: "usd",
        interval: "year",
        discountName: null,
        quantity: 1,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        cancelAt: null,
        card: null,
      },
    });
    expect(c.status).toBe("subscribed");
    expect(c.lines.map((l) => [l.kind, l.amount])).toEqual([
      ["annual", 3588],
      ["additional", 500],
    ]);
    expect(c.total).toBe(4088);
  });

  it("falls back to a legacy bracket price and treats beta as free", () => {
    const legacy = getProtestCost({
      ...none,
      accountPlan: "owner_managed",
      planTier: "corvusrf_managed",
      subscriptionStatus: "active",
      valueBracket: "under2m",
    });
    expect(legacy.total).toBe(199 * 12);
    expect(getProtestCost({ ...none, accountPlan: "beta" }).total).toBe(0);
  });
});

describe("buildSavingsFindings", () => {
  it("writes property-specific sentences and labels the evidence", () => {
    const [comps, property, docs] = buildSavingsFindings({
      comps: { count: 6, median: 738_352, gapPct: 7, limitedData: false },
      site: [
        {
          factor: "Floodplain",
          finding: "0.7 ac in Zone AE",
          status: "Confirmed",
          severity: "High",
        },
      ],
      improvement: null,
      zoning: null,
      documents: {
        count: 2,
        applied: true,
        direction: "lowers",
        strength: 0.3,
        kinds: ["Repair estimate"],
        indicatedValue: 700_000,
      },
    });
    expect(comps).toMatchObject({
      strength: "Strong",
      sentence: expect.stringContaining("$738,352, 7% below"),
    });
    expect(property).toMatchObject({
      module: "site",
      strength: "Strong",
      sentence: "Floodplain: 0.7 ac in Zone AE.",
    });
    expect(docs).toMatchObject({
      strength: "Limited",
      sentence: "Your repair estimate points to a value of about $700,000.",
    });
  });

  it("says what's missing instead of a generic claim", () => {
    const f = buildSavingsFindings({
      comps: null,
      site: [],
      improvement: [],
      zoning: null,
      documents: null,
    });
    expect(f.map((x) => x.strength)).toEqual(["Missing", "Missing", "Missing"]);
  });
});

describe("getSavingsNextStep", () => {
  const strong = buildSavingsFindings({
    comps: { count: 6, median: 1, gapPct: 7, limitedData: false },
    site: null,
    improvement: null,
    zoning: null,
    documents: null,
  });
  const a = {
    annualSavings: 939,
    reductionBase: 52_175,
    valuationConfidence: "High" as const,
    netBenefit: 700,
    uncertainReasons: [],
  };

  it("shows exactly one action, matched to the evidence and the benefit", () => {
    expect(getSavingsNextStep(a, strong).module).toBe("executive");
    expect(getSavingsNextStep({ ...a, valuationConfidence: "Limited" }, strong).module).toBe(
      "evidence",
    );
    expect(getSavingsNextStep({ ...a, netBenefit: -2600 }, strong).kind).toBe("limited");
    expect(getSavingsNextStep({ ...a, reductionBase: 0, annualSavings: 0 }, strong).kind).toBe(
      "limited",
    );
  });
});
