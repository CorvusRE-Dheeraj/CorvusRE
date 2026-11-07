import { describe, expect, it } from "vitest";
import { approvedQuote, csv, isStalled, pricingDeviations, stageBlocker } from "./bd-console";

describe("approvedQuote", () => {
  it("uses the approved prices: first property full price, each additional 15% off", () => {
    const q = approvedQuote("owner_managed", 10, "month");
    expect(q.first).toBe(199);
    expect(q.additional).toBe(169.15);
    expect(q.monthly).toBe(1721.35);
    expect(q.annual).toBe(Math.round(q.monthly * 12));
  });
  it("yearly upfront is 50% off the first year", () => {
    const q = approvedQuote("corvusrf_managed", 1, "year");
    expect(q.monthly).toBe(299);
    expect(q.firstYear).toBe(Math.round(299 * 12 * 0.5));
  });
});

describe("pricingDeviations", () => {
  it("standard terms need no approval", () => {
    expect(
      pricingDeviations({
        tier: "owner_managed",
        interval: "month",
        properties: 5,
        discountPct: 0,
        commitmentMonths: null,
        customTerms: "",
      }),
    ).toEqual([]);
    expect(
      pricingDeviations({ tier: "owner_managed", interval: "month", commitmentMonths: 12 }),
    ).toEqual([]);
  });
  it("custom discount, commitment and terms each need approval", () => {
    const d = pricingDeviations({
      tier: "owner_managed",
      interval: "month",
      discountPct: 20,
      commitmentMonths: 6,
      customTerms: "Cancel any time",
    });
    expect(d.map((x) => x.field)).toEqual(["discount", "commitment", "terms"]);
    expect(d[0].detail).toBe("Custom discount of 20%");
  });
  it("no plan is a deviation", () => {
    expect(pricingDeviations({})[0].field).toBe("plan");
  });
});

describe("stage gates", () => {
  it("activation and active need a verified agreement; active also needs payment", () => {
    expect(
      stageBlocker({ agreementVerifiedAt: null, paymentVerifiedAt: null }, "negotiation"),
    ).toBeNull();
    expect(
      stageBlocker({ agreementVerifiedAt: null, paymentVerifiedAt: null }, "activation"),
    ).toMatch(/agreement/);
    expect(
      stageBlocker({ agreementVerifiedAt: "2026-11-01", paymentVerifiedAt: null }, "activation"),
    ).toBeNull();
    expect(
      stageBlocker({ agreementVerifiedAt: "2026-11-01", paymentVerifiedAt: null }, "active"),
    ).toMatch(/payment/);
    expect(
      stageBlocker(
        { agreementVerifiedAt: "2026-11-01", paymentVerifiedAt: "2026-11-02" },
        "active",
      ),
    ).toBeNull();
  });
});

describe("isStalled", () => {
  const now = Date.parse("2026-11-06T00:00:00Z");
  it("21 days without a stage change or activity", () => {
    expect(
      isStalled(
        { stage: "proposal", stageChangedAt: "2026-10-01T00:00:00Z", lastActivityAt: null },
        now,
      ),
    ).toBe(true);
    expect(
      isStalled(
        {
          stage: "proposal",
          stageChangedAt: "2026-10-01T00:00:00Z",
          lastActivityAt: "2026-11-01T00:00:00Z",
        },
        now,
      ),
    ).toBe(false);
    expect(
      isStalled(
        { stage: "on_hold", stageChangedAt: "2026-01-01T00:00:00Z", lastActivityAt: null },
        now,
      ),
    ).toBe(false);
    expect(
      isStalled(
        { stage: "lost", stageChangedAt: "2026-01-01T00:00:00Z", lastActivityAt: null },
        now,
      ),
    ).toBe(false);
  });
});

it("csv quotes safely", () => {
  expect(csv(["a"], [["x, y"], [null]])).toBe('a\n"x, y"\n');
});
