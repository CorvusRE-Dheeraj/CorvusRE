import { useEffect, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, Sparkles, TrendingUp } from "lucide-react";
import { invokeEdgeFunction } from "@/lib/edge-functions";
import { useAuth } from "@/lib/auth";
import { listTaxBills, type TaxBillRecord } from "@/lib/tax-bills";
import { getEffectiveTaxRate, getTaxRateMeta } from "@/lib/texas-tax-rates";
import type { CadValueHistoryEntry } from "@/lib/cad-lookup";
import {
  buildTaxHistory,
  describeTrigger,
  detectTaxIncreaseTriggers,
  increaseLabel,
  MIN_HISTORY_YEARS,
  type IncreaseLevel,
  type IncreaseTrigger,
  type TaxHistoryRow,
} from "@/lib/tax-history";

// What Module 1 renders: loads this property's own tax bills, builds the history
// and triggers, and shows the section. Hidden when there's no history at all.
export function PropertyTaxHistory({
  propertyId,
  address,
  cad,
  propertyType,
  valueHistory,
  taxYear,
  totalValue,
  onStartProtest,
}: {
  propertyId: string | null;
  address: string;
  cad: string | null;
  propertyType: string | null;
  valueHistory: CadValueHistoryEntry[];
  taxYear: number | null;
  totalValue: number | null;
  onStartProtest?: () => void;
}) {
  const { user } = useAuth();
  const [bills, setBills] = useState<TaxBillRecord[]>([]);
  useEffect(() => {
    if (!user || !propertyId) return;
    let live = true;
    listTaxBills(user.id)
      .then((all) => {
        if (live) setBills(all.filter((b) => b.propertyId === propertyId));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [user, propertyId]);

  const rate = getEffectiveTaxRate(cad);
  const meta = getTaxRateMeta(cad);
  const rows = buildTaxHistory({
    valueHistory,
    currentYear: taxYear,
    currentAppraised: totalValue,
    taxBills: bills,
    estimateRate: rate,
  });
  return (
    <HistoricPropertyTaxSection
      rows={rows}
      triggers={detectTaxIncreaseTriggers(rows)}
      address={address}
      cad={cad}
      propertyType={propertyType}
      estimateBasis={`appraised value × ${(rate * 100).toFixed(2)}% ${meta.countySpecific ? "county" : "Texas statewide"} average effective rate`}
      onStartProtest={onStartProtest}
    />
  );
}

// Module 1 → Historic Property Tax: 5+ years of value and tax history with
// charts, year-over-year change, and the 10% / 20% / 30% increase triggers with
// an AI explanation. Rows and triggers are computed by tax-history.ts.

type Insight = {
  whatIncreased: string;
  byHowMuch: string;
  comparedToPriorYears: string;
  whyItMatters: string;
  warrantsReview: "yes" | "maybe" | "no";
  reviewReason: string;
  recommendedNextStep: string;
};

const LEVEL_STYLE: Record<IncreaseLevel, string> = {
  major: "border-destructive/50 bg-destructive/10",
  significant: "border-warning/60 bg-warning/15",
  noticeable: "border-amber-400/50 bg-amber-400/10",
};

const usd = (n: number | null) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);
const compactUsd = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
    : n >= 1_000
      ? `$${Math.round(n / 1_000)}K`
      : `$${Math.round(n)}`;

function ChangeCell({ c }: { c: { dollar: number; pct: number } | null }) {
  if (!c) return <span className="text-muted-foreground">—</span>;
  const up = c.dollar > 0;
  return (
    <span
      className={
        up ? (c.pct >= 10 ? "font-semibold text-destructive" : "text-foreground") : "text-success"
      }
    >
      {up ? "+" : ""}
      {c.pct.toFixed(1)}% ({up ? "+" : "−"}
      {usd(Math.abs(c.dollar))})
    </span>
  );
}

// One AI explanation per (property, triggers) — cached for the session so
// reopening the module doesn't spend another call.
const insightCache = new Map<string, Insight>();

export function HistoricPropertyTaxSection({
  rows,
  triggers,
  address,
  cad,
  propertyType,
  estimateBasis,
  onStartProtest,
}: {
  rows: TaxHistoryRow[];
  triggers: IncreaseTrigger[];
  address: string;
  cad: string | null;
  propertyType: string | null;
  // How estimated taxes were computed, shown in the footnote.
  estimateBasis: string | null;
  onStartProtest?: () => void;
}) {
  const [insight, setInsight] = useState<Insight | null>(null);
  const [insightError, setInsightError] = useState<string | null>(null);
  const [loadingInsight, setLoadingInsight] = useState(false);

  const cacheKey = `${address}|${triggers.map((t) => `${t.metric}:${t.toYear}:${Math.round(t.to)}`).join(",")}`;
  useEffect(() => {
    if (triggers.length === 0) return;
    const hit = insightCache.get(cacheKey);
    if (hit) {
      setInsight(hit);
      return;
    }
    let live = true;
    setLoadingInsight(true);
    setInsightError(null);
    invokeEdgeFunction<Insight>("tax-increase-insight", {
      address,
      cad,
      propertyType,
      triggers,
      history: rows.slice(0, 8).map((r) => ({
        year: r.year,
        appraised: r.appraised,
        taxable: r.taxable,
        taxes: r.taxes,
        taxesBasis: r.taxesBasis,
      })),
    })
      .then((i) => {
        insightCache.set(cacheKey, i);
        if (live) setInsight(i);
      })
      .catch((err) => {
        if (live)
          setInsightError(err instanceof Error ? err.message : "Couldn't get the AI insight.");
      })
      .finally(() => {
        if (live) setLoadingInsight(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  if (rows.length === 0) return null;
  const chart = [...rows].reverse().map((r) => ({
    year: String(r.year),
    appraised: r.appraised,
    taxable: r.taxable,
    taxes: r.taxes != null ? Math.round(r.taxes) : null,
    estimated: r.taxesBasis === "estimate",
  }));
  const hasTaxable = rows.some((r) => r.taxable != null);
  const hasEstimates = rows.some((r) => r.taxesBasis === "estimate");
  const top = triggers[0];

  return (
    <section
      className="mt-6 rounded-lg border border-border p-4"
      aria-labelledby="historic-tax-title"
    >
      <h3
        id="historic-tax-title"
        className="flex items-center gap-2 font-serif text-lg font-semibold"
      >
        <TrendingUp className="h-5 w-5 text-accent" aria-hidden="true" />
        Historic Property Tax
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {rows.length >= MIN_HISTORY_YEARS
          ? `${rows.length} years of history`
          : `${rows.length} year${rows.length === 1 ? "" : "s"} of history — the county publishes no earlier values for this property. Upload older tax bills to extend it.`}
      </p>

      {/* Increase triggers */}
      {triggers.length > 0 && (
        <div className="mt-3 grid gap-2">
          {triggers.map((t) => (
            <div
              key={t.metric}
              className={`flex items-start gap-2 rounded-md border p-3 text-sm ${LEVEL_STYLE[t.level]}`}
              role="alert"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                <div className="font-semibold">{increaseLabel(t.level)}</div>
                <div>{describeTrigger(t, { withLevel: false })}</div>
              </div>
            </div>
          ))}

          <div className="rounded-md border border-accent/40 bg-accent/5 p-3 text-sm">
            <div className="flex items-center gap-1.5 font-semibold text-accent">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              AI insight
            </div>
            {loadingInsight && (
              <p className="mt-1 text-muted-foreground">Looking at what changed…</p>
            )}
            {insightError && <p className="mt-1 text-destructive">{insightError}</p>}
            {insight && (
              <dl className="mt-2 grid gap-1.5">
                {(
                  [
                    ["What increased", insight.whatIncreased],
                    ["By how much", insight.byHowMuch],
                    ["Compared with prior years", insight.comparedToPriorYears],
                    ["Why it may matter", insight.whyItMatters],
                    [
                      "Worth a review or protest?",
                      `${insight.warrantsReview === "yes" ? "Yes" : insight.warrantsReview === "no" ? "Probably not" : "Possibly"} — ${insight.reviewReason}`,
                    ],
                    ["Recommended next step", insight.recommendedNextStep],
                  ] as const
                )
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-xs font-medium text-muted-foreground">{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
              </dl>
            )}
            {onStartProtest &&
              top &&
              (top.level === "major" || insight?.warrantsReview === "yes") && (
                <button type="button" onClick={onStartProtest} className="btn-accent mt-3 text-xs">
                  Review &amp; start a protest
                </button>
              )}
            <p className="mt-2 text-[11px] text-muted-foreground">
              AI explanation of the figures above — verify against your appraisal notice. Not a
              guarantee of any reduction.
            </p>
          </div>
        </div>
      )}

      {/* Value and tax trend */}
      <div className="mt-4 h-64 w-full" aria-label="Appraised value and property taxes by year">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="year" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="value" tickFormatter={compactUsd} tick={{ fontSize: 11 }} width={56} />
            <YAxis
              yAxisId="tax"
              orientation="right"
              tickFormatter={compactUsd}
              tick={{ fontSize: 11 }}
              width={52}
            />
            <Tooltip formatter={(v: number, name: string) => [usd(v), name]} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar
              yAxisId="tax"
              dataKey="taxes"
              name="Total taxes"
              fill="#0f9e6e"
              fillOpacity={0.6}
              radius={[3, 3, 0, 0]}
            >
              {/* Estimated years are paler, with a dashed outline, so a real bill
                  and an estimate never look alike. */}
              {chart.map((d) => (
                <Cell
                  key={d.year}
                  fillOpacity={d.estimated ? 0.2 : 0.6}
                  stroke={d.estimated ? "#0f9e6e" : undefined}
                  strokeDasharray={d.estimated ? "4 3" : undefined}
                />
              ))}
            </Bar>
            <Line
              yAxisId="value"
              type="monotone"
              dataKey="appraised"
              name="Appraised value"
              stroke="#1d3b5c"
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls
            />
            {hasTaxable && (
              <Line
                yAxisId="value"
                type="monotone"
                dataKey="taxable"
                name="Taxable value"
                stroke="#7c3aed"
                strokeWidth={2}
                strokeDasharray="5 3"
                dot={{ r: 3 }}
                connectNulls
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Year-by-year table */}
      <div
        className="mt-3 overflow-x-auto"
        role="region"
        aria-label="Historic property tax by year"
      >
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-1 pr-3">Year</th>
              <th className="py-1 pr-3">Appraised</th>
              <th className="py-1 pr-3">Change</th>
              <th className="py-1 pr-3">Taxable</th>
              <th className="py-1 pr-3">Total taxes</th>
              <th className="py-1 pr-3">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.year} className="border-t border-border">
                <td className="py-1.5 pr-3 font-medium">{r.year}</td>
                <td className="py-1.5 pr-3">{usd(r.appraised)}</td>
                <td className="py-1.5 pr-3 text-xs">
                  <ChangeCell c={r.appraisedChange} />
                </td>
                <td className="py-1.5 pr-3">{usd(r.taxable)}</td>
                <td className="py-1.5 pr-3">
                  {usd(r.taxes)}
                  {r.taxesBasis === "estimate" && (
                    <span className="ml-1 text-[11px] text-muted-foreground">est.</span>
                  )}
                </td>
                <td className="py-1.5 pr-3 text-xs">
                  <ChangeCell c={r.taxesChange} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Appraised values from the county appraisal district. Taxable value and taxes come from your
        tax bills
        {hasEstimates && estimateBasis
          ? `; years marked "est." (pale bars on the chart) are estimates (${estimateBasis})`
          : ""}
        . Alerts flag increases of 10% (noticeable), 20% (significant) and 30% (major) over the
        prior year.
      </p>
    </section>
  );
}
