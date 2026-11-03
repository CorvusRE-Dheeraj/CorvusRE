import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { assessmentTier, getProtestReadiness } from "./executive-assessment";
import { buildExecutiveReportPdf, type ExecutiveReportData } from "./executive-report-pdf";
import type { PreFilingCheckItem } from "./pre-filing-check";

const today = new Date("2027-04-20T10:00:00");
const row = (
  label: string,
  status: PreFilingCheckItem["status"],
  issue?: string,
): PreFilingCheckItem => ({
  label,
  value: status === "missing" ? null : "x",
  status,
  issue,
  blocking: true,
});

describe("assessmentTier", () => {
  it("folds the four AI actions into three tiers", () => {
    expect(assessmentTier("Proceed with Protest")).toBe("recommended");
    expect(assessmentTier("Proceed with Protest After Completing Recommended Evidence")).toBe(
      "review",
    );
    expect(assessmentTier("Additional Information Needed Before Proceeding")).toBe("review");
    expect(assessmentTier("Limited Protest Opportunity Based on Available Information")).toBe(
      "limited",
    );
  });
});

describe("getProtestReadiness", () => {
  const base = {
    protestDeadline: null,
    preFilingItems: null,
    evidenceItems: [],
    missingInformation: [],
    today,
  };

  it("is ready with nothing outstanding", () => {
    expect(getProtestReadiness(base)).toEqual({ status: "ready", requirement: null, module: null });
  });

  it("puts a passed deadline ahead of everything else", () => {
    const r = getProtestReadiness({
      ...base,
      preFilingItems: [
        row("Account Number", "missing"),
        row("Protest Deadline", "needs_review", "Passed."),
      ],
    });
    expect(r).toEqual({ status: "deadline_review", requirement: "Passed.", module: null });
    expect(getProtestReadiness({ ...base, protestDeadline: "2027-04-01" }).status).toBe(
      "deadline_review",
    );
    expect(getProtestReadiness({ ...base, protestDeadline: "2027-05-15" }).status).toBe("ready");
  });

  it("names one missing filing field, then one critical evidence gap", () => {
    expect(
      getProtestReadiness({ ...base, preFilingItems: [row("Account Number", "missing")] })
        .requirement,
    ).toBe("Account Number is missing from the property record.");
    const r = getProtestReadiness({
      ...base,
      evidenceItems: [
        {
          item: "Photos",
          priority: "Important",
          status: "Missing",
          importance: "Low",
          availability: "Low",
        },
        {
          item: "Rent roll",
          priority: "Critical",
          status: "Missing",
          importance: "High",
          availability: "Low",
        },
      ],
    });
    expect(r).toEqual({
      status: "info_needed",
      requirement: "Most important outstanding item: Rent roll.",
      module: "evidence",
    });
  });
});

describe("buildExecutiveReportPdf", () => {
  const data: ExecutiveReportData = {
    property: {
      address: "100 Main St",
      county: "Travis CAD",
      account: "123",
      owner: "Acme LLC",
      propertyType: "Commercial",
      taxYear: 2027,
    },
    tier: "recommended",
    explanation: "Comparable sales sit well below the CAD value.",
    readiness: {
      status: "info_needed",
      requirement: "Most important outstanding item: Rent roll.",
      module: "evidence",
    },
    values: {
      cad: 790527,
      compsMedian: 738352,
      compsRange: { min: 700000, max: 760000 },
      income: null,
      cost: 720000,
      valueToConsider: 738352,
      valueBasis: "Comparable median",
    },
    comps: [{ address: "1 Oak St", distanceMi: 0.4, value: 730000 }],
    compsGapPct: 7,
    land: {
      keyFinding: "Part of the lot is in Zone AE → limits use.",
      factors: [{ factor: "Floodplain", finding: "0.7 ac in AE", severity: "High" }],
    },
    zoning: null,
    improvement: { keyFinding: null, components: [{ component: "Roof", condition: "Poor" }] },
    savings: {
      annual: 939,
      reductionPct: 6.6,
      taxRatePct: 1.8,
      taxRateSource: "Comptroller 2026",
      assumptions: ["No exemptions"],
    },
    strategies: [{ name: "Market value", strengthScore: 78, reason: "Comps below CAD" }],
    evidence: { verified: 2, found: 1, missing: 3, sources: ["CAD record"] },
    missingCritical: ["Rent roll"],
    deadline: "May 15, 2027",
    filingMethod: "Online — https://example.org",
  };

  it("renders a PDF, including non-WinAnsi text, and leaves out empty sections", async () => {
    const bytes = await buildExecutiveReportPdf(data);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
    const minimal = await buildExecutiveReportPdf({
      ...data,
      values: {
        cad: null,
        compsMedian: null,
        compsRange: null,
        income: null,
        cost: null,
        valueToConsider: null,
        valueBasis: null,
      },
      comps: [],
      land: null,
      improvement: null,
      savings: null,
      strategies: [],
      evidence: { verified: 0, found: 0, missing: 0, sources: [] },
      missingCritical: [],
      deadline: null,
      filingMethod: null,
    });
    expect((await PDFDocument.load(minimal)).getPageCount()).toBe(1);
  });
});
