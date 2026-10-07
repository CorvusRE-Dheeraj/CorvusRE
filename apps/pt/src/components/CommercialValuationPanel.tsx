import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  Calculator,
  ChevronDown,
  Hammer,
  Landmark,
  Plus,
  Scale,
  Trash2,
  TrendingDown,
  TriangleAlert,
} from "lucide-react";
import type { ComparableStats } from "@/lib/comps-analysis";
import type { IncomeApproach } from "@/lib/income-approach";
import {
  costApproach,
  equalUniformApproach,
  impairmentsApproach,
  incomeApproach,
  landImprovementAnalysis,
  reconcile,
  salesComparisonApproach,
  type ApproachId,
  type ApproachResult,
  type Impairment,
} from "@/lib/commercial-valuation";

const ICON: Record<ApproachId, typeof Scale> = {
  income: Calculator,
  sales: TrendingDown,
  equity: Scale,
  cost: Hammer,
  land: Landmark,
  impairments: TriangleAlert,
};

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

type Saved = {
  vacancyPct?: number | null;
  expenseRatioPct?: number | null;
  capRatePct?: number | null;
  costPerSqft?: number | null;
  economicLifeYears?: number;
  impairments?: Impairment[];
};

// A per-viewer what-if scratchpad (sliders, cost inputs, impairment list) —
// browser storage, wrapped so private windows still work.
function useSaved(propertyId: string | null): [Saved, (patch: Saved) => void] {
  const key = propertyId ? `corvuspt:valuation:${propertyId}` : null;
  const [saved, setSaved] = useState<Saved>({});
  useEffect(() => {
    if (!key) return;
    try {
      setSaved(JSON.parse(localStorage.getItem(key) ?? "{}") as Saved);
    } catch {
      setSaved({});
    }
  }, [key]);
  const update = (patch: Saved) =>
    setSaved((cur) => {
      const next = { ...cur, ...patch };
      try {
        if (key) localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // per-viewer convenience only
      }
      return next;
    });
  return [saved, update];
}

