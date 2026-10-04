import { describe, expect, it } from "vitest";
import type { PropertyRecord } from "./properties";
import type { ProtestRecord } from "./protests";
import {
  arbitrationImpact,
  arbitrationStages,
  buildArbitrationNumbers,
  evaluateArbitrationEligibility,
  parseBulletList,
  parseSections,
  parseMoney,
} from "./arbitration";

const property = (over: Partial<PropertyRecord> = {}): PropertyRecord =>
  ({
    id: "prop",
    cad: "Collin Central Appraisal District",
    propertyType: "Land",
    totalValue: 3_000_000,
    ...over,
  }) as PropertyRecord;

const protest = (over: Partial<ProtestRecord> = {}): ProtestRecord =>
  ({
    id: "p",
    status: "decision_received",
    informalStatus: "rejected",
    arbDecision: "denied",
    arbDecisionDate: "2026-09-10",
    originalValue: 3_000_000,
    finalValue: 3_000_000,
    escalationPath: "arbitration",
    ...over,
  }) as ProtestRecord;

const NOW = new Date("2026-09-24T12:00:00");

describe("evaluateArbitrationEligibility", () => {
  it("needs the ARB decision before anything else", () => {
    const e = evaluateArbitrationEligibility(property(), protest({ arbDecision: null }), 3, NOW);
    expect(e.status).toBe("needs_info");
    expect(e.label).toBe("Needs additional information");
    expect(e.missing[0]).toMatch(/ARB decision/);
  });

  it("is potentially eligible inside the 60 days, with deadline and days remaining", () => {
    const e = evaluateArbitrationEligibility(property(), protest(), 3, NOW);
    expect(e.status).toBe("eligible");
    expect(e.deadline).toBe("2026-11-09");
    expect(e.daysRemaining).toBe(46);
    expect(e.expired).toBe(false);
    expect(e.deposit).toBeGreaterThan(0);
  });

  it("is not eligible once the 60 days have passed", () => {
    const e = evaluateArbitrationEligibility(
      property(),
      protest({ arbDecisionDate: "2026-06-01" }),
      3,
      NOW,
    );
    expect(e.status).toBe("not_eligible");
    expect(e.expired).toBe(true);
    expect(e.daysRemaining).toBeLessThan(0);
  });

  it("is not eligible for non-homestead property over the $5M cap", () => {
    const e = evaluateArbitrationEligibility(
      property({ totalValue: 8_000_000 }),
      protest({ originalValue: 8_000_000, finalValue: 8_000_000 }),
      3,
      NOW,
    );
    expect(e.status).toBe("not_eligible");
    expect(e.reasons.join(" ")).toMatch(/5,000,000/);
  });

  it("is not eligible when the ARB already approved in full", () => {
    const e = evaluateArbitrationEligibility(
      property(),
      protest({ arbDecision: "approved" }),
      3,
      NOW,
    );
    expect(e.status).toBe("not_eligible");
  });

  it("asks for the order date if it is missing", () => {
    const e = evaluateArbitrationEligibility(
      property(),
      protest({ arbDecisionDate: null }),
      3,
      NOW,
    );
    expect(e.status).toBe("needs_info");
    expect(e.missing[0]).toMatch(/date/i);
  });
});

describe("arbitrationStages", () => {
  const eligible = evaluateArbitrationEligibility(property(), protest(), 3, NOW);
  const current = (stages: ReturnType<typeof arbitrationStages>) =>
    stages.filter((s) => s.state === "current").map((s) => s.id);

  it("highlights exactly one stage at each point", () => {
    expect(current(arbitrationStages(protest(), eligible, false))).toEqual(["preparation"]);
    expect(current(arbitrationStages(protest(), eligible, true))).toEqual(["file"]);
    expect(
      current(
        arbitrationStages(protest({ arbitrationFiledAt: "2026-09-20T00:00:00Z" }), eligible, true),
      ),
    ).toEqual(["settlement"]);
    const notEligible = evaluateArbitrationEligibility(
      property(),
      protest({ arbDecision: "approved" }),
      3,
      NOW,
    );
    expect(
      current(arbitrationStages(protest({ arbDecision: "approved" }), notEligible, false)),
    ).toEqual(["eligibility"]);
  });

  it("marks everything done once the arbitration result closes the case", () => {
    const stages = arbitrationStages(protest({ status: "resolved" }), eligible, true);
    expect(stages.every((s) => s.state === "done")).toBe(true);
  });
});

describe("numbers", () => {
  it("computes the gap between the ARB value and the owner's request", () => {
    const n = buildArbitrationNumbers(property(), protest({ finalValue: 3_000_000 }), 2_500_000);
    expect(n.difference).toBe(500_000);
    expect(n.differencePct).toBeCloseTo(16.67, 1);
    expect(n.annualTaxAtStake).toBe(Math.round(500_000 * n.taxRate));
  });

  it("leaves the gap empty without a requested value", () => {
    expect(buildArbitrationNumbers(property(), protest(), null).difference).toBeNull();
  });

  it("computes the impact of an arbitration result", () => {
    const i = arbitrationImpact(property(), protest({ finalValue: 3_000_000 }), 2_700_000);
    expect(i.reduction).toBe(300_000);
    expect(i.reductionPct).toBeCloseTo(10, 5);
    expect(i.taxSavings).toBe(Math.round(300_000 * i.taxRate));
    expect(i.taxNow).toBe(Math.round(2_700_000 * i.taxRate));
  });
});

describe("helpers", () => {
  it("parses money", () => {
    expect(parseMoney("$2,500,000")).toBe(2_500_000);
    expect(parseMoney("")).toBeNull();
  });

  it("reads bulleted and numbered lists", () => {
    const text = "Intro\n1. First **one**\n2) Second\n- Third\n* Fourth";
    expect(parseBulletList(text)).toEqual(["First one", "Second", "Third", "Fourth"]);
  });

  it("splits a labelled reply into sections", () => {
    const text = "WEAK POINTS:\n- a\n- b\n**NEW EVIDENCE:**\n- None";
    const r = parseSections(text, ["WEAK POINTS", "NEW EVIDENCE"]);
    expect(r["WEAK POINTS"]).toEqual(["a", "b"]);
    expect(r["NEW EVIDENCE"]).toEqual(["None"]);
  });
});
