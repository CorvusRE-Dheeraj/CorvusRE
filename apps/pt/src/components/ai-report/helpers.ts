import { type HealthScoreResult } from "@/lib/ai-health-score";
import { type ModuleResultMap, type StrategyEntry } from "@/lib/ai-report-modules";
import { type CompsResult } from "@/lib/cad-comps";
import {
  computeComparableStats,
  type ComparableStats,
  type RankedComp,
} from "@/lib/comps-analysis";
import { ICON_COLORS, type IconColor } from "@/lib/icon-colors";
import { type IncomeAnalysis } from "@/lib/income-analysis";
import { incomeSupportsCad, type IncomeApproach } from "@/lib/income-approach";
import { currency } from "@/lib/intake-store";
import { isModuleNotApplicable, type ModuleOverride } from "@/lib/module-overrides";
import { MODULES, type Module } from "@/lib/modules";
import { type ProtestCostLine } from "@/lib/protest-cost";
import { type DocumentStatus } from "@/lib/protest-reason";
import { type SavingsAnalysis, type SavingsTaxInputs } from "@/lib/savings-analysis";
import { type EvidenceStrength, type SavingsFinding } from "@/lib/savings-dashboard";
import { type SiteFactor } from "@/lib/site-condition";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Building2,
  CheckCircle2,
  FileText,
  HelpCircle,
  MapPin,
  Percent,
  Target,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { type IncomeFormState } from "./income";
import { type SavingsFormState } from "./savings";
import { ModuleAsyncState } from "./shared";

// Non-component helpers and constants of the AI report page, kept apart from the
// component files so each of those exports only components.
// Module 8's per-document AI status — see analyzeEvidence() in
// protest-reason.ts. "Duplicate" is the one value never AI-decided (a real
// SHA-256 match, computed before the AI ever sees the documents), but reads
// the same way here since the badge is just reflecting whatever status the
// document ended up with.
export const DOCUMENT_STATUS_TONE: Record<DocumentStatus, string> = {
  Accepted: "bg-success/15 text-success",
  "Needs Review": "bg-warning/15 text-warning-foreground",
  "Incorrect Document": "bg-destructive/10 text-destructive",
  Duplicate: "bg-secondary/60 text-muted-foreground",
  "Additional Information Needed": "bg-accent/15 text-accent",
};

export const ZONING_STATUS = {
  consistent: {
    Icon: CheckCircle2,
    color: "text-success",
    bg: "bg-success/10",
    label: "Classification Consistent",
  },
  inconsistent: {
    Icon: AlertTriangle,
    color: "text-destructive",
    bg: "bg-destructive/10",
    label: "Possible Mismatch",
  },
  uncertain: {
    Icon: HelpCircle,
    color: "text-warning-foreground",
    bg: "bg-warning/15",
    label: "Uncertain — Needs Review",
  },
} as const;

