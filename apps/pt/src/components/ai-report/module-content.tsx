import { AnimatedNumber } from "@/components/AnimatedNumber";
import { PropertyTaxHistory } from "@/components/HistoricPropertyTaxSection";
import { ImprovementWorkspace } from "@/components/ImprovementWorkspace";
import { MarkdownLite } from "@/components/MarkdownLite";
import { StreetViewComparison } from "@/components/StreetViewComparison";
import { type HealthScoreBreakdownEntry, type HealthScoreResult } from "@/lib/ai-health-score";
import { type ModuleResultMap } from "@/lib/ai-report-modules";
import { type CompsResult } from "@/lib/cad-comps";
import { buildCaseOutcome, caseStageLabel, outcomeRouteLabel } from "@/lib/case-outcome";
import { type DocumentRecord } from "@/lib/documents";
import { computeDepreciation, getTypicalEconomicLife } from "@/lib/improvement-condition";
import { currency, type IntakeState } from "@/lib/intake-store";
import { isItemNotApplicable, type ModuleOverride } from "@/lib/module-overrides";
import { type Module } from "@/lib/modules";
import { type PropertyRecord } from "@/lib/properties";
import { protestOutcome } from "@/lib/protest-outcome";
import { type ProtestRecord } from "@/lib/protests";
import { classifyPropertyCategory, getAssessmentRatioInfo } from "@/lib/texas-tax-rates";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  BarChart3,
  CheckCircle2,
  FileText,
  Percent,
  ShieldCheck,
  Target,
  TrendingUp,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from "recharts";
import { FactBox } from "./bits";
import { AiVerdictLine, gradualScoreColor, scoreColor } from "./module-preview";
import { buildCompsSummary, ModuleAsyncState } from "./shared";
import { StrategyDetail, StrategyRankList, strategySlug } from "./strategy";
import { BuildingComponentRow, ExecutiveStat } from "./visuals";

// Part of the AI report page (src/routes/ai-report.tsx), split out of that
// file unchanged. Group: module-content.
export function SkeletonVisual() {
  return (
    <div className="grid gap-2">
      <div className="h-6 w-16 animate-pulse rounded bg-secondary/60" />
      <div className="h-3 w-28 animate-pulse rounded bg-secondary/40" />
    </div>
  );
}

// Icon per Module 1 score-breakdown label — the fixed label set the edge
// function validates against (BREAKDOWN_LABELS in ai-health-score/index.ts),
// so this mapping is safe/exhaustive rather than guessing at free AI text.
export function breakdownIcon(label: string): LucideIcon {
  switch (label) {
    case "CAD Valuation":
      return FileText;
    case "Comparable Properties":
      return BarChart3;
    case "Market Data":
      return Percent;
    case "Property Condition":
      return Wrench;
    case "Historical Valuation":
      return Activity;
    default:
      return Target;
  }
}

