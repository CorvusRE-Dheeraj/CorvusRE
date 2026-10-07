import { describe, expect, it } from "vitest";
import { postHearing, type PostHearingInput } from "./post-hearing";
import type { ProtestRecord } from "./protests";
import type { TaxBillRecord } from "./tax-bills";
import type { EscalationEvaluation } from "./escalation-eval";

const protest = (over: Partial<ProtestRecord> = {}): ProtestRecord =>
  ({
    id: "p26",
    propertyId: "prop",
    status: "decision_received",
    taxYear: 2026,
    originalValue: 8_450_000,
    finalValue: 7_310_000,
    arbDecision: "partial",
    arbDecisionDate: "2026-08-01",
    informalStatus: "rejected",
    arbitrationFiledAt: null,
    ...over,
  }) as ProtestRecord;

const bill = (over: Partial<TaxBillRecord> = {}): TaxBillRecord =>
  ({
    id: "b",
    propertyId: "prop",
    taxYear: 2026,
    taxableValue: 7_310_000,
    taxRate: 2.2,
    amountDue: 160_820,
    paidAt: null,
    ...over,
  }) as TaxBillRecord;

const escalation = {
  available: true,
  options: [
    {
      id: "binding_arbitration",
      title: "Binding arbitration",
      eligible: false,
      eligibilityBasis: "Arbitration is limited to property appraised at $5 million or less.",
      deadline: { date: "2026-09-30", basis: "" },
      estimatedCost: { min: 1550, max: 1550, basis: "" },
      potentialAdditionalSavings: { amount: 9_020, basis: "" },
      estimatedRoi: { ratio: 5.8, basis: "" },
      recommended: false,
    },
    {
      id: "district_court",
      title: "Appeal to district court",
      eligible: true,
      eligibilityBasis: "",
      deadline: { date: "2026-09-30", basis: "" },
      estimatedCost: { min: 5_000, max: 25_000, basis: "" },
      potentialAdditionalSavings: { amount: 9_020, basis: "" },
      estimatedRoi: { ratio: 0.4, basis: "Up to $9,020 a year against $5,000–$25,000." },
      recommended: true,
    },
    {
      id: "no_further_action",
      title: "Accept",
      eligible: true,
      eligibilityBasis: "",
      deadline: { date: null, basis: "" },
      estimatedCost: null,
      potentialAdditionalSavings: { amount: 0, basis: "" },
      estimatedRoi: { ratio: null, basis: "" },
      recommended: false,
    },
  ],
} as unknown as EscalationEvaluation;

const base: PostHearingInput = {
  protest: protest(),
  priorValue: 8_450_000,
  effectiveTaxRate: 0.022,
  taxBills: [],
  valueHistory: [{ year: 2025, total: 7_900_000 }],
  priorProtests: [],
  escalation,
  arbitration: null,
  supportableLow: 6_900_000,
  documentTypes: ["Hearing Decision Document"],
  today: "2026-08-20",
};

describe("postHearing", () => {
  it("reports the outcome", () => {
    const r = postHearing(base)!;
    expect(r).toMatchObject({
      finalValue: 7_310_000,
      priorValue: 8_450_000,
      reduction: 1_140_000,
      reductionPct: 13.5,
      estimatedSavings: 25_080,
    });
  });

  it("waits for the bill, then checks it reflects the final value", () => {
    expect(postHearing(base)!.bill).toMatchObject({
      status: "awaiting_bill",
      expectedBill: 160_820,
    });
    expect(postHearing({ ...base, taxBills: [bill()] })!.bill.status).toBe("matches");
    const stale = postHearing({
      ...base,
      taxBills: [bill({ taxableValue: 8_450_000, amountDue: 185_900 })],
    })!.bill;
    expect(stale).toMatchObject({ status: "too_high", difference: 25_080 });
    expect(stale.note).toContain("corrected bill");
  });

  it("reads a fractional or per-$100 rate the same", () => {
    const pct = postHearing({ ...base, taxBills: [bill({ taxRate: 2.2 })] })!.bill;
    const frac = postHearing({ ...base, taxBills: [bill({ taxRate: 0.022 })] })!.bill;
    expect(pct.status).toBe("matches");
    expect(frac.status).toBe("matches");
  });

  it("lists appeal routes with deadlines and recommends by the economics", () => {
    const r = postHearing(base)!;
    expect(r.routes.map((x) => [x.id, x.eligible, x.daysLeft])).toEqual([
      ["district_court", true, 41],
      ["binding_arbitration", false, 41],
    ]);
    // (7.31M − 6.9M) × 2.2% = $9,020 a year still at stake
    expect(r.verdict.headline).toBe("Worth considering: Appeal to district court");
    expect(r.verdict.detail).toContain("$9,020");
  });

  it("says further appeal isn't worth it when little is at stake", () => {
    expect(postHearing({ ...base, supportableLow: 7_250_000 })!.verdict.headline).toBe(
      "Probably not worth appealing further",
    );
  });

  it("lists the documents still needed, including §42.08 for a court appeal", () => {
    const docs = postHearing(base)!.documents;
    expect(docs.find((d) => d.label.startsWith("ARB Order"))?.onFile).toBe(true);
    expect(docs.find((d) => d.label.includes("tax statement"))?.onFile).toBe(false);
    expect(docs.some((d) => d.why.includes("§42.08"))).toBe(true);
  });

  it("adds arbitration paperwork when arbitration is open", () => {
    const docs = postHearing({
      ...base,
      arbitration: {
        status: "eligible",
        label: "Potentially eligible",
        deposit: 1550,
        deadline: "2026-09-30",
        daysRemaining: 41,
        reasons: [],
      } as never,
    })!.documents.map((d) => d.label);
    expect(docs).toContain("Request for Binding Arbitration (Comptroller Form AP-219)");
    expect(docs).toContain("Arbitration deposit ($1,550)");
  });

  it("compares with the prior year, using last year's protest result when there was one", () => {
    expect(postHearing(base)!.priorYear).toMatchObject({
      year: 2025,
      value: 7_900_000,
      change: -590_000,
      changePct: -7.5,
    });
    const withCase = postHearing({
      ...base,
      priorProtests: [
        protest({ id: "p25", taxYear: 2025, originalValue: 8_000_000, finalValue: 7_200_000 }),
      ],
    })!.priorYear!;
    expect(withCase).toMatchObject({
      value: 7_200_000,
      change: 110_000,
      priorOutcome: "Protested: $8,000,000 → $7,200,000",
    });
  });

  it("is null before there's a final value", () => {
    expect(postHearing({ ...base, protest: protest({ finalValue: null }) })).toBeNull();
  });
});
