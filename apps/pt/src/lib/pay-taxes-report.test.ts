import { describe, expect, it } from "vitest";
import { buildPayTaxesRow, type PayTaxBill, type PaymentPlan } from "./pay-taxes";
import type { PropertyRecord } from "./properties";
import {
  dueEvents,
  dueEventsIcs,
  reportCells,
  splitAddress,
  summaryLine,
  summaryPdf,
  summaryTotals,
  totalsCells,
} from "./pay-taxes-report";

const half = (county: string, status: "confirmed" | "to_confirm" = "confirmed"): PaymentPlan => ({
  county,
  planKey: "half_payment",
  name: "Half-Payment Plan",
  kind: "half",
  propertyTypes: [],
  requirement: status === "to_confirm" ? "over65_disabled_dv_homestead" : null,
  schedule: [
    { label: "First half", pct: 50, month: 11, day: 30, yearOffset: 0 },
    { label: "Second half", pct: 50, month: 6, day: 30, yearOffset: 1 },
  ],
  enrollmentNote: null,
  status,
  sourceUrl: null,
  active: true,
});

function property(over: Partial<PropertyRecord>): PropertyRecord {
  return {
    id: "p1",
    address: "19730 Bulverde Rd, San Antonio, TX 78259",
    cad: "Bexar Appraisal District",
    accountNumber: "1149803",
    ownerName: "BULVERDE HOLDINGS LLC",
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

const bill = (over: Partial<PayTaxBill>): PayTaxBill => ({
  id: "b1",
  propertyId: "p1",
  taxYear: 2026,
  taxableValue: null,
  taxRate: null,
  amountDue: 20_000,
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
});

const row = (p: Partial<PropertyRecord>, bills: PayTaxBill[], plans: PaymentPlan[]) =>
  buildPayTaxesRow({
    property: property(p),
    bills,
    plans,
    settings: [],
    protests: [],
    todayIso: "2026-11-06",
  });

const bexar = row({}, [bill({})], [half("Bexar")]);
const collin = row(
  {
    id: "p2",
    address: "10247 WARREN PKWY, FRISCO, TX 75035",
    cad: "Collin Central Appraisal District",
    ownerName: "WARREN PKWY LP",
    totalValue: 3_000_000,
  },
  [],
  [],
);

describe("summaryLine", () => {
  it("splits the address and carries owner, county and the half-payment schedule", () => {
    const l = summaryLine(bexar);
    expect(l).toMatchObject({
      property: "19730 Bulverde Rd",
      address: "San Antonio, TX 78259",
      owner: "BULVERDE HOLDINGS LLC",
      county: "Bexar",
      totalTax: 20_000,
      totalIsEstimate: false,
      dueDate: "2027-01-31",
      halfPay: "available",
    });
    expect(l.firstHalf).toMatchObject({ amount: 10_000, dueDate: "2026-11-30" });
    expect(l.secondHalf).toMatchObject({ amount: 10_000, dueDate: "2027-06-30" });
  });

  it("marks a county without the option as not available, with the standard due date", () => {
    const l = summaryLine(collin);
    expect(l.halfPay).toBe("not_available");
    expect(l.firstHalf).toBeNull();
    expect(l.totalIsEstimate).toBe(true);
    expect(l.dueDate).toBe("2027-02-01"); // Jan 31 2027 is a Sunday
    expect(reportCells(l).slice(6)).toEqual(["Not available", "N/A", "N/A", "N/A", "N/A"]);
  });

  it("splitAddress handles an address without commas", () => {
    expect(splitAddress("PARKER RD")).toEqual(["PARKER RD", ""]);
  });
});

describe("totals", () => {
  it("adds every total tax, and half payments only where the option is available", () => {
    const maybe = row(
      { id: "p3", address: "1 Main St, San Antonio, TX 78205" },
      [bill({ id: "b3", propertyId: "p3", amountDue: 4_000 })],
      [half("Bexar", "to_confirm")],
    );
    const lines = [bexar, collin, maybe].map(summaryLine);
    expect(lines[2].halfPay).toBe("to_confirm");
    const t = summaryTotals(lines);
    expect(t.totalTax).toBe(20_000 + (lines[1].totalTax ?? 0) + 4_000);
    expect(t.firstHalf).toBe(10_000);
    expect(t.secondHalf).toBe(10_000);
    expect(t.halfPayCount).toBe(1);
    expect(t.estimated).toBe(1);
    expect(reportCells(lines[2])[7]).toBe("$2,000.00†");
    expect(totalsCells(t)[0]).toBe("Total");
    expect(totalsCells(t)[7]).toBe("$10,000.00");
  });
});

describe("PDF", () => {
  it("renders, including many rows across pages", async () => {
    const many = Array.from({ length: 45 }, (_, i) =>
      summaryLine(
        row({ id: `p${i}`, ownerName: `OWNER ${i} — “TRUST”` }, [bill({})], [half("Bexar")]),
      ),
    );
    const bytes = await summaryPdf(many, { generatedAt: new Date("2026-11-06T15:00:00Z") });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const { PDFDocument } = await import("pdf-lib");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });
});

describe("calendar", () => {
  it("lists the due date plus both halves where available, soonest first", () => {
    const ev = dueEvents([bexar, collin].map(summaryLine));
    expect(ev.map((e) => [e.date, e.title])).toEqual([
      ["2026-11-30", "First half of property tax due — 19730 Bulverde Rd"],
      ["2027-01-31", "Property tax due — 19730 Bulverde Rd"],
      ["2027-02-01", "Property tax due — 10247 WARREN PKWY"],
      ["2027-06-30", "Second half of property tax due — 19730 Bulverde Rd"],
    ]);
  });

  it("writes an all-day event with alerts 30/15/7/2/1 days before and on the day", () => {
    const ics = dueEventsIcs(dueEvents([summaryLine(collin)]), new Date("2026-11-06T00:00:00Z"));
    expect(ics).toContain("DTSTART;VALUE=DATE:20270201");
    expect(ics).toContain("DTEND;VALUE=DATE:20270202");
    for (const t of ["-PT711H", "-PT351H", "-PT159H", "-PT39H", "-PT15H", "PT9H"])
      expect(ics).toContain(`TRIGGER:${t}`);
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(6);
    expect(ics).toContain("UID:tax-due-p2-2026@corvusre.com");
  });
});

describe("appraisal district history", () => {
  const history = {
    propertyId: "p2",
    accountNumber: "1149803",
    source: "collin_open_data" as const,
    sourceUrl: null,
    retrievedAt: "2026-11-06T00:00:00Z",
    years: [
      {
        year: 2026,
        marketValue: 489198,
        appraisedValue: 489198,
        taxableValue: 489198,
        rate: 1.610619,
        tax: 7879.12,
        exact: true,
      },
      {
        year: 2025,
        marketValue: 487735,
        appraisedValue: 487735,
        taxableValue: 487735,
        rate: 1.613771,
        tax: 7870.93,
        exact: true,
      },
    ],
  };

  it("uses the CAD-calculated tax for the year instead of an estimate", () => {
    const r = buildPayTaxesRow({
      property: property({ id: "p2", cad: "Collin Central Appraisal District" }),
      bills: [],
      plans: [],
      settings: [],
      protests: [],
      todayIso: "2026-11-06",
      cadHistory: history,
    });
    expect(r.totalTax).toBe(7879.12);
    expect(r.totalTaxBasis).toBe("cad");
    expect(r.totalTaxIsEstimate).toBe(false);
    const l = summaryLine(r);
    expect(reportCells(l)[4]).toBe("$7,879.12‡");
  });

  it("a real bill still wins over the CAD history", () => {
    const r = buildPayTaxesRow({
      property: property({ id: "p2" }),
      bills: [bill({ propertyId: "p2", amountDue: 8000 })],
      plans: [],
      settings: [],
      protests: [],
      todayIso: "2026-11-06",
      cadHistory: history,
    });
    expect(r.totalTax).toBe(8000);
    expect(r.totalTaxBasis).toBe("bill");
  });
});
