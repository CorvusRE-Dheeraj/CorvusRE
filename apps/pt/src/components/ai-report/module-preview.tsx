import { AskAiMicButton } from "@/components/AskAiMicButton";
import { CaseOutcomeBanner } from "@/components/CaseOutcomeBanner";
import { FinalCaseSummaryPanel } from "@/components/CaseReportView";
import { CommercialValuationPanel } from "@/components/CommercialValuationPanel";
import { CompsMap } from "@/components/CompsMap";
import { EvidenceFileRow } from "@/components/EvidenceFileRow";
import { EvidenceImpactContext } from "@/components/EvidenceImpactCard";
import { MarkdownLite } from "@/components/MarkdownLite";
import { SiteReportsPanel } from "@/components/SiteReportsPanel";
import { type HealthScoreResult } from "@/lib/ai-health-score";
import { EVIDENCE_CATEGORY_ORDER, type ModuleResultMap } from "@/lib/ai-report-modules";
import { useAuth } from "@/lib/auth";
import { type CompsResult } from "@/lib/cad-comps";
import {
  compSelectionsToExtraComps,
  excludedCompKeys,
  pinnedCompKeys,
  type CompSaleExtraction,
  type CompSelection,
  type CompSelectionInput,
} from "@/lib/comp-selections";
import {
  computeComparableStats,
  TOP_N_FOR_INDICATED_VALUE,
  type RankedComp,
} from "@/lib/comps-analysis";
import { getCountyProtestInfo } from "@/lib/county-protest-info";
import {
  EVIDENCE_DOCUMENT_TYPE,
  PROTEST_EVIDENCE_DOCUMENT_TYPE,
  type DocumentRecord,
} from "@/lib/documents";
import { getErrorMessage } from "@/lib/error-message";
import { categorizeEvidenceUploads, evidenceItemSlug } from "@/lib/evidence-categorize";
import { buildEvidencePacket } from "@/lib/evidence-packet";
import { computeEvidenceReadiness } from "@/lib/evidence-readiness";
import {
  clearUnavailable,
  isUnavailable,
  listUnavailable,
  markUnavailable,
  orphanedUnavailable,
  type UnavailableRecord,
} from "@/lib/evidence-unavailable";
import {
  ASSESSMENT_TIER,
  assessmentTier,
  getProtestReadiness,
  READINESS_LABEL,
  type AssessmentTier,
  type ProtestReadinessResult,
} from "@/lib/executive-assessment";
import { buildExecutiveReportPdf } from "@/lib/executive-report-pdf";
import { buildFinalCaseSummary } from "@/lib/final-case-summary";
import { type GeocodedPoint } from "@/lib/geocode";
import { type IconColor } from "@/lib/icon-colors";
import {
  type IncomeAnalysis,
  type IncomeAnalysisInput,
  type IncomeExtraction,
} from "@/lib/income-analysis";
import { type IncomeApproach } from "@/lib/income-approach";
import { currency, type IntakeState } from "@/lib/intake-store";
import {
  isItemNotApplicable,
  isModuleNotApplicable,
  type ModuleOverride,
} from "@/lib/module-overrides";
import { MODULES, type Module } from "@/lib/modules";
import { getPreFilingCheck } from "@/lib/pre-filing-check";
import { type PropertyRecord } from "@/lib/properties";
import { type ProtestCost } from "@/lib/protest-cost";
import { downloadPdf } from "@/lib/protest-documents";
import { analyzeEvidence, type DocumentStatus, type EvidenceAnalysis } from "@/lib/protest-reason";
import { type ProtestRecord } from "@/lib/protests";
import { type SavingsAnalysis, type SavingsTaxInputs } from "@/lib/savings-analysis";
import { buildSavingsFindings, getSavingsNextStep } from "@/lib/savings-dashboard";
import { type SavingsTaxInputsInput } from "@/lib/savings-tax-inputs";
import { countDataGaps } from "@/lib/site-condition";
import { type SiteGisResult } from "@/lib/site-gis";
import { getValuationWorksheet } from "@/lib/valuation-worksheet";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Cpu,
  Download,
  FileText,
  Gauge,
  MapPin,
  Percent,
  RefreshCw,
  Scale,
  ShieldCheck,
  Target,
  Upload,
  User,
  type LucideIcon,
} from "lucide-react";
import { useContext, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ChecklistSteps,
  DocumentStatusBadge,
  ErrorWithRetry,
  EvidenceCategoryRow,
  FactBullet,
  ZoningBadge,
} from "./bits";
import {
  AddCompForm,
  compactCurrency,
  ComparableAdjustments,
  comparableConfidenceReasoning,
  ComparableSelectionFunnel,
  ComparableTable,
  ComparableValueChart,
  compLabel,
  CompsAdjustmentGrid,
} from "./comps";
import { IncomeWorkspace } from "./income";
import { Module1Content, Module2Content, Module5Content } from "./module-content";
import { SavingsWorkspace } from "./savings";
import { ModuleAsyncState } from "./shared";
import { AnalysisPipeline } from "./strategy";
import {
  FloodZoneBadge,
  MiniMeter,
  SiteFactorGapTile,
  SiteFactorNotApplicableTile,
  SiteFactorRow,
  SiteMapThumb,
} from "./visuals";
import { ZONING_ASPECT_KINDS, ZoningClassificationTable, ZoningImpactCol } from "./zoning";

