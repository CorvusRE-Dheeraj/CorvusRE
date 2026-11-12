import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/document-ai", () => ({ askAboutDocument: vi.fn() }));
vi.mock("@/lib/protest-case", () => ({ recordEscalation: vi.fn(), closeCase: vi.fn() }));

import { PostArbOptions } from "./post-arb-options";
import type { PropertyRecord } from "@/lib/properties";
import type { ProtestRecord } from "@/lib/protests";

const property = {
  id: "p1",
  address: "4601 Parkview Hills Ln, Fort Worth, TX",
  cad: "Tarrant Appraisal District",
  accountNumber: "42717939",
  propertyType: "Commercial",
  totalValue: 600_000,
} as unknown as PropertyRecord;

const protest = (over: Partial<ProtestRecord>) =>
  ({
    id: "x1",
    propertyId: "p1",
    status: "decision_received",
    informalStatus: "completed",
    arbDecision: "denied",
    arbDecisionDate: "2026-11-01",
    originalValue: 600_000,
    finalValue: 600_000,
    escalationPath: null,
    ...over,
  }) as unknown as ProtestRecord;

const render = (p: ProtestRecord, supportableLow: number | null = 500_000) =>
  renderToStaticMarkup(
    <PostArbOptions
      property={property}
      protest={p}
      evidenceDocumentCount={3}
      supportableLow={supportableLow}
    />,
  );

describe("Post ARB options", () => {
  it("lists every option in one table, with the comparison columns", () => {
    const html = render(protest({}));
    for (const t of [
      "Regular binding arbitration",
      "Limited binding arbitration (procedural)",
      "Appeal to district court",
      "Appeal to SOAH",
      "Correction motion",
      "Accept the ARB value and close",
      "Est. cost",
      "Added savings / yr",
      "Est. ROI",
      "Evidence",
      "Risk",
    ])
      expect(html).toContain(t);
    // (600,000 − 500,000) × the county rate — a real figure, not "—"
    expect(html).toMatch(/\$\d[\d,]* <\/td>|\$[\d,]+<\/td>/);
  });

  it("fades options that don't apply and keeps them unclickable", () => {
    const html = render(protest({}));
    // SOAH is only for property over $1M; limited arbitration is procedural only
    const faded = html.match(/<tr[^>]*aria-disabled="true"[^>]*>/g) ?? [];
    expect(faded.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain("Only for property appraised over $1,000,000.");
    // the open ones are buttons
    expect(html).toMatch(
      /role="button"[^>]*aria-label="Regular binding arbitration — open details"/,
    );
  });

  it("before the ARB's order, only closing is open", () => {
    const html = render(protest({ arbDecision: null, finalValue: null }));
    expect(html).toContain("They open once the ARB");
    expect(html).not.toContain("Approve Escalation");
    expect(html).not.toContain("Accept ARB decision");
  });

  it("links the county's ARB page and the statewide guides, and offers the decisions", () => {
    const html = render(protest({}));
    expect(html).toContain("https://www.tad.org/about/tarb");
    expect(html).toContain("https://comptroller.texas.gov/taxes/property-tax/arbitration/");
    expect(html).toContain("https://www.soah.texas.gov/appraisal-review-board");
    expect(html).toContain("Approve Escalation");
    expect(html).toContain("Accept ARB decision &amp; Close Case");
    expect(html).toContain("Corvus AI assessment");
  });
});