// Part of the AI report page (src/routes/ai-report.tsx), split out of that
// file unchanged. Group: comps.
// Compact "$4.8M"/"$120K" formatting for tight badge/axis labels where the
// full currency() output (e.g. "$4,800,000") would overflow.
export function compactCurrency(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1000)}K`;
  return currency(n);
}

// Real 2-D scatter — Value Per Acre (Y) vs Land Size (X), the honest
// per-unit substitute for a "$/SF vs. building size" plot: no building-SF
// field exists anywhere in this pipeline (see valuePerAcre() below), but
// legalAcreage and marketValue are both real CAD fields every comp already
// carries. The subject renders as a larger, labeled accent dot among the
// comps (muted) so where the subject sits in the market reads at a glance,
// same visual language as CompsMap's subject/comp marker distinction.
// Subject dot shape shared by both the 2-D and 1-D fallback charts below —
// a larger accent-colored, labeled marker so the subject reads as visually
// distinct from the comps regardless of which chart is showing.
// Teal, reused straight from the Market Value module's own assigned icon
// color (ICON_COLORS[2] in icon-colors.ts) — comps read as "this module's
// color," not an invented chart palette.
export const COMPS_DOT_COLOR = "#0d9488";
// Sky blue, also an existing app tone (ICON_COLORS[6], already live on the
// Income Value module) reused here as a "this one is you" highlight —
// deliberately distinct from the comps' teal so the subject reads at a
// glance, without inventing a color the app doesn't already use elsewhere.
export const SUBJECT_DOT_COLOR = "#0284c7";

// Best real value available for a comp — tries marketValue first, then
// appraisedValue, then landValue+improvementValue summed, all real CAD
// fields on the same row. TrueProdigy is known-inconsistent about which of
// these it actually populates for a given county/property (some rows carry
// an appraised or land+improvement figure but a null marketValue) — this
// widens which comps the CARD's own chart can plot without changing
// computeComparableStats()'s stricter marketValue-only definition, which
// still drives the actual $ figures (Market Value Range, Valuation Gap,
// "Limited Comparable Data") since those feed the real protest argument.
export function bestAvailableValue(c: {
  marketValue: number | null;
  appraisedValue?: number | null;
  landValue?: number | null;
  improvementValue?: number | null;
}): number | null {
  if (c.marketValue != null) return c.marketValue;
  if (c.appraisedValue != null) return c.appraisedValue;
  if (c.landValue != null && c.improvementValue != null) return c.landValue + c.improvementValue;
  return null;
}

// Real, deterministic explanation of the confidence score — the same two
// inputs computeComparableStats() itself blends (usable comp count, value
// spread), phrased in a sentence — never AI-written, matching the
// SupportingDataGrid/SourcesList convention already used for Module 1.
export function comparableConfidenceReasoning(stats: ComparableStats): string | null {
  if (stats.confidencePct == null || stats.indicated == null) return null;
  const count = stats.selected.length;
  const spreadPct =
    stats.indicated.median > 0
      ? Math.round(((stats.indicated.max - stats.indicated.min) / stats.indicated.median) * 100)
      : null;
  const countPhrase = `The ${count} selected comparable ${count === 1 ? "property" : "properties"}`;
  const spreadPhrase =
    spreadPct != null
      ? spreadPct <= 20
        ? "a tight value range"
        : spreadPct <= 50
          ? "a moderate value range"
          : "a wide value range"
      : null;
  return spreadPhrase
    ? `${countPhrase}, within ${spreadPhrase} (±${spreadPct}%), support this indicated value.`
    : `${countPhrase} support this indicated value.`;
}

// A real deed date (see CompProperty.lastTransferDt), never a sale price —
// formatted plainly so it can't be mistaken for one.
export function formatTransferDate(v?: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function formatAcres(v?: number | null): string | null {
  if (v == null) return null;
  return `${v.toFixed(v < 1 ? 2 : 1)} ac`;
}

// $-per-acre, the real per-unit metric this data actually supports — not a
// $/SF substitute, since no building-size field exists (see comps-analysis.ts).
export function valuePerAcre(marketValue?: number | null, acreage?: number | null): number | null {
  if (marketValue == null || !acreage || acreage < 0.05) return null;
  return marketValue / acreage;
}

// Deterministic flags read as "less reliable"; the informational ones
// ("Not a market sale" is true of every CAD comp) get a quieter style.
export const COMP_FLAG_TONE: Record<string, string> = {
  Stale: "bg-warning/20 text-warning-foreground",
  Distant: "bg-warning/20 text-warning-foreground",
  "Size mismatch": "bg-warning/20 text-warning-foreground",
  "Type mismatch": "bg-warning/20 text-warning-foreground",
  "Unverified price": "bg-destructive/15 text-destructive",
};
// "Comp 3 — 1001 Hwy66, TX": the same number everywhere a final comp shows.
export function compLabel(c: RankedComp, numberOf?: Map<string, number>): string {
  const n = numberOf?.get(c.key);
  const addr = c.address || `Property #${c.pid}`;
  return n != null ? `Comp ${n} — ${addr}` : addr;
}

// Part of the AI report page (src/routes/ai-report.tsx), split out of that
// file unchanged. Group: income.
// ── Module 7 (Income Value) ───────────────────────────────────────────────
// Every figure rendered here is the deterministic result from
// src/lib/income-approach.ts (computed from owner-confirmed data) — never an
// AI value. The AI narrative (moduleData.income) only explains these.

export const INCOME_DOC_KINDS = ["P&L", "Operating Statement", "Rent Roll", "Appraisal"] as const;