// Part of the AI report page (src/routes/ai-report.tsx), split out of that
// file unchanged. Group: module-preview.
// Renders the actual per-module body — split from ModulePreviewBody below so
// the "Ask AI" Q&A box (see ModuleQABox) can be appended once, after whichever
// early-return branch below fires, instead of being duplicated into each one.
export function ModulePreviewContent({
  m,
  estimated,
  state,
  moduleState,
  moduleData,
  compsMap,
  siteGisMap,
  siteCoords,
  siteCoordsSettled,
  onRetry,
  allowEvidenceUpload,
  evidenceDocs,
  uploadingEvidence,
  onUploadEvidence,
  onForceReload,
  onFetchCadDetails,
  onRefreshSiteGis,
  siteGisRefreshing,
  cadFetching,
  onAutoSourceEvidence,
  autoSourcingEvidence,
  onFetchPublicData,
  fetchingPublicData,
  onAnswerStrategy,
  existingProtest,
  resolvedProperty,
  caseDocuments,
  noticeSignedAt,
  onOpenModule,
  onStartProtest,
  onReloadModule,
  onViewCase,
  onAskQuestion,
  overrides,
  onMarkNotApplicable,
  onClearNotApplicable,
  compSelections,
  onSaveCompSelection,
  onRemoveCompSelection,
  onResetCompSelections,
  onExtractCompSale,
  incomeAnalysis,
  incomeComputed,
  onSaveIncomeAnalysis,
  onExtractIncome,
  savingsAnalysis,
  protestCost,
  savingsTaxInputs,
  onSaveSavingsTaxInputs,
}: {
  m: Module;
  estimated: {
    hasEstimate: boolean;
    reduction: number;
    savings: number;
    rationale: string | null;
    effectiveTaxRatePct: number;
  };
  state: IntakeState;
  moduleState: ModuleAsyncState | undefined;
  moduleData: Record<string, ModuleAsyncState>;
  compsMap: { data: CompsResult | null; loading: boolean };
  siteGisMap: { data: SiteGisResult | null; loading: boolean };
  siteCoords: GeocodedPoint | null;
  // True once the CAD-subject / geocode resolution has finished — lets the
  // comps map tell "still locating" apart from "couldn't locate".
  siteCoordsSettled: boolean;
  onRetry: () => void;
  allowEvidenceUpload: boolean;
  evidenceDocs: DocumentRecord[];
  uploadingEvidence: boolean;
  onUploadEvidence: (files: File[], strategyId?: string, documentTypeOverride?: string) => void;
  onForceReload: () => void;
  // Module 6 only — re-pull the CAD record and update the classification.
  onFetchCadDetails: () => void;
  onRefreshSiteGis: () => void;
  siteGisRefreshing: boolean;
  cadFetching: boolean;
  // Module 8 only — pull the live CAD record + site GIS, then re-run the
  // evidence module so it verifies against real records before asking.
  onAutoSourceEvidence: () => void;
  autoSourcingEvidence: boolean;
  // Module 5's "Ask Corvus to Fetch Details" — refresh the property's
  // AI-fetched base data from public sources, then re-run this module.
  onFetchPublicData: () => void;
  fetchingPublicData: boolean;
  onAnswerStrategy: (strategyId: string, answer: string) => void;
  onAskQuestion: (moduleId: string, question: string) => Promise<string>;
  // "AI fills in the missing data" — drafts a starter data sheet for the
  // inputs this module reports as missing and files it in the central
  // repository, tagged to this module. Returns the new doc's filename.
  onGenerateDataSheet: (
    moduleId: string,
    moduleLabel: string,
    moduleResult: unknown,
  ) => Promise<string | null>;
  // Module 10 only — real case state + navigation, so it can show real
  // filing readiness and a genuinely working "View Analysis"/CTA without a
  // page reload (just switches which module is open in this same modal).
  existingProtest: ProtestRecord | null;
  resolvedProperty: PropertyRecord | null;
  // Module 10's Full Case Report also reads every property document and
  // whether the Notice of Protest has been signed.
  caseDocuments: DocumentRecord[];
  noticeSignedAt: string | null;
  onOpenModule: (moduleId: string) => void;
  onStartProtest: () => void;
  // Module 1 only — force-reload a module OTHER than whichever one is
  // currently open (onForceReload only reloads the open module). Used so
  // accepting a link / uploading evidence from inside Module 1 re-runs
  // Module 8's real analysis in the background, without navigating the user
  // there — see Module1Content.
  onReloadModule: (moduleId: string) => void;
  onViewCase: () => void;
  // Real, user-confirmed "not applicable" marks — see module-overrides.ts.
  // onMarkNotApplicable/onClearNotApplicable default `itemKey` to the
  // whole-module key (see markNotApplicable/clearNotApplicable in Report()).
  overrides: ModuleOverride[];
  onMarkNotApplicable: (moduleId: string, itemKey?: string) => void;
  onClearNotApplicable: (moduleId: string, itemKey?: string) => void;
  // Module 3 (Market Value) — the user's comp include/exclude/add decisions
  // (see comp-selections.ts). The two callbacks are no-ops in the printable
  // report view (allowEvidenceUpload false); interactive only in the modal.
  compSelections: CompSelection[];
  onSaveCompSelection: (sel: CompSelectionInput) => void;
  onRemoveCompSelection: (compKey: string) => void;
  // Drops every tick/untick so the AI's own top 5 apply again.
  onResetCompSelections: () => void;
  // Uploads one sale document and returns the AI-extracted figures, or null
  // (no-op in the printable report view).
  onExtractCompSale: (file: File) => Promise<CompSaleExtraction | null>;
  // Module 7 (Income Value) — the owner-confirmed income figures (see
  // income-analysis.ts) and the deterministic income-approach result
  // (income-approach.ts). onSaveIncomeAnalysis / onExtractIncome are no-ops
  // in the printable report view (allowEvidenceUpload false).
  incomeAnalysis: IncomeAnalysis | null;
  incomeComputed: IncomeApproach;
  onSaveIncomeAnalysis: (input: IncomeAnalysisInput) => void;
  onExtractIncome: (documentId: string) => Promise<IncomeExtraction>;
  // Module 9 (Estimated Savings) — the deterministic financial analysis
  // (savings-analysis.ts) and the optional tax-inputs saver (a no-op in the
  // printable report view).
  savingsAnalysis: SavingsAnalysis;
  // Module 9 — the owner's real protest cost (see protest-cost.ts).
  protestCost: ProtestCost;
  savingsTaxInputs: SavingsTaxInputs | null;
  onSaveSavingsTaxInputs: (input: SavingsTaxInputsInput) => void;
}) {
  // Real AI analysis of the customer's own uploaded evidence — see Module
  // 8's "evidence" case below and analyzeEvidence() in protest-reason.ts.
  // Declared unconditionally at the top (not inside the "evidence" case)
  // so this never runs afoul of the Rules of Hooks against the early
  // returns below.
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<EvidenceAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  // Evidence packet compile/download — see buildEvidencePacket() in
  // evidence-packet.ts and Module 8's "evidence" case below. Same
  // unconditional-top-of-component placement as the analysis state above.
  const [downloadingPacket, setDownloadingPacket] = useState(false);
  const [packetError, setPacketError] = useState<string | null>(null);
  // Module 10's "Download Protest Report (PDF)" — see executive-report-pdf.ts.
  const [downloadingReport, setDownloadingReport] = useState(false);
  // Module 9 — the uploaded-evidence reading behind "Supporting Documents".
  const evidenceImpact = useContext(EvidenceImpactContext);
  // Which evidence-checklist category (Module 8) is currently expanded —
  // single-open accordion, same unconditional-top placement as the state
  // above. Also tracks the bulk "Upload Evidence" button's own real AI
  // categorization pass (see handleBulkUploadEvidence below), distinct from
  // uploadingEvidence (the actual upload itself).
  const [expandedEvidenceItem, setExpandedEvidenceItem] = useState<string | null>(null);
  const [categorizingEvidence, setCategorizingEvidence] = useState(false);
  // Part 2's "library" view — group the same real items by category instead
  // of by priority. Priority stays the default (Part 3 explicitly wants
  // prioritization first); this is just a different lens on the same data.
  const [evidenceGroupBy, setEvidenceGroupBy] = useState<"priority" | "category">("priority");
  const { user: authUser } = useAuth();
  // Module 8's "Document not available" marks, keyed by checklist slug (see
  // evidence-unavailable.ts) — overlaid on the checklist, never regenerating it.
  const [unavailable, setUnavailable] = useState<Map<string, UnavailableRecord>>(new Map());
  const unavailablePropertyId = m.id === "evidence" ? (resolvedProperty?.id ?? null) : null;
  useEffect(() => {
    if (!unavailablePropertyId) return;
    let live = true;
    listUnavailable(unavailablePropertyId)
      .then((map) => live && setUnavailable(map))
      .catch((e) => console.error("evidence_unavailable load failed:", e));
    return () => {
      live = false;
    };
  }, [unavailablePropertyId]);

  if (m.requiresUserData) {
    // Module 7 "Cost and Income": the Cost approach (and the conditions a
    // buyer would discount for) first, then Income — the same calculators as
    // the report page's Commercial Valuation panel, sharing its saved inputs.
    const costSection = (
      <section className="mt-4 grid gap-3">
        <div>
          <h3 className="font-serif text-lg font-semibold">Cost</h3>
          <p className="text-xs text-muted-foreground">
            Land value plus what it would cost to rebuild the improvements today, less depreciation
            — then the conditions a buyer would discount for.
          </p>
        </div>
        {state.improvementValue === 0 ? (
          <p className="rounded-md bg-secondary/60 p-3 text-sm text-muted-foreground">
            The county records no buildings on this property (improvement value $0), so the cost
            approach is just the land value of {currency(state.landValue ?? undefined)}. Conditions
            a buyer would discount for are covered under Land Condition.
          </p>
        ) : (
          <CommercialValuationPanel
            embedded
            only={["cost", "impairments"]}
            userId={allowEvidenceUpload ? (authUser?.id ?? null) : null}
            propertyId={resolvedProperty?.id ?? null}
            cadValue={state.totalValue ?? null}
            landValue={state.landValue ?? null}
            improvementValue={state.improvementValue ?? null}
            acres={compsMap.data?.subject?.legalAcreage ?? null}
            buildingSqft={state.buildingSqft ?? null}
            yearBuilt={state.yearBuilt ?? null}
            income={incomeComputed}
            compStats={null}
            knownConditions={[]}
          />
        )}
        <h3 className="mt-2 font-serif text-lg font-semibold">Income</h3>
      </section>
    );
    if (isModuleNotApplicable(overrides, "income")) {
      return (
        <>
          {costSection}
          <div className="mt-4 card-elev p-4 bg-secondary/60">
            <p className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              Marked not applicable — no P&L, rent roll, or operating statement is available for
              this property. The income approach is excluded from this protest.
            </p>
            <button
              type="button"
              onClick={() => onClearNotApplicable("income")}
              className="mt-2 text-xs font-medium text-accent hover:underline"
            >
              Undo — I can upload financials
            </button>
          </div>
        </>
      );
    }
    return (
      <>
        {costSection}
        <IncomeWorkspace
          m={m}
          state={state}
          moduleState={moduleState}
          compsMap={compsMap}
          analysis={incomeAnalysis}
          computed={incomeComputed}
          evidenceDocs={evidenceDocs}
          allowEvidenceUpload={allowEvidenceUpload}
          uploadingEvidence={uploadingEvidence}
          onUploadEvidence={onUploadEvidence}
          onSaveIncomeAnalysis={onSaveIncomeAnalysis}
          onExtractIncome={onExtractIncome}
          onForceReload={onForceReload}
          onMarkNotApplicable={() => onMarkNotApplicable("income")}
        />
      </>
    );
  }

  const loading = !moduleState || moduleState.loading;
  const error = moduleState?.error;

  // Deterministic, not AI-generated — `estimated` (computed by the caller) is
  // the exact same estimateSavings() call the intake savings screen uses, so
  // this always matches that screen for the same property. No loading/error
  // state here since there's no AI call backing this module anymore.
  if (m.id === "savings") {
    const current = state.totalValue ?? 0;
    // No assessed value on the CAD record at all — there is no estimate,
    // which is a different finding from "we estimated ~$0." Same guard the
    // top banner now applies; without it this module told the owner their
    // property was "fairly assessed" purely because we had nothing to work
    // from. See the `hasEstimate` comment on the `estimated` memo.
    if (!estimated.hasEstimate) {
      return (
        <div className="mt-4 grid gap-3 text-center">
          <p className="font-serif text-xl font-bold">No assessed value on file yet.</p>
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">
            The county record for this property doesn't carry an assessed value for this tax year,
            so there's nothing to estimate savings from. Upload your appraisal notice, or check back
            once the county publishes this year's value.
          </p>
        </div>
      );
    }
    // Same >= 1 threshold and reasoning as the page's own top banner and
    // intake.tsx's Savings step — a real analysis landing on (near-)$0 isn't
    // a failure, and currency() rounding a sub-$1 amount down to "$0" would
    // otherwise still read as one.
    if (estimated.savings < 1) {
      return (
        <div className="mt-4 grid gap-3">
          <div className="text-center">
            <p className="font-serif text-xl font-bold text-success">Good news!</p>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
              Your property appears to be fairly assessed. We found little or no opportunity for
              additional tax savings this year.
            </p>
          </div>
          <p className="text-center text-xs text-muted-foreground">
            {estimated.rationale ?? "Based on your county's real effective tax rate."}
          </p>
        </div>
      );
    }
    // Once the protest process has concluded, Module 9 also carries the
    // deterministic Final Case Summary (see src/lib/final-case-summary.ts).
    // Purely additive — the estimated-savings workspace below is unchanged.
    const finalSummary =
      resolvedProperty && existingProtest
        ? buildFinalCaseSummary(resolvedProperty, existingProtest)
        : null;
    // "Why You May Be Paying Too Much" — from this property's own module
    // results and uploaded evidence (see savings-dashboard.ts).
    const savingsComps = computeComparableStats(
      compsMap.data?.subject ?? null,
      compsMap.data?.comps ?? [],
      state.totalValue,
    );
    const usableComps = savingsComps.ranked.filter((c) => c.marketValue != null);
    const siteResult = moduleData.site?.data as ModuleResultMap["site"] | undefined;
    const improvementResult = moduleData.improvement?.data as
      ModuleResultMap["improvement"] | undefined;
    const zoningResult = moduleData.zoning?.data as ModuleResultMap["zoning"] | undefined;
    const savingsFindings = buildSavingsFindings({
      comps: savingsComps.indicated
        ? {
            count: usableComps.length,
            median: savingsComps.indicated.median,
            gapPct: savingsComps.valuationGapPct,
            limitedData: savingsComps.limitedData,
          }
        : null,
      site: siteResult?.factors ?? null,
      improvement: improvementResult?.buildingComponents.filter((c) => !c.notApplicable) ?? null,
      zoning: zoningResult
        ? {
            matches: zoningResult.matches,
            discrepancy: zoningResult.discrepancies[0]?.detail ?? null,
          }
        : null,
      documents: evidenceImpact
        ? {
            count: evidenceImpact.evidenceCount,
            applied: evidenceImpact.adjustment.applied,
            direction: evidenceImpact.adjustment.direction,
            strength: evidenceImpact.adjustment.strength,
            kinds: [...new Set(evidenceImpact.adjustment.contributions.map((c) => c.label))],
            indicatedValue: evidenceImpact.adjustment.indicatedValue,
          }
        : null,
    });
    return (
      <div className="grid gap-4">
        {finalSummary?.available && (
          <div className="mt-4">
            <FinalCaseSummaryPanel summary={finalSummary} />
          </div>
        )}
        <SavingsWorkspace
          analysis={savingsAnalysis}
          cost={protestCost}
          findings={savingsFindings}
          nextStep={getSavingsNextStep(savingsAnalysis, savingsFindings)}
          cadSourceLabel={[
            state.cad ? `${state.cad} record` : "county record",
            state.valueYear ?? state.taxYear,
          ]
            .filter(Boolean)
            .join(", ")}
          taxInputs={savingsTaxInputs}
          allowEdit={allowEvidenceUpload}
          onSaveTaxInputs={onSaveSavingsTaxInputs}
          onOpenModule={onOpenModule}
          rationale={estimated.rationale}
          incomeNote={
            incomeComputed.complete && incomeComputed.indicatedValue != null
              ? `Income approach also indicates ${compactCurrency(incomeComputed.indicatedValue)}${
                  incomeComputed.gapPct != null
                    ? ` (${Math.abs(incomeComputed.gapPct)}% ${incomeComputed.gapPct > 0 ? "below" : "above"} CAD)`
                    : ""
                }. See Module 7.`
              : null
          }
        />
      </div>
    );
  }

  // The comps map is fetched independently of the AI guidance text (a different
  // Edge Function, its own loading/error state) — rendered here, before the
  // generic loading/error gate below, so a rate-limited or slow AI call never
  // hides a map that already loaded successfully.
  if (m.id === "comps") {
    const d = moduleState?.data as ModuleResultMap["comps"] | undefined;
    const map = compsMap.data;
    // Interactive comp picking only in the live modal — the printable report
    // (allowEvidenceUpload false) shows the same data read-only.
    const compsInteractive = allowEvidenceUpload;
    const pinnedKeys = pinnedCompKeys(compSelections);
    const stats = computeComparableStats(map?.subject ?? null, map?.comps ?? [], state.totalValue, {
      excludedKeys: excludedCompKeys(compSelections),
      pinnedKeys,
      subjectAddress: state.address,
      extraComps: compSelectionsToExtraComps(compSelections),
    });
    // The final 5 (AI's top 5 by similarity, or the owner's own picks) — the
    // indicated value, adjustments, rate table, chart and AI recommendation
    // below all use exactly these, numbered 1-5 the same way everywhere.
    const usable = stats.ranked.filter((c) => c.marketValue != null && !c.excluded && !c.isSubject);
    const topRanked = stats.selected;
    const numberOf = new Map(topRanked.map((c, i) => [c.key, i + 1]));
    const subjectAddress = state.address || map?.subject?.address || null;
    const confidenceReasoning = comparableConfidenceReasoning(stats);
    const perCompMap = new Map((d?.perComp ?? []).map((p) => [p.key, p]));
    const recommendedKeys = new Set(d?.recommendedKeys ?? []);
    // Anything to reset: a CAD comp ticked/unticked, or an added comp unticked.
    const canResetSelection = compSelections.some(
      (s) => !s.compKey.startsWith("user:") || s.action === "exclude",
    );
    // The map renders for EVERY county, not just the 4 with a comps feed —
    // a synthetic subject from the property's own geocoded point when there
    // are no CAD comps, so the user can still see (and, in Phase B, place)
    // comps relative to it.
    const mapSubject =
      map?.subject ??
      (siteCoords
        ? {
            pid: -1,
            address: state.address ?? "This property",
            latitude: siteCoords.lat,
            longitude: siteCoords.lng,
            marketValue: state.totalValue ?? null,
            ownerName: null,
          }
        : null);
    const mapComps = stats.ranked
      .filter((c) => Number.isFinite(c.latitude) && Number.isFinite(c.longitude))
      .map((c) => ({
        pid: c.pid,
        address: c.address || `Property #${c.pid}`,
        latitude: c.latitude,
        longitude: c.longitude,
        marketValue: c.userAdded ? (c.salePrice ?? null) : c.marketValue,
        ownerName: c.ownerName ?? null,
        distanceMi: c.distanceMi,
        similarity: c.similarity,
        kind: c.userAdded
          ? c.saleVerified
            ? ("sale-verified" as const)
            : ("sale-unverified" as const)
          : ("assessed" as const),
        excluded: c.excluded,
      }));
    const hasAnyComp = stats.ranked.length > 0;
    const statewideSource = compsMap.data?.source === "statewide";

    // Ticking a comp puts it in the final 5 ahead of the AI's own picks;
    // unticking one lets the next most similar comp take its place. An added
    // comp keeps its figures either way (only its action changes).
    function handleToggleSelect(comp: RankedComp, select: boolean) {
      if (select && !comp.selected) {
        const ownPicks = topRanked.filter((c) => pinnedKeys.has(c.key)).length;
        if (ownPicks >= TOP_N_FOR_INDICATED_VALUE) {
          toast.error(
            `You've already picked ${TOP_N_FOR_INDICATED_VALUE} comps — untick one first.`,
          );
          return;
        }
      }
      const action = select ? ("include" as const) : ("exclude" as const);
      const own = comp.userAdded ? compSelections.find((s) => s.compKey === comp.key) : null;
      onSaveCompSelection(own ? { ...own, action } : { compKey: comp.key, action });
    }
    const verifiedSaleCount = mapComps.filter((c) => c.kind === "sale-verified").length;
    // No located subject yet, but there's an address and the CAD-subject /
    // geocode resolution hasn't finished — show "locating", not "couldn't".
    const locating = !mapSubject && !!(state.address || "").trim() && !siteCoordsSettled;

    return (
      <div className="mt-4 grid gap-4">
        {/* Map first — the visual centerpiece of Module 3: every located
            comp plotted against the subject, sale data distinguished from
            assessed-value comps by colour. Shown for every county; when the
            county publishes no comp feed it's still the subject on the map
            with an invitation to add a real sale. */}
        <div id="comps-step-find" className="scroll-mt-4">
          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3">
            <div className="text-sm font-medium">
              {statewideSource ? "Comparable Properties" : "Comparable Sales"} — Located vs. Your
              Property
            </div>
            <div className="text-sm text-muted-foreground">
              {hasAnyComp
                ? `${mapComps.length} located` +
                  (verifiedSaleCount > 0
                    ? ` · ${verifiedSaleCount} verified sale${verifiedSaleCount === 1 ? "" : "s"}`
                    : "")
                : "subject only"}
            </div>
          </div>
          {compsMap.loading || locating ? (
            <div className="grid h-[280px] place-items-center rounded-lg border border-border bg-secondary/40 text-sm text-muted-foreground">
              Locating this property…
            </div>
          ) : mapSubject ? (
            <>
              <CompsMap subject={mapSubject} comps={mapComps} />
              {!hasAnyComp && (
                <p className="mt-1.5 text-sm text-muted-foreground">
                  No comparable sales are published in {state.cad ?? "this county"}&apos;s public
                  data. Texas doesn&apos;t disclose sale prices — add a real sale from a closing
                  statement below and it&apos;ll appear on the map, distinguished from
                  assessed-value comps.
                </p>
              )}
            </>
          ) : (
            <div className="grid h-[200px] place-items-center rounded-lg border border-border bg-secondary/40 text-sm text-muted-foreground">
              Couldn&apos;t locate this property on the map — check the address.
            </div>
          )}
        </div>

        {statewideSource && hasAnyComp && (
          <p className="-mt-2 text-sm text-muted-foreground">
            {map?.comps.length} nearby{" "}
            {map?.subject?.improvementValue === 0 ? "vacant land parcels" : "improved properties"}{" "}
            in {state.cad ?? "this county"} valued within half to double this property, from the
            State of Texas parcel data
            {compsMap.data?.taxYear ? ` (${compsMap.data.taxYear} values)` : ""}. These are the
            district&apos;s assessed values, not sale prices.
          </p>
        )}

        {stats.limitedData && (
          <div className="rounded-lg bg-warning/15 p-3 text-sm text-warning-foreground">
            <span className="font-semibold">Limited Comparable Data.</span>{" "}
            {usable.length === 0
              ? "No comparable properties with a usable value were found, so there's no indicated value yet."
              : `Only ${usable.length} comparable propert${usable.length === 1 ? "y" : "ies"} with a usable value ${usable.length === 1 ? "was" : "were"} found — at least 3 are needed for a reliable value range.`}{" "}
            Adding a real sale from a closing statement (below) strengthens this the most.
          </div>
        )}

        {compsInteractive && (
          <AddCompForm onAdd={onSaveCompSelection} onExtractSale={onExtractCompSale} />
        )}

        {hasAnyComp && (
          <>
            {/* How the comp set was narrowed — real counts only. */}
            <ComparableSelectionFunnel
              reviewed={stats.ranked.filter((c) => !c.isSubject).length}
              qualified={usable.length}
              selected={topRanked.length}
            />

            {/* Comparable table — the final 5 first (AI's picks until the
                owner ticks their own), the full list one click away. */}
            <ComparableTable
              ranked={stats.ranked}
              cad={state.cad}
              perComp={perCompMap}
              recommendedKeys={recommendedKeys}
              onToggleSelect={compsInteractive ? handleToggleSelect : undefined}
              onRemove={compsInteractive ? (c) => onRemoveCompSelection(c.key) : undefined}
              onReset={onResetCompSelections}
              canReset={canResetSelection}
              numberOf={numberOf}
              subjectAddress={subjectAddress}
              subjectValue={stats.subjectValue}
              subjectAcres={map?.subject?.legalAcreage ?? null}
            />

            {/* How each of the final 5 differs from the subject (CAD-record
                signals, so gated on a real CAD subject). */}
            {map?.subject && topRanked.length > 0 && (
              <div>
                <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  How the Top {topRanked.length} Comps Differ from the Subject Property
                </div>
                <ComparableAdjustments
                  subject={map.subject}
                  subjectAddress={subjectAddress}
                  subjectValue={stats.subjectValue}
                  comps={topRanked}
                  numberOf={numberOf}
                />
              </div>
            )}

            <CompsAdjustmentGrid
              perCompAdjustment={stats.perCompAdjustment}
              selected={topRanked}
              numberOf={numberOf}
              adjustedIndicated={stats.adjustedIndicated}
              subjectAddress={subjectAddress}
              subjectValue={stats.subjectValue}
              subjectAcres={map?.subject?.legalAcreage ?? null}
            />

            {/* Value comparison chart — subject vs. the final 5. */}
            {(stats.subjectValue != null || topRanked.length > 0) && (
              <div>
                <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Assessed Value Comparison — Subject vs. Top {topRanked.length} Comps
                </div>
                <ComparableValueChart
                  subjectValue={stats.subjectValue}
                  comps={topRanked}
                  numberOf={numberOf}
                  median={stats.indicated?.median ?? null}
                />
              </div>
            )}

            {/* 6. Indicated Value / CAD Value / Gap. Prefers the rate-based
                target range (comps priced below the subject's own $/acre)
                when at least one qualifies; otherwise the raw top-5 range. */}
            {stats.indicated && (
              <div id="comps-step-value" className="grid scroll-mt-4 grid-cols-3 gap-2">
                <div className="rounded-lg bg-success/10 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-success">
                    {stats.adjustedIndicated ? "Indicated Target Range" : "Indicated Value Range"}
                  </div>
                  <div className="mt-0.5 text-lg font-bold text-success">
                    {stats.adjustedIndicated
                      ? `${compactCurrency(stats.adjustedIndicated.min)}–${compactCurrency(stats.adjustedIndicated.max)}`
                      : `${compactCurrency(stats.indicated.min)}–${compactCurrency(stats.indicated.max)}`}
                  </div>
                </div>
                {stats.subjectValue != null && (
                  <div className="rounded-lg bg-destructive/10 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-destructive">
                      CAD Value
                    </div>
                    <div className="mt-0.5 text-lg font-bold text-destructive">
                      {compactCurrency(stats.subjectValue)}
                    </div>
                  </div>
                )}
                <div className="rounded-lg bg-secondary/60 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Valuation Gap
                  </div>
                  <div className="mt-0.5 text-lg font-bold">
                    {stats.valuationGapPct != null
                      ? `${stats.valuationGapPct > 0 ? "+" : ""}${stats.valuationGapPct}%`
                      : "—"}
                  </div>
                </div>
              </div>
            )}

            {/* 7. Confidence — real percentage + real, deterministic reasoning. */}
            {stats.confidencePct != null && (
              <div id="comps-step-confidence" className="card-elev scroll-mt-4 p-4">
                <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Comparable Confidence
                </div>
                <MiniMeter value={stats.confidencePct} label="Comparable confidence" />
                {confidenceReasoning && (
                  <p className="mt-2 text-sm text-muted-foreground">{confidenceReasoning}</p>
                )}
              </div>
            )}

            {/* 8. Methodology + Sources — real, static facts (not AI prose),
                so this is short icon-led bullets rather than paragraphs. */}
            <div className="grid gap-3 rounded-lg bg-secondary/40 p-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <div className="text-sm font-semibold text-foreground">Methodology</div>
                <FactBullet icon={Building2}>
                  {statewideSource
                    ? "Same county and kind (vacant land or improved), valued half to double this property, nearest first"
                    : "Same CAD subdivision as this property"}
                </FactBullet>
                <FactBullet icon={Percent}>
                  0–100 similarity: value, distance, size, use, recency, source reliability
                </FactBullet>
                <FactBullet icon={Target}>
                  Top 5 normalized to $/acre (or $/SF), size + time adjusted, then reconciled
                </FactBullet>
              </div>
              <div className="grid gap-1.5">
                <div className="text-sm font-semibold text-foreground">Sources</div>
                <FactBullet icon={FileText}>
                  {statewideSource
                    ? `State of Texas parcel data (TxGIO), compiled from ${state.cad ?? "the county appraisal district"}'s records${compsMap.data?.taxYear ? ` — ${compsMap.data.taxYear} values` : ""} — plus any closing documents you upload`
                    : `${state.cad ?? "County appraisal district"} assessed-value records + any closing documents you upload`}
                </FactBullet>
                <FactBullet icon={ShieldCheck}>
                  Texas doesn&apos;t disclose sale prices — a verified price shows only for a comp
                  backed by a document. ATTOM / LightBox / MLS are not connected.
                </FactBullet>
              </div>
            </div>
            {state.deeds && state.deeds.length > 0 && (
              <div>
                <div className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  This Property's Deed History
                </div>
                <div className="mt-1.5 overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[520px] text-left text-sm">
                    <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Date</th>
                        <th className="px-3 py-2 font-semibold">Type</th>
                        <th className="px-3 py-2 font-semibold">Seller</th>
                        <th className="px-3 py-2 font-semibold">Buyer</th>
                        <th className="px-3 py-2 font-semibold">Instrument #</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.deeds.map((deed, i) => (
                        <tr key={i} className="border-t border-border/60">
                          <td className="px-3 py-2 text-muted-foreground">
                            {deed.date?.slice(0, 10) ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {deed.description ?? deed.type ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{deed.seller ?? "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{deed.buyer ?? "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {deed.instrumentNum ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  No sale price is shown because none is publicly recorded under Texas law.
                </p>
              </div>
            )}
          </>
        )}

        {/* AI guidance + checklist + the strongest 3-5 comps + how to use
            them — the genuinely AI-generated part of this module, grounded
            in the real ranked comps sent from loadModule() above and
            clamped server-side to that set. */}
        {loading ? (
          <p className="text-sm text-muted-foreground">AI is generating this analysis…</p>
        ) : error ? (
          <ErrorWithRetry message={error} onRetry={onRetry} />
        ) : d ? (
          <div id="comps-step-recommendation" className="grid scroll-mt-4 gap-3">
            <AiVerdictLine icon={m.icon} text={d.guidance} color={m.color} />
            <ChecklistSteps items={d.checklist} color={m.color} />

            {recommendedKeys.size > 0 && (
              <div>
                <div className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  AI-Recommended Comps ({recommendedKeys.size})
                </div>
                <ul className="grid gap-1 text-sm">
                  {stats.ranked
                    .filter((c) => recommendedKeys.has(c.key))
                    .map((c) => {
                      const reason = perCompMap.get(c.key)?.reason;
                      return (
                        <li key={c.key} className="flex items-start gap-1.5">
                          <span className="mt-0.5 text-success">✓</span>
                          <span>
                            <span className="font-medium">{compLabel(c, numberOf)}</span>
                            {" — "}
                            {c.similarity}/100 similarity
                            {reason ? `. ${reason}` : ""}
                          </span>
                        </li>
                      );
                    })}
                </ul>
              </div>
            )}

            {(() => {
              const excludeSuggestions = (d.perComp ?? []).filter(
                (p) => p.verdict === "exclude" && !recommendedKeys.has(p.key),
              );
              if (excludeSuggestions.length === 0) return null;
              const addr = (key: string) => {
                const c = stats.ranked.find((r) => r.key === key);
                return c ? compLabel(c, numberOf) : "A comparable";
              };
              return (
                <div>
                  <div className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Suggested Exclusions
                  </div>
                  <ul className="grid gap-1 text-sm text-muted-foreground">
                    {excludeSuggestions.map((p) => (
                      <li key={p.key} className="flex items-start gap-1.5">
                        <span className="mt-0.5 text-warning-foreground">✕</span>
                        <span>
                          <span className="font-medium text-foreground">{addr(p.key)}</span>
                          {p.reason ? ` — ${p.reason}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()}

            {(d.protestRecommendation || d.recommendedUse) && (
              <div>
                <div className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Protest Recommendation
                </div>
                <AiVerdictLine
                  icon={ArrowRight}
                  text={d.protestRecommendation || d.recommendedUse}
                  color={m.color}
                />
              </div>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  if (loading) {
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        {m.id === "health" ? "AI is scoring this property…" : "AI is generating this analysis…"}
      </p>
    );
  }
  if (error) {
    return <ErrorWithRetry message={error} onRetry={onRetry} />;
  }
  if (!moduleState?.data) return null;

  if (m.id === "health") {
    const data = moduleState.data as HealthScoreResult;
    return (
      <Module1Content
        data={data}
        state={state}
        estimated={estimated}
        m={m}
        moduleData={moduleData}
        onStartProtest={onStartProtest}
        onReloadModule={onReloadModule}
        onOpenModule={onOpenModule}
        compsMap={compsMap}
        evidenceDocs={evidenceDocs}
        protest={existingProtest}
        property={resolvedProperty}
        onViewCase={onViewCase}
      />
    );
  }

  switch (m.id) {
    case "strategy": {
      const d = moduleState.data as ModuleResultMap["strategy"];
      if (d.strategies.length === 0) {
        return (
          <p className="mt-4 text-sm text-muted-foreground">
            AI cannot proceed without enough property data to evaluate any strategy yet.
          </p>
        );
      }
      return (
        <Module2Content
          d={d}
          m={m}
          state={state}
          evidenceDocs={evidenceDocs}
          uploadingEvidence={uploadingEvidence}
          onUploadEvidence={onUploadEvidence}
          onAnswerStrategy={onAnswerStrategy}
          onForceReload={onForceReload}
          onOpenModule={onOpenModule}
          onAskQuestion={onAskQuestion}
          refreshing={!!moduleState?.loading}
        />
      );
    }
    case "site": {
      const d = moduleState.data as ModuleResultMap["site"];
      const siteGis = siteGisMap.data;
      const gaps = countDataGaps(d.factors);
      const nextModule = MODULES.find((mm) => mm.id === "improvement");
      const siteDocs = evidenceDocs.filter(
        (doc) => doc.modules?.includes("site") || doc.documentType?.startsWith("Site: "),
      );
      const siteFactorKinds = d.factors.map((f) => f.factor);
      // One upload -> AI reads each file and tags it to the site factor it
      // documents (Floodplain, Easements, Drainage, …), or leaves it generic
      // when it can't tell. Mirrors Module 5/6/7/8.
      async function handleSiteAutoUpload(files: File[]) {
        setCategorizingEvidence(true);
        try {
          const categorized = await categorizeEvidenceUploads(siteFactorKinds, files);
          const groups = new Map<string, File[]>();
          for (const file of files) {
            const matched = categorized.find((c) => c.fileName === file.name)?.matchedItem ?? null;
            const key =
              matched && siteFactorKinds.includes(matched as (typeof siteFactorKinds)[number])
                ? `Site: ${matched}`
                : PROTEST_EVIDENCE_DOCUMENT_TYPE;
            const g = groups.get(key);
            if (g) g.push(file);
            else groups.set(key, [file]);
          }
          for (const [documentType, groupFiles] of groups) {
            await onUploadEvidence(groupFiles, undefined, documentType);
          }
        } finally {
          setCategorizingEvidence(false);
        }
      }
      return (
        <div className="mt-4 grid gap-4">
          {resolvedProperty && (
            <SiteReportsPanel
              propertyId={resolvedProperty.id}
              userId={authUser?.id ?? null}
              canEdit={allowEvidenceUpload && !!authUser}
              onApply={onForceReload}
              facts={{
                address: state.address ?? null,
                cad: state.cad ?? null,
                floodZone: siteGis?.floodZone
                  ? `Zone ${siteGis.floodZone.zone} (${siteGis.floodZone.label})`
                  : null,
                elevationFt: siteGis?.elevationFt ?? null,
                acres: compsMap.data?.subject?.legalAcreage ?? null,
                nearestHighwayMi: siteGis?.nearestHighwayMi ?? null,
                nearestRailMi: siteGis?.nearestRailMi ?? null,
              }}
            />
          )}
          <div>
            <div className="relative">
              {siteCoords ? (
                <SiteMapThumb lat={siteCoords.lat} lng={siteCoords.lng} height={220} />
              ) : (
                <div className="grid h-[220px] place-items-center rounded-lg bg-secondary/40">
                  <MapPin className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
              <FloodZoneBadge floodZone={siteGis?.floodZone} />
            </div>
            {/* Real "Site Facts" strip — only ever the two point facts this
                app can actually fetch (FEMA/USGS); nothing else is claimed. */}
            {(siteGis?.floodZone || siteGis?.elevationFt != null) && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Fetched records:</span>
                {siteGis?.floodZone && (
                  <span>
                    Flood zone:{" "}
                    <strong className="text-foreground">{siteGis.floodZone.label}</strong>
                  </span>
                )}
                {siteGis?.elevationFt != null && (
                  <span>
                    Elevation:{" "}
                    <strong className="text-foreground">
                      {Math.round(siteGis.elevationFt)} ft
                    </strong>{" "}
                    (single point, not a full survey)
                  </span>
                )}
              </div>
            )}
          </div>

          <MiniMeter value={d.priorityScore} label="Documentation priority" />

          {d.guidance && <AiVerdictLine icon={m.icon} text={d.guidance} color={m.color} />}

          {/* Split, not one flat 14-row list — see MODULE_SPECS.site and
              enforceSiteFactorRealData in the edge function. The 1-2 factors
              with a real/partial finding (almost always just Floodplain/
              Grade) get full detail cards, since there's genuine substance
              to read; the remaining "Additional Data Needed" majority — a
              near-duplicate explanation each — collapses into one compact,
              tappable icon grid instead of 12 more full-text cards nobody
              would actually read through. */}
          {(() => {
            // Combines the server's own status with the override state
            // directly (not just d.factors.status) so a factor moves to
            // "Marked Not Applicable" the instant the user clicks, without
            // waiting on the forced reload this also triggers (see
            // markNotApplicable() in Report()) to come back.
            const isNA = (factor: string) => isItemNotApplicable(overrides, "site", factor);
            const withData = d.factors.filter(
              (f) =>
                f.status !== "Additional Data Needed" &&
                f.status !== "Not Applicable" &&
                !isNA(f.factor),
            );
            const missing = d.factors.filter(
              (f) => f.status === "Additional Data Needed" && !isNA(f.factor),
            );
            const notApplicableFactors = d.factors.filter(
              (f) => f.status === "Not Applicable" || isNA(f.factor),
            );
            return (
              <>
                {withData.length > 0 && (
                  <div>
                    <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      What We Found
                    </div>
                    <div className="grid gap-1.5">
                      {withData.map((f) => (
                        <SiteFactorRow key={f.factor} factor={f} onOpenModule={onOpenModule} />
                      ))}
                    </div>
                  </div>
                )}
                {missing.length > 0 && (
                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Needs More Data
                      </div>
                      <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                        {gaps} of {d.factors.length}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                      {missing.map((f) => (
                        <SiteFactorGapTile
                          key={f.factor}
                          factor={f}
                          onOpenModule={onOpenModule}
                          onMarkNotApplicable={() => onMarkNotApplicable("site", f.factor)}
                          onUpload={(factor, files) =>
                            onUploadEvidence(files, undefined, `Site: ${factor.factor}`)
                          }
                          uploading={uploadingEvidence}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {notApplicableFactors.length > 0 && (
                  <div>
                    <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Marked Not Applicable / Not Available
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                      {notApplicableFactors.map((f) => (
                        <SiteFactorNotApplicableTile
                          key={f.factor}
                          label={f.factor}
                          onClear={() => onClearNotApplicable("site", f.factor)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            );
          })()}

          {d.keyFinding && (
            <div className={`rounded-lg p-4 ${m.color.bg}`}>
              <div className={`text-[10px] font-semibold uppercase tracking-wide ${m.color.text}`}>
                Key Finding
              </div>
              <p className="mt-1 text-sm text-foreground/90">{d.keyFinding}</p>
            </div>
          )}

          {allowEvidenceUpload && (
            <div className="rounded-lg border border-border">
              <div className="bg-secondary/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Data &amp; Evidence
              </div>
              {siteDocs.length > 0 && (
                <ul className="grid gap-1 px-4 py-2.5 text-xs">
                  {siteDocs.map((doc) => (
                    <li key={doc.id} className="flex items-center justify-between gap-2">
                      <span className="truncate text-muted-foreground">{doc.fileName}</span>
                      <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                        {doc.documentType?.replace(/^Site:\s*/, "") ?? "Site"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-center justify-center gap-2 border-t border-border/60 px-4 py-3">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-accent/50 bg-background px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/10">
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    multiple
                    disabled={uploadingEvidence || categorizingEvidence}
                    className="hidden"
                    onChange={(e) => {
                      const sel = Array.from(e.target.files ?? []);
                      e.target.value = "";
                      if (sel.length > 0) handleSiteAutoUpload(sel);
                    }}
                  />
                  <Upload className="h-3.5 w-3.5" />
                  {categorizingEvidence
                    ? "Reading documents…"
                    : uploadingEvidence
                      ? "Uploading…"
                      : "Upload documents"}
                </label>
                <button
                  type="button"
                  onClick={onRefreshSiteGis}
                  disabled={siteGisRefreshing}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary disabled:opacity-60"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${siteGisRefreshing ? "animate-spin" : ""}`} />
                  {siteGisRefreshing ? "Fetching…" : "Fetch details"}
                </button>
              </div>
              <p className="px-4 pb-3 text-center text-[10px] text-muted-foreground">
                Upload a survey, plat, flood determination, or site photos — the AI tags each to the
                right factor. Fetch details re-pulls the FEMA flood zone and USGS elevation.
              </p>
            </div>
          )}

          {nextModule && (
            <button
              type="button"
              onClick={() => onOpenModule(nextModule.id)}
              className="flex items-center justify-between gap-2 rounded-lg bg-secondary/40 px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-secondary/60"
            >
              <span>Next Step: Evaluate {nextModule.shortName}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      );
    }
    case "improvement": {
      const d = moduleState.data as ModuleResultMap["improvement"];
      const improvementDocs = evidenceDocs.filter(
        (doc) =>
          doc.modules?.includes("improvement") ||
          doc.documentType === EVIDENCE_DOCUMENT_TYPE ||
          doc.documentType?.startsWith("Improvement: "),
      );
      return (
        <Module5Content
          d={d}
          m={m}
          state={state}
          overrides={overrides}
          onMarkNotApplicable={onMarkNotApplicable}
          onClearNotApplicable={onClearNotApplicable}
          improvementDocs={improvementDocs}
          onOpenModule={onOpenModule}
          workspace={
            resolvedProperty
              ? {
                  propertyId: resolvedProperty.id,
                  userId: authUser?.id ?? null,
                  canEdit: allowEvidenceUpload && !!authUser,
                  onApply: onForceReload,
                }
              : null
          }
        />
      );
    }
    case "zoning": {
      const d = moduleState.data as ModuleResultMap["zoning"];
      const zoningDocs = evidenceDocs.filter(
        (doc) => doc.modules?.includes("zoning") || doc.documentType?.startsWith("Zoning: "),
      );
      // One upload -> AI tags each file to the aspect it documents. Mirrors
      // Module 7 / Module 8's bulk categorize-then-upload. Reuses the shared
      // "reading documents" flag (only one module modal is open at a time).
      async function handleZoningAutoUpload(files: File[]) {
        setCategorizingEvidence(true);
        try {
          const categorized = await categorizeEvidenceUploads([...ZONING_ASPECT_KINDS], files);
          const groups = new Map<string, File[]>();
          for (const file of files) {
            const matched = categorized.find((c) => c.fileName === file.name)?.matchedItem ?? null;
            const key =
              matched && (ZONING_ASPECT_KINDS as readonly string[]).includes(matched)
                ? matched
                : "General";
            const g = groups.get(key);
            if (g) g.push(file);
            else groups.set(key, [file]);
          }
          for (const [kind, groupFiles] of groups) {
            await onUploadEvidence(groupFiles, undefined, `Zoning: ${kind}`);
          }
        } finally {
          setCategorizingEvidence(false);
        }
      }
      return (
        <div className="mt-4 grid gap-4">
          <p className="-mb-1 text-sm text-muted-foreground">
            AI checks alignment across classification, use, and zoning, then identifies issues.
          </p>
          <AnalysisPipeline
            steps={[
              { eyebrow: "User input", label: "Property & zoning data", Icon: User },
              { eyebrow: "AI processing", label: "Zoning & use analyzer", Icon: Cpu },
              { eyebrow: "Logic / decision", label: "Alignment & impact model", Icon: Scale },
              {
                eyebrow: "AI output",
                label: "Zoning analysis report",
                Icon: Gauge,
                current: true,
              },
              { eyebrow: "Next step", label: "Apply to value relevance", Icon: ArrowRight },
            ]}
          />

          <ZoningBadge matches={d.matches} />
          <AiVerdictLine icon={m.icon} text={d.assessment} color={m.color} />

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Category:</span>
            <span className="badge-soft">{d.category}</span>
            <span className="text-muted-foreground">· Typical CAD class:</span>
            <span className="font-medium">{d.typicalClassification || "—"}</span>
          </div>

          <ZoningClassificationTable
            aspects={d.aspects}
            matches={d.matches}
            zoningDocs={zoningDocs}
            onUpload={allowEvidenceUpload ? handleZoningAutoUpload : undefined}
            onFetchDetails={allowEvidenceUpload ? onFetchCadDetails : undefined}
            uploading={uploadingEvidence}
            categorizing={categorizingEvidence}
            fetching={cadFetching}
          />

          {d.discrepancies.length > 0 && (
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-4">
              <div className="text-sm font-semibold text-warning-foreground">
                Detected discrepancies
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                A classification or zoning mismatch is a fact to explain — not, by itself, proof the
                property is overvalued.
              </p>
              <ul className="mt-2.5 grid gap-2 text-sm">
                {d.discrepancies.map((dc, i) => (
                  <li key={i}>
                    <span className="font-medium">{dc.between}</span>
                    <span className="ml-1.5 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      {dc.confidence} confidence
                    </span>
                    <div className="text-muted-foreground">{dc.detail}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              AI Analysis &amp; Impact
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <ZoningImpactCol title="Valuation relevance" tone="success">
                <p>{d.valuationRelevance}</p>
              </ZoningImpactCol>
              <ZoningImpactCol title="Possible exemptions" tone="accent">
                {d.possibleExemptions.length > 0 ? (
                  <ul className="grid gap-1.5 pl-4 list-disc">
                    {d.possibleExemptions.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                ) : (
                  <p>None identified from the data on file.</p>
                )}
              </ZoningImpactCol>
              <ZoningImpactCol title="Evidence required" tone="success">
                {d.evidenceRequired.length > 0 ? (
                  <ul className="grid gap-1.5 pl-4 list-disc">
                    {d.evidenceRequired.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                ) : (
                  <p>—</p>
                )}
              </ZoningImpactCol>
            </div>
          </div>

          <div className="grid gap-3 rounded-lg bg-secondary/40 p-4 text-sm sm:grid-cols-2">
            <div>
              <div className="font-semibold text-foreground">Restrictions</div>
              <p className="text-muted-foreground">{d.restrictions || "—"}</p>
            </div>
            <div>
              <div className="font-semibold text-foreground">Comparable classifications</div>
              <p className="text-muted-foreground">{d.comparableClassifications || "—"}</p>
            </div>
          </div>
        </div>
      );
    }
    case "evidence": {
      const d = moduleState.data as ModuleResultMap["evidence"];
      // priority/status is the real model; importance/availability fall back
      // for a stale cache. Only Critical + Missing blocks the user.
      const evPriority = (it: ModuleResultMap["evidence"]["items"][number]) =>
        it.priority ?? (it.importance === "High" ? "Important" : "Supporting");
      const evStatus = (it: ModuleResultMap["evidence"]["items"][number]) =>
        it.status ?? (it.availability === "Low" ? "Missing" : "Found");
      const onFileItems = d.items.filter((i) => evStatus(i) !== "Missing");
      // Missing items the owner marked "not available" stop asking for action —
      // they get their own group with the AI's "what to do instead".
      const notAvailable = (i: ModuleResultMap["evidence"]["items"][number]) =>
        evStatus(i) === "Missing" &&
        isUnavailable({ item: i.item, status: "Missing" }, unavailable);
      const needsActionItems = d.items.filter(
        (i) => evStatus(i) === "Missing" && evPriority(i) === "Critical" && !notAvailable(i),
      );
      const strengthenItems = d.items.filter(
        (i) => evStatus(i) === "Missing" && evPriority(i) !== "Critical" && !notAvailable(i),
      );
      // plus marks whose item a regenerated checklist renamed or dropped
      const unavailableItems = [
        ...d.items.filter(notAvailable),
        ...orphanedUnavailable(d.items, unavailable),
      ];
      const verifiedCount = d.items.filter((i) => evStatus(i) === "Verified").length;
      const foundCount = d.items.filter((i) => evStatus(i) === "Found").length;
      // Real protest-case evidence — the generic PROTEST_EVIDENCE_DOCUMENT_TYPE
      // tag CaseDetailModal's own evidence-checklist upload uses (so a file
      // uploaded from either path shows up here together), PLUS anything
      // uploaded straight into one of this module's own checklist categories
      // below (`Evidence Category: <slug>`) — both are real protest evidence
      // for this case, just tagged by how the user chose to upload them.
      // "Analyze My Evidence"/the evidence packet should see all of it.
      const protestEvidenceDocs = evidenceDocs.filter(
        (doc) =>
          doc.useAsEvidence === true ||
          (doc.useAsEvidence !== false &&
            (doc.documentType === PROTEST_EVIDENCE_DOCUMENT_TYPE ||
              doc.documentType?.startsWith("Evidence Category: "))),
      );

      // Runs before the actual upload — reads each picked file's real
      // content and matches it against this property's OWN current
      // checklist (never a fixed taxonomy), so the generic bulk upload
      // button below can tag files with the right category automatically
      // instead of leaving them uncategorized. Never blocks the upload
      // itself: if categorization fails, every file just uploads
      // uncategorized, same as before this feature existed.
      async function handleBulkUploadEvidence(files: File[]) {
        setCategorizingEvidence(true);
        try {
          const categorized = await categorizeEvidenceUploads(
            d.items.map((it) => it.item),
            files,
          );
          const groups = new Map<string, File[]>();
          for (const file of files) {
            const matched = categorized.find((c) => c.fileName === file.name)?.matchedItem ?? null;
            const key = matched ?? "";
            const group = groups.get(key);
            if (group) group.push(file);
            else groups.set(key, [file]);
          }
          for (const [matchedItem, groupFiles] of groups) {
            const documentType = matchedItem
              ? `Evidence Category: ${evidenceItemSlug(matchedItem)}`
              : PROTEST_EVIDENCE_DOCUMENT_TYPE;
            await onUploadEvidence(groupFiles, undefined, documentType);
          }
        } finally {
          setCategorizingEvidence(false);
        }
      }

      // Real AI read of the customer's own uploaded evidence — never
      // automatic, only from the explicit "Analyze My Evidence" click
      // below. Same real strategy-name lookup Module 10 (executive) below
      // already does from this same moduleData prop.
      const strategyForAnalysis =
        (moduleData.strategy?.data as ModuleResultMap["strategy"] | undefined)?.strategies[0]
          ?.name ?? null;

      async function handleAnalyzeEvidence() {
        if (!resolvedProperty) return;
        setAnalyzing(true);
        setAnalysisError(null);
        try {
          const result = await analyzeEvidence(
            resolvedProperty,
            strategyForAnalysis,
            protestEvidenceDocs,
          );
          setAnalysis(result);
        } catch (err) {
          setAnalysisError(err instanceof Error ? err.message : "Could not analyze this evidence.");
        } finally {
          setAnalyzing(false);
        }
      }

      // Only "Accepted"/"Needs Review"/"Additional Information Needed" ever
      // make it into the packet — see INCLUDED_STATUSES in
      // evidence-packet.ts for why "Incorrect Document"/"Duplicate" don't.
      const packetEligibleCount =
        analysis?.documentFindings.filter((f) =>
          (
            ["Accepted", "Needs Review", "Additional Information Needed"] as DocumentStatus[]
          ).includes(f.status),
        ).length ?? 0;

      async function handleDownloadPacket() {
        if (!resolvedProperty || !analysis) return;
        setDownloadingPacket(true);
        setPacketError(null);
        try {
          const worksheet = await getValuationWorksheet(resolvedProperty.id).catch(() => null);
          const bytes = await buildEvidencePacket(
            resolvedProperty,
            protestEvidenceDocs,
            analysis.documentFindings,
            d.items,
            worksheet?.summary ?? null,
          );
          const filenameBase = resolvedProperty.accountNumber ?? resolvedProperty.id;
          downloadPdf(bytes, `Evidence-Packet-${filenameBase}.pdf`);
          toast.success("Evidence packet downloaded.");
        } catch (err) {
          setPacketError(
            getErrorMessage(err, "Could not compile the evidence packet. Please try again."),
          );
        } finally {
          setDownloadingPacket(false);
        }
      }

      const renderEvidenceRow = (it: ModuleResultMap["evidence"]["items"][number]) => {
        const slug = evidenceItemSlug(it.item);
        const uploadedForItem = protestEvidenceDocs.filter(
          (doc) => doc.documentType === `Evidence Category: ${slug}`,
        );
        return (
          <EvidenceCategoryRow
            key={it.item}
            it={it}
            uploadedDocs={uploadedForItem}
            categories={d.items.map((x) => ({ label: x.item, slug: evidenceItemSlug(x.item) }))}
            expanded={expandedEvidenceItem === it.item}
            onToggleExpand={() =>
              setExpandedEvidenceItem((prev) => (prev === it.item ? null : it.item))
            }
            uploadingEvidence={uploadingEvidence}
            onUploadEvidence={(files) =>
              onUploadEvidence(files, undefined, `Evidence Category: ${slug}`)
            }
            unavailable={unavailable.get(slug) ?? null}
            onMarkUnavailable={
              allowEvidenceUpload && resolvedProperty
                ? async (reason, note) => {
                    const rec = await markUnavailable({
                      property: resolvedProperty,
                      item: it,
                      checklist: d.items,
                      strategies: (
                        (moduleData.strategy?.data as ModuleResultMap["strategy"] | undefined)
                          ?.strategies ?? []
                      ).map((s) => s.name),
                      reason,
                      note,
                    });
                    setUnavailable((prev) => new Map(prev).set(slug, rec));
                  }
                : undefined
            }
            onClearUnavailable={
              allowEvidenceUpload
                ? async () => {
                    const rec = unavailable.get(slug);
                    if (!rec) return;
                    await clearUnavailable(rec.id);
                    setUnavailable((prev) => {
                      const next = new Map(prev);
                      next.delete(slug);
                      return next;
                    });
                  }
                : undefined
            }
          />
        );
      };

      // Part 2's library grouping — only categories actually present for
      // this property/strategy are shown, never a padded generic 11-row
      // list ("AI should not require every document").
      const categoriesPresent = EVIDENCE_CATEGORY_ORDER.filter((cat) =>
        d.items.some((it) => (it.category ?? "Other Supporting Evidence") === cat),
      );

      return (
        <div className="mt-4 grid gap-3" id="evidence-checklist-top">
          {allowEvidenceUpload && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
              <div className="min-w-0 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{verifiedCount} verified</span> ·{" "}
                {foundCount} to review ·{" "}
                <span
                  className={needsActionItems.length > 0 ? "font-semibold text-destructive" : ""}
                >
                  {needsActionItems.length} need action
                </span>
                {unavailableItems.length > 0 && <> · {unavailableItems.length} not available</>}
              </div>
              <button
                type="button"
                onClick={onAutoSourceEvidence}
                disabled={autoSourcingEvidence}
                className="btn-outline text-xs py-1.5 disabled:opacity-60"
              >
                {autoSourcingEvidence ? "Sourcing…" : "Auto-source evidence"}
              </button>
            </div>
          )}

          {categoriesPresent.length > 1 && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="text-muted-foreground">Group by:</span>
              {(["priority", "category"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setEvidenceGroupBy(mode)}
                  className={`rounded-full px-2 py-0.5 font-medium capitalize ${
                    evidenceGroupBy === mode
                      ? "bg-accent/15 text-accent"
                      : "text-muted-foreground hover:bg-secondary/60"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          )}

          {evidenceGroupBy === "priority" ? (
            <>
              {needsActionItems.length > 0 && (
                <div
                  id="evidence-needs-action"
                  className="grid gap-2 rounded-md bg-destructive/5 p-2"
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Needs your action — {needsActionItems.length} critical item
                    {needsActionItems.length === 1 ? "" : "s"} missing
                  </div>
                  {needsActionItems.map(renderEvidenceRow)}
                </div>
              )}

              {onFileItems.length > 0 && (
                <div className="grid gap-2">
                  <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    On file &amp; verified — {onFileItems.length}
                  </div>
                  {onFileItems.map(renderEvidenceRow)}
                </div>
              )}

              {strengthenItems.length > 0 && (
                <div className="grid gap-2">
                  <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    Strengthen your case (optional) — {strengthenItems.length}
                  </div>
                  <p className="-mt-1 text-[11px] text-muted-foreground">
                    None of these block your protest — they add weight where the case is thin.
                  </p>
                  {strengthenItems.map(renderEvidenceRow)}
                </div>
              )}

              {unavailableItems.length > 0 && (
                <div className="grid gap-2">
                  <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    Not available — strategy adjusted — {unavailableItems.length}
                  </div>
                  <p className="-mt-1 text-[11px] text-muted-foreground">
                    You told us you can&apos;t provide these. Open one to see what AI suggests using
                    instead and how the case changes without it.
                  </p>
                  {unavailableItems.map(renderEvidenceRow)}
                </div>
              )}
            </>
          ) : (
            <div className="grid gap-3">
              {categoriesPresent.map((cat) => {
                const inCategory = d.items.filter(
                  (it) => (it.category ?? "Other Supporting Evidence") === cat,
                );
                return (
                  <div key={cat} className="grid gap-2">
                    <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      {cat} — {inCategory.length}
                    </div>
                    {inCategory.map(renderEvidenceRow)}
                  </div>
                );
              })}
            </div>
          )}

          {/* Part 7's "Evidence Completeness Check" — real counts by
              priority tier, never a re-judgment of any item, and never
              blocking: only Critical missing changes the completion label,
              exactly the "only Critical blocks" rule Part 3 already set. */}
          {d.items.length > 0 && (
            <div className="grid gap-2 rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Evidence Readiness
                </div>
                <span
                  className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    needsActionItems.length > 0
                      ? "bg-warning/15 text-warning-foreground"
                      : unavailableItems.some((i) => evPriority(i) === "Critical")
                        ? "bg-accent/15 text-accent"
                        : "bg-success/15 text-success"
                  }`}
                >
                  {needsActionItems.length > 0
                    ? "Incomplete — Additional Evidence Suggested"
                    : unavailableItems.some((i) => evPriority(i) === "Critical")
                      ? "Gaps Noted — Strategy Adjusted"
                      : "Complete"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-3">
                {(
                  [
                    ["Critical Evidence", "Critical"],
                    ["Important Evidence", "Important"],
                    ["Supporting Evidence", "Supporting"],
                  ] as const
                ).map(([label, tier]) => {
                  const total = d.items.filter((i) => evPriority(i) === tier).length;
                  const have = d.items.filter(
                    (i) => evPriority(i) === tier && evStatus(i) !== "Missing",
                  ).length;
                  return total > 0 ? (
                    <div key={tier}>
                      <span className="text-muted-foreground">{label}: </span>
                      <span className="font-medium">
                        {have} of {total}
                      </span>
                    </div>
                  ) : null;
                })}
                <div>
                  <span className="text-muted-foreground">Missing Evidence: </span>
                  <span className="font-medium">
                    {d.items.filter((i) => evStatus(i) === "Missing").length}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Evidence Packet: </span>
                  <span className="font-medium">
                    {analysis && packetEligibleCount > 0 && needsActionItems.length === 0
                      ? "Ready"
                      : "In Progress"}
                  </span>
                </div>
              </div>
              {needsActionItems.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    Additional Evidence Suggested
                  </span>{" "}
                  — one or more important items are still missing. You can continue, but obtaining
                  the recommended evidence could strengthen the identified protest arguments.
                </p>
              )}
            </div>
          )}

          {allowEvidenceUpload && (
            <div
              id="evidence-upload-section"
              className="border-t border-border/60 pt-4 print:hidden"
            >
              <div className="text-sm font-medium">
                {protestEvidenceDocs.length > 0 ? "Upload More Evidence" : "Upload Evidence"}
              </div>
              <p className="text-xs text-muted-foreground">
                Add documents in bulk — AI reads each one and sorts it into the matching category
                above automatically. Anything that doesn't clearly match stays here, uncategorized.
              </p>
              {protestEvidenceDocs.length > 0 && (
                <ul className="mt-2 grid gap-1.5 text-xs text-muted-foreground">
                  {protestEvidenceDocs.map((doc) => (
                    <EvidenceFileRow
                      key={doc.id}
                      doc={doc}
                      categories={d.items.map((it) => ({
                        label: it.item,
                        slug: evidenceItemSlug(it.item),
                      }))}
                    />
                  ))}
                </ul>
              )}
              <label
                className={`mt-3 inline-flex btn-outline text-sm cursor-pointer ${uploadingEvidence || categorizingEvidence ? "pointer-events-none opacity-60" : ""}`}
              >
                {categorizingEvidence
                  ? "Sorting your documents…"
                  : uploadingEvidence
                    ? "Uploading…"
                    : protestEvidenceDocs.length > 0
                      ? "Upload More Evidence"
                      : "Upload Evidence"}
                <input
                  type="file"
                  accept="image/*,.pdf"
                  multiple
                  className="hidden"
                  disabled={uploadingEvidence || categorizingEvidence}
                  onChange={(e) => {
                    const selected = e.target.files ? Array.from(e.target.files) : [];
                    e.target.value = "";
                    if (selected.length > 0) handleBulkUploadEvidence(selected);
                  }}
                />
              </label>
            </div>
          )}

          {allowEvidenceUpload && protestEvidenceDocs.length > 0 && (
            <div className="border-t border-border/60 pt-4 print:hidden">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">AI Evidence Analysis</div>
                <button
                  type="button"
                  onClick={handleAnalyzeEvidence}
                  disabled={analyzing}
                  className="btn-outline text-xs py-1 disabled:opacity-60"
                >
                  {analyzing
                    ? "Reading your evidence…"
                    : analysis
                      ? "Re-Analyze"
                      : "Analyze My Evidence"}
                </button>
              </div>
              {!analysis && !analyzing && !analysisError && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Corvus AI reads your {protestEvidenceDocs.length} uploaded document
                  {protestEvidenceDocs.length === 1 ? "" : "s"} and tells you what it actually found
                  — including flagging anything that doesn't look like real supporting evidence.
                </p>
              )}
              {analysisError && <p className="mt-1 text-xs text-destructive">{analysisError}</p>}
              {analysis && (
                <div className="mt-3 grid gap-3">
                  <div className="grid gap-1.5">
                    {analysis.documentFindings.map((f, i) => (
                      <div key={i} className="rounded-md border border-border p-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 flex-1 truncate font-medium">{f.fileName}</span>
                          <DocumentStatusBadge status={f.status} />
                        </div>
                        <p className="mt-0.5 text-muted-foreground">{f.assessment}</p>
                      </div>
                    ))}
                  </div>
                  {analysis.summary && (
                    <div className="rounded-md bg-secondary/40 p-2.5 text-xs">
                      <span className="font-medium">Summary: </span>
                      {analysis.summary}
                    </div>
                  )}
                  {analysis.suggestedReason && (
                    <div className="rounded-md border border-accent/30 bg-accent/5 p-2.5 text-xs">
                      <span className="font-medium text-foreground">
                        Suggested reason for protest:
                      </span>
                      <p className="mt-1 text-muted-foreground">{analysis.suggestedReason}</p>
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        This is a draft — it'll also be offered as a suggestion when you complete
                        your Notice of Protest under File Protest, where you can review and edit it
                        before signing.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {allowEvidenceUpload && analysis && (
            <div className="border-t border-border/60 pt-4 print:hidden">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">Download Evidence Packet</div>
                  <p className="text-xs text-muted-foreground">
                    {packetEligibleCount > 0
                      ? `Compiles your ${packetEligibleCount} accepted document${packetEligibleCount === 1 ? "" : "s"} into one organized PDF, with a cover page and your county's real filing instructions. Incorrect/duplicate uploads are left out.`
                      : "No documents currently qualify — resolve any Incorrect Document/Duplicate flags above, or upload new evidence and re-analyze."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadPacket}
                  disabled={downloadingPacket || packetEligibleCount === 0}
                  className="btn-outline shrink-0 whitespace-nowrap text-xs py-1 disabled:opacity-60"
                >
                  {downloadingPacket ? "Compiling…" : "Download Evidence Packet"}
                </button>
              </div>
              {packetError && <p className="mt-1 text-xs text-destructive">{packetError}</p>}
            </div>
          )}

          {/* Part 8's end-of-module Evidence Summary — every number reused
              from state already computed above, plus the one pure rollup
              (strategiesSupported/overall) from evidence-readiness.ts. */}
          {d.items.length > 0 &&
            (() => {
              const readiness = computeEvidenceReadiness(
                d.items.map((it) => ({
                  status: evStatus(it),
                  priority: evPriority(it),
                  relatedModule: it.relatedModule ?? null,
                })),
              );
              const packetReady =
                !!analysis && packetEligibleCount > 0 && needsActionItems.length === 0;
              const nextModule = MODULES.find((mm) => mm.id === "executive");
              const scrollTo = (id: string) =>
                document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
              return (
                <div className="grid gap-3 rounded-lg border border-border bg-secondary/20 p-4 print:hidden">
                  <div className="font-serif text-base font-semibold">Evidence Summary</div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs sm:grid-cols-3">
                    <div>
                      <span className="text-muted-foreground">Protest Strategies Supported: </span>
                      <span className="font-medium">{readiness.strategiesSupported}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Evidence Items Identified: </span>
                      <span className="font-medium">{readiness.itemsIdentified}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Evidence Uploaded: </span>
                      <span className="font-medium">{protestEvidenceDocs.length}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Evidence Verified: </span>
                      <span className="font-medium">{readiness.verifiedCount}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Critical Evidence Missing: </span>
                      <span className="font-medium">{readiness.criticalMissingCount}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Evidence Packet: </span>
                      <span className="font-medium">{packetReady ? "Ready" : "In Progress"}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Overall Evidence Readiness:</span>
                    <span
                      className={`font-semibold ${
                        readiness.overall === "Strong"
                          ? "text-success"
                          : readiness.overall === "Moderate"
                            ? "text-warning-foreground"
                            : "text-destructive"
                      }`}
                    >
                      {readiness.overall}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    This is an evidence-readiness assessment, not a prediction of protest success.
                  </p>
                  <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                    {allowEvidenceUpload && (
                      <button
                        type="button"
                        onClick={() => scrollTo("evidence-upload-section")}
                        className="btn-primary text-xs py-1.5"
                      >
                        {protestEvidenceDocs.length > 0
                          ? "Upload More Evidence"
                          : "Upload Evidence"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => scrollTo("evidence-checklist-top")}
                      className="btn-outline text-xs py-1.5"
                    >
                      View Evidence Plan
                    </button>
                    {needsActionItems.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setEvidenceGroupBy("priority");
                          scrollTo("evidence-needs-action");
                        }}
                        className="btn-outline text-xs py-1.5"
                      >
                        View Missing Evidence
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleDownloadPacket}
                      disabled={!analysis || downloadingPacket || packetEligibleCount === 0}
                      className="btn-outline text-xs py-1.5 disabled:opacity-60"
                    >
                      {downloadingPacket ? "Compiling…" : "Download Evidence Packet"}
                    </button>
                    {nextModule && (
                      <button
                        type="button"
                        onClick={() => onOpenModule(nextModule.id)}
                        className="btn-outline text-xs py-1.5"
                      >
                        Continue to {nextModule.shortName}
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}
        </div>
      );
    }
    case "executive": {
      const d = moduleState.data as ModuleResultMap["executive"];
      const strategyData = moduleData.strategy?.data as ModuleResultMap["strategy"] | undefined;
      const evidenceData = moduleData.evidence?.data as ModuleResultMap["evidence"] | undefined;
      const evidenceItems = evidenceData?.items ?? [];
      const preFilingItems =
        existingProtest && resolvedProperty
          ? getPreFilingCheck(resolvedProperty, existingProtest)
          : null;

      // Module 10 is the final summary, not another analysis dashboard: one
      // recommendation, one readiness status, and the full report as a PDF.
      // Figures, comps, evidence and filing detail live in Modules 1-9 and
      // the PDF — never repeated here.
      const tier = assessmentTier(d.recommendedAction);
      const tierMeta = ASSESSMENT_TIER[tier];
      const readiness = getProtestReadiness({
        protestDeadline: resolvedProperty?.protestDeadline ?? null,
        preFilingItems,
        evidenceItems,
        missingInformation: d.missingInformation,
      });
      const TIER_STYLE: Record<AssessmentTier, { card: string; dot: string }> = {
        recommended: { card: "border-success/40 bg-success/10", dot: "bg-success" },
        review: { card: "border-warning/50 bg-warning/15", dot: "bg-warning" },
        limited: { card: "border-violet-300/60 bg-violet-500/10", dot: "bg-violet-400" },
      };
      const READINESS_STYLE: Record<ProtestReadinessResult["status"], string> = {
        ready: "bg-success/15 text-success",
        info_needed: "bg-warning/15 text-warning-foreground",
        deadline_review: "bg-destructive/10 text-destructive",
      };

      async function handleDownloadReport() {
        setDownloadingReport(true);
        try {
          const site = moduleData.site?.data as ModuleResultMap["site"] | undefined;
          const zoning = moduleData.zoning?.data as ModuleResultMap["zoning"] | undefined;
          const improvement = moduleData.improvement?.data as
            ModuleResultMap["improvement"] | undefined;
          const stats = computeComparableStats(
            compsMap.data?.subject ?? null,
            compsMap.data?.comps ?? [],
            state.totalValue,
          );
          const worksheet = resolvedProperty
            ? await getValuationWorksheet(resolvedProperty.id).catch(() => null)
            : null;
          const approach = (id: string) => {
            const a = worksheet?.summary?.approaches.find((x) => x.id === id);
            return a?.status === "indicated" ? a.indicatedValue : null;
          };
          const isCriticalGap = (i: (typeof evidenceItems)[number]) =>
            i.priority
              ? i.priority === "Critical" && i.status === "Missing"
              : i.importance === "High" && i.availability === "Low";
          const missingCritical = [
            ...new Set([
              ...evidenceItems.filter(isCriticalGap).map((i) => i.item),
              ...d.missingInformation
                .filter((mi) => mi.severity === "Critical")
                .map((mi) => mi.item),
            ]),
          ];
          const deadline = resolvedProperty?.protestDeadline
            ? new Date(`${resolvedProperty.protestDeadline}T00:00:00`).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })
            : null;
          const filingMethod =
            preFilingItems?.find((i) => i.label === "Filing Method")?.value ??
            (getCountyProtestInfo(state.cad)?.filingMethod?.online
              ? `Online — ${getCountyProtestInfo(state.cad)?.filingMethod?.online?.url}`
              : null);
          const bytes = await buildExecutiveReportPdf({
            property: {
              address: resolvedProperty?.address ?? state.address ?? null,
              county: resolvedProperty?.cad ?? state.cad ?? null,
              account: resolvedProperty?.accountNumber ?? state.accountNumber ?? null,
              owner: resolvedProperty?.ownerName ?? state.ownerName ?? null,
              propertyType: resolvedProperty?.propertyType ?? state.propertyType ?? null,
              taxYear:
                existingProtest?.taxYear ?? resolvedProperty?.taxYear ?? state.taxYear ?? null,
            },
            tier,
            explanation: d.recommendationExplanation || null,
            readiness,
            values: {
              cad: state.totalValue ?? null,
              compsMedian: stats.indicated?.median ?? null,
              compsRange: stats.indicated
                ? { min: stats.indicated.min, max: stats.indicated.max }
                : null,
              income: incomeComputed.complete ? incomeComputed.indicatedValue : approach("income"),
              cost: approach("cost"),
              valueToConsider: d.recommendedProtestValue,
              valueBasis: d.recommendedProtestValueBasis || null,
            },
            comps: stats.ranked.slice(0, 5).map((c) => ({
              address: c.address,
              distanceMi: c.distanceMi,
              value: c.marketValue ?? null,
            })),
            compsGapPct: stats.limitedData ? null : stats.valuationGapPct,
            land: site
              ? {
                  keyFinding: site.keyFinding || null,
                  factors: site.factors
                    .filter(
                      (f) =>
                        (f.status === "Confirmed" || f.status === "Partial Data") &&
                        f.severity !== "Unknown",
                    )
                    .map((f) => ({ factor: f.factor, finding: f.finding, severity: f.severity })),
                }
              : null,
            zoning: zoning
              ? {
                  matches: zoning.matches,
                  assessment: zoning.assessment,
                  discrepancies: zoning.discrepancies.map((x) => `${x.between}: ${x.detail}`),
                }
              : null,
            improvement: improvement
              ? {
                  keyFinding: improvement.keyFinding || null,
                  components: improvement.buildingComponents
                    .filter((c) => !c.notApplicable)
                    .map((c) => ({ component: c.component, condition: c.condition })),
                }
              : null,
            savings:
              savingsAnalysis.sufficient && savingsAnalysis.annualSavings > 0
                ? {
                    annual: savingsAnalysis.annualSavings,
                    reductionPct: savingsAnalysis.reductionPct,
                    taxRatePct: savingsAnalysis.taxRate.pct,
                    taxRateSource: savingsAnalysis.taxRate.source,
                    assumptions: savingsAnalysis.assumptions,
                  }
                : estimated.savings > 0
                  ? {
                      annual: estimated.savings,
                      reductionPct:
                        state.totalValue && estimated.reduction
                          ? Math.round((estimated.reduction / state.totalValue) * 100)
                          : null,
                      taxRatePct: estimated.effectiveTaxRatePct || null,
                      taxRateSource: null,
                      assumptions: estimated.rationale ? [estimated.rationale] : [],
                    }
                  : null,
            strategies: (strategyData?.strategies ?? []).slice(0, 2).map((s) => ({
              name: s.name,
              strengthScore: s.strengthScore,
              reason: s.primaryReason,
            })),
            evidence: {
              verified: evidenceItems.filter((i) => i.status === "Verified").length,
              found: evidenceItems.filter((i) => i.status === "Found").length,
              missing: evidenceItems.filter((i) => i.status === "Missing").length,
              sources: [
                ...new Set(
                  evidenceItems
                    .filter((i) => i.status !== "Missing" && i.foundIn)
                    .map((i) => i.foundIn as string),
                ),
              ],
            },
            missingCritical,
            deadline,
            filingMethod,
          });
          const base = resolvedProperty?.accountNumber ?? state.accountNumber ?? "property";
          downloadPdf(bytes, `Protest-Report-${base}.pdf`);
          toast.success("Protest report downloaded.");
        } catch (err) {
          toast.error(
            getErrorMessage(err, "Could not build the protest report. Please try again."),
          );
        } finally {
          setDownloadingReport(false);
        }
      }

      return (
        <div className="mt-4 grid gap-4">
          {/* 1. Corvus AI Final Recommendation */}
          <div className={`rounded-xl border p-5 ${TIER_STYLE[tier].card}`}>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Corvus AI Final Recommendation
            </div>
            <div className="mt-1.5 flex items-center gap-2.5">
              <span className={`h-3.5 w-3.5 shrink-0 rounded-full ${TIER_STYLE[tier].dot}`} />
              <span className="font-serif text-xl font-bold text-foreground">{tierMeta.label}</span>
            </div>
            <p className="mt-1.5 text-sm text-foreground/90">
              {d.recommendationExplanation || tierMeta.description}
            </p>
          </div>

          {/* 2. Protest Readiness */}
          <div className="card-elev p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Protest Readiness
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${READINESS_STYLE[readiness.status]}`}
              >
                {READINESS_LABEL[readiness.status]}
              </span>
            </div>
            {readiness.requirement && (
              <p className="mt-2 text-sm text-foreground/90">
                {readiness.requirement}
                {readiness.module && (
                  <button
                    type="button"
                    onClick={() => onOpenModule(readiness.module!)}
                    className="ml-1.5 text-xs text-accent hover:underline"
                  >
                    Open Evidence Builder →
                  </button>
                )}
              </p>
            )}
          </div>

          {/* 3. Download Executive Protest Report */}
          <div className="flex justify-center pt-1">
            <button
              type="button"
              onClick={handleDownloadReport}
              disabled={downloadingReport}
              className="btn-accent inline-flex items-center gap-2 disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              {downloadingReport ? "Building report…" : "Download Protest Report (PDF)"}
            </button>
          </div>
        </div>
      );
    }
  }

  return <p className="mt-4 text-sm">{m.teaser}</p>;
}

// Thin wrapper around ModulePreviewContent that appends the "Ask AI" Q&A box
// once, regardless of which of ModulePreviewContent's several early-return
// branches rendered — see the comment on ModulePreviewContent above. Skipped
// for "income" (no analysis exists yet to ground an answer in) and "savings"
// (a deterministic formula, not an AI call) — every other module gets one.
export function ModulePreviewBody(props: Parameters<typeof ModulePreviewContent>[0]) {
  const showQA = !props.m.requiresUserData && props.m.id !== "savings" && !!props.moduleState?.data;
  const showDataSheet =
    props.allowEvidenceUpload &&
    props.m.id !== "savings" &&
    // Module 1 has its own direct path into Module 8 (the real evidence
    // system) now — a second, separate "AI drafts assumed values" sheet
    // alongside it duplicated the same job with lower-quality output.
    props.m.id !== "health" &&
    !!props.moduleState?.data;
  return (
    <>
      <CaseOutcomeBanner
        protest={props.existingProtest}
        property={props.resolvedProperty}
        onViewCase={props.onViewCase}
      />
      <ModulePreviewContent {...props} />
      {showDataSheet && (
        <ModuleDataSheetButton
          moduleId={props.m.id}
          moduleLabel={props.m.title}
          shortLabel={props.m.shortName}
          moduleResult={props.moduleState?.data}
          onGenerate={props.onGenerateDataSheet}
        />
      )}
      {showQA && <ModuleQABox moduleId={props.m.id} onAskQuestion={props.onAskQuestion} />}
    </>
  );
}

// "AI fills in the missing data" — drafts a starter data sheet for whatever
// inputs this module reports as missing and files it in the central
// repository, tagged to this module. The sheet is clearly labelled
// AI-generated assumptions; it's a gathering aid, not real data.
export function ModuleDataSheetButton({
  moduleId,
  moduleLabel,
  shortLabel,
  moduleResult,
  onGenerate,
}: {
  moduleId: string;
  moduleLabel: string;
  // The module's short display name (e.g. "Site Condition", "Income Value")
  // — used only for the button's own text, so it reads "Generate Site
  // Condition Overview" instead of the generic "Generate Property Summary"
  // every module used to share. `moduleLabel` (the longer title) still goes
  // into the generated file's own name/tagging, unchanged.
  shortLabel: string;
  moduleResult: unknown;
  onGenerate: (
    moduleId: string,
    moduleLabel: string,
    moduleResult: unknown,
  ) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [madeFile, setMadeFile] = useState<string | null>(null);
  return (
    <div className="mt-4 border-t border-border/60 pt-4 print:hidden">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Missing data
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Let AI draft a starter sheet for the inputs this module is missing — typical values, their
        basis, and where to confirm each. Filed in your documents and tagged to this module;
        it&apos;s an assumptions aid, not verified data.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const name = await onGenerate(moduleId, moduleLabel, moduleResult);
          setMadeFile(name);
          setBusy(false);
        }}
        className="btn-outline mt-2 text-sm disabled:opacity-50"
      >
        {busy ? "Drafting…" : `Generate ${shortLabel} Overview`}
      </button>
      {madeFile && (
        <p className="mt-1.5 text-xs text-success">Added “{madeFile}” to your documents.</p>
      )}
    </div>
  );
}

// Per-module "Ask AI" follow-up box — ephemeral by design (plain component
// state, not persisted anywhere), so it resets whenever the modal closes and
// reopens. Answers are grounded server-side in this module's own already-
// generated data — see askModuleQuestion() in ai-report-modules.ts.
export function ModuleQABox({
  moduleId,
  onAskQuestion,
}: {
  moduleId: string;
  onAskQuestion: (moduleId: string, question: string) => Promise<string>;
}) {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [thread, setThread] = useState<{ question: string; answer: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function submit(override?: string) {
    const q = (override ?? question).trim();
    if (!q || asking) return;
    setAsking(true);
    setError(null);
    try {
      const answer = await onAskQuestion(moduleId, q);
      setThread((prev) => [...prev, { question: q, answer }]);
      setQuestion("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not get an answer. Please retry.");
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="mt-4 border-t border-border/60 pt-4 print:hidden">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Ask AI About This Module
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Ask why a finding or strategy was chosen, what evidence supports it, what&apos;s missing, or
        which module to check next.
      </p>
      {thread.length > 0 && (
        <div className="mt-2 grid gap-2.5">
          {thread.map((t, i) => (
            <div key={i} className="text-sm">
              <div className="font-medium">{t.question}</div>
              <MarkdownLite className="mt-0.5 text-muted-foreground" text={t.answer} />
            </div>
          ))}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <div className="mt-2 flex items-end gap-2">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder="Ask a follow-up question…"
          disabled={asking}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm disabled:opacity-60"
        />
        <AskAiMicButton
          onTranscript={setQuestion}
          onFinal={(text) => void submit(text)}
          disabled={asking}
        />
        <button
          type="button"
          onClick={() => submit()}
          disabled={asking || !question.trim()}
          className="btn-outline text-sm disabled:opacity-50"
        >
          {asking ? "Asking…" : "Ask"}
        </button>
      </div>
    </div>
  );
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

// Every module's AI-generated takeaway line goes through this — a tinted,
// icon-led card instead of a bare <p>, so it reads as one distinct visual
// element (like the gauges/chips/tables around it) rather than a paragraph
// to read through. Paired with the tightened word-count prompts server-side
// (see ai-health-score/ai-report-modules' SCHEMA comments — one short
// sentence, not "2-3 sentences" anymore), so the text itself is short
// enough to actually fit this treatment instead of overflowing it.
export function AiVerdictLine({
  icon: Icon,
  text,
  color,
}: {
  icon: LucideIcon;
  text: string;
  color: IconColor;
}) {
  return (
    <div className={`min-w-0 flex items-start gap-2.5 rounded-lg p-3 ${color.bg}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color.text}`} />
      {/* Every caller passes real AI-generated text (assessment/guidance/
          executiveConclusion/nextAction/topStrategySummary) — the prompts
          for these fields are told they "may bold the one key number" (see
          ai-health-score/index.ts's own comment), so the raw string can
          contain literal **bold** markdown. MarkdownLite is the same
          renderer already used for methodology/confidenceReasoning just
          below in this file; a bare {text} interpolation left those
          asterisks showing up verbatim instead of rendering as bold. */}
      <div className="min-w-0 flex-1 break-words text-sm font-medium leading-snug">
        <MarkdownLite text={text} />
      </div>
    </div>
  );
}
