import { CaseResultContext } from "@/components/CaseOutcomeBanner";
import { MarkdownLite } from "@/components/MarkdownLite";
import { ProgressRing } from "@/components/ProgressRing";
import { type HealthScoreResult } from "@/lib/ai-health-score";
import { type ModuleResultMap } from "@/lib/ai-report-modules";
import { type CompsResult } from "@/lib/cad-comps";
import { computeComparableStats } from "@/lib/comps-analysis";
import { getDefenseReadinessScore, getExecutiveSummary } from "@/lib/executive-summary";
import { type GeocodedPoint } from "@/lib/geocode";
import { computeDepreciation, getTypicalEconomicLife } from "@/lib/improvement-condition";
import { type IncomeAnalysis, type IncomeAnalysisInput } from "@/lib/income-analysis";
import { incomeSupportsCad, type IncomeApproach } from "@/lib/income-approach";
import { currency } from "@/lib/intake-store";
import { isModuleNotApplicable, type ModuleOverride } from "@/lib/module-overrides";
import { type Module } from "@/lib/modules";
import { protestOutcome } from "@/lib/protest-outcome";
import { type SavingsAnalysis } from "@/lib/savings-analysis";
import { countDataGaps, pickHeadlineFactor } from "@/lib/site-condition";
import { type SiteGisResult } from "@/lib/site-gis";
import {
  ArrowDown,
  ArrowRight,
  CheckCircle2,
  Lock,
  MapPin,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useContext } from "react";
import { CompsValueScatter } from "./comps";
import { breakdownIcon, compactCurrency, moduleInsight, scoreColor } from "./helpers";
import { IncomeCardVisual, IncomeLadderPreview } from "./income";
import { SkeletonVisual, SpeedometerGauge } from "./module-content";

import { SavingsCardVisual } from "./savings";
import { ModuleAsyncState } from "./shared";
import { StrategyRankList } from "./strategy";
import {
  EvidenceQuadrant,
  FloodZoneBadge,
  FormulaChain,
  ImprovementCardVisual,
  InsightBanner,
  MiniMeter,
  NumberBadge,
  SiteImpactChain,
  SiteMapThumb,
} from "./visuals";
import { ZoningAspectTiles } from "./zoning";