export const INCOME_VERDICT: Record<
  "supports" | "does-not-support" | "inconclusive",
  { label: string; cls: string }
> = {
  supports: { label: "Income Supports CAD Value", cls: "bg-success/10 text-success" },
  "does-not-support": {
    label: "Income Does Not Support CAD Value",
    cls: "bg-accent/10 text-accent",
  },
  inconclusive: {
    label: "Income Analysis Inconclusive",
    cls: "bg-secondary text-muted-foreground",
  },
};

export function toFormState(a: IncomeAnalysis | null): IncomeFormState {
  const s = (v: number | null | undefined) => (v != null ? String(v) : "");
  return {
    grossPotentialIncome: s(a?.grossPotentialIncome),
    otherIncome: s(a?.otherIncome),
    vacancyPct: s(a?.vacancyPct),
    operatingExpenses: s(a?.operatingExpenses),
    noiStated: s(a?.noiStated),
    rentableSqft: s(a?.rentableSqft),
    capRatePct: s(a?.capRatePct),
    capRateSource: a?.capRateSource ?? "owner",
  };
}

export const numOrNull = (v: string): number | null => {
  const n = Number(v.replace(/[^0-9.-]/g, ""));
  return v.trim() !== "" && Number.isFinite(n) ? n : null;
};

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

export function scoreColor(score: number): string {
  if (score >= 70) return "var(--success)";
  if (score >= 40) return "var(--warning)";
  return "var(--destructive)";
}

// A continuous version of scoreColor — smoothly interpolated (red at 0,
// amber at 50, green at 100, everything in between blended) rather than
// jumping abruptly at fixed 40/70 cutoffs, for the one place that read as
// "graph-like" enough to want a real gradient: SpeedometerGauge. Uses CSS
// color-mix() (same technique already used for the hub doors' glow tint)
// so it blends the app's real theme tokens directly — correct in both light
// and dark mode — rather than a hardcoded hex gradient.
export function gradualScoreColor(score: number): string {
  const s = Math.max(0, Math.min(100, score));
  // Eased, not linear: a plain 0-50 linear blend put 25 at a 50/50 red/amber
  // mix, which reads as orange, not red — the same problem a direct 2-stop
  // red-green mix had at the other extreme (a muddy midpoint, no real
  // yellow). Easing each half toward its own anchor (ease-in low, ease-out
  // high) keeps 25 mostly red and 90 mostly green, while 50 still lands on
  // pure amber — still one continuous curve, just not a straight line.
  if (s <= 50) {
    const t = s / 50;
    const pct = t * t * t * 100;
    return `color-mix(in oklch, var(--warning) ${pct}%, var(--destructive) ${100 - pct}%)`;
  }
  const t = (s - 50) / 50;
  const pct = (1 - (1 - t) * (1 - t) * (1 - t)) * 100;
  return `color-mix(in oklch, var(--success) ${pct}%, var(--warning) ${100 - pct}%)`;
}

// Part of the AI report page (src/routes/ai-report.tsx), split out of that
// file unchanged. Group: savings.
// ── Module 9 (Estimated Savings) ─────────────────────────────────────────
// Every figure here is the deterministic result from
// src/lib/savings-analysis.ts — no AI value anywhere, identical on every
// refresh.

export const SAVINGS_CONF_STYLE: Record<SavingsAnalysis["financialConfidence"], string> = {
  High: "bg-success/15 text-success",
  Moderate: "bg-warning/20 text-warning-foreground",
  Limited: "bg-secondary text-muted-foreground",
};

export const SAVINGS_DISCLAIMER =
  "Estimated savings are based on the current valuation and tax assumptions available to CorvusPT. Actual savings depend on the final value the county sets and the applicable tax rates, exemptions, and taxable-value rules.";

export const COST_KIND_LABEL: Record<ProtestCostLine["kind"], string> = {
  annual: "Annual",
  one_time: "One-time",
  additional: "Additional",
};
export const savingsToForm = (t: SavingsTaxInputs | null): SavingsFormState => {
  const s = (v: number | null | undefined) => (v != null ? String(v) : "");
  return {
    taxableValue: s(t?.taxableValue),
    exemptionsTotal: s(t?.exemptionsTotal),
    protestCostOverride: s(t?.protestCostOverride),
    projectionYears: s(t?.projectionYears),
  };
};

