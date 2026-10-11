import type { CadValueHistoryEntry } from "./cad-lookup";
import type { TaxBillRecord } from "./tax-bills";
import {
  compareYears,
  type IncreaseTrigger,
} from "../../../../supabase/pt/functions/_shared/tax-increase";

export {
  classifyIncrease,
  describeTrigger,
  increaseLabel,
  INCREASE_THRESHOLDS,
  METRIC_LABEL,
  type IncreaseLevel,
  type IncreaseTrigger,
} from "../../../../supabase/pt/functions/_shared/tax-increase";

// Module 1's Historic Property Tax section: one row per tax year, from real data
// only —
//   appraised / market value: the county's published value history (plus the
//     current year's value);
//   taxable value + total taxes: the property's own tax bills for that year;
//   a year with no bill gets an ESTIMATED tax (appraised × effective rate),
//     always flagged as such, never presented as the bill.
// Year-over-year change is only computed between consecutive years.

export type TaxHistoryRow = {
  year: number;
  appraised: number | null;
  market: number | null;
  taxable: number | null;
  taxes: number | null;
  taxesBasis: "bill" | "estimate" | null;
  appraisedChange: { dollar: number; pct: number } | null;
  taxableChange: { dollar: number; pct: number } | null;
  taxesChange: { dollar: number; pct: number } | null;
};

export const MIN_HISTORY_YEARS = 5;

function change(prev: number | null | undefined, cur: number | null | undefined) {
  if (prev == null || cur == null || prev <= 0) return null;
  return { dollar: cur - prev, pct: ((cur - prev) / prev) * 100 };
}

export function buildTaxHistory(input: {
  valueHistory: CadValueHistoryEntry[];
  currentYear: number | null;
  currentAppraised: number | null;
  taxBills: Pick<TaxBillRecord, "taxYear" | "taxableValue" | "amountDue" | "createdAt">[];
  // Effective rate for years without a bill (fraction). null = no estimates.
  estimateRate: number | null;
}): TaxHistoryRow[] {
  const byYear = new Map<number, TaxHistoryRow>();
  const row = (year: number): TaxHistoryRow => {
    let r = byYear.get(year);
    if (!r) {
      r = {
        year,
        appraised: null,
        market: null,
        taxable: null,
        taxes: null,
        taxesBasis: null,
        appraisedChange: null,
        taxableChange: null,
        taxesChange: null,
      };
      byYear.set(year, r);
    }
    return r;
  };

  for (const h of input.valueHistory) {
    if (h.appraisedValue == null && h.marketValue == null) continue;
    const r = row(h.year);
    r.appraised = h.appraisedValue ?? r.appraised;
    r.market = h.marketValue ?? r.market;
  }
  if (input.currentYear != null && input.currentAppraised != null) {
    const r = row(input.currentYear);
    r.appraised ??= input.currentAppraised;
  }
  // Latest bill per year wins (a corrected bill re-uploaded).
  const bills = [...input.taxBills]
    .filter((b) => b.taxYear != null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const b of bills) {
    const r = row(b.taxYear!);
    if (b.taxableValue != null) r.taxable = b.taxableValue;
    if (b.amountDue != null) {
      r.taxes = b.amountDue;
      r.taxesBasis = "bill";
    }
  }
  for (const r of byYear.values()) {
    if (r.taxes == null && input.estimateRate != null) {
      const base = r.taxable ?? r.appraised;
      if (base != null) {
        r.taxes = base * input.estimateRate;
        r.taxesBasis = "estimate";
      }
    }
  }

  const rows = [...byYear.values()].sort((a, b) => a.year - b.year);
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    if (cur.year !== prev.year + 1) continue;
    cur.appraisedChange = change(prev.appraised, cur.appraised);
    cur.taxableChange = change(prev.taxable, cur.taxable);
    // Taxes only compare like with like — an estimate against a bill would
    // mostly measure the estimate's error, not a real change.
    if (prev.taxesBasis === cur.taxesBasis) cur.taxesChange = change(prev.taxes, cur.taxes);
  }
  return rows.reverse(); // newest first
}

// Triggers for the latest year against the year before it. Taxes trigger only on
// real bills for both years — an estimated tax just mirrors the appraised value.
export function detectTaxIncreaseTriggers(rows: TaxHistoryRow[]): IncreaseTrigger[] {
  const asc = [...rows].sort((a, b) => a.year - b.year);
  const latestWith = (pick: (r: TaxHistoryRow) => number | null) => {
    const withValue = asc.filter((r) => pick(r) != null);
    const cur = withValue[withValue.length - 1];
    const prior = withValue[withValue.length - 2];
    return {
      cur: cur && { year: cur.year, value: pick(cur) },
      prior: prior && { year: prior.year, value: pick(prior) },
    };
  };
  const out: IncreaseTrigger[] = [];
  const a = latestWith((r) => r.appraised);
  const t = latestWith((r) => r.taxable);
  const x = latestWith((r) => (r.taxesBasis === "bill" ? r.taxes : null));
  for (const tr of [
    compareYears("appraised", a.prior, a.cur),
    compareYears("taxable", t.prior, t.cur),
    compareYears("taxes", x.prior, x.cur),
  ]) {
    if (tr) out.push(tr);
  }
  const rank = { major: 0, significant: 1, noticeable: 2 } as const;
  return out.sort((p, q) => rank[p.level] - rank[q.level] || q.pctIncrease - p.pctIncrease);
}