// "Make commercial valuation visibly commercial": the six paths a commercial
// appraiser (and the ARB) actually argues — Income, Sales Comparison, Equal &
// Uniform, Cost, Land / Improvement, Property-Specific Impairments — each
// with its own inputs, math and indicated value, side by side against the
// county's. See lib/commercial-valuation.ts.
export function CommercialValuationPanel({
  propertyId,
  cadValue,
  landValue,
  improvementValue,
  acres,
  buildingSqft,
  yearBuilt,
  income,
  compStats,
  knownConditions,
  onAddIncomeData,
  onAddSales,
}: {
  propertyId: string | null;
  cadValue: number | null;
  landValue: number | null;
  improvementValue: number | null;
  acres: number | null;
  buildingSqft: number | null;
  yearBuilt: number | null;
  income: IncomeApproach;
  compStats: ComparableStats | null;
  knownConditions: string[];
  onAddIncomeData?: () => void;
  onAddSales?: () => void;
}) {
  const [saved, update] = useSaved(propertyId);
  const [open, setOpen] = useState<ApproachId | null>(null);
  const currentYear = new Date().getFullYear();
  const baseExpenseRatio = income.opexRatioPct;

  const results = useMemo(() => {
    const incomeR = incomeApproach(income, {
      vacancyPct: saved.vacancyPct ?? null,
      expenseRatioPct: saved.expenseRatioPct ?? null,
      capRatePct: saved.capRatePct ?? null,
    });
    const ranked = compStats?.ranked ?? [];
    return {
      income: incomeR,
      sales: salesComparisonApproach(ranked, { buildingSqft }),
      equity: equalUniformApproach(compStats),
      cost: costApproach({
        landValue,
        buildingSqft,
        yearBuilt,
        costPerSqft: saved.costPerSqft ?? null,
        economicLifeYears: saved.economicLifeYears ?? 50,
        currentYear,
      }),
      land: landImprovementAnalysis({
        landValue,
        improvementValue,
        totalValue: cadValue,
        acres,
        buildingSqft,
        comps: ranked,
      }),
      impairments: impairmentsApproach(cadValue, saved.impairments ?? [], knownConditions),
    } satisfies Record<ApproachId, ApproachResult>;
  }, [
    income,
    saved,
    compStats,
    buildingSqft,
    landValue,
    improvementValue,
    yearBuilt,
    acres,
    cadValue,
    knownConditions,
    currentYear,
  ]);

  const ordered: ApproachResult[] = [
    results.income,
    results.sales,
    results.equity,
    results.cost,
    results.land,
    results.impairments,
  ];
  const rec = reconcile(ordered, cadValue);
  const scaleMax = Math.max(cadValue ?? 0, ...rec.indicated.map((x) => x.value)) * 1.05 || 1;

  return (
    <section aria-labelledby="commercial-valuation" className="mt-6 card-elev p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-accent" aria-hidden="true" />
            <h2 id="commercial-valuation" className="font-serif text-2xl font-semibold">
              Commercial Valuation
            </h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            The six ways a commercial property is valued at the appraisal district and the ARB —
            each with its own math, so you can see exactly where the county&apos;s number holds up
            and where it doesn&apos;t. Adjust the inputs to test your case.
          </p>
        </div>
      </div>

      {/* Reconciliation: every indicated value against the county's. */}
      <div className="mt-5 rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">Reconciliation</h3>
          {rec.lowest && cadValue != null && rec.lowest.value < cadValue ? (
            <p className="text-sm">
              <span className="font-semibold">{rec.belowCad}</span> of {rec.indicated.length}{" "}
              approach{rec.indicated.length === 1 ? "" : "es"} indicate less than the county. Lowest
              supported: <span className="font-semibold text-success">{usd(rec.lowest.value)}</span>{" "}
              ({rec.lowest.name}, {usd(cadValue - rec.lowest.value)} below)
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {rec.indicated.length === 0
                ? "Add data below to see what each approach indicates."
                : "So far, no approach indicates less than the county's value."}
            </p>
          )}
        </div>
        <div className="mt-3 grid gap-2">
          {cadValue != null && (
            <Bar label="County appraised value" value={cadValue} max={scaleMax} tone="county" />
          )}
          {ordered.map((r) =>
            r.status === "indicated" && r.indicatedValue != null ? (
              <Bar
                key={r.id}
                label={r.name}
                value={r.indicatedValue}
                max={scaleMax}
                tone={cadValue != null && r.indicatedValue < cadValue ? "below" : "above"}
              />
            ) : (
              <div key={r.id} className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="w-28 shrink-0 truncate sm:w-44">{r.name}</span>
                <span>
                  {r.status === "supports_cad" ? "Supports the county's value" : "Needs data"}
                </span>
              </div>
            ),
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {ordered.map((r) => {
          const Icon = ICON[r.id];
          const expanded = open === r.id;
          return (
            <article key={r.id} className="rounded-lg border border-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
                    <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-semibold">{r.name}</h3>
                    <p className="text-xs text-muted-foreground">{r.basis}</p>
                  </div>
                </div>
                <StatusPill result={r} cadValue={cadValue} />
              </div>

              {r.id === "income" && (
                <IncomeControls
                  income={income}
                  saved={saved}
                  baseExpenseRatio={baseExpenseRatio}
                  update={update}
                />
              )}
              {r.id === "cost" && <CostControls saved={saved} update={update} />}
              {r.id === "impairments" && (
                <ImpairmentControls items={saved.impairments ?? []} update={update} />
              )}

              {r.missing.length > 0 && (
                <div className="mt-3 rounded-md bg-secondary/60 p-3 text-xs">
                  <div className="font-semibold">To run this approach, add:</div>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {r.missing.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                  {r.id === "income" && onAddIncomeData && (
                    <button
                      type="button"
                      onClick={onAddIncomeData}
                      className="mt-2 text-accent underline"
                    >
                      Upload a rent roll or P&amp;L
                    </button>
                  )}
                  {r.id === "sales" && onAddSales && (
                    <button
                      type="button"
                      onClick={onAddSales}
                      className="mt-2 text-accent underline"
                    >
                      Add a comparable sale
                    </button>
                  )}
                </div>
              )}

              {r.steps.length > 0 && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : r.id)}
                    aria-expanded={expanded}
                    className="inline-flex items-center gap-1 text-xs font-medium text-accent"
                  >
                    {expanded ? "Hide" : "Show"} the math
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
                      aria-hidden="true"
                    />
                  </button>
                  {expanded && (
                    <ol className="mt-2 space-y-1 rounded-md bg-secondary/40 p-3 font-mono text-xs">
                      {r.steps.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Indicated values are computed from your county record, comparable properties, sales you add
        and the figures you enter — estimates to support your protest, not an appraisal.
      </p>
    </section>
  );
}

function StatusPill({ result, cadValue }: { result: ApproachResult; cadValue: number | null }) {
  if (result.status === "indicated" && result.indicatedValue != null) {
    const below = cadValue != null && result.indicatedValue < cadValue;
    return (
      <div className="shrink-0 text-right">
        <div className={`text-lg font-semibold ${below ? "text-success" : ""}`}>
          {usd(result.indicatedValue)}
        </div>
        {cadValue != null && (
          <div className={`text-[11px] ${below ? "text-success" : "text-muted-foreground"}`}>
            {below ? `${usd(cadValue - result.indicatedValue)} below county` : "at or above county"}
          </div>
        )}
      </div>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {result.status === "supports_cad" ? "Supports county" : "Needs data"}
    </span>
  );
}

function Bar({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  tone: "county" | "below" | "above";
}) {
  const color =
    tone === "county" ? "bg-foreground/70" : tone === "below" ? "bg-success" : "bg-warning";
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-28 shrink-0 truncate font-medium sm:w-44">{label}</span>
      <span className="relative h-3 min-w-0 flex-1 rounded-full bg-secondary">
        <span
          className={`absolute inset-y-0 left-0 rounded-full ${color}`}
          style={{ width: `${Math.max(2, (value / max) * 100)}%` }}
        />
      </span>
      <span className="w-20 shrink-0 text-right tabular-nums sm:w-24">{usd(value)}</span>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  unset = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  // No figure from the owner's documents yet — the slider shows a starting
  // point, but nothing is computed until it's moved.
  unset?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className="grid gap-1 text-xs">
      <span className="flex justify-between">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums">
          {unset ? "not set — drag to test" : `${value}${suffix}`}
        </span>
      </span>
      <input
        type="range"
        aria-label={label}
        aria-valuetext={unset ? "not set" : `${value}${suffix}`}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-primary"
      />
    </div>
  );
}

function IncomeControls({
  income,
  saved,
  baseExpenseRatio,
  update,
}: {
  income: IncomeApproach;
  saved: Saved;
  baseExpenseRatio: number | null;
  update: (p: Saved) => void;
}) {
  if (income.gpi == null) return null;
  const vacancy = saved.vacancyPct ?? income.vacancyPct ?? 10;
  const expense = saved.expenseRatioPct ?? baseExpenseRatio ?? 35;
  const cap = saved.capRatePct ?? income.capRatePct ?? 8;
  const changed =
    saved.vacancyPct != null || saved.expenseRatioPct != null || saved.capRatePct != null;
  return (
    <div className="mt-3 grid gap-3 rounded-md border border-border p-3">
      <Slider
        label="Vacancy & collection loss"
        unset={saved.vacancyPct == null && income.vacancyPct == null}
        value={vacancy}
        min={0}
        max={40}
        step={0.5}
        suffix="%"
        onChange={(v) => update({ vacancyPct: v })}
      />
      <Slider
        label="Normalized operating expenses (of EGI)"
        unset={saved.expenseRatioPct == null && baseExpenseRatio == null}
        value={expense}
        min={5}
        max={75}
        step={0.5}
        suffix="%"
        onChange={(v) => update({ expenseRatioPct: v })}
      />
      <Slider
        label="Cap rate"
        unset={saved.capRatePct == null && income.capRatePct == null}
        value={cap}
        min={4}
        max={14}
        step={0.05}
        suffix="%"
        onChange={(v) => update({ capRatePct: Math.round(v * 100) / 100 })}
      />
      {changed && (
        <button
          type="button"
          onClick={() => update({ vacancyPct: null, expenseRatioPct: null, capRatePct: null })}
          className="justify-self-start text-xs text-accent underline"
        >
          Reset to your documents&apos; figures
        </button>
      )}
    </div>
  );
}

function CostControls({ saved, update }: { saved: Saved; update: (p: Saved) => void }) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-3 rounded-md border border-border p-3 text-xs">
      <label className="grid gap-1">
        <span className="font-medium">Replacement cost per SF</span>
        <input
          type="number"
          min={0}
          inputMode="decimal"
          placeholder="e.g. from a contractor bid"
          value={saved.costPerSqft ?? ""}
          onChange={(e) =>
            update({ costPerSqft: e.target.value === "" ? null : Number(e.target.value) })
          }
          className="rounded-md border border-input bg-background px-2 py-1.5"
        />
      </label>
      <label className="grid gap-1">
        <span className="font-medium">Economic life</span>
        <select
          value={saved.economicLifeYears ?? 50}
          onChange={(e) => update({ economicLifeYears: Number(e.target.value) })}
          className="rounded-md border border-input bg-background px-2 py-1.5"
        >
          {[30, 35, 40, 45, 50, 55, 60].map((y) => (
            <option key={y} value={y}>
              {y} years
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function ImpairmentControls({
  items,
  update,
}: {
  items: Impairment[];
  update: (p: Saved) => void;
}) {
  const [label, setLabel] = useState("");
  const [cost, setCost] = useState("");
  const add = () => {
    const c = Number(cost.replace(/[$,]/g, ""));
    if (!label.trim() || !(c > 0)) return;
    update({
      impairments: [...items, { id: crypto.randomUUID(), label: label.trim(), costToCure: c }],
    });
    setLabel("");
    setCost("");
  };
  return (
    <div className="mt-3 grid gap-2 rounded-md border border-border p-3 text-xs">
      {items.map((x) => (
        <div key={x.id} className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate">{x.label}</span>
          <span className="flex items-center gap-2">
            <span className="tabular-nums">−{usd(x.costToCure)}</span>
            <button
              type="button"
              aria-label={`Remove ${x.label}`}
              onClick={() => update({ impairments: items.filter((y) => y.id !== x.id) })}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </span>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Roof at end of life"
          aria-label="Impairment"
          className="min-w-0 flex-1 basis-40 rounded-md border border-input bg-background px-2 py-1.5"
        />
        <input
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          placeholder="Cost to cure $"
          inputMode="decimal"
          aria-label="Cost to cure"
          className="w-32 rounded-md border border-input bg-background px-2 py-1.5"
        />
        <button
          type="button"
          onClick={add}
          className="btn-outline inline-flex items-center gap-1 px-2 py-1 text-xs"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add
        </button>
      </div>
    </div>
  );
}
