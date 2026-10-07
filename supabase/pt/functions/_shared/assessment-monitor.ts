// Annual "assessment changed" monitoring — the pure part. Each week the
// monitor-assessments job re-reads every property's county record and asks
// this module whether the assessment changed: a new tax year's value (the
// annual notice), or a revision to the current year's value. Pure so the
// client's tests cover it.
import { classifyIncrease, type IncreaseLevel } from "./tax-increase.ts";

export type AssessmentValues = {
  taxYear: number | null;
  totalValue: number | null;
  landValue: number | null;
  improvementValue: number | null;
};

export type HistoryPoint = { year: number; total: number | null };

export type AssessmentChange = {
  kind: "new_year" | "revised";
  taxYear: number;
  priorYear: number | null;
  priorValue: number | null;
  newValue: number;
  landValue: number | null;
  improvementValue: number | null;
  change: number | null; // newValue − priorValue
  changePct: number | null; // one decimal
  level: IncreaseLevel | null; // the 10 / 20 / 30% increase bands
};

// A same-year revision smaller than this is rounding, not a change.
export const REVISION_MIN = { dollars: 1_000, pct: 0.5 } as const;

const pct = (from: number | null, to: number) =>
  from && from > 0 ? Math.round(((to - from) / from) * 1000) / 10 : null;

export function detectAssessmentChange(
  stored: AssessmentValues,
  fetched: AssessmentValues & { valueHistory?: HistoryPoint[] },
): AssessmentChange | null {
  const year = fetched.taxYear;
  const value = fetched.totalValue;
  if (year == null || value == null || value <= 0) return null;

  const base = {
    taxYear: year,
    newValue: value,
    landValue: fetched.landValue,
    improvementValue: fetched.improvementValue,
  };

  // A tax year the property record hasn't seen: the new annual notice.
  if (stored.taxYear == null || year > stored.taxYear) {
    const fromHistory =
      (fetched.valueHistory ?? []).find((h) => h.year === year - 1)?.total ??
      null;
    const priorValue =
      stored.taxYear === year - 1 && stored.totalValue != null
        ? stored.totalValue
        : fromHistory;
    // Some districts roll the year forward before reappraising, carrying last
    // year's value over unchanged (seen live: Denton and Kaufman showing the
    // next year at the prior value). That's a placeholder, not a notice —
    // wait for the real value.
    if (priorValue != null && priorValue === value) return null;
    const changePct = pct(priorValue, value);
    return {
      ...base,
      kind: "new_year",
      priorYear: priorValue != null ? year - 1 : null,
      priorValue,
      change: priorValue != null ? value - priorValue : null,
      changePct,
      level:
        changePct != null && changePct > 0 ? classifyIncrease(changePct) : null,
    };
  }

  // Same year: a revised value (a correction, a settlement, a supplement).
  if (year === stored.taxYear && stored.totalValue != null) {
    const diff = value - stored.totalValue;
    const p = pct(stored.totalValue, value) ?? 0;
    if (Math.abs(diff) < REVISION_MIN.dollars || Math.abs(p) < REVISION_MIN.pct)
      return null;
    return {
      ...base,
      kind: "revised",
      priorYear: year,
      priorValue: stored.totalValue,
      change: diff,
      changePct: p,
      level: p > 0 ? classifyIncrease(p) : null,
    };
  }
  return null; // the county returned an older year than the record has
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

// One line for the notice, the email and the in-app banner.
export function describeChange(c: AssessmentChange): string {
  const what =
    c.kind === "new_year"
      ? `The ${c.taxYear} appraised value is ${usd(c.newValue)}`
      : `The ${c.taxYear} appraised value was revised to ${usd(c.newValue)}`;
  if (c.priorValue == null || c.changePct == null) return `${what}.`;
  const dir = c.change! > 0 ? "up" : c.change! < 0 ? "down" : "unchanged";
  return dir === "unchanged"
    ? `${what}, unchanged from ${c.priorYear}.`
    : `${what} — ${dir} ${Math.abs(c.changePct)}% (${usd(Math.abs(c.change!))}) from ${usd(c.priorValue)}${c.kind === "new_year" ? ` in ${c.priorYear}` : ""}.`;
}

// Texas protest deadline for a newly noticed value: May 15, or 30 days after
// the notice was delivered if that's later (Tax Code §41.44). The job sees
// the value roughly when the notice goes out, so it estimates from today —
// but only in notice season (through June); a value first seen later was
// noticed long before, so the owner's notice is the only reliable source.
export function protestDeadlineEstimate(
  taxYear: number,
  detectedOn: string,
): string | null {
  if (detectedOn > `${taxYear}-06-30` || detectedOn < `${taxYear}-01-01`)
    return null;
  const may15 = `${taxYear}-05-15`;
  const d = new Date(`${detectedOn}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 30);
  const plus30 = d.toISOString().slice(0, 10);
  return plus30 > may15 ? plus30 : may15;
}
