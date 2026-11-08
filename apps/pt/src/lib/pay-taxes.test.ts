import { describe, expect, it } from "vitest";
import {
  billStatus,
  buildPayTaxesRow,
  nextBusinessDay,
  paymentLink,
  penaltyAndInterestPct,
  planEligibility,
  portfolioSummary,
  standardDueDate,
  type CountyTaxSettings,
  type PayTaxBill,
  type PaymentPlan,
} from "./pay-taxes";
import type { PropertyRecord } from "./properties";

const half = (county: string): PaymentPlan => ({
  county,
  planKey: "half_payment",
  name: "Half-Payment Plan",
  kind: "half",
  propertyTypes: [],
  requirement: null,
  schedule: [
    { label: "First half", pct: 50, month: 11, day: 30, yearOffset: 0 },
    { label: "Second half", pct: 50, month: 6, day: 30, yearOffset: 1 },
  ],
  enrollmentNote: "Pay half by Nov 30.",
  status: "confirmed",
  sourceUrl: null,
  active: true,
});

const quarter: PaymentPlan = {
  county: "*",
  planKey: "quarter_homestead",
  name: "Quarter-Payment Plan (homestead)",
  kind: "quarter",
  propertyTypes: ["residential"],
  requirement: "over65_disabled_dv_homestead",
  schedule: [
    { label: "1st quarter", pct: 25, month: 1, day: 31, yearOffset: 1 },
    { label: "2nd quarter", pct: 25, month: 3, day: 31, yearOffset: 1 },
    { label: "3rd quarter", pct: 25, month: 5, day: 31, yearOffset: 1 },
    { label: "4th quarter", pct: 25, month: 7, day: 31, yearOffset: 1 },
  ],
  enrollmentNote: null,
  status: "confirmed",
  sourceUrl: null,
  active: true,
};

const PLANS = [quarter, half("Bexar"), half("Tarrant")];

function property(over: Partial<PropertyRecord>): PropertyRecord {
  return {
    id: "p1",
    address: "19730 Bulverde Rd, San Antonio, TX 78259",
    cad: "Bexar Appraisal District",
    accountNumber: "1149803",
    ownerName: null,
    propertyType: "Commercial",
    landValue: null,
    improvementValue: null,
    totalValue: 1_000_000,
    taxYear: 2026,
    protestDeadline: null,
    paymentDueDate: null,
    taxAmountDue: null,
    paidAt: null,
    estimatedSavings: null,
    savingsBasis: null,
    createdAt: "2026-01-01T00:00:00Z",
    valueHistory: null,
    ...over,
  };
}

function bill(over: Partial<PayTaxBill>): PayTaxBill {
  return {
    id: "b1",
    propertyId: "p1",
    taxYear: 2026,
    taxableValue: null,
    taxRate: null,
    amountDue: 20_000.01,
    dueDate: "2027-01-31",
    penaltyDate: null,
    sourceDocumentId: "doc1",
    amountPaid: null,
    paidAt: null,
    paymentConfirmation: null,
    refundAmount: null,
    refundExpectedAt: null,
    refundReceivedAt: null,
    notes: null,
    createdAt: "2026-10-20T00:00:00Z",
    installments: [],
    ...over,
  };
}

describe("planEligibility", () => {
  it("a Bexar commercial property is eligible for the half-payment plan, not the homestead quarter plan", () => {
    const res = planEligibility(property({}), PLANS, 2026, 20_000.01);
    const halfPay = res.find((r) => r.plan.kind === "half")!;
    expect(halfPay.status).toBe("eligible");
    expect(halfPay.installments).toEqual([
      { label: "First half", dueDate: "2026-11-30", amount: 10_000 },
      { label: "Second half", dueDate: "2027-06-30", amount: 10_000.01 },
    ]);
    expect(res.find((r) => r.plan.kind === "quarter")?.status).toBe("not_eligible");
  });

  it("does not offer a county's plan anywhere else", () => {
    const res = planEligibility(
      property({ cad: "Harris Central Appraisal District" }),
      PLANS,
      2026,
      1000,
    );
    expect(res.map((r) => r.plan.kind)).toEqual(["quarter"]);
  });

  it("a homestead-only plan is 'to be confirmed' for a residence, never assumed eligible", () => {
    const res = planEligibility(property({ propertyType: "Residential" }), PLANS, 2026, 1000);
    const q = res.find((r) => r.plan.kind === "quarter")!;
    expect(q.status).toBe("to_confirm");
    expect(q.reason).toMatch(/to be confirmed with county tax office/i);
  });

  it("an unknown property type can't be confirmed for a restricted plan", () => {
    const res = planEligibility(property({ propertyType: null }), PLANS, 2026, 1000);
    expect(res.find((r) => r.plan.kind === "quarter")?.status).toBe("to_confirm");
    expect(res.find((r) => r.plan.kind === "half")?.status).toBe("eligible");
  });
});

describe("dates", () => {
  it("moves a weekend deadline to Monday", () => {
    expect(nextBusinessDay("2024-11-30")).toBe("2024-12-02");
    expect(nextBusinessDay("2026-11-30")).toBe("2026-11-30");
  });
  it("standard due date is January 31 (the day before Feb 1 delinquency), weekend-adjusted", () => {
    expect(standardDueDate(2026)).toBe("2027-02-01"); // Jan 31 2027 is a Sunday
    expect(standardDueDate(2025)).toBe("2026-02-02"); // Jan 31 2026 is a Saturday
  });
});