// Half-circle "speedometer" gauge — a full red→amber→green gradient scale
// (the property's whole possible-score range, always shown) with a bold
// scoreColor()-toned progress arc on top marking the actual score, plus the
// number centered underneath. Combines the two reference looks: reference 1's
// bold filled progress against a duller full scale, reference 2's full-width
// half-circle gradient presentation. Used for Module 1 at both a compact
// (card) and large (modal) size — replaces the old MiniGauge/RadialGauge,
// which only this module used.
export function SpeedometerGauge({
  value,
  size = "md",
}: {
  value: number;
  size?: "sm" | "md" | "lg";
}) {
  const color = gradualScoreColor(value);
  const dims =
    size === "lg"
      ? { w: 240, h: 132, bar: 16, font: "text-4xl" }
      : size === "sm"
        ? { w: 140, h: 80, bar: 10, font: "text-xl" }
        : { w: 180, h: 100, bar: 12, font: "text-2xl" };
  // Single RadialBar with chart-level `data` + the `background` prop for the
  // auto-drawn full-arc track — the same proven pattern the old MiniGauge/
  // RadialGauge used, just at a half-circle angle. An earlier version tried
  // two <RadialBar>s each with their own per-bar `data` override (one for a
  // full gradient scale, one for the value) to combine both reference looks
  // more closely, but that silently rendered zero bars in this Recharts
  // version (confirmed via a live console error and an empty sectors group)
  // — reverted in favor of this reliable single-bar approach.
  return (
    <div
      className="relative mx-auto"
      style={{
        width: dims.w,
        height: dims.h,
        filter: `drop-shadow(0 0 8px color-mix(in oklch, ${color} 45%, transparent))`,
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          cx="50%"
          cy="100%"
          startAngle={180}
          endAngle={0}
          innerRadius={dims.w / 2 - dims.bar - 4}
          outerRadius={dims.w / 2 - 4}
          barSize={dims.bar}
          data={[{ value, fill: color }]}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar background dataKey="value" cornerRadius={999} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
        <div className={`${dims.font} font-bold leading-none`} style={{ color }}>
          <AnimatedNumber value={value} />
        </div>
        <div className="text-[10px] text-muted-foreground">/100</div>
      </div>
    </div>
  );
}

// Each item's reason line is shown directly under its bar now — found live
// chasing real beta feedback ("I don't trust the estimate yet," "more
// explanation of the reasoning," asked independently by every one of 3 real
// testers): a bare "CAD Valuation 62/100" with no sentence attached gave no
// way to tell WHY, short of hunting for the same numbers somewhere else in
// the report. b.reason is deterministic (see computeHealthScore), built
// from the exact same variable that produced b.score, so it can never say
// something the number doesn't back up.
export function ScoreBreakdownList({ breakdown }: { breakdown: HealthScoreBreakdownEntry[] }) {
  if (breakdown.length === 0) return null;
  return (
    <div className="grid gap-3">
      {breakdown.map((b) => {
        const Icon = breakdownIcon(b.label);
        return (
          <div key={b.label} className="flex items-start gap-2.5">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">{b.label}</span>
                <span className="text-xs font-semibold" style={{ color: scoreColor(b.score) }}>
                  {b.score}/100
                </span>
              </div>
              <div className="mt-0.5 h-1.5 rounded-full bg-secondary/60">
                <div
                  className="h-1.5 rounded-full"
                  style={{ width: `${b.score}%`, backgroundColor: scoreColor(b.score) }}
                />
              </div>
              {b.reason && <p className="mt-1 text-xs text-muted-foreground">{b.reason}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Deterministic, real, client-side-computed numbers — never AI-written —
// straight from the same state/compsMap already loaded for this property, so
// "the data behind the score" can never be an AI paraphrase or a
// hallucinated figure. Same real fields already used to ground the AI's own
// prompt (see loadModule()'s health/strategy branch above).
export function SupportingDataGrid({
  state,
  compsMap,
}: {
  state: IntakeState;
  compsMap: { data: CompsResult | null; loading: boolean };
}) {
  const category = classifyPropertyCategory(state.propertyType);
  const ratio = getAssessmentRatioInfo(state.cad, category);
  const compsSummary = buildCompsSummary(compsMap.data);
  const sortedHistory = [...(state.valueHistory ?? [])].sort((a, b) => b.year - a.year);
  const latestPrior = sortedHistory.find(
    (h) => h.year < (state.taxYear ?? Infinity) && (h.appraisedValue ?? h.marketValue) != null,
  );
  const priorValue = latestPrior?.appraisedValue ?? latestPrior?.marketValue ?? null;
  const pctChange =
    priorValue && state.totalValue
      ? Math.round(((state.totalValue - priorValue) / priorValue) * 100)
      : null;

  const rows: { label: string; value: string }[] = [
    { label: "Current Assessed Value", value: currency(state.totalValue) },
  ];
  if (state.landValue != null || state.improvementValue != null) {
    rows.push({
      label: "Land / Improvement Split",
      value: `${currency(state.landValue)} / ${currency(state.improvementValue)}`,
    });
  }
  if (priorValue != null) {
    rows.push({
      label: `Prior Year Value (${latestPrior?.year})`,
      value: `${currency(priorValue)}${pctChange != null ? ` (${pctChange > 0 ? "+" : ""}${pctChange}%)` : ""}`,
    });
  }
  if (compsSummary) {
    rows.push({
      label: `Comparable Median (${compsSummary.count} comps)`,
      value: `${currency(compsSummary.median)} (range ${currency(compsSummary.min)}–${currency(compsSummary.max)})`,
    });
  }
  if (ratio) {
    rows.push({
      label: "County Assessment Ratio COD",
      value: `${ratio.cod.toFixed(1)} (median ${ratio.medianPct}%)`,
    });
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.label} className="rounded-md bg-secondary/40 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{r.label}</div>
          <div className="text-xs font-semibold">{r.value}</div>
        </div>
      ))}
    </div>
  );
}

// Same deterministic-not-AI principle as SupportingDataGrid — where each
// number actually came from, with a date where one is meaningful.
export function SourcesList({
  state,
  compsMap,
  evidenceDocs,
}: {
  state: IntakeState;
  compsMap: { data: CompsResult | null; loading: boolean };
  evidenceDocs: DocumentRecord[];
}) {
  const category = classifyPropertyCategory(state.propertyType);
  const items: string[] = [];
  if (state.cad) {
    items.push(`${state.cad} public records${state.taxYear ? ` (tax year ${state.taxYear})` : ""}`);
  }
  if (compsMap.data?.comps.length) {
    items.push(
      `${compsMap.data.comps.length} real comparable properties, same CAD subdivision (as of today)`,
    );
  }
  if (getAssessmentRatioInfo(state.cad, category)) {
    items.push("Texas Comptroller property value study (assessment ratio/COD data)");
  }
  if (evidenceDocs.length > 0) {
    items.push(
      `User-uploaded evidence (${evidenceDocs.length} file${evidenceDocs.length === 1 ? "" : "s"})`,
    );
  }
  if (items.length === 0) return null;
  return (
    <ul className="grid gap-1 text-xs text-muted-foreground">
      {items.map((s, i) => (
        <li key={i}>• {s}</li>
      ))}
    </ul>
  );
}

// Module 1 — deliberately minimal. Earlier drafts put a full missing-items
// checklist (per-item Upload/Link/Answer) directly in Module 1; feedback
// after seeing it built was that the page had gotten too complicated for
// what it needs to answer: "Should I protest? Why? What should I do next?"
// The one action this module offers now is a straight hop into Module 8 (the
// real evidence system) — no duplicate document list rendered here. "What
// Corvus AI Checked" still reads Module 8's real per-item status for the
// collapsed Detailed Analysis section, since that's real data worth keeping
// available, just not surfaced as a whole extra workflow up front.
export function evidenceStatusLabel(status: "Verified" | "Found" | "Missing"): string {
  return status === "Verified"
    ? "Reviewed"
    : status === "Found"
      ? "More Information Helpful"
      : "Data Not Available";
}

export function Module1Content({
  data,
  state,
  estimated,
  m,
  moduleData,
  onStartProtest,
  onReloadModule,
  onOpenModule,
  compsMap,
  evidenceDocs,
  protest,
  property,
  onViewCase,
}: {
  data: HealthScoreResult;
  state: IntakeState;
  estimated: { hasEstimate: boolean; reduction: number; savings: number };
  m: Module;
  moduleData: Record<string, ModuleAsyncState>;
  onStartProtest: () => void;
  onReloadModule: (moduleId: string) => void;
  onOpenModule: (moduleId: string) => void;
  compsMap: { data: CompsResult | null; loading: boolean };
  evidenceDocs: DocumentRecord[];
  // Once a protest exists this module reports how it went instead of pitching one.
  protest: ProtestRecord | null;
  property: PropertyRecord | null;
  onViewCase: () => void;
}) {
  const evidenceState = moduleData.evidence;
  const evidenceItems = (evidenceState?.data as ModuleResultMap["evidence"] | undefined)?.items;

  // Kick off Module 8's own analysis the first time Module 1 opens and it
  // hasn't run yet — the readiness gate below and the collapsed Detailed
  // Analysis section both need real per-property evidence status, whether or
  // not the user ever opens Module 8 directly.
  useEffect(() => {
    if (!evidenceState?.data && !evidenceState?.loading && !evidenceState?.error) {
      onReloadModule("evidence");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const criticalMissing = (evidenceItems ?? []).some(
    (it) => it.status === "Missing" && it.priority === "Critical",
  );
  const readyToProtest = data.dataSufficient && !criticalMissing;

  const tier = data.score >= 70 ? "Strong" : data.score >= 40 ? "Moderate" : "Limited";

  // Case state: nothing yet / in progress / completed.
  const caseOutcome = protest && property ? buildCaseOutcome(property, protest) : null;
  const caseDone = !!protest && protest.status === "resolved" && !!caseOutcome;
  const caseOpen = !!protest && protest.status !== "requested" && protest.status !== "resolved";
  // Same reasoning as the compact card (ModuleVisual's "health" case): once
  // the case is closed, the pre-protest opportunity score/gauge and its
  // pre-protest narrative are the wrong things to show — grade the real,
  // completed outcome instead (protest-outcome.ts).
  const outcome = caseDone && caseOutcome ? protestOutcome(caseOutcome.valueReductionPct) : null;
  const outcomeColor = outcome
    ? outcome.tone === "success"
      ? "var(--success)"
      : "var(--muted-foreground)"
    : null;

  return (
    <div className="mt-4 grid gap-5">
      {/* 1. Your Protest Recommendation — conclusion + the 3 headline numbers,
          shown as separate labelled stats. Never combined into one "$X — Y%"
          string: a dollar amount and a percentage are two different numbers
          and reading them as one implies a relationship that isn't real. */}
      <div>
        {outcome ? (
          <AiVerdictLine icon={m.icon} text={outcome.message} color={m.color} />
        ) : (
          data.executiveConclusion && (
            <AiVerdictLine icon={m.icon} text={data.executiveConclusion} color={m.color} />
          )
        )}
        <div className="mt-3 grid gap-4 sm:grid-cols-[13rem_1fr] items-center">
          <div className="text-center">
            {outcome ? (
              <div className="grid h-[132px] place-items-center">
                <div className="font-serif text-2xl font-bold" style={{ color: outcomeColor! }}>
                  {outcome.label}
                </div>
              </div>
            ) : (
              <SpeedometerGauge value={data.score} size="lg" />
            )}
            <div
              className="mt-1 text-sm font-semibold"
              style={{ color: outcome ? outcomeColor! : scoreColor(data.score) }}
            >
              {caseDone ? "Protest completed" : `${tier} Protest Opportunity`}
            </div>
          </div>
          <div className="@container min-w-0">
            <div className="grid grid-cols-1 gap-3 @[28rem]:grid-cols-3">
              {caseDone && caseOutcome ? (
                <>
                  <Stat
                    label="Actual Tax Savings"
                    value={caseOutcome.taxSavings != null ? currency(caseOutcome.taxSavings) : "—"}
                    tone="success"
                  />
                  <Stat
                    label="Assessment Reduction"
                    value={
                      caseOutcome.valueReductionPct != null
                        ? `${Math.round(caseOutcome.valueReductionPct)}%`
                        : "—"
                    }
                  />
                  <Stat
                    label="Final Assessed Value"
                    value={caseOutcome.finalValue != null ? currency(caseOutcome.finalValue) : "—"}
                  />
                </>
              ) : (
                <>
                  <Stat
                    label="Potential Tax Savings"
                    value={
                      estimated.hasEstimate ? currency(estimated.savings) : "Not yet available"
                    }
                    tone="success"
                  />
                  <Stat
                    label="Potential Assessment Reduction"
                    value={
                      estimated.hasEstimate && state.totalValue
                        ? `~${Math.round((estimated.reduction / state.totalValue) * 100)}%`
                        : "Not yet available"
                    }
                  />
                  <Stat
                    label="Current Assessed Value"
                    value={state.totalValue ? currency(state.totalValue) : "—"}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 2. Why — the reasons, plus confidence folded in as one compact line
          rather than its own separate meter card. */}
      {data.factorsIncreasing.length > 0 && (
        <div className="rounded-lg bg-success/10 p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-success">
            <TrendingUp className="h-3.5 w-3.5" />
            Why
          </div>
          <ul className="grid gap-2 text-sm text-foreground/90">
            {data.factorsIncreasing.map((f, i) => {
              const explanation = data.factorExplanations?.[i];
              return (
                <li key={i} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  <div className="min-w-0">
                    <div className="font-semibold text-foreground">
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                    </div>
                    {explanation && (
                      <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        <MarkdownLite text={explanation} />
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex items-start gap-1.5 border-t border-success/20 pt-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <span className="font-semibold text-foreground">
                Confidence: {data.confidencePct}%
              </span>{" "}
              — how complete the information behind this score is, not the odds of winning.
              {!data.dataSufficient &&
                (data.confidenceReasoning
                  ? ` More information needed: ${data.confidenceReasoning}`
                  : " More information needed.")}
            </span>
          </div>
        </div>
      )}

      {/* 3. Recommended Next Step — large and unambiguous, one action only. */}
      <div
        className={`rounded-lg p-5 ${caseDone || caseOpen || readyToProtest ? "bg-primary text-primary-foreground" : m.color.bg}`}
      >
        {caseDone && protest && caseOutcome ? (
          <>
            <div className="text-xs font-semibold uppercase tracking-wide opacity-80">
              Protest completed
            </div>
            <p className="mt-2 text-lg font-semibold">
              Final value {currency(caseOutcome.finalValue)}
              {caseOutcome.taxSavings
                ? ` — about ${currency(caseOutcome.taxSavings)}/yr saved`
                : ""}
            </p>
            <button
              onClick={onViewCase}
              className="btn-accent mt-3 w-full text-base font-bold sm:w-auto"
            >
              VIEW CASE OUTCOME
            </button>
            <p className="mt-3 text-sm opacity-90">
              Resolved through {outcomeRouteLabel(protest)}. Your property returns to tax monitoring
              for next year.
            </p>
          </>
        ) : caseOpen && protest ? (
          <>
            <div className="text-xs font-semibold uppercase tracking-wide opacity-80">
              Your protest is in progress
            </div>
            <p className="mt-2 text-lg font-semibold">Stage: {caseStageLabel(protest)}</p>
            <button
              onClick={onViewCase}
              className="btn-accent mt-3 w-full text-base font-bold sm:w-auto"
            >
              VIEW CASE
            </button>
            <p className="mt-3 text-sm opacity-90">
              Open the case to see what to do next and to keep everything in one place.
            </p>
          </>
        ) : readyToProtest ? (
          <>
            <div className="text-xs font-semibold uppercase tracking-wide opacity-80">
              Corvus AI Recommends a Protest
            </div>
            <button
              onClick={onStartProtest}
              className="btn-accent mt-3 w-full text-base font-bold sm:w-auto"
            >
              START MY PROTEST
            </button>
            <p className="mt-3 text-sm opacity-90">
              Depending on your subscription, Corvus AI or our team handles the filing, county
              communication, hearing support, and settlement coordination.
            </p>
          </>
        ) : (
          <>
            <div className={`text-xs font-semibold uppercase tracking-wide ${m.color.text}`}>
              Recommended Next Step
            </div>
            <p className="mt-1 text-sm font-semibold">
              Complete the missing property information so Corvus AI can finish your protest
              analysis.
            </p>
            <div className="mt-3">
              <button
                onClick={() => onOpenModule("evidence")}
                className="btn-accent text-sm font-bold"
              >
                Upload Property Information
              </button>
            </div>
          </>
        )}
      </div>

      {/* Historic Property Tax — 5+ years of values and taxes, with the 10% /
          20% / 30% increase triggers and their AI insight. */}
      <PropertyTaxHistory
        propertyId={property?.id ?? null}
        address={state.address ?? property?.address ?? ""}
        cad={state.cad ?? property?.cad ?? null}
        propertyType={state.propertyType ?? null}
        valueHistory={state.valueHistory ?? []}
        taxYear={state.taxYear ?? null}
        totalValue={state.totalValue ?? null}
        onStartProtest={protest ? undefined : onStartProtest}
      />

      {/* 4. Detailed Analysis — collapsed by default; native <details> since
          nothing outside this block needs to control whether it's open. */}
      <details className="card-elev overflow-hidden p-0">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
          <div className="flex items-center justify-between gap-2">
            <span>
              What Corvus AI Checked
              {evidenceItems && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {evidenceItems.length + data.scoreBreakdown.length} property and valuation factors
                  analyzed
                </span>
              )}
            </span>
            <span className="shrink-0 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground shadow-sm transition-[filter] hover:brightness-110">
              See Analysis Details
            </span>
          </div>
        </summary>
        <div className="grid gap-4 border-t border-border/60 p-4">
          {evidenceItems && evidenceItems.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                What Corvus AI Checked
              </div>
              <ul className="grid gap-1.5 text-xs">
                {evidenceItems.map((it) => (
                  <li key={it.item} className="flex items-center justify-between gap-2">
                    <span className="truncate">{it.item}</span>
                    <span
                      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        it.status === "Verified"
                          ? "bg-success/15 text-success"
                          : it.status === "Found"
                            ? "bg-accent/15 text-accent"
                            : "bg-secondary/60 text-muted-foreground"
                      }`}
                    >
                      {evidenceStatusLabel(it.status)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.scoreBreakdown.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Score Breakdown
              </div>
              <ScoreBreakdownList breakdown={data.scoreBreakdown} />
            </div>
          )}

          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Supporting Data
            </div>
            <SupportingDataGrid state={state} compsMap={compsMap} />
          </div>

          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Sources
            </div>
            <SourcesList state={state} compsMap={compsMap} evidenceDocs={evidenceDocs} />
          </div>

          {data.methodology && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                AI Methodology
              </div>
              <MarkdownLite className="text-xs text-muted-foreground" text={data.methodology} />
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: "success" }) {
  return (
    <div
      className={`min-w-0 rounded-xl p-4 @[44rem]:p-5 ${tone === "success" ? "bg-success/10" : "bg-secondary/40"}`}
    >
      <div
        className={`text-xs font-semibold uppercase tracking-wide ${tone === "success" ? "text-success" : "text-muted-foreground"}`}
      >
        {label}
      </div>
      <div
        className={`mt-1.5 break-words font-serif text-2xl font-bold leading-tight tabular-nums @[28rem]:text-xl @[36rem]:text-2xl @[44rem]:text-3xl ${tone === "success" ? "text-success" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

// Module 2 — same philosophy as Module 1's simplified layout: lead with the
// plain recommendation, keep the full per-strategy breakdown (evidence
// upload/answer per strategy, the ranked list) collapsed by default rather
// than shown up front. Unlike Module 1 (one opportunity score), a property
// can genuinely have more than one strategy worth pursuing at once, so the
// headline card lists every strategy strong enough to feature — not just
// the top-ranked one — rather than picking a single winner.
export const STRATEGY_FEATURE_THRESHOLD = 40;

export function strategyTier(score: number): string {
  return score >= 70 ? "Strong" : score >= STRATEGY_FEATURE_THRESHOLD ? "Moderate" : "Limited";
}

export function Module2Content({
  d,
  m,
  state,
  evidenceDocs,
  uploadingEvidence,
  onUploadEvidence,
  onAnswerStrategy,
  onForceReload,
  onOpenModule,
  onAskQuestion,
  refreshing,
}: {
  d: ModuleResultMap["strategy"];
  m: Module;
  state: IntakeState;
  evidenceDocs: DocumentRecord[];
  uploadingEvidence: boolean;
  onUploadEvidence: (files: File[], strategyId?: string, documentTypeOverride?: string) => void;
  onAnswerStrategy: (strategyId: string, answer: string) => void;
  onForceReload: () => void;
  onOpenModule: (moduleId: string) => void;
  onAskQuestion: (moduleId: string, question: string) => Promise<string>;
  refreshing: boolean;
}) {
  const featured = d.strategies.filter((s) => s.strengthScore >= STRATEGY_FEATURE_THRESHOLD);
  const shown = featured.length > 0 ? featured : d.strategies.slice(0, 1);
  const needsMoreInfo = shown.some((s) => !s.dataSufficient || s.missingEvidence.length > 0);
  // Clicking a featured strategy opens "What Corvus AI Checked" and scrolls
  // to that strategy's own detailed card, briefly highlighted.
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const showStrategyDetail = (name: string) => {
    if (detailsRef.current) detailsRef.current.open = true;
    setHighlighted(name);
    requestAnimationFrame(() =>
      document
        .getElementById(`strategy-detail-${strategySlug(name)}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
    window.setTimeout(() => setHighlighted((h) => (h === name ? null : h)), 2000);
  };

  return (
    <div className="mt-4 grid gap-5">
      {/* 1. Recommendation — every strategy worth featuring, not just #1. */}
      <div>
        {d.topStrategySummary && (
          <AiVerdictLine icon={m.icon} text={d.topStrategySummary} color={m.color} />
        )}
        <div className="mt-3 grid gap-2">
          {shown.map((s) => (
            <button
              key={s.name}
              type="button"
              onClick={() => showStrategyDetail(s.name)}
              className="card-elev block w-full p-4 text-left transition-colors hover:border-accent/50 hover:bg-accent/5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">{s.name}</h3>
                <span
                  className="text-xs font-semibold"
                  style={{ color: scoreColor(s.strengthScore) }}
                >
                  {strategyTier(s.strengthScore)} · {s.confidencePct}% confidence
                </span>
              </div>
              {s.primaryReason && (
                <p className="mt-1 text-sm text-muted-foreground">{s.primaryReason}</p>
              )}
              <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-accent">
                View detailed analysis <ArrowDown className="h-3 w-3" />
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* 2. Recommended Next Step — one action only. */}
      <div
        className={`rounded-lg p-5 ${needsMoreInfo ? m.color.bg : "bg-primary text-primary-foreground"}`}
      >
        {needsMoreInfo ? (
          <>
            <div className={`text-xs font-semibold uppercase tracking-wide ${m.color.text}`}>
              Recommended Next Step
            </div>
            <p className="mt-1 text-sm font-semibold">
              Complete the missing property information so Corvus AI can finish evaluating these
              strategies.
            </p>
            <div className="mt-3">
              <button
                onClick={() => onOpenModule("evidence")}
                className="btn-accent text-sm font-bold"
              >
                Upload Property Information
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="text-xs font-semibold uppercase tracking-wide opacity-80">
              Corvus AI Recommends These Strategies
            </div>
            <p className="mt-1 text-sm opacity-90">
              {shown.length === 1
                ? "This strategy is ready to support your protest."
                : "These strategies are ready to support your protest."}
            </p>
          </>
        )}
      </div>

      {/* 3. Detailed Analysis — collapsed by default; the full ranked list
          and every per-strategy evidence card, unchanged. */}
      <details ref={detailsRef} className="card-elev overflow-hidden p-0">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
          <div className="flex items-center justify-between gap-2">
            <span>
              What Corvus AI Checked
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {d.strategies.length} strateg{d.strategies.length === 1 ? "y" : "ies"} evaluated
              </span>
            </span>
            <span className="shrink-0 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground shadow-sm transition-[filter] hover:brightness-110">
              See Analysis Details
            </span>
          </div>
        </summary>
        <div className="grid gap-4 border-t border-border/60 p-4 [&>*]:min-w-0">
          <div className="card-elev min-w-0 p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Ranked Strategies
            </div>
            {/* Unlike the compact card's own StrategyRankList (one consolidated
                "Upload data" button instead), this detail-view list has room for
                each row's own "Data Needed" pill to actually DO something — same
                per-strategy upload StrategyDetail's own card below already
                offers, just reachable straight from the summary row instead of
                only after scrolling to find the matching detail card. */}
            <StrategyRankList
              strategies={d.strategies}
              color={m.color}
              onUploadFor={(s, files) => onUploadEvidence(files, strategySlug(s.name))}
              uploading={uploadingEvidence}
            />
          </div>
          <div className="grid gap-3 [&>*]:min-w-0">
            {d.strategies.map((s, i) => (
              <div
                key={s.name}
                id={`strategy-detail-${strategySlug(s.name)}`}
                className={`scroll-mt-4 rounded-xl transition-shadow duration-500 ${
                  highlighted === s.name ? "ring-2 ring-accent ring-offset-2" : ""
                }`}
              >
                <StrategyDetail
                  s={s}
                  rank={i + 1}
                  color={m.color}
                  evidenceDocs={evidenceDocs}
                  uploadingEvidence={uploadingEvidence}
                  onUploadEvidence={onUploadEvidence}
                  answer={state.strategyAnswers?.[strategySlug(s.name)]}
                  onAnswerStrategy={onAnswerStrategy}
                  onRefresh={onForceReload}
                  refreshing={refreshing}
                  onOpenModule={onOpenModule}
                  onAskQuestion={onAskQuestion}
                />
              </div>
            ))}
          </div>
        </div>
      </details>
    </div>
  );
}

// Module 5 — same philosophy as Modules 1/2: lead with what Corvus actually
// found about the building, what it means for value, and how that compares
// to the CAD's own improvement value; push the technical machinery (effective
// age, economic life, physical/functional/external depreciation — the real
// deterministic math in computeDepreciation) into a collapsed Detailed
// Analysis section. One upload path — straight into Module 8 — rather than a
// per-component category picker; the evidence system re-tags and re-runs this
// module's analysis on its own once new photos/documents land.
export function Module5Content({
  d,
  m,
  state,
  overrides,
  onMarkNotApplicable,
  onClearNotApplicable,
  improvementDocs,
  onOpenModule,
  workspace,
}: {
  d: ModuleResultMap["improvement"];
  m: Module;
  state: IntakeState;
  overrides: ModuleOverride[];
  onMarkNotApplicable: (moduleId: string, itemKey?: string) => void;
  onClearNotApplicable: (moduleId: string, itemKey?: string) => void;
  improvementDocs: DocumentRecord[];
  onOpenModule: (moduleId: string) => void;
  // the building records workspace (uploads, details, condition records)
  workspace: {
    propertyId: string;
    userId: string | null;
    canEdit: boolean;
    onApply: () => void;
  } | null;
}) {
  const [hasRecords, setHasRecords] = useState(false);
  const economicLife = getTypicalEconomicLife(state.propertyType);
  const depreciation = computeDepreciation(
    d.effectiveAgeYears,
    economicLife,
    d.functionalObsolescencePct,
    d.externalObsolescencePct,
    state.improvementValue ?? null,
  );

  const missingComponents = d.buildingComponents.filter((c) => !c.hasPhoto && !c.notApplicable);
  const hasRealMetrics =
    d.effectiveAgeYears != null ||
    d.functionalObsolescencePct != null ||
    d.externalObsolescencePct != null;
  const hasValueImpact =
    depreciation.conditionAdjustedValue != null && state.improvementValue != null;
  const needsMoreInfo = missingComponents.length > 0 || !hasRealMetrics;
  // no photos, no confirmed records: a score would be a default, not a finding
  const insufficient = !hasRecords && !d.buildingComponents.some((c) => c.hasPhoto);

  const affectingValue = [
    d.functionalObsolescencePct != null ? d.functionalObsolescenceBasis : null,
    d.externalObsolescencePct != null ? d.externalObsolescenceBasis : null,
  ].filter((s): s is string => !!s);

  return (
    <div className="mt-4 grid gap-5">
      {workspace && (
        <ImprovementWorkspace
          propertyId={workspace.propertyId}
          userId={workspace.userId}
          canEdit={workspace.canEdit}
          address={state.address ?? null}
          propertyType={state.propertyType ?? null}
          recordFacts={{
            yearBuilt: state.yearBuilt ?? null,
            buildingSqft: state.buildingSqft ?? null,
          }}
          onApply={workspace.onApply}
          onEvidenceChange={setHasRecords}
        />
      )}
      {/* 1. What We Found — the building itself, component by component. */}
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          AI Findings
        </div>
        {d.guidance && <AiVerdictLine icon={m.icon} text={d.guidance} color={m.color} />}
        <div className="mt-3 flex flex-col items-center">
          {insufficient ? (
            <div className="rounded-lg bg-secondary/50 px-4 py-3 text-center">
              <div className="text-sm font-semibold">Insufficient Information</div>
              <div className="text-xs text-muted-foreground">
                No condition score yet — add photos, a report or component conditions above.
              </div>
            </div>
          ) : (
            <>
              <SpeedometerGauge value={d.priorityScore} size="md" />
              <div className="-mt-1 text-xs text-muted-foreground">Condition Priority</div>
            </>
          )}
        </div>
        <div className="mt-3 grid gap-1.5">
          {d.buildingComponents.map((c) => (
            <BuildingComponentRow
              key={c.component}
              c={
                !c.hasPhoto && isItemNotApplicable(overrides, "improvement", c.component)
                  ? { ...c, notApplicable: true }
                  : c
              }
              onMarkNotApplicable={() => onMarkNotApplicable("improvement", c.component)}
              onClearNotApplicable={() => onClearNotApplicable("improvement", c.component)}
            />
          ))}
        </div>
      </div>

      {/* Street View: the visible exterior against the nearest comparables. */}
      <StreetViewComparison
        address={state.address}
        cad={state.cad}
        accountNumber={state.accountNumber}
        totalValue={state.totalValue}
      />

      {/* 2. What May Be Affecting Its Value — real AI-grounded findings only. */}
      {affectingValue.length > 0 && (
        <div className="rounded-lg bg-warning/10 p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-warning-foreground">
            <AlertTriangle className="h-3.5 w-3.5" />
            What May Be Affecting Its Value
          </div>
          <ul className="grid gap-1 text-xs text-foreground/90">
            {affectingValue.map((s, i) => (
              <li key={i}>• {s}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 3. How It Compares With the CAD Value — only ever shown once real
          numbers exist; never a placeholder row. */}
      {hasValueImpact && (
        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            How It Compares With the CAD Value
          </div>
          <div className="grid grid-cols-3 gap-2">
            <FactBox
              label="CAD Improvement Value"
              value={
                state.improvementValue == null ? "Not Available" : currency(state.improvementValue)
              }
            />
            <FactBox
              label="Condition-Adjusted Value"
              value={currency(depreciation.conditionAdjustedValue)}
            />
            <FactBox
              label="Impact"
              value={`${currency(depreciation.impactDollar ?? 0)} (${depreciation.impactPct}%)`}
            />
          </div>
        </div>
      )}

      {/* 4. Evidence Supporting Our Finding */}
      {improvementDocs.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Evidence Supporting Our Finding
          </div>
          <ul className="grid gap-1 text-xs">
            {improvementDocs.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-2">
                <span className="truncate text-muted-foreground">{doc.fileName}</span>
                <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {doc.documentType?.replace(/^Improvement:\s*/, "") ?? "Improvement Evidence"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 5. Corvus AI's Finding — the conclusion: does the evidence support a
          lower value, or is more still needed. */}
      {d.keyFinding && (
        <div className={`rounded-lg p-4 ${m.color.bg}`}>
          <div className={`text-[10px] font-semibold uppercase tracking-wide ${m.color.text}`}>
            Corvus AI's Finding
          </div>
          <p className="mt-1 text-sm text-foreground/90">{d.keyFinding}</p>
        </div>
      )}

      {/* 6. Recommended Next Step — one action only. */}
      {needsMoreInfo && (
        <div className={`rounded-lg p-5 ${m.color.bg}`}>
          <div className={`text-xs font-semibold uppercase tracking-wide ${m.color.text}`}>
            Recommended Next Step
          </div>
          <p className="mt-1 text-sm font-semibold">
            {missingComponents.length > 0
              ? `Add photos of the ${missingComponents.map((c) => c.component.toLowerCase()).join(", ")} — or upload an inspection report — so Corvus AI can assess them.`
              : "Record component conditions or upload an inspection report so Corvus AI can finish the condition analysis."}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Missing photos don&apos;t mean poor condition — they just leave it unassessed.
          </p>
          <div className="mt-3">
            <button
              onClick={() =>
                workspace
                  ? document
                      .getElementById("improvement-uploads")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" })
                  : onOpenModule("evidence")
              }
              className="btn-accent text-sm font-bold"
            >
              Upload Photos / Report
            </button>
          </div>
        </div>
      )}

      {/* 7. Detailed Analysis — collapsed by default; the background math
          (effective age, economic life, depreciation) the customer never
          needs to read to understand the conclusion above. */}
      {hasRealMetrics && (
        <details className="card-elev overflow-hidden p-0">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
            <div className="flex items-center justify-between gap-2">
              <span>Analysis Details</span>
              <span className="text-xs font-normal text-accent">Effective age, depreciation</span>
            </div>
          </summary>
          <div className="grid grid-cols-2 gap-2 border-t border-border/60 p-4 sm:grid-cols-3">
            <ExecutiveStat
              label="Effective Age"
              value={
                d.effectiveAgeYears != null
                  ? `${d.effectiveAgeYears} yrs`
                  : "Additional Data Needed"
              }
            />
            <ExecutiveStat
              label="Economic Life"
              value={`${economicLife.typical} yrs (${economicLife.min}-${economicLife.max} typical)`}
            />
            <ExecutiveStat
              label="Physical Depreciation"
              value={
                depreciation.physicalDepreciationPct != null
                  ? `${depreciation.physicalDepreciationPct}%`
                  : "Additional Data Needed"
              }
            />
            <ExecutiveStat
              label="Functional Obsolescence"
              value={
                d.functionalObsolescencePct != null
                  ? `${d.functionalObsolescencePct}%`
                  : "Additional Data Needed"
              }
            />
            <ExecutiveStat
              label="External Obsolescence"
              value={
                d.externalObsolescencePct != null
                  ? `${d.externalObsolescencePct}%`
                  : "Additional Data Needed"
              }
            />
            <ExecutiveStat
              label="Total Depreciation"
              value={
                depreciation.totalDepreciationPct != null
                  ? `${depreciation.totalDepreciationPct}%`
                  : "Additional Data Needed"
              }
            />
          </div>
        </details>
      )}
    </div>
  );
}