// Part of the AI report page (src/routes/ai-report.tsx), split out of that
// file unchanged. Group: module-card.
export function ModuleCard({
  m,
  unlocked,
  hasFullAccess,
  moduleState,
  moduleData,
  compsMap,
  siteGisMap,
  siteCoords,
  estimated,
  propertyType,
  address,
  totalValue,
  improvementValue,
  overrides,
  incomeComputed,
  incomeAnalysis,
  savingsAnalysis,
  uploadingEvidence,
  onUploadEvidence,
  onSaveIncomeAnalysis,
  onOpen,
  onForceReload,
}: {
  m: Module;
  unlocked: boolean;
  hasFullAccess: boolean;
  moduleState: ModuleAsyncState | undefined;
  moduleData: Record<string, ModuleAsyncState>;
  compsMap: { data: CompsResult | null; loading: boolean };
  siteGisMap: { data: SiteGisResult | null; loading: boolean };
  siteCoords: GeocodedPoint | null;
  estimated: {
    hasEstimate: boolean;
    reduction: number;
    savings: number;
    rationale: string | null;
    effectiveTaxRatePct: number;
  };
  propertyType?: string;
  address?: string | null;
  totalValue?: number | null;
  improvementValue?: number | null;
  overrides: ModuleOverride[];
  incomeComputed: IncomeApproach;
  incomeAnalysis: IncomeAnalysis | null;
  savingsAnalysis: SavingsAnalysis;
  uploadingEvidence: boolean;
  onUploadEvidence: (files: File[], strategyId?: string, documentTypeOverride?: string) => void;
  onSaveIncomeAnalysis: (input: IncomeAnalysisInput) => void;
  onOpen: () => void;
  onForceReload: () => void;
}) {
  const caseResult = useContext(CaseResultContext);
  // Reflects what's actually happening now that the grid eager-loads real
  // data (see the effect above Report()), not the old static per-module
  // metadata — "Completed" used to show even for a module nobody had opened
  // yet, before it had actually run.
  const status: CardStatus = !unlocked
    ? "Locked"
    : m.id === "income"
      ? isModuleNotApplicable(overrides, "income")
        ? "Not Applicable"
        : !incomeComputed.dataComplete
          ? "Needs Data"
          : !moduleState || moduleState.loading
            ? "Analyzing"
            : moduleState.error
              ? "Error"
              : "Completed"
      : m.id === "savings"
        ? "Completed"
        : !moduleState || moduleState.loading
          ? "Analyzing"
          : moduleState.error
            ? "Error"
            : "Completed";
  const insight =
    unlocked && caseResult && m.id === "health"
      ? "Protest completed"
      : unlocked
        ? moduleInsight(
            m,
            moduleState,
            compsMap,
            estimated,
            totalValue,
            overrides,
            incomeComputed,
            savingsAnalysis,
          )
        : null;
  // Module 2's own score for this module's strategy, once it's resolved — see
  // the priorityContext sequencing in loadModule()/the eager-load effects
  // above. Only comps/site/improvement/income/zoning map to one of Module 2's
  // 5 fixed strategies; other modules never show this badge.
  const strategyData = moduleData.strategy?.data as ModuleResultMap["strategy"] | undefined;
  const priorityScore = strategyData?.strategies.find((s) =>
    s.relatedModules.includes(m.id),
  )?.strengthScore;
  return (
    // A square tile with highlights only — the full analysis opens with
    // View Details. A locked card has nothing to show yet, so it's only as
    // tall as its header, lock line and Subscribe button (no empty square).
    <div
      className={`card-elev relative flex flex-col self-start overflow-hidden transition-all hover:shadow-elev ${unlocked ? "aspect-square self-auto" : ""}`}
    >
      {/* A strip in the module's own colour along the top. */}
      <div aria-hidden className={`h-1.5 bg-current ${m.color.text}`} />
      {unlocked && (
        <m.icon
          aria-hidden
          className={`pointer-events-none absolute -bottom-3 right-3 h-24 w-24 opacity-[0.06] ${m.color.text}`}
        />
      )}
      <div className="flex min-h-0 flex-1 flex-col p-5 pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <ProgressRing
              percent={status === "Completed" ? 100 : status === "Analyzing" ? 35 : 0}
              spinning={status === "Analyzing"}
              className={m.color.text}
            >
              <NumberBadge n={m.n} color={m.color} size="lg" />
            </ProgressRing>
            {/* Wraps instead of truncating — confirmed live on a narrow
                mobile card that even the already-shortened names ("Zoning &
                Classification", "Executive Protest Report") still don't fit
                one line alongside the status chip/refresh button, and
                ellipsis-cutting a module's own name reads far worse than two
                short lines. Every real shortName is only 2-4 words, so this
                only ever wraps on the rare tight case, not routinely. */}
            <h3 className="min-w-0 font-serif text-sm font-bold uppercase tracking-wide">
              {m.shortName}
            </h3>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {priorityScore != null && (
              <span
                className="whitespace-nowrap text-[10px] font-semibold"
                style={{ color: scoreColor(priorityScore) }}
                title="Strategy module's priority ranking for this argument"
              >
                Priority {priorityScore}
              </span>
            )}
            <StatusChip status={status} />
            {/* Hidden for a locked/gated card (nothing to refetch), "Needs
                Data"/"Not Applicable" (income — that's a P&L upload gate,
                not an AI call this page ever fires, whether or not the user
                has marked it not applicable), and "savings" (deterministic,
                no AI call at all — loadModule() no-ops for it). Spins in
                place, doubling as the loading indicator the user asked for,
                and doubles as a one-click retry for a genuinely slow/stuck
                module without having to open the modal's own Retry
                button. */}
            {unlocked &&
              m.id !== "savings" &&
              status !== "Locked" &&
              status !== "Needs Data" &&
              status !== "Not Applicable" && (
                <button
                  type="button"
                  onClick={onForceReload}
                  disabled={status === "Analyzing"}
                  title={status === "Analyzing" ? "Analyzing…" : "Regenerate this module"}
                  aria-label={status === "Analyzing" ? "Analyzing" : "Regenerate this module"}
                  className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${status === "Analyzing" ? "animate-spin" : ""}`}
                  />
                </button>
              )}
          </div>
        </div>
        <div
          className={`relative mt-3 flex min-h-0 flex-col overflow-hidden ${unlocked ? "flex-1" : ""}`}
        >
          <ModuleVisual
            m={m}
            unlocked={unlocked}
            moduleState={moduleState}
            moduleData={moduleData}
            compsMap={compsMap}
            siteGisMap={siteGisMap}
            siteCoords={siteCoords}
            estimated={estimated}
            propertyType={propertyType}
            address={address}
            totalValue={totalValue}
            improvementValue={improvementValue}
            overrides={overrides}
            incomeComputed={incomeComputed}
            incomeAnalysis={incomeAnalysis}
            savingsAnalysis={savingsAnalysis}
            uploadingEvidence={uploadingEvidence}
            onUploadEvidence={onUploadEvidence}
            onSaveIncomeAnalysis={onSaveIncomeAnalysis}
            hasFullAccess={hasFullAccess}
            onOpen={onOpen}
          />
          {unlocked && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-card to-transparent"
            />
          )}
        </div>
      </div>
      {insight && <InsightBanner text={insight} color={m.color} onClick={onOpen} />}
      <div className="flex items-center justify-end gap-2 px-5 pb-4 pt-3">
        {/* The colored insight band above is the big affordance; this stays
            as the explicit, always-present control — a subtle text link for
            an unlocked module, the real "Subscribe" CTA for a locked one. */}
        {unlocked ? (
          <button
            onClick={onOpen}
            className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline"
          >
            View Details <ArrowRight className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button onClick={onOpen} className="btn-outline text-sm py-2">
            Subscribe to unlock
          </button>
        )}
      </div>
    </div>
  );
}

export type CardStatus =
  "Locked" | "Analyzing" | "Completed" | "Needs Data" | "Not Applicable" | "Error";

export function StatusChip({ status }: { status: CardStatus }) {
  const map: Record<CardStatus, string> = {
    Locked: "bg-secondary text-muted-foreground",
    Analyzing: "bg-secondary text-muted-foreground",
    Completed: "bg-success/15 text-success",
    "Needs Data": "bg-warning/20 text-warning-foreground",
    "Not Applicable": "bg-secondary text-muted-foreground",
    Error: "bg-destructive/10 text-destructive",
  };
  return (
    <span
      className={`text-[10px] font-semibold px-2 py-1 rounded-full whitespace-nowrap ${map[status]}`}
    >
      {status}
    </span>
  );
}

// The small, glanceable visual each overview card shows in place of the old
// paragraph of teaser text — real data once loaded (see the eager-load
// effect above Report()), a skeleton while it's in flight, and a lock
// (never a fetch attempt) for gated modules nobody has subscribed to yet.
export function ModuleVisual({
  m,
  unlocked,
  moduleState,
  moduleData,
  compsMap,
  siteGisMap,
  siteCoords,
  estimated,
  propertyType,
  address,
  totalValue,
  improvementValue,
  overrides,
  incomeComputed,
  incomeAnalysis,
  savingsAnalysis,
  uploadingEvidence,
  onUploadEvidence,
  onSaveIncomeAnalysis,
  hasFullAccess,
  onOpen,
}: {
  m: Module;
  unlocked: boolean;
  hasFullAccess: boolean;
  moduleState: ModuleAsyncState | undefined;
  moduleData: Record<string, ModuleAsyncState>;
  compsMap: { data: CompsResult | null; loading: boolean };
  siteGisMap: { data: SiteGisResult | null; loading: boolean };
  siteCoords: GeocodedPoint | null;
  estimated: {
    hasEstimate: boolean;
    reduction: number;
    savings: number;
    rationale: string | null;
    effectiveTaxRatePct: number;
  };
  propertyType?: string;
  address?: string | null;
  totalValue?: number | null;
  improvementValue?: number | null;
  overrides: ModuleOverride[];
  incomeComputed: IncomeApproach;
  incomeAnalysis: IncomeAnalysis | null;
  savingsAnalysis: SavingsAnalysis;
  uploadingEvidence: boolean;
  onUploadEvidence: (files: File[], strategyId?: string, documentTypeOverride?: string) => void;
  onSaveIncomeAnalysis: (input: IncomeAnalysisInput) => void;
  onOpen: () => void;
}) {
  const caseResult = useContext(CaseResultContext);
  if (!unlocked) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Lock className="h-4 w-4 shrink-0" />
        <span className="text-xs">Subscribe to see this analysis</span>
      </div>
    );
  }

  if (m.id === "savings") {
    if (estimated.savings > 0 && savingsAnalysis.sufficient) {
      return <SavingsCardVisual a={savingsAnalysis} />;
    }
    return (
      <div className="grid gap-1.5">
        <FormulaChain
          reduction={estimated.reduction}
          ratePct={estimated.effectiveTaxRatePct}
          savings={estimated.savings}
        />
      </div>
    );
  }

  if (m.id === "income") {
    if (isModuleNotApplicable(overrides, "income")) {
      return (
        <div className="flex items-center gap-2 text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span className="text-xs">Marked not applicable — excluded from this protest</span>
        </div>
      );
    }
    if (!incomeComputed.dataComplete) {
      return (
        <IncomeLadderPreview
          computed={incomeComputed}
          editable={hasFullAccess}
          analysis={incomeAnalysis}
          onSave={onSaveIncomeAnalysis}
          onOpen={onOpen}
        />
      );
    }
    const aiSupports = (moduleData.income?.data as ModuleResultMap["income"] | undefined)
      ?.supportsCadValue;
    return (
      <IncomeCardVisual
        computed={incomeComputed}
        supports={aiSupports ?? incomeSupportsCad(incomeComputed)}
        onOpen={onOpen}
      />
    );
  }

  if (m.id === "comps" && compsMap.data?.comps.length) {
    const stats = computeComparableStats(compsMap.data.subject, compsMap.data.comps, totalValue);
    // The single most-similar comp (ranked[0] once excluded ones are skipped —
    // `ranked` is already sorted highest-similarity-first, see comps-analysis.ts) —
    // a real, named nearby property instead of just an aggregate range, so the
    // card's otherwise-empty space below the chart shows something concrete
    // and specific to this property rather than being wasted.
    const topComp = stats.ranked.find((c) => !c.excluded) ?? null;
    return (
      <div>
        <div className="flex items-baseline gap-1.5">
          <span className="font-serif text-xl font-bold">{compsMap.data.comps.length}</span>
          <span className="text-xs text-muted-foreground">comparable properties found nearby</span>
        </div>
        <div className="mt-3">
          <CompsValueScatter
            subject={compsMap.data.subject}
            subjectValue={stats.subjectValue}
            comps={stats.ranked}
          />
        </div>
        {topComp && (
          <div className={`mt-3 rounded-lg px-2.5 py-2 ${m.color.bg}`}>
            <div className={`text-[9px] font-semibold uppercase tracking-wide ${m.color.text}`}>
              Closest match — {Math.round(topComp.similarity)}% similar
            </div>
            <div className="mt-0.5 truncate text-xs font-medium text-foreground">
              {topComp.address}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {topComp.distanceMi.toFixed(1)} mi away
              {topComp.marketValue != null && ` · ${compactCurrency(topComp.marketValue)}`}
            </div>
          </div>
        )}
        {stats.limitedData ? (
          <div className="mt-3 rounded-md bg-warning/15 px-2 py-1 text-[11px] text-warning-foreground">
            Limited Comparable Data
          </div>
        ) : (
          stats.indicated && (
            <>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-success/10 px-2 py-2 text-center">
                  <div className="text-[9px] font-medium uppercase tracking-wide text-success">
                    Market Value Range
                  </div>
                  <div className="mt-0.5 truncate text-sm font-bold text-success">
                    {compactCurrency(stats.indicated.min)}–{compactCurrency(stats.indicated.max)}
                  </div>
                </div>
                {stats.subjectValue != null && (
                  <div className="rounded-lg bg-destructive/10 px-2 py-2 text-center">
                    <div className="text-[9px] font-medium uppercase tracking-wide text-destructive">
                      CAD Value
                    </div>
                    <div className="mt-0.5 truncate text-sm font-bold text-destructive">
                      {compactCurrency(stats.subjectValue)}
                    </div>
                  </div>
                )}
              </div>
              {stats.valuationGapPct != null && (
                <div className="mt-1.5 flex justify-center">
                  <ArrowDown className={`h-4 w-4 ${m.color.text}`} />
                </div>
              )}
            </>
          )
        )}
      </div>
    );
  }

  const loading = !moduleState || moduleState.loading || (m.id === "comps" && compsMap.loading);
  if (loading) return <SkeletonVisual />;
  if (moduleState?.error) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="text-left text-xs text-destructive underline underline-offset-2 hover:text-destructive/80"
      >
        Couldn't load — click to view &amp; retry
      </button>
    );
  }
  if (!moduleState?.data) return null;

  switch (m.id) {
    case "health": {
      const d = moduleState.data as HealthScoreResult;
      const top3 = d.scoreBreakdown.slice(0, 3);
      // Once the case is closed, Module 1's own score/gauge is the wrong
      // number to show — it measures pre-protest OPPORTUNITY ("is this worth
      // protesting"), not how the actual, completed protest went, and kept
      // showing a low, red "weak" score plus the old pre-protest narrative
      // even after a real, sizeable reduction. Grade the real outcome
      // instead, from the product-specified bands (protest-outcome.ts).
      if (caseResult) {
        const outcome = protestOutcome(caseResult.valueReductionPct);
        const outcomeColor =
          outcome.tone === "success" ? "var(--success)" : "var(--muted-foreground)";
        return (
          <div>
            <div className="text-center">
              <div className="font-serif text-xl font-bold" style={{ color: outcomeColor }}>
                {outcome.label}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{outcome.message}</p>
            </div>
            {top3.length > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
                {top3.map((b) => {
                  const Icon = breakdownIcon(b.label);
                  return (
                    <div key={b.label} className="flex flex-col items-center gap-1">
                      <span
                        className={`grid h-8 w-8 place-items-center rounded-full ${m.color.bg} ${m.color.text}`}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="text-[9px] leading-tight text-muted-foreground">
                        {b.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {caseResult.taxSavings != null && (
              <div className="mt-3 rounded-lg bg-success/10 px-3 py-2.5 text-center">
                <div className="font-serif text-2xl font-bold leading-none text-success">
                  {currency(caseResult.taxSavings)}
                </div>
                {caseResult.valueReductionPct != null ? (
                  <div className="mt-1 text-base font-bold text-success/90">
                    {Math.round(caseResult.valueReductionPct)}% lower assessed value
                  </div>
                ) : null}
                <div className="mt-1 text-[10px] text-muted-foreground">
                  actual tax savings from your completed protest
                </div>
              </div>
            )}
          </div>
        );
      }
      const label =
        d.score >= 70
          ? "Strong Opportunity"
          : d.score >= 40
            ? "Moderate Opportunity"
            : "Limited Opportunity";
      return (
        <div>
          <SpeedometerGauge value={d.score} size="sm" />
          <div className="text-center text-sm font-semibold" style={{ color: scoreColor(d.score) }}>
            {label}
          </div>
          {!d.dataSufficient && (
            <div className="mt-1.5 text-center text-[10px] font-semibold text-warning-foreground">
              Additional Data Needed
            </div>
          )}
          {top3.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
              {top3.map((b) => {
                const Icon = breakdownIcon(b.label);
                return (
                  <div key={b.label} className="flex flex-col items-center gap-1">
                    <span
                      className={`grid h-8 w-8 place-items-center rounded-full ${m.color.bg} ${m.color.text}`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="text-[9px] leading-tight text-muted-foreground">
                      {b.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {estimated.savings > 0 && (
            <div className="mt-3 rounded-lg bg-success/10 px-3 py-2.5 text-center">
              <div className="font-serif text-2xl font-bold leading-none text-success">
                {currency(estimated.savings)}
              </div>
              {totalValue ? (
                <div className="mt-1 text-base font-bold text-success/90">
                  {(() => {
                    // The percentage is how much the assessed VALUE drops (not the tax $ above).
                    const pct = (estimated.reduction / totalValue) * 100;
                    return `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}% lower assessed value`;
                  })()}
                </div>
              ) : null}
              <div className="mt-1 text-[10px] text-muted-foreground">
                estimated savings if your protest succeeds
              </div>
            </div>
          )}
          {d.executiveConclusion && (
            <div className="mt-2 text-center text-[11px] leading-snug text-muted-foreground">
              <MarkdownLite text={d.executiveConclusion} />
            </div>
          )}
          <div className="mt-2 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
            <ShieldCheck className="h-3 w-3" />
            Confidence: {d.confidencePct}%
          </div>
        </div>
      );
    }
    case "strategy": {
      const d = moduleState.data as ModuleResultMap["strategy"];
      if (d.strategies.length === 0) return null;
      // The AI's own one-line reason for its top-ranked argument — already
      // computed for the modal's StrategyDetail, just not shown here, so this
      // reuses it instead of adding anything new. Real and specific to this
      // property (not a generic "here's how scoring works" blurb), which is
      // what makes the otherwise-empty space above the bars worth filling.
      const top = d.strategies.reduce((best, s) =>
        s.strengthScore > best.strengthScore ? s : best,
      );
      return (
        <div>
          {top.primaryReason && (
            <div className={`mb-3 rounded-lg px-3 py-2 ${m.color.bg}`}>
              <div className={`text-[9px] font-semibold uppercase tracking-wide ${m.color.text}`}>
                Strongest argument — {top.name}
              </div>
              <p className="mt-0.5 line-clamp-2 text-xs text-foreground">{top.primaryReason}</p>
            </div>
          )}
          {/* Highlights only — uploads happen in View Details. Rows that still
              need evidence show a plain "Data Needed" pill. */}
          <StrategyRankList strategies={d.strategies} color={m.color} max={5} />
        </div>
      );
    }
    case "comps": {
      const d = moduleState.data as ModuleResultMap["comps"];
      return (
        <div className="grid gap-1 text-xs text-muted-foreground">
          {!compsMap.loading && !compsMap.data?.comps.length && (
            <p>
              No comparable-property map yet — live comps are only available for Collin, Denton,
              Grayson, Montgomery, Tarrant and Travis counties so far. Upload a sale or appraisal
              below to build the comp set yourself.
            </p>
          )}
          <p>
            {d.checklist.length} evidence item{d.checklist.length === 1 ? "" : "s"} to gather
          </p>
        </div>
      );
    }
    case "site": {
      const d = moduleState.data as ModuleResultMap["site"];
      const headline = pickHeadlineFactor(d.factors);
      return (
        <div>
          <div className="relative">
            {siteCoords ? (
              <SiteMapThumb lat={siteCoords.lat} lng={siteCoords.lng} height={128} />
            ) : (
              <div className="grid h-32 place-items-center rounded-lg bg-secondary/40">
                <MapPin className="h-6 w-6 text-muted-foreground" />
              </div>
            )}
            <FloodZoneBadge floodZone={siteGisMap.data?.floodZone} />
          </div>
          <div className="mt-2.5">
            <MiniMeter value={d.priorityScore} label="documentation priority" />
            <div className="mt-1.5">
              {headline ? (
                <SiteImpactChain factor={headline} />
              ) : (
                <p className="text-[10px] text-muted-foreground">
                  {countDataGaps(d.factors)} of {d.factors.length} site factors need more data.
                </p>
              )}
            </div>
            {d.keyFinding && (
              <p className="mt-1.5 line-clamp-2 text-[10px] text-muted-foreground">
                {d.keyFinding}
              </p>
            )}
            {/* Static hint, not a link — the card's own "View report" button
                below already opens this module's modal, where the real
                clickable Next Step bar (to Module 5) lives. */}
            <p className="mt-1.5 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
              Next: Improvement Condition
              <ArrowRight className="h-2.5 w-2.5" />
            </p>
          </div>
        </div>
      );
    }
    case "improvement": {
      // Card stays minimal by design — a building visual + the 1-2 numbers
      // that actually matter (Total Depreciation, Value Impact). The full
      // pipeline/4-component breakdown/6-tile metrics only live in the
      // modal ("View report") — repeating them here was too much text for
      // a glance-able card.
      const d = moduleState.data as ModuleResultMap["improvement"];
      const depreciation = computeDepreciation(
        d.effectiveAgeYears,
        getTypicalEconomicLife(propertyType),
        d.functionalObsolescencePct,
        d.externalObsolescencePct,
        improvementValue ?? null,
      );
      return (
        // Highlights only — photos are uploaded in View Details.
        <ImprovementCardVisual
          d={d}
          depreciation={depreciation}
          address={address}
          overrides={overrides}
          onOpen={onOpen}
        />
      );
    }
    case "zoning": {
      const d = moduleState.data as ModuleResultMap["zoning"];
      // Highlights only — evidence is uploaded in View Details.
      return <ZoningAspectTiles aspects={d.aspects} matches={d.matches} />;
    }
    case "evidence": {
      const d = moduleState.data as ModuleResultMap["evidence"];
      return <EvidenceQuadrant items={d.items} />;
    }
    case "executive": {
      const d = moduleState.data as ModuleResultMap["executive"];
      const evidenceData = moduleData.evidence?.data as ModuleResultMap["evidence"] | undefined;
      const strategyData = moduleData.strategy?.data as ModuleResultMap["strategy"] | undefined;
      const execStats = computeComparableStats(
        compsMap.data?.subject ?? null,
        compsMap.data?.comps ?? [],
        totalValue,
      );
      const summary = getExecutiveSummary(
        execStats,
        estimated.savings,
        evidenceData?.items ?? [],
        null,
      );
      const defenseScore = getDefenseReadinessScore(d.defenseQA);
      return (
        <div className="grid gap-2">
          {/* Real Executive Summary tiles — overvaluation range (comps
              math), primary strategy name (Module 2's own top pick), market
              value range (comps math) — same 3-tile layout as the
              reference this card was matched to, all real numbers. */}
          <div className="grid grid-cols-3 gap-1.5">
            <div
              className={`min-w-0 rounded-md px-1 py-1.5 text-center ${summary.overvaluationRange ? "bg-destructive/10" : "bg-secondary/40"}`}
            >
              <div
                className={`truncate text-[7px] uppercase tracking-wide ${summary.overvaluationRange ? "text-destructive" : "text-muted-foreground"}`}
              >
                Overvaluation
              </div>
              <div
                className={`truncate text-[11px] font-bold ${summary.overvaluationRange ? "text-destructive" : "text-muted-foreground"}`}
              >
                {summary.overvaluationRange
                  ? `${compactCurrency(summary.overvaluationRange.minDollar)}–${compactCurrency(summary.overvaluationRange.maxDollar)}`
                  : summary.indicatedValueRange
                    ? "Not Indicated"
                    : "Insufficient Data"}
              </div>
              {summary.overvaluationRange && (
                <div className="text-[8px] text-destructive/80">
                  ({summary.overvaluationRange.minPct}%–{summary.overvaluationRange.maxPct}%)
                </div>
              )}
            </div>
            <div className="min-w-0 rounded-md bg-accent/10 px-1 py-1.5 text-center">
              <div className="truncate text-[7px] uppercase tracking-wide text-accent">
                Primary Strategy
              </div>
              <div className="truncate text-[10px] font-bold">
                {strategyData?.strategies[0]?.name ?? "—"}
              </div>
              {strategyData?.strategies[0] && (
                <div className="text-[8px] text-muted-foreground">
                  {strategyData.strategies[0].strengthScore >= 70 ? "Strongest" : "Best available"}
                </div>
              )}
            </div>
            <div
              className={`min-w-0 rounded-md px-1 py-1.5 text-center ${summary.indicatedValueRange ? "bg-success/10" : "bg-secondary/40"}`}
            >
              <div
                className={`truncate text-[7px] uppercase tracking-wide ${summary.indicatedValueRange ? "text-success" : "text-muted-foreground"}`}
              >
                Value Range
              </div>
              <div
                className={`truncate text-[11px] font-bold ${summary.indicatedValueRange ? "text-success" : "text-muted-foreground"}`}
              >
                {summary.indicatedValueRange
                  ? `${compactCurrency(summary.indicatedValueRange.min)}–${compactCurrency(summary.indicatedValueRange.max)}`
                  : "Insufficient Data"}
              </div>
              {summary.currentCadValue != null && (
                <div className="truncate text-[8px] text-muted-foreground">
                  vs CAD {compactCurrency(summary.currentCadValue)}
                </div>
              )}
            </div>
          </div>
          {!summary.indicatedValueRange && (
            <p className="text-[9px] text-muted-foreground">
              No comparable properties with a usable market value were found for this property yet —
              comps math above can&apos;t run without at least one.
            </p>
          )}

          {/* Key Supporting Factors — real AI findings, short titles only. */}
          {d.majorFindings.length > 0 && (
            <div className="grid gap-0.5">
              {d.majorFindings.slice(0, 4).map((f, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3 w-3 shrink-0 text-success" />
                  <span className="min-w-0 flex-1 truncate text-[10px]">{f.finding}</span>
                </div>
              ))}
            </div>
          )}

          {/* Overall Case Assessment + Protest Defense Readiness gauges,
              side by side — same pairing as the reference. */}
          <div className="grid grid-cols-2 items-end gap-2">
            {summary.overallConfidencePct != null && (
              <div className="flex flex-col items-center">
                <SpeedometerGauge value={summary.overallConfidencePct} size="sm" />
                <div className="-mt-1 text-center text-[8px] uppercase tracking-wide text-muted-foreground">
                  Case Assessment
                </div>
              </div>
            )}
            {defenseScore != null && (
              <div className="flex flex-col items-center">
                <SpeedometerGauge value={defenseScore} size="sm" />
                <div className="-mt-1 text-center text-[8px] uppercase tracking-wide text-muted-foreground">
                  Defense Readiness
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }
    default:
      return null;
  }
}
