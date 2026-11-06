import { AnimatedNumber } from "@/components/AnimatedNumber";
import { EvidenceImpactCard, EvidenceImpactContext } from "@/components/EvidenceImpactCard";
import { currency } from "@/lib/intake-store";
import { type ProtestCost } from "@/lib/protest-cost";
import { type SavingsAnalysis, type SavingsTaxInputs } from "@/lib/savings-analysis";
import {
  EVIDENCE_LABEL,
  SCENARIO_COPY,
  type SavingsFinding,
  type SavingsNextStep,
} from "@/lib/savings-dashboard";
import { type SavingsTaxInputsInput } from "@/lib/savings-tax-inputs";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Building2,
  DollarSign,
  Home,
  Receipt,
  TrendingDown,
} from "lucide-react";
import { useContext, useEffect, useState } from "react";
import {
  COST_KIND_LABEL,
  FINDING_ICON,
  SAVINGS_CONF_STYLE,
  SAVINGS_DISCLAIMER,
  STRENGTH_LABEL,
  STRENGTH_STYLE,
  compactCurrency,
  savingsToForm,
} from "./helpers";

import { FormulaIcon } from "./visuals";

export function ConfPill({ level }: { level: SavingsAnalysis["financialConfidence"] }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${SAVINGS_CONF_STYLE[level]}`}
    >
      {level}
    </span>
  );
}

// Compact card visual — CAD → Indicated → Reduction → Annual Savings, then a
// Net Benefit / ROI chip. Mirrors the reference infographic's compact form.
export function SavingsCardVisual({ a }: { a: SavingsAnalysis }) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-center gap-1">
        <FormulaIcon
          Icon={Building2}
          value={compactCurrency(a.cadValue)}
          label="CAD value"
          tone="bg-destructive/10 text-destructive"
        />
        <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        <FormulaIcon
          Icon={Home}
          value={
            a.indicatedRange
              ? `${compactCurrency(a.indicatedRange.low)}+`
              : compactCurrency(a.indicatedValue)
          }
          label="indicated"
          tone="bg-sky-500/15 text-sky-700"
        />
        <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        <FormulaIcon
          Icon={TrendingDown}
          value={`${compactCurrency(a.reductionBase)}`}
          label={`${a.reductionPct}% off`}
          tone="bg-warning/20 text-warning-foreground"
        />
        <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        <FormulaIcon
          Icon={DollarSign}
          value={`${compactCurrency(a.annualSavings)}/yr`}
          label="tax savings"
          tone="bg-success/15 text-success"
        />
      </div>
      <div className="flex items-center justify-center gap-2 text-xs">
        <span
          className="text-muted-foreground"
          title="After the protest cost under your CorvusPT plan."
        >
          Net benefit (after protest cost)
        </span>
        <span className="font-serif font-bold text-success">{compactCurrency(a.netBenefit)}</span>
        {a.roiPct != null ? (
          <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold text-success">
            {a.roiPct}% ROI
          </span>
        ) : a.savingsToCostMultiple != null ? (
          <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold text-success">
            {a.savingsToCostMultiple}x
          </span>
        ) : (
          <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
            no cost entered
          </span>
        )}
      </div>
    </div>
  );
}

export function SavingsSummaryList({ a }: { a: SavingsAnalysis }) {
  const rows: [string, string][] = [
    ["Current CAD Value", currency(a.cadValue)],
    [
      a.indicatedRange ? "AI-Indicated Value Range" : "AI-Indicated Value",
      a.indicatedRange
        ? `${currency(a.indicatedRange.low)} – ${currency(a.indicatedRange.high)}`
        : currency(a.indicatedValue),
    ],
    ["Potential Value Reduction", currency(a.reductionBase)],
    ["Potential Reduction", `${a.reductionPct}%`],
    ["Estimated Annual Tax Savings", currency(a.annualSavings)],
    ["Protest Cost", a.protestCostSource === "none" ? "Not entered" : currency(a.protestCost)],
    ["Estimated Net Benefit", currency(a.netBenefit)],
    [
      "Savings-to-Cost Multiple",
      a.savingsToCostMultiple != null ? `${a.savingsToCostMultiple}x` : "—",
    ],
  ];
  return (
    <div className="rounded-lg border border-border">
      <div className="bg-secondary/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Financial Opportunity
      </div>
      <table className="w-full text-xs sm:text-sm">
        <tbody>
          {rows.map(([k, v], i) => (
            <tr key={k} className={i > 0 ? "border-t border-border/60" : ""}>
              <td className="px-3 py-2 text-muted-foreground sm:px-4">{k}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums sm:px-4">
                {v}
              </td>
            </tr>
          ))}
          <tr className="border-t border-border/60">
            <td className="px-3 py-2 text-muted-foreground sm:px-4">Financial Confidence</td>
            <td className="px-3 py-2 text-right sm:px-4">
              <ConfPill level={a.financialConfidence} />
            </td>
          </tr>
        </tbody>
      </table>
      <p className="border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground sm:px-4">
        {SAVINGS_DISCLAIMER}
      </p>
    </div>
  );
}

// Low / Estimated / High as three compact cards in plain language — the
// middle one highlighted, but only called the most likely outcome when the
// valuation evidence is strong. The calculation behind each sits under
// "How are these calculated?".
export function SavingsScenarioCards({ a }: { a: SavingsAnalysis }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Savings Scenarios
      </h3>
      <div className="grid grid-cols-3 gap-2">
        {a.scenarios.map((s) => {
          const copy = SCENARIO_COPY[s.key];
          const mid = s.key === "base";
          return (
            <div
              key={s.key}
              className={`rounded-lg border p-2.5 text-center sm:p-3 ${
                mid ? "border-success/50 bg-success/10 shadow-sm" : "border-border"
              }`}
            >
              <div
                className={`text-[10px] font-semibold uppercase tracking-wide ${mid ? "text-success" : "text-muted-foreground"}`}
              >
                {copy.title}
              </div>
              <div className="mt-1 font-serif text-base font-bold tabular-nums sm:text-lg">
                {currency(s.annualSavings)}
                <span className="text-[10px] font-normal text-muted-foreground">/yr</span>
              </div>
              <p className="mt-1 hidden text-[11px] leading-snug text-muted-foreground sm:block">
                {copy.plain}
              </p>
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Illustrative scenarios based on the available valuation evidence and how an Appraisal Review
        Board panel might decide — not guaranteed outcomes.
        {a.valuationConfidence !== "High" &&
          " The middle figure is not necessarily the most likely outcome."}
      </p>
      <details className="mt-1.5 text-xs">
        <summary className="cursor-pointer text-accent">How are these calculated?</summary>
        <div className="mt-2 grid gap-1.5 rounded-lg bg-secondary/40 p-3 text-muted-foreground">
          {a.scenarios.map((s) => (
            <p key={s.key}>
              <span className="font-semibold text-foreground">{SCENARIO_COPY[s.key].title}:</span>{" "}
              the value comes down {currency(s.valueReduction)} ({s.reductionPct}%) ×{" "}
              {a.taxRate.pct}% tax rate = {currency(s.annualSavings)} a year.
            </p>
          ))}
          <p>
            {a.indicatedRange
              ? `Conservative uses the top of the comparable range (${currency(a.indicatedRange.high)}), Higher Savings the bottom (${currency(a.indicatedRange.low)}), and Estimated the ${a.valueBasisLabel} value.`
              : `Without a comparable range, Conservative is 60% and Higher Savings 150% of the estimated reduction (${a.valueBasisLabel}).`}
          </p>
          {a.appraisalCap != null && (
            <p>
              Each scenario only counts the part of the reduction that falls below the county&apos;s
              capped appraised value ({currency(a.appraisalCap)}).
            </p>
          )}
        </div>
      </details>
    </section>
  );
}

// Savings − protest cost = net benefit, from the owner's real plan (see
// protest-cost.ts). The ratio, cost breakdown and the hypothetical
// multi-year figure stay under "Financial details".
export function SavingsWorthIt({ a, cost }: { a: SavingsAnalysis; cost: ProtestCost }) {
  const costKnown = cost.total != null;
  return (
    <section className="rounded-lg border border-border p-3 sm:p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Is Filing a Protest Worth It?
      </h3>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
        <FormulaIcon
          Icon={DollarSign}
          value={currency(a.annualSavings)}
          label="potential savings / yr"
          tone="bg-success/15 text-success"
        />
        <span className="text-lg text-muted-foreground">−</span>
        <FormulaIcon
          Icon={Receipt}
          value={costKnown ? currency(a.protestCost) : "Not on file"}
          label="protest cost"
          tone="bg-secondary text-foreground"
        />
        <span className="text-lg text-muted-foreground">=</span>
        <FormulaIcon
          Icon={BarChart3}
          value={costKnown ? currency(a.netBenefit) : "—"}
          label="estimated net benefit"
          tone={
            !costKnown || a.netBenefit > 0
              ? "bg-success/15 text-success"
              : "bg-warning/20 text-warning-foreground"
          }
        />
      </div>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        Protest cost: {cost.label}.
      </p>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-accent">Financial details</summary>
        <div className="mt-2 grid gap-1.5 rounded-lg bg-secondary/40 p-3">
          {cost.lines.map((l) => (
            <div key={l.label} className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="mr-1.5 rounded-full bg-background px-1.5 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">
                  {COST_KIND_LABEL[l.kind]}
                </span>
                {l.label}
                {l.note && <span className="block text-muted-foreground">{l.note}</span>}
              </span>
              <span className="shrink-0 font-medium tabular-nums">{currency(l.amount)}</span>
            </div>
          ))}
          {a.savingsToCostMultiple != null && (
            <div className="flex justify-between gap-3 border-t border-border/60 pt-1.5">
              <span className="text-muted-foreground">Savings-to-cost ratio</span>
              <span className="font-medium">{a.savingsToCostMultiple}x</span>
            </div>
          )}
          {a.multiYearSavings != null && (
            <p className="border-t border-border/60 pt-1.5 text-muted-foreground">
              Hypothetical: if the lower value held for {a.projectionYears} years, savings would
              total about {currency(a.multiYearSavings)}. Future property values and tax rates can
              change, so this is not an estimate of what you will save.
            </p>
          )}
        </div>
      </details>
    </section>
  );
}

export type SavingsFormState = {
  taxableValue: string;
  exemptionsTotal: string;
  protestCostOverride: string;
  projectionYears: string;
};

export function SavingsTaxDetailsForm({
  taxInputs,
  onSave,
}: {
  taxInputs: SavingsTaxInputs | null;
  onSave: (input: SavingsTaxInputsInput) => void;
}) {
  const [form, setForm] = useState<SavingsFormState>(() => savingsToForm(taxInputs));
  const key = JSON.stringify(taxInputs ?? {});
  useEffect(() => {
    setForm(savingsToForm(taxInputs));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof SavingsFormState, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const parse = (v: string): number | null => {
    const n = Number(v.replace(/[^0-9.-]/g, ""));
    return v.trim() !== "" && Number.isFinite(n) ? n : null;
  };
  const field = (label: string, k: keyof SavingsFormState, prefix?: string, suffix?: string) => (
    <label className="grid gap-1 text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="flex items-center rounded-md border border-border bg-background px-2 focus-within:border-accent">
        {prefix && <span className="text-muted-foreground">{prefix}</span>}
        <input
          inputMode="decimal"
          value={form[k]}
          onChange={(e) => set(k, e.target.value)}
          className="w-full bg-transparent py-1.5 text-sm outline-none"
        />
        {suffix && <span className="text-muted-foreground">{suffix}</span>}
      </span>
    </label>
  );
  return (
    <details className="rounded-lg border border-border">
      <summary className="cursor-pointer px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Adjust tax details
      </summary>
      <div className="border-t border-border/60 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {field("Taxable value (if different from appraised)", "taxableValue", "$")}
          {field("Total exemptions", "exemptionsTotal", "$")}
          {field("Other protest expenses (appraisal, travel …)", "protestCostOverride", "$")}
          {field("Years for the hypothetical multi-year figure", "projectionYears")}
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() =>
              onSave({
                taxableValue: parse(form.taxableValue),
                exemptionsTotal: parse(form.exemptionsTotal),
                protestCostOverride: parse(form.protestCostOverride),
                projectionYears: parse(form.projectionYears),
              })
            }
            className="btn-primary text-sm"
          >
            Save &amp; recalculate
          </button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Every figure here is yours — nothing is estimated. Leave a field blank to use the default
          assumption.
        </p>
      </div>
    </details>
  );
}

export function SavingsViewDetails({ a }: { a: SavingsAnalysis }) {
  const line = (k: string, v: string) => (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right font-medium tabular-nums">{v}</span>
    </div>
  );
  return (
    <details className="rounded-lg border border-border">
      <summary className="cursor-pointer px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        View details
      </summary>
      <div className="grid gap-4 border-t border-border/60 p-4 text-xs">
        <div className="grid gap-1">
          <div className="font-semibold text-foreground">Valuation Reconciliation</div>
          {line("Current CAD value", currency(a.cadValue))}
          {line(
            a.indicatedRange ? "AI-indicated range" : "AI-indicated value",
            a.indicatedRange
              ? `${currency(a.indicatedRange.low)} – ${currency(a.indicatedRange.high)}`
              : currency(a.indicatedValue),
          )}
          {line("Potential reduction", `${currency(a.reductionBase)} (${a.reductionPct}%)`)}
          {line("Value reduction basis", a.valueBasisLabel)}
        </div>
        <div className="grid gap-1">
          <div className="font-semibold text-foreground">Tax Assumptions</div>
          {line("Tax year", a.taxYear != null ? String(a.taxYear) : "—")}
          {line("Combined tax rate", `${a.taxRate.pct}%`)}
          {line("Tax rate unit", "decimal (fraction of value)")}
          {line(
            "Taxable value used",
            `${currency(a.taxableValueUsed)}${a.taxableValueAssumed ? " (assumed = appraised)" : ""}`,
          )}
          {line(
            "Exemptions applied",
            a.exemptionsApplied > 0 ? currency(a.exemptionsApplied) : "none on file",
          )}
          {line("Rate source", a.taxRate.source)}
          {line("Rate effective year", String(a.taxRate.effectiveYear))}
          {line("Taxing-entity detail", "combined county rate used — entity detail not available")}
        </div>
        <div className="grid gap-1">
          <div className="font-semibold text-foreground">Financial Analysis</div>
          {line("Estimated annual tax savings", currency(a.annualSavings))}
          {line(
            "Protest cost",
            a.protestCostSource === "none" ? "not entered" : currency(a.protestCost),
          )}
          {line("Net benefit", currency(a.netBenefit))}
          {line("ROI", a.roiPct != null ? `${a.roiPct}%` : "n/a (cost 0 or unknown)")}
          {line(
            "Savings-to-cost multiple",
            a.savingsToCostMultiple != null ? `${a.savingsToCostMultiple}x` : "n/a",
          )}
          {a.multiYearSavings != null &&
            line(
              "Potential multi-year savings",
              `${currency(a.multiYearSavings)} over ${a.projectionYears} yrs (estimate)`,
            )}
        </div>
        <div className="grid gap-1">
          <div className="font-semibold text-foreground">Confidence</div>
          {line("Valuation confidence", a.valuationConfidence)}
          {line("Tax data confidence", a.taxDataConfidence)}
          {line("Financial confidence", a.financialConfidence)}
        </div>
        <div className="grid gap-1">
          <div className="font-semibold text-foreground">Calculation Methodology</div>
          <p className="text-muted-foreground">
            Annual tax savings = value reduction × combined tax rate ={" "}
            {currency(Math.min(a.reductionBase, a.taxableValueUsed))} × {a.taxRate.pct}% ={" "}
            {currency(a.annualSavings)}.
          </p>
          {a.protestCostSource === "contingency" && (
            <p className="text-muted-foreground">
              Protest cost = 25% × annual savings = {currency(a.protestCost)}. Net benefit ={" "}
              {currency(a.annualSavings)} − {currency(a.protestCost)} = {currency(a.netBenefit)}.
            </p>
          )}
          {a.roiPct != null && (
            <p className="text-muted-foreground">
              ROI = net benefit ÷ protest cost × 100 = {currency(a.netBenefit)} ÷{" "}
              {currency(a.protestCost)} × 100 = {a.roiPct}%.
            </p>
          )}
          <ul className="mt-1 grid list-disc gap-0.5 pl-4 text-muted-foreground">
            {a.assumptions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  );
}

// Current vs estimated value as two simple bars; "See Valuation Range"
// overlays the comparable range on the estimate.
export function SavingsValueBars({ a, showRange }: { a: SavingsAnalysis; showRange: boolean }) {
  const max = Math.max(a.cadValue, a.indicatedRange?.high ?? 0) * 1.04 || 1;
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  const rows = [
    { label: "Current CAD value", value: a.cadValue, bar: "bg-slate-400 dark:bg-slate-500" },
    { label: "Estimated value", value: a.indicatedValue, bar: "bg-success" },
  ];
  return (
    <div className="grid gap-2" aria-label="Current value compared with the estimated value">
      {rows.map((r, i) => (
        <div key={r.label} className="grid grid-cols-[7.5rem_1fr] items-center gap-2 text-xs">
          <span className="text-muted-foreground">{r.label}</span>
          <div className="relative h-4 rounded bg-secondary/60">
            <div className={`h-4 rounded ${r.bar}`} style={{ width: pct(r.value) }} />
            {i === 1 && showRange && a.indicatedRange && (
              <div
                className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full border-2 border-foreground/70"
                style={{
                  left: pct(a.indicatedRange.low),
                  width: `calc(${pct(a.indicatedRange.high)} - ${pct(a.indicatedRange.low)})`,
                }}
                title="Supported valuation range"
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SavingsWorkspace({
  analysis: a,
  cost,
  findings,
  nextStep,
  cadSourceLabel,
  taxInputs,
  allowEdit,
  onSaveTaxInputs,
  onOpenModule,
  rationale,
  incomeNote,
}: {
  analysis: SavingsAnalysis;
  cost: ProtestCost;
  findings: SavingsFinding[];
  nextStep: SavingsNextStep;
  cadSourceLabel: string;
  taxInputs: SavingsTaxInputs | null;
  allowEdit: boolean;
  onSaveTaxInputs: (input: SavingsTaxInputsInput) => void;
  onOpenModule: (moduleId: string) => void;
  rationale: string | null;
  incomeNote: string | null;
}) {
  const [showRange, setShowRange] = useState(false);
  const evidence = useContext(EvidenceImpactContext);
  if (!a.sufficient) {
    return (
      <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-4">
        <div className="text-sm font-semibold text-warning-foreground">Additional Data Needed</div>
        <p className="mt-1 text-xs text-muted-foreground">
          The savings can&apos;t be estimated yet. Missing:
        </p>
        <ul className="mt-2 grid list-disc gap-1 pl-5 text-sm">
          {a.missing.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </div>
    );
  }
  const uncertain = a.uncertainReasons.length > 0;
  const low = a.scenarios[0]?.annualSavings ?? 0;
  const high = a.scenarios[2]?.annualSavings ?? a.annualSavings;
  const docCount = evidence?.evidenceCount ?? 0;
  const docReliability =
    evidence?.adjustment.applied && evidence.adjustment.strength >= 0.6
      ? "strong"
      : evidence?.adjustment.applied
        ? "moderate"
        : "not yet usable";
  const NEXT_TONE: Record<SavingsNextStep["kind"], string> = {
    potential: "border-success/40 bg-success/10",
    more_evidence: "border-warning/40 bg-warning/10",
    limited: "border-border bg-secondary/40",
  };

  return (
    <div className="mt-4 grid gap-4">
      {/* How much could I save? */}
      <section className="rounded-xl border border-success/30 bg-success/5 p-4 text-center sm:p-5">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Potential Annual Tax Savings
        </div>
        {uncertain ? (
          <div className="mt-1 font-serif text-3xl font-bold text-success sm:text-4xl">
            {currency(low)} – {currency(high)}
            <span className="text-base font-normal text-muted-foreground"> / year</span>
          </div>
        ) : (
          <div className="mt-1 font-serif text-4xl font-bold text-success sm:text-5xl">
            <AnimatedNumber value={a.annualSavings} format={currency} duration={900} />
            <span className="text-base font-normal text-muted-foreground"> / year</span>
          </div>
        )}
        <p className="mt-1 text-sm text-muted-foreground">
          {uncertain
            ? "Savings are uncertain — the range runs from no change to the strongest supported outcome."
            : "Estimated savings based on current property information."}
        </p>
        <span
          className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
            a.valuationConfidence === "High"
              ? "bg-success/15 text-success"
              : a.valuationConfidence === "Moderate"
                ? "bg-secondary text-muted-foreground"
                : "bg-warning/15 text-warning-foreground"
          }`}
        >
          {EVIDENCE_LABEL[a.valuationConfidence]}
        </span>
        {uncertain && (
          <ul className="mx-auto mt-2 grid max-w-md gap-0.5 text-left text-xs text-warning-foreground">
            {a.uncertainReasons.map((r) => (
              <li key={r} className="flex gap-1.5">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                {r}
              </li>
            ))}
          </ul>
        )}
      </section>

      {a.conflicts.length > 0 && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <div className="text-xs font-semibold text-destructive">
            Data Conflict — Review Required
          </div>
          <ul className="mt-1 grid list-disc gap-0.5 pl-5 text-xs text-muted-foreground">
            {a.conflicts.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Valuation comparison */}
      <section className="grid gap-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-border p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Current CAD Value
            </div>
            <div className="mt-0.5 text-lg font-bold tabular-nums">{currency(a.cadValue)}</div>
            <div className="text-[11px] text-muted-foreground">Verified · {cadSourceLabel}</div>
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Estimated Property Value
            </div>
            <div className="mt-0.5 text-lg font-bold tabular-nums">
              {currency(a.indicatedValue)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              Corvus AI estimate · {a.valueBasisLabel}
            </div>
          </div>
          <div className="rounded-lg border border-success/40 bg-success/5 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Potential Value Reduction
            </div>
            <div className="mt-0.5 text-lg font-bold tabular-nums text-success">
              {currency(a.reductionBase)}{" "}
              <span className="text-sm font-semibold">({a.reductionPct}%)</span>
            </div>
            <div className="text-[11px] text-muted-foreground">
              {a.taxableReduction < a.reductionBase
                ? `Lowers the taxable value by ${currency(a.taxableReduction)}`
                : "Market value reduction"}
            </div>
          </div>
        </div>
        <SavingsValueBars a={a} showRange={showRange} />
        {a.indicatedRange && (
          <button
            type="button"
            onClick={() => setShowRange((v) => !v)}
            className="justify-self-start text-xs text-accent hover:underline"
          >
            {showRange
              ? `Supported range: ${currency(a.indicatedRange.low)} – ${currency(a.indicatedRange.high)} · Hide`
              : "See Valuation Range"}
          </button>
        )}
      </section>

      {/* Why could I save? */}
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Why You May Be Paying Too Much
        </h3>
        <div className="grid gap-2 sm:grid-cols-3">
          {findings.map((f) => {
            const Icon = FINDING_ICON[f.key];
            return (
              <div key={f.key} className="flex flex-col rounded-lg border border-border p-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary">
                    <Icon className="h-3.5 w-3.5 text-foreground/80" />
                  </span>
                  <span className="text-sm font-semibold">{f.title}</span>
                </div>
                <p className="mt-2 line-clamp-3 flex-1 text-xs text-foreground/90">{f.sentence}</p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STRENGTH_STYLE[f.strength]}`}
                  >
                    {STRENGTH_LABEL[f.strength]}
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpenModule(f.module)}
                    className="text-xs text-accent hover:underline"
                  >
                    View Details
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {docCount === 0
            ? "No supporting documents uploaded yet."
            : `${docCount} supporting document${docCount === 1 ? "" : "s"} · overall reliability ${docReliability}. Documents change the estimate only when they state a value, repair cost or income figure.`}
        </p>
      </section>

      {/* What should I do next? */}
      <section className={`rounded-lg border p-4 ${NEXT_TONE[nextStep.kind]}`}>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          What Should I Do Next?
        </div>
        <div className="mt-1 font-serif text-lg font-bold">{nextStep.title}</div>
        <p className="mt-0.5 text-sm text-foreground/90">{nextStep.message}</p>
        <button
          type="button"
          onClick={() => onOpenModule(nextStep.module)}
          className="btn-primary mt-3 inline-flex items-center gap-2 text-sm"
        >
          {nextStep.button}
          <ArrowRight className="h-4 w-4" />
        </button>
      </section>

      <SavingsScenarioCards a={a} />
      <SavingsWorthIt a={a} cost={cost} />

      {/* Deeper detail, for owners who want it. */}
      <div className="grid gap-2">
        <details className="rounded-lg border border-border">
          <summary className="cursor-pointer px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            View evidence analysis
          </summary>
          <div className="border-t border-border/60 px-3 pb-3">
            <EvidenceImpactCard />
            {(rationale || incomeNote) && (
              <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
                {rationale && <p>{rationale}</p>}
                {incomeNote && <p>{incomeNote}</p>}
              </div>
            )}
          </div>
        </details>
        <details className="rounded-lg border border-border">
          <summary className="cursor-pointer px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Financial opportunity
          </summary>
          <div className="border-t border-border/60 p-3">
            <SavingsSummaryList a={a} />
          </div>
        </details>
        <SavingsViewDetails a={a} />
        {allowEdit && <SavingsTaxDetailsForm taxInputs={taxInputs} onSave={onSaveTaxInputs} />}
      </div>
    </div>
  );
}