export const FINDING_ICON: Record<SavingsFinding["key"], LucideIcon> = {
  comps: BarChart3,
  property: Building2,
  documents: FileText,
};
export const STRENGTH_STYLE: Record<EvidenceStrength, string> = {
  Strong: "bg-success/15 text-success",
  Limited: "bg-secondary text-muted-foreground",
  Missing: "bg-warning/15 text-warning-foreground",
};
export const STRENGTH_LABEL: Record<EvidenceStrength, string> = {
  Strong: "Strong evidence",
  Limited: "Limited evidence",
  Missing: "Evidence missing",
};

// Part of the AI report page (src/routes/ai-report.tsx), split out of that
// file unchanged. Group: strategy.
// Icon for a ranked strategy — reuses the Module's own icon for the 5 fixed
// strategies (so "Comparable Sales" shows the same icon as the Market Value
// module card, etc.) via relatedModules; falls back to a generic icon for an
// AI-added "Other: ..." strategy, which doesn't map to any of Modules 3-7.
export function strategyIcon(s: StrategyEntry): LucideIcon {
  const relatedId = s.relatedModules[0];
  const mod = relatedId ? MODULES.find((mm) => mm.id === relatedId) : undefined;
  return mod?.icon ?? Target;
}

// Stable per-strategy key for tagging uploaded evidence (documents.document_type,
// see handleUploadEvidence in Report()) and storing the free-text evidence-gate
// answer (IntakeState.strategyAnswers) — derived from the AI's own strategy name
// so no separate id/lookup table is needed.
export function strategySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const SITE_FACTOR_STATUS_TONE: Record<SiteFactor["status"], string> = {
  Confirmed: "bg-success/15 text-success",
  "Partial Data": "bg-warning/15 text-warning-foreground",
  "Additional Data Needed": "bg-secondary/60 text-muted-foreground",
  "Not Applicable": "bg-secondary/60 text-muted-foreground",
};

export const BUILDING_CONDITION_TONE: Record<string, string> = {
  Good: "bg-success/15 text-success",
  Fair: "bg-warning/15 text-warning-foreground",
  Poor: "bg-destructive/10 text-destructive",
  Unknown: "bg-secondary/60 text-muted-foreground",
};

// The reference's 5-step explainer strip — purely describes a pipeline that
// now genuinely exists (this module's own real photo-grounded assessment +
// deterministic depreciation math), not a claim about this property. Fixed,
// not data-driven — same spirit as a product diagram, not an AI output.
export const PIPELINE_STEPS: { label: string; sub: string; icon: LucideIcon }[] = [
  { label: "User Input", sub: "Building Data, Photos", icon: FileText },
  { label: "AI Processing", sub: "Condition Analyzer", icon: Wrench },
  { label: "Logic/Decision", sub: "Depreciation Model", icon: BarChart3 },
  { label: "AI Output", sub: "Condition Assessment", icon: Activity },
  { label: "Next Step", sub: "Apply to Value Model", icon: ArrowRight },
];

