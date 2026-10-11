import { describe, expect, it } from "vitest";
import type { PropertyRecord } from "./properties";
import type { ProtestRecord } from "./protests";
import { buildCaseOutcome } from "./case-outcome";
import { getEffectiveTaxRate } from "./texas-tax-rates";

const property = {
  id: "prop-1",
  cad: "Denton Central Appraisal District",
  totalValue: 1_000_000,
} as PropertyRecord;

const protest = (over: Partial<ProtestRecord>): ProtestRecord =>
  ({
    id: "p1",
    propertyId: "prop-1",
    status: "requested",
    informalStatus: "not_requested",
    arbDecision: null,
    originalValue: null,
    finalValue: null,
    settlementOfferValue: null,
    ...over,
  }) as ProtestRecord;

describe("buildCaseOutcome", () => {
  it("is null while nothing has concluded", () => {
    expect(buildCaseOutcome(property, protest({ status: "filed" }))).toBeNull();
  });

  it("reports a closed informal settlement with $ and % savings and the new tax", () => {
    const o = buildCaseOutcome(
      property,
      protest({ status: "resolved", informalStatus: "accepted", finalValue: 800_000 }),
    )!;
    const rate = getEffectiveTaxRate(property.cad);
    expect(o.stage).toBe("informal");
    expect(o.closed).toBe(true);
    expect(o.headline).toMatch(/informal review/i);
    expect(o.valueReduction).toBe(200_000);
    expect(o.valueReductionPct).toBeCloseTo(20, 5);
    expect(o.taxBefore).toBe(Math.round(1_000_000 * rate));
    expect(o.taxAfter).toBe(Math.round(800_000 * rate));
    expect(o.taxSavings).toBe(Math.round(1_000_000 * rate) - Math.round(800_000 * rate));
  });

  it("uses the settlement document's value when the case has no final value yet", () => {
    const o = buildCaseOutcome(property, protest({ informalStatus: "accepted" }), 900_000)!;
    expect(o.finalValue).toBe(900_000);
    expect(o.closed).toBe(false);
    expect(o.headline).toMatch(/not yet closed/i);
  });

  it("calls an ARB decision formal, even if an informal offer came first", () => {
    const o = buildCaseOutcome(
      property,
      protest({
        status: "resolved",
        informalStatus: "rejected",
        arbDecision: "partial",
        finalValue: 950_000,
      }),
    )!;
    expect(o.stage).toBe("formal");
    expect(o.headline).toMatch(/formal hearing/i);
    expect(o.valueReductionPct).toBeCloseTo(5, 5);
  });

  it("never reports a negative saving if the final value is higher", () => {
    const o = buildCaseOutcome(
      property,
      protest({ status: "resolved", informalStatus: "accepted", finalValue: 1_100_000 }),
    )!;
    expect(o.valueReduction).toBe(0);
    expect(o.taxSavings).toBe(0);
  });
});
