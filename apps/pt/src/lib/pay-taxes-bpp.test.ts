import { describe, expect, it } from "vitest";
import { buildBppTaxRow, portfolioSummary, withBppSummary } from "./pay-taxes";
import { bppSummaryLine, dueEvents } from "./pay-taxes-report";
import type { BppAccountRecord } from "./bpp-accounts";
import { getEffectiveTaxRate } from "./texas-tax-rates";

function account(overrides: Partial<BppAccountRecord> = {}): BppAccountRecord {
  return {
    id: "b1",
    businessName: "Acme Dental LLC",
    accountNumber: "BPP-123",
    cad: "Collin",
    locationAddress: "100 Main St, Plano, TX 75074",
    createdAt: "2026-11-01T00:00:00Z",
    taxYear: 2026,
    renderedValue: 200_000,
    priorValue: null,
    noticeValue: null,
    renditionDeadline: null,
    protestDeadline: null,
    renditionSignatureType: null,
    renditionSignatureData: null,
    renditionSignedAt: null,
    renditionFiledAt: null,
    estimatedSavings: null,
    stripeSubscriptionId: null,
    subscriptionStatus: null,
    planTier: null,
    valueBracket: null,
    cancelAtPeriodEnd: false,
    cancelAt: null,
    autoRefile: false,
    autoRefileAuthorizedAt: null,
    taxAmountDue: null,
    taxAmountPaid: null,
    paymentDueDate: null,
    paidAt: null,
    ...overrides,
  };
}

const today = "2026-11-10";

describe("buildBppTaxRow", () => {
  it("estimates from the value when no bill is entered, due by the standard deadline", () => {
    const r = buildBppTaxRow({ account: account(), settings: [], todayIso: today });
    expect(r.county).toBe("Collin");
    expect(r.taxYear).toBe(2026);
    expect(r.totalTax).toBe(Math.round(200_000 * getEffectiveTaxRate("Collin")));
    expect(r.totalTaxIsEstimate).toBe(true);
    expect(r.dueDate).toBe("2027-02-01"); // Jan 31, 2027 is a Sunday
    expect(r.dueDateIsStandard).toBe(true);
    expect(r.status).toBe("unpaid");
    expect(r.outstanding).toBe(r.totalTax);
  });

  it("uses the entered bill, its due date and what's been paid", () => {
    const r = buildBppTaxRow({
      account: account({ taxAmountDue: 4000, taxAmountPaid: 1500, paymentDueDate: "2026-11-25" }),
      settings: [],
      todayIso: today,
    });
    expect(r.totalTax).toBe(4000);
    expect(r.totalTaxIsEstimate).toBe(false);
    expect(r.status).toBe("partial");
    expect(r.outstanding).toBe(2500);
    expect(r.flags.upcoming).toBe(true);
  });

  it("is paid when marked paid, with nothing outstanding", () => {
    const r = buildBppTaxRow({
      account: account({ taxAmountDue: 4000, paidAt: "2026-11-09T00:00:00Z" }),
      settings: [],
      todayIso: today,
    });
    expect(r.status).toBe("paid");
    expect(r.outstanding).toBe(0);
    expect(r.amountPaid).toBe(4000);
  });

  it("a stale rendition year without a bill doesn't read as long overdue", () => {
    const r = buildBppTaxRow({
      account: account({ taxYear: 2023 }),
      settings: [],
      todayIso: today,
    });
    expect(r.taxYear).toBe(2026);
    expect(r.status).toBe("unpaid");
  });

  it("is overdue once the delinquency date has passed", () => {
    const r = buildBppTaxRow({
      account: account({ taxYear: 2025, taxAmountDue: 1000 }),
      settings: [],
      todayIso: today,
    });
    expect(r.status).toBe("overdue");
    expect(r.flags.overdue).toBe(true);
  });

  it("no value and no bill → no amount, not counted as an estimate", () => {
    const r = buildBppTaxRow({
      account: account({ renderedValue: null }),
      settings: [],
      todayIso: today,
    });
    expect(r.totalTax).toBeNull();
    expect(r.totalTaxIsEstimate).toBe(false);
    expect(r.outstanding).toBeNull();
  });
});

describe("BPP in the Pay Taxes totals, PDF and calendar", () => {
  it("adds BPP accounts to the portfolio tiles", () => {
    const bpp = [
      buildBppTaxRow({
        account: account({ taxAmountDue: 4000, taxAmountPaid: 1000, paymentDueDate: "2026-11-25" }),
        settings: [],
        todayIso: today,
      }),
    ];
    const s = withBppSummary(portfolioSummary([]), bpp);
    expect(s).toMatchObject({ totalTax: 4000, totalPaid: 1000, outstanding: 3000, upcoming: 1 });
    expect(s.properties).toBe(0); // the tile counts real-estate properties; BPP is its hint
  });

  it("becomes a summary line and a due-date calendar event", () => {
    const row = buildBppTaxRow({
      account: account({ taxAmountDue: 4000 }),
      settings: [],
      todayIso: today,
    });
    const line = bppSummaryLine(row);
    expect(line).toMatchObject({
      propertyId: "bpp-b1",
      property: "BPP — Acme Dental LLC",
      address: "100 Main St, Plano, TX 75074",
      totalTax: 4000,
      halfPay: "not_available",
    });
    const events = dueEvents([line]);
    expect(events).toHaveLength(1);
    expect(events[0].title).toContain("BPP — Acme Dental LLC");
  });
});