export function moduleInsight(
  m: Module,
  moduleState: ModuleAsyncState | undefined,
  compsMap: { data: CompsResult | null; loading: boolean },
  estimated: { savings: number },
  totalValue: number | null | undefined,
  overrides: ModuleOverride[],
  incomeComputed?: IncomeApproach,
  savingsAnalysis?: SavingsAnalysis,
): string | null {
  if (m.id === "income") {
    if (isModuleNotApplicable(overrides, "income")) return "Marked Not Applicable";
    if (!incomeComputed?.complete) {
      return incomeComputed?.dataComplete ? "Cap rate needed" : "Upload financials to unlock";
    }
    const supports =
      (moduleState?.data as ModuleResultMap["income"] | undefined)?.supportsCadValue ??
      incomeSupportsCad(incomeComputed);
    return supports === "does-not-support"
      ? "Income does not support CAD value"
      : supports === "supports"
        ? "Income supports CAD value"
        : "Income analysis inconclusive";
  }
  if (m.id === "savings") {
    if (estimated.savings <= 0) return null;
    if (savingsAnalysis && !savingsAnalysis.sufficient) return "Additional data needed";
    if (savingsAnalysis) {
      return savingsAnalysis.netBenefit > 0
        ? "Strong potential savings"
        : "Marginal — review protest cost";
    }
    return "Strong Potential Savings";
  }
  if (!moduleState?.data) return null;
  switch (m.id) {
    case "health": {
      const d = moduleState.data as HealthScoreResult;
      return d.score >= 70
        ? "Strong Opportunity"
        : d.score >= 40
          ? "Moderate Opportunity"
          : "Limited Opportunity";
    }
    case "strategy": {
      const d = moduleState.data as ModuleResultMap["strategy"];
      if (d.strategies.length === 0) return null;
      if (d.topStrategySummary) return d.topStrategySummary;
      const top = d.strategies.slice(0, 2).map((s) => s.name);
      return `AI recommends focus on ${top.join(" & ")}`;
    }
    case "comps": {
      const stats = computeComparableStats(
        compsMap.data?.subject ?? null,
        compsMap.data?.comps ?? [],
        totalValue,
      );
      if (stats.limitedData || stats.valuationGapPct == null) return null;
      return stats.valuationGapPct > 0 ? "Potential Overvaluation" : "Fairly Valued";
    }
    case "site":
    case "improvement": {
      const d = moduleState.data as ModuleResultMap["site"] | ModuleResultMap["improvement"];
      return d.priorityScore >= 70
        ? "High Documentation Priority"
        : d.priorityScore >= 40
          ? "Moderate Documentation Priority"
          : "Low Documentation Priority";
    }
    case "zoning": {
      const d = moduleState.data as ModuleResultMap["zoning"];
      return ZONING_STATUS[d.matches].label;
    }
    case "evidence": {
      const d = moduleState.data as ModuleResultMap["evidence"];
      const gaps = d.items.filter((i) => i.importance === "High" && i.availability === "Low");
      return gaps.length > 0 ? "Focus Here First" : "Evidence Well Covered";
    }
    case "executive": {
      const d = moduleState.data as ModuleResultMap["executive"];
      return d.recommendedAction;
    }
    default:
      return null;
  }
}

// Part of the AI report page (src/routes/ai-report.tsx), split out of that
// file unchanged. Group: zoning.
export const ZONING_ASPECT_STATUS: Record<
  ModuleResultMap["zoning"]["aspects"][number]["status"],
  { label: string; cls: string; Icon: LucideIcon; iconCls: string }
> = {
  Confirmed: {
    label: "Confirmed",
    cls: "bg-success/15 text-success",
    Icon: CheckCircle2,
    iconCls: "text-success",
  },
  "Partial Data": {
    label: "Partial",
    cls: "bg-warning/20 text-warning-foreground",
    Icon: AlertTriangle,
    iconCls: "text-warning-foreground",
  },
  "Additional Data Needed": {
    label: "Needs data",
    cls: "bg-secondary text-muted-foreground",
    Icon: HelpCircle,
    iconCls: "text-muted-foreground",
  },
};

export const ZONING_ASPECT_ICON: Record<string, LucideIcon> = {
  "CAD Classification": FileText,
  "Actual Use": Building2,
  "Zoning District": MapPin,
  "Permitted Use": CheckCircle2,
};

// Each aspect tile gets its own color from the app's shared icon palette
// (icon-colors.ts) instead of all four sharing one flat muted gray — Permitted
// Use gets the same success green the checkmark already uses a few lines down
// for a "Matches" outcome, so approval reads the same color everywhere.
export const ZONING_ASPECT_COLOR: Record<string, IconColor> = {
  "CAD Classification": ICON_COLORS[6], // sky — official record/paperwork
  "Actual Use": ICON_COLORS[2], // teal — the building itself
  "Zoning District": ICON_COLORS[1], // violet — location/district
  "Permitted Use": ICON_COLORS[5], // success green — approval
};

// The 4-column classification line-up from the spec's screenshot: the four
// aspects are the columns, one value row, then a muted source / upload row.
// The Permitted Use column also carries the overall consistent/mismatch mark.
export const ZONING_ASPECT_KINDS = [
  "CAD Classification",
  "Actual Use",
  "Zoning District",
  "Permitted Use",
] as const;