describe("billStatus", () => {
  it("is overdue once delinquent and unpaid", () => {
    expect(billStatus(bill({}), "2027-02-01", "2027-02-01")).toBe("overdue");
    expect(billStatus(bill({}), "2027-01-15", "2027-02-01")).toBe("unpaid");
  });
  it("paid needs the payment to cover the bill", () => {
    expect(
      billStatus(bill({ paidAt: "2026-12-01", amountPaid: 20_000.01 }), "2027-03-01", "2027-02-01"),
    ).toBe("paid");
    expect(billStatus(bill({ amountPaid: 5000 }), "2027-01-01", "2027-02-01")).toBe("partial");
  });
  it("an installment plan is overdue only when an installment is late", () => {
    const b = bill({
      planKey: "half_payment",
      installments: [
        { label: "First half", dueDate: "2026-11-30", amount: 10_000, paidAt: "2026-11-20" },
        { label: "Second half", dueDate: "2027-06-30", amount: 10_000 },
      ],
    });
    expect(billStatus(b, "2027-03-01", "2027-02-01")).toBe("partial");
    expect(billStatus(b, "2027-07-01", "2027-02-01")).toBe("overdue");
  });
});

describe("paymentLink", () => {
  const bexar: CountyTaxSettings = {
    county: "Bexar",
    paymentPortalUrl: "https://bexar.acttax.com/act_webdev/bexar/index.jsp",
    accountUrlTemplate: "https://bexar.acttax.com/act_webdev/bexar/showdetail2.jsp?can={account}",
    accountPattern: "^\\d{12}$",
    delinquencyMonthDay: "02-01",
    notes: null,
    sourceUrl: null,
    updatedAt: null,
  };
  it("deep-links only an account number that fits the county's pattern", () => {
    expect(
      paymentLink({ cad: "Bexar Appraisal District", accountNumber: "177280090010" }, bexar),
    ).toMatchObject({
      kind: "account",
      url: "https://bexar.acttax.com/act_webdev/bexar/showdetail2.jsp?can=177280090010",
    });
    expect(
      paymentLink({ cad: "Bexar Appraisal District", accountNumber: "1149803" }, bexar)?.kind,
    ).toBe("portal");
  });
  it("falls back to the Comptroller directory's tax office site", () => {
    const link = paymentLink(
      { cad: "Collin Central Appraisal District", accountNumber: "1" },
      null,
    );
    expect(link?.kind).toBe("website");
    expect(link?.url).toMatch(/^https?:\/\//);
  });
});

describe("portfolio half-payment total", () => {
  it("adds up the first halves of every eligible, unpaid property", () => {
    const rows = [
      buildPayTaxesRow({
        property: property({}),
        bills: [bill({})],
        plans: PLANS,
        settings: [],
        protests: [],
        todayIso: "2026-11-05",
      }),
      buildPayTaxesRow({
        property: property({ id: "p2", cad: "Tarrant Appraisal District" }),
        bills: [bill({ id: "b2", propertyId: "p2", amountDue: 9_000 })],
        plans: PLANS,
        settings: [],
        protests: [],
        todayIso: "2026-11-05",
      }),
      buildPayTaxesRow({
        property: property({ id: "p3", cad: "Harris Central Appraisal District" }),
        bills: [bill({ id: "b3", propertyId: "p3", amountDue: 50_000 })],
        plans: PLANS,
        settings: [],
        protests: [],
        todayIso: "2026-11-05",
      }),
    ];
    const s = portfolioSummary(rows);
    expect(s.halfPay.items.map((i) => i.row.property.id)).toEqual(["p1", "p2"]);
    expect(s.halfPay.total).toBe(14_500);
    expect(s.halfPay.dueDates).toEqual(["2026-11-30"]);
    expect(s.totalTax).toBe(79_000.01);
    expect(rows[0].totalTaxIsEstimate).toBe(false);
  });

  it("an estimate is flagged when no tax statement is on file", () => {
    const row = buildPayTaxesRow({
      property: property({}),
      bills: [],
      plans: PLANS,
      settings: [],
      protests: [],
      todayIso: "2026-11-05",
    });
    expect(row.totalTaxIsEstimate).toBe(true);
    expect(row.totalTax).toBeGreaterThan(0);
    expect(row.dueDateIsStandard).toBe(true);
  });

  it("without a bill, uses the current tax year — not the property's stale or next value year", () => {
    for (const valueYear of [2023, 2027]) {
      const row = buildPayTaxesRow({
        property: property({ taxYear: valueYear }),
        bills: [],
        plans: PLANS,
        settings: [],
        protests: [],
        todayIso: "2026-11-08",
      });
      expect(row.taxYear).toBe(2026);
      expect(row.status).not.toBe("overdue");
    }
  });

  it("with a bill, uses the newest bill's year", () => {
    const row = buildPayTaxesRow({
      property: property({ taxYear: 2023 }),
      bills: [bill({ taxYear: 2025 })],
      plans: PLANS,
      settings: [],
      protests: [],
      todayIso: "2026-11-08",
    });
    expect(row.taxYear).toBe(2025);
  });

  it("recognises a property saved under the 'Collin CAD' spelling", () => {
    const link = paymentLink({ cad: "Collin CAD", accountNumber: "1" }, null);
    expect(link?.url).toMatch(/^https?:\/\//);
  });
});

describe("penaltyAndInterestPct", () => {
  it("follows Tax Code §33.01: 7% in February, 18% by July", () => {
    expect(penaltyAndInterestPct(0)).toBe(0);
    expect(penaltyAndInterestPct(1)).toBe(7);
    expect(penaltyAndInterestPct(6)).toBe(18);
  });
});
