import { getEffectiveTaxRate } from "./texas-tax-rates";
import type { ProtestRecord } from "./protests";
import type { PropertyRecord } from "./properties";
import type { BppAccountRecord } from "./bpp-accounts";

// One real, decision-backed savings figure per resolved case — same formula
// as protest-case.ts's getCaseResults (original assessed value vs. the final
// value an ARB decision/settlement actually landed at, × the real per-county
// effective tax rate), just computed across the WHOLE portfolio — real
// estate and BPP accounts together — instead of one case at a time. Only
// counts a case once its status is actually "resolved": a "decision_received"
// case (still open to appeal/arbitration) has a finalValue on file too, but
// that number isn't final yet, so it's excluded rather than double-claimed
// and then possibly revised.
export type CaseSavingsEntry = {
  protestId: string;
  subjectKind: "property" | "bpp";
  subjectId: string;
  subjectLabel: string;
  taxYear: number | null;
  originalValue: number;
  finalValue: number;
  valueReduction: number;
  actualSavings: number;
  closedAt: string | null;
};

export type PortfolioSavings = {
  lifetimeSavings: number;
  resolvedCaseCount: number;
  entries: CaseSavingsEntry[];
  byYear: { year: number; savings: number }[];
};

export function computePortfolioSavings(
  protests: ProtestRecord[],
  properties: PropertyRecord[],
  bppAccounts: BppAccountRecord[],
): PortfolioSavings {
  const propertyById = new Map(properties.map((p) => [p.id, p]));
  const bppById = new Map(bppAccounts.map((a) => [a.id, a]));
  const entries: CaseSavingsEntry[] = [];

  for (const protest of protests) {
    if (protest.status !== "resolved") continue;
    if (protest.originalValue == null || protest.finalValue == null) continue;

    let cad: string | null;
    let subjectKind: "property" | "bpp";
    let subjectId: string;
    let subjectLabel: string;
    if (protest.propertyId) {
      const property = propertyById.get(protest.propertyId);
      if (!property) continue;
      cad = property.cad;
      subjectKind = "property";
      subjectId = property.id;
      subjectLabel = property.address;
    } else if (protest.bppAccountId) {
      const account = bppById.get(protest.bppAccountId);
      if (!account) continue;
      cad = account.cad;
      subjectKind = "bpp";
      subjectId = account.id;
      subjectLabel = account.businessName;
    } else {
      continue;
    }

    const valueReduction = Math.max(0, protest.originalValue - protest.finalValue);
    const rate = getEffectiveTaxRate(cad);
    entries.push({
      protestId: protest.id,
      subjectKind,
      subjectId,
      subjectLabel,
      taxYear: protest.taxYear,
      originalValue: protest.originalValue,
      finalValue: protest.finalValue,
      valueReduction: Math.round(valueReduction),
      actualSavings: Math.round(valueReduction * rate),
      closedAt: protest.closedAt,
    });
  }

  entries.sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""));

  const yearTotals = new Map<number, number>();
  for (const e of entries) {
    if (e.taxYear == null) continue;
    yearTotals.set(e.taxYear, (yearTotals.get(e.taxYear) ?? 0) + e.actualSavings);
  }
  const byYear = [...yearTotals.entries()]
    .map(([year, savings]) => ({ year, savings }))
    .sort((a, b) => a.year - b.year);

  return {
    lifetimeSavings: entries.reduce((sum, e) => sum + e.actualSavings, 0),
    resolvedCaseCount: entries.length,
    entries,
    byYear,
  };
}
