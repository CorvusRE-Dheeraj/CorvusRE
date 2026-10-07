// Tax increase triggers — one definition shared by the app (Module 1's Historic
// Property Tax section, apps/pt/src/lib/tax-history.ts) and the weekly
// refresh-property-base-data job's alerts. Pure, no imports.
//
//   10%+  Noticeable increase
//   20%+  Significant increase
//   30%+  Major increase — needs review
//
// Always the current year against the immediately prior year — a gap year is
// never bridged, since a multi-year jump isn't a year-over-year increase.

export type IncreaseLevel = "noticeable" | "significant" | "major";

export const INCREASE_THRESHOLDS: { level: IncreaseLevel; minPct: number; label: string }[] = [
  { level: "major", minPct: 30, label: "Major increase — needs review" },
  { level: "significant", minPct: 20, label: "Significant increase" },
  { level: "noticeable", minPct: 10, label: "Noticeable increase" },
];

export function classifyIncrease(pct: number | null | undefined): IncreaseLevel | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  // Rounded to a tenth first, so 9.96% (shown as "10.0%") isn't silently missed
  // and 29.99% doesn't read as "30%" yet classify one level lower.
  const p = Math.round(pct * 10) / 10;
  return INCREASE_THRESHOLDS.find((t) => p >= t.minPct)?.level ?? null;
}

export function increaseLabel(level: IncreaseLevel): string {
  return INCREASE_THRESHOLDS.find((t) => t.level === level)!.label;
}

export type IncreaseMetric = "appraised" | "taxable" | "taxes";

export const METRIC_LABEL: Record<IncreaseMetric, string> = {
  appraised: "appraised value",
  taxable: "taxable value",
  taxes: "total property taxes",
};

export type IncreaseTrigger = {
  metric: IncreaseMetric;
  level: IncreaseLevel;
  fromYear: number;
  toYear: number;
  from: number;
  to: number;
  dollarIncrease: number;
  pctIncrease: number;
};

export function compareYears(
  metric: IncreaseMetric,
  prior: { year: number; value: number | null } | undefined,
  current: { year: number; value: number | null } | undefined,
): IncreaseTrigger | null {
  if (!prior || !current || prior.value == null || current.value == null) return null;
  if (current.year !== prior.year + 1 || prior.value <= 0) return null;
  const pctIncrease = ((current.value - prior.value) / prior.value) * 100;
  const level = classifyIncrease(pctIncrease);
  if (!level) return null;
  return {
    metric,
    level,
    fromYear: prior.year,
    toYear: current.year,
    from: prior.value,
    to: current.value,
    dollarIncrease: current.value - prior.value,
    pctIncrease,
  };
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

// "30% increase detected: appraised value went from $2,500,000 (2025) to
// $3,250,000 (2026), up $750,000."
// `withLevel: false` drops the "(Major increase — needs review)" part, for places
// that already show the level as a heading.
export function describeTrigger(t: IncreaseTrigger, opts: { withLevel?: boolean } = {}): string {
  const level = opts.withLevel === false ? "" : ` (${increaseLabel(t.level)})`;
  return (
    `${Math.round(t.pctIncrease)}% increase detected${level}: ` +
    `${METRIC_LABEL[t.metric]} went from ${money(t.from)} (${t.fromYear}) to ${money(t.to)} ` +
    `(${t.toYear}), up ${money(t.dollarIncrease)}.`
  );
}
