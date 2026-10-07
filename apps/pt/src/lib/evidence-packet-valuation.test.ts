import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: {} }));

import { buildEvidencePacket, pdfSafe } from "./evidence-packet";
import type { PropertyRecord } from "./properties";
import type { WorksheetSummary } from "./valuation-worksheet";

describe("pdfSafe", () => {
  it("swaps symbols the PDF font can't draw", () => {
    expect(pdfSafe("− Vacancy → NOI ÷ 8% × 60,000 SF ⚠")).toBe(
      "- Vacancy -> NOI ÷ 8% × 60,000 SF ",
    );
  });
});

describe("buildEvidencePacket with a valuation worksheet", () => {
  it("adds the Commercial Valuation Summary without a font error", async () => {
    const property = {
      id: "p1",
      address: "2214 Emery St, Denton, TX 76201",
      cad: "Denton Central Appraisal District",
      accountNumber: "730758",
      taxYear: 2026,
      totalValue: 1_482_624,
    } as unknown as PropertyRecord;
    const valuation: WorksheetSummary = {
      cadValue: 1_482_624,
      approaches: [
        {
          id: "income",
          name: "Income Approach",
          status: "indicated",
          indicatedValue: 1_300_000,
          steps: [
            "Gross potential income $150,000",
            "− Vacancy & collection 10% ($15,000)",
            "÷ Cap rate 8%",
            "= Indicated value $1,300,000",
          ],
        },
        {
          id: "cost",
          name: "Cost Approach",
          status: "needs_data",
          indicatedValue: null,
          steps: [],
        },
      ],
      lowest: { name: "Income Approach", value: 1_300_000 },
      computedAt: "2026-10-07T00:00:00Z",
    };
    const without = await buildEvidencePacket(property, [], [], [], null);
    const withIt = await buildEvidencePacket(property, [], [], [], valuation);
    expect(withIt.byteLength).toBeGreaterThan(without.byteLength);
  });
});
