import { Field } from "@/components/ai-report/bits";
import { ModuleCard } from "@/components/ai-report/module-card";
import { ModulePreviewBody } from "@/components/ai-report/module-preview";
import { buildCompsSummary, ModuleAsyncState } from "@/components/ai-report/shared";
import { NumberBadge } from "@/components/ai-report/visuals";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { CaseResultContext } from "@/components/CaseOutcomeBanner";
import { CasePreviewFor } from "@/components/CasePreview";
import { CommercialValuationPanel } from "@/components/CommercialValuationPanel";
import { EvidenceImpactContext } from "@/components/EvidenceImpactCard";
import { JourneyTracker } from "@/components/JourneyTracker";
import { Modal } from "@/components/Modal";
import { ProtestAuthorizationFlow } from "@/components/ProtestAuthorizationFlow";
import { ValueHistorySection } from "@/components/ValueHistorySection";
import { getHealthScore, type HealthScoreResult } from "@/lib/ai-health-score";
import {
  askModuleQuestion,
  getModuleAnalysis,
  type BatchModuleId,
  type ModuleAnalysisInput,
  type ModuleResultMap,
} from "@/lib/ai-report-modules";
import { getAiReportCacheEnabled } from "@/lib/app-settings";
import { useAuth } from "@/lib/auth";
import {
  bracketForValue,
  formatMoney,
  getMyBilling,
  isCustomPricedValue,
  listMySubscriptions,
  startPropertyCheckout,
  TIER_BRACKET_PRICES,
  TIER_LABEL,
  planPriceLines,
  type MySubscription,
  type PlanValue,
  type Tier,
  type BillingInterval,
} from "@/lib/billing";
import { BillingIntervalToggle, CommitmentNote } from "@/components/BillingChoice";
import { getComps, type CompsResult } from "@/lib/cad-comps";
import { cadLookup, cadLookupByAccount, type CadRecord } from "@/lib/cad-lookup";
import { getCaseNextAction, type CaseNextAction } from "@/lib/case-next-action";
import { buildCaseOutcome } from "@/lib/case-outcome";
import {
  compSelectionsToExtraComps,
  deleteCompSelection,
  excludedCompKeys,
  extractCompSale,
  listCompSelections,
  pinnedCompKeys,
  upsertCompSelection,
  type CompSaleExtraction,
  type CompSelection,
  type CompSelectionInput,
} from "@/lib/comp-selections";
import { computeComparableStats } from "@/lib/comps-analysis";
import {
  buildDataSheetFile,
  DATA_SHEET_DOCUMENT_TYPE_PREFIX,
  generateDataSheet,
} from "@/lib/data-sheet";
import { setDocumentModules, tagUploadedDocument } from "@/lib/document-modules";
import {
  EVIDENCE_DOCUMENT_TYPE,
  extractEvidenceValue,
  getDocumentUrl,
  listDocuments,
  notifyDocumentsChanged,
  PROTEST_EVIDENCE_DOCUMENT_TYPE,
  uploadDocument,
  type DocumentRecord,
} from "@/lib/documents";
import { getErrorMessage } from "@/lib/error-message";
import { listUnavailable, reasonLabel } from "@/lib/evidence-unavailable";
import {
  applyEvidenceToEstimate,
  applyPoints,
  baseIndicatedValue,
  computeEvidenceAdjustment,
  VALUE_SIGNAL_SCHEMA_VERSION,
  type ValueSignal,
} from "@/lib/evidence-value";
import { geocodeAddress, type GeocodedPoint } from "@/lib/geocode";
import { computeDepreciation, getTypicalEconomicLife } from "@/lib/improvement-condition";
import { cardConditions, loadImprovementData, recordsForModule } from "@/lib/improvement-records";
import {
  extractIncomeFinancials,
  getIncomeAnalysis,
  upsertIncomeAnalysis,
  type IncomeAnalysis,
  type IncomeAnalysisInput,
} from "@/lib/income-analysis";
import {
  computeIncomeApproach,
  incomeSupportsCad,
  type IncomeApproach,
  type IncomeFigures,
} from "@/lib/income-approach";
import {
  currency,
  fileToDataUrl,
  readIntake,
  updateIntake,
  UPLOAD_LIMITS,
  type IntakeState,
} from "@/lib/intake-store";
import {
  clearNotApplicable as clearModuleNotApplicable,
  isModuleNotApplicable,
  itemsNotApplicable,
  listModuleOverrides,
  markNotApplicable as markModuleNotApplicable,
  WHOLE_MODULE_KEY,
  type ModuleOverride,
} from "@/lib/module-overrides";
import {
  getCachedModuleResult,
  hashModuleInput,
  MODEL_TAG,
  relativeTime,
  saveModuleResult,
} from "@/lib/module-results-cache";
import { moduleSourceFacts } from "@/lib/module-source-facts";
import { MODULES, type Module } from "@/lib/modules";
import { getPreFilingCheck } from "@/lib/pre-filing-check";
import {
  addProperty,
  buildAiReportIntakePatch,
  findExistingProperty,
  listProperties,
  updatePropertyIdentity,
  updatePropertySavings,
  type PropertyRecord,
} from "@/lib/properties";
import {
  fetchPropertyBaseSnapshot,
  getPropertyBaseData,
  savePropertyBaseData,
  type PropertyBaseData,
} from "@/lib/property-base-data";
import { syncHealthScore } from "@/lib/property-scores";
import {
  buildPropertySummaryFile,
  generatePropertySummary,
  PROPERTY_SUMMARY_DOCUMENT_TYPE,
} from "@/lib/property-summary";
import { generateCasePrep } from "@/lib/protest-case";
import { getProtestCost } from "@/lib/protest-cost";
import { listProtests, requestProtest, type ProtestRecord } from "@/lib/protests";
import {
  computeSavingsAnalysis,
  EMPTY_TAX_INPUTS,
  type ModuleIndication,
  type SavingsAnalysis,
  type SavingsTaxInputs,
} from "@/lib/savings-analysis";
import { estimateSavings } from "@/lib/savings-estimate";
import {
  getSavingsTaxInputs,
  upsertSavingsTaxInputs,
  type SavingsTaxInputsInput,
} from "@/lib/savings-tax-inputs";
import { getSiteGis, type SiteGisResult } from "@/lib/site-gis";
import { lookupCityZoning, zoningLabel } from "@/lib/city-zoning";
import { confirmedForModule, listSiteReports } from "@/lib/site-reports";
import { isPaidStatus } from "@/lib/subscription-status";
import {
  applyValueTrendAdjustment,
  classifyPropertyCategory,
  getAssessmentRatioInfo,
  getEffectiveTaxRate,
} from "@/lib/texas-tax-rates";
import { useDocumentsVersion } from "@/lib/use-documents-version";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { RefreshCw, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/ai-report")({
  head: () => ({
    meta: [
      { title: "AI Property Review — CorvusPT" },
      { name: "description", content: "AI-generated property tax review with 10 premium modules." },
      { property: "og:title", content: "AI Property Review" },
      {
        property: "og:description",
        content: "AI analysis of your Texas commercial or residential property.",
      },
    ],
  }),
  // openModule: a deep link (CaseDetailModal's "Upload Evidence — Go to
  // Module 8" button) auto-opens a specific module's modal on load.
  // propertyId: opens the report for one specific saved property regardless
  // of what's in intake — the Properties page's bulk "Run AI Report" opens
  // one tab per selected property this way, so each tab is self-contained
  // rather than racing a shared sessionStorage write.
  // tab / view: the open top tab (Protest Case) and modules tab (Commercial
  // Valuation). The open module and both tabs are kept in the URL as the
  // owner moves around, so going to View Case (or any page) and pressing
  // Back reopens the report exactly where they left it.
  validateSearch: (
    search: Record<string, unknown>,
  ): { openModule?: string; propertyId?: string; tab?: "case"; view?: "valuation" } => ({
    openModule: typeof search.openModule === "string" ? search.openModule : undefined,
    propertyId: typeof search.propertyId === "string" ? search.propertyId : undefined,
    tab: search.tab === "case" ? "case" : undefined,
    view: search.view === "valuation" ? "valuation" : undefined,
  }),
  component: Report,
});

// Modules 1-3 are free for everyone, signed in or not. Modules 4-10 require a
// paid subscription — there is no sign-in-only tier and no per-user "pick any
// 3" quota; which modules are free is fixed by module number, not user choice.
const FREE_MODULE_COUNT = 3;

// Real value-history-jump signal fed into Module 2's prompt — same
// applyValueTrendAdjustment() real trend-vs-own-history check success-
// probability.ts already reuses; baseReductionPct is passed as 0 since only the
// jump detection is needed here, not a reduction percentage.
function buildValueTrend(valueHistory: IntakeState["valueHistory"]) {
  const history = (valueHistory ?? [])
    .map((h) => ({ year: h.year, value: h.appraisedValue ?? h.marketValue ?? null }))
    .filter((h): h is { year: number; value: number } => h.value != null);
  const trend = applyValueTrendAdjustment(0, history);
  return { jumpTriggered: trend.jumpTriggered, jumpPct: trend.jumpPct };
}

// The subject's own year-over-year assessed-value CAGR as a whole-number
// percent, from its CAD value history — the basis for Module 3's time
// adjustment. null when there isn't a ≥2-year span of real values.
function subjectValueTrendPctPerYear(valueHistory: IntakeState["valueHistory"]): number | null {
  const h = (valueHistory ?? [])
    .map((x) => ({ year: x.year, value: x.appraisedValue ?? x.marketValue ?? null }))
    .filter((x): x is { year: number; value: number } => x.value != null && x.value > 0)
    .sort((a, b) => a.year - b.year);
  if (h.length < 2) return null;
  const first = h[0];
  const last = h[h.length - 1];
  const years = last.year - first.year;
  if (years <= 0) return null;
  const cagr = Math.pow(last.value / first.value, 1 / years) - 1;
  return Math.max(-15, Math.min(15, Math.round(cagr * 100)));
}

function Report() {
  const nav = useNavigate();
  const { user } = useAuth();
  const {
    openModule: deepLinkModuleId,
    propertyId: deepLinkPropertyId,
    tab: initialTopTab,
    view: initialModulesView,
  } = Route.useSearch();
  const [state, setState] = useState<IntakeState>({ previewsUsed: [] });
  // The printed report's "Generated" date is set in the browser after load:
  // computing it while rendering baked the build date into the prerendered
  // page and didn't match on hydration. Central time, like the rest of the app.
  const [generatedOn, setGeneratedOn] = useState("");
  useEffect(() => {
    setGeneratedOn(new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago" }));
  }, []);
  const [analyzing, setAnalyzing] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  // The two views at the top of the page: the property itself, and its
  // protest case (savings + case progress).
  const [topTab, setTopTab] = useState<"property" | "case">(initialTopTab ?? "property");
  // The modules grid and the Commercial Valuation panel, as two tabs.
  const [modulesTab, setModulesTab] = useState<"modules" | "valuation">(
    initialModulesView === "valuation" ? "valuation" : "modules",
  );
  const [showWall, setShowWall] = useState(false);
  const [hasFullAccess, setHasFullAccess] = useState(false);
  // The raw plan value, not just the hasFullAccess boolean below — owner_managed
  // means the customer files their own protest (no agent-appointment agreement,
  // no CorvusPT staff in the loop); startProtest() branches on this directly
  // rather than routing every plan through the same "hire CorvusPT as agent"
  // ProtestAuthorizationFlow.
  const [myPlan, setMyPlan] = useState<PlanValue | null>(null);
  // Set once the billing check below has actually resolved (true either way —
  // real access or not; also true immediately when there's no signed-in user
  // to check) — a deep link (?openModule=evidence, from CaseDetailModal's
  // "Upload Evidence" button) must wait for this before deciding real vs.
  // paywalled, or a paying customer would see a flash of the paywall before
  // hasFullAccess catches up.
  const [billingChecked, setBillingChecked] = useState(false);
  // AI content for every module (health + the 8 batch modules) is fetched lazily —
  // only when the user clicks "Unlock preview" on that specific module, via
  // loadModule() below — rather than all up front, so tokens are only spent on
  // modules the user actually opens.
  const [rawModuleData, setModuleData] = useState<Record<string, ModuleAsyncState>>({});
  const moduleRequestSeq = useRef<Record<string, number>>({});
  // Separate from moduleData since it's not an AI call and has its own real/empty
  // result shape (CompsResult, not the free-text ModuleResultMap) — only fetched
  // when the Comps module (module 3) is opened.
  // `attempted` distinguishes "settled, genuinely no subject" from "not
  // started yet" — same reason siteGisMap below carries its own.
  const [compsMap, setCompsMap] = useState<{
    data: CompsResult | null;
    loading: boolean;
    attempted: boolean;
  }>({
    data: null,
    loading: false,
    attempted: false,
  });
  // Fallback coordinates for every county getComps() has no comps platform
  // for (see its own comment — only 4 counties return a real subject/lat-
  // lng). Only attempted once compsMap has genuinely settled with no
  // subject of its own (see the firing effect below) — CAD's own
  // coordinates are preferred when they exist, tied to the actual parcel
  // rather than a geocoder's best guess at the mailing address.
  const [geocodedSubject, setGeocodedSubject] = useState<{
    data: GeocodedPoint | null;
    loading: boolean;
    attempted: boolean;
  }>({
    data: null,
    loading: false,
    attempted: false,
  });
  // Real FEMA flood-zone + USGS elevation for the subject's lat/lng, once
  // compsMap resolves one (see loadSiteGis()/its firing effect below). Same
  // rationale as compsMap: not an AI call, its own real/empty result shape.
  // Official city zoning at the property's point (Module 6's input; the
  // zoning card reads the same cached lookup). null until it settles.
  const [cityZoning, setCityZoning] = useState<{ key: string; label: string | null } | null>(null);
  // `attempted` distinguishes "settled, genuinely no data" from "not started
  // yet" — see loadSiteGis's own comment.
  const [siteGisMap, setSiteGisMap] = useState<{
    data: SiteGisResult | null;
    loading: boolean;
    attempted: boolean;
  }>({
    data: null,
    loading: false,
    attempted: false,
  });
  // Lets "Request Protest Filing" work from the report page too, not just the
  // Properties dashboard — resolves (or, on first click, creates) the real saved
  // PropertyRecord this report is for, reusing the exact same dedup lookup
  // properties.ts already uses elsewhere so this never creates a duplicate row for
  // a property the user already has on file.
  const [resolvedProperty, setResolvedProperty] = useState<PropertyRecord | null>(null);
  const [existingProtest, setExistingProtest] = useState<ProtestRecord | null>(null);
  const [authorizing, setAuthorizing] = useState(false);
  const [cadFetching, setCadFetching] = useState(false);
  // Module 8's "Auto-source evidence" — the full live CAD record (not just
  // the classification field handleFetchCadDetails keeps) plus a flag for
  // the button's spinner. Fed into the evidence module so it can verify
  // checklist items against real records before asking the user.
  const [evidenceCadRecord, setEvidenceCadRecord] = useState<CadRecord | null>(null);
  const [autoSourcingEvidence, setAutoSourcingEvidence] = useState(false);
  // The property's AI-fetched base data (structured CAD + FEMA/USGS + record
  // link), stored as a document and tagged to every module — the single
  // foundation modules read instead of the user re-entering facts. See
  // src/lib/property-base-data.ts.
  const [baseData, setBaseData] = useState<PropertyBaseData | null>(null);
  const [baseDataBusy, setBaseDataBusy] = useState(false);
  // True once the stored base data (its value history and building details feed the Module 1
  // score) has been read, so the score is never computed from a half-loaded page and then
  // shown differently after a reload.
  const [baseDataChecked, setBaseDataChecked] = useState(false);
  const baseDataFetchedFor = useRef<string | null>(null);

  // "Fetch details" (Module 6) — re-pull this property's CAD record from the
  // live county source and update the classification-relevant field
  // (property type / CAD class). Only 6 counties expose a real API (see the
  // texas_cad_vendor_landscape memory); the rest just report "no live
  // source". Never touches assessed values or history — only the field the
  // zoning module actually reads — so it can't silently change the numbers
  // shown elsewhere.
  async function handleFetchCadDetails() {
    setCadFetching(true);
    try {
      let record: CadRecord | null = null;
      if (state.cad && state.accountNumber) {
        record = await cadLookupByAccount(state.cad, state.accountNumber).catch(() => null);
      }
      if (!record && state.address) {
        const res = await cadLookup(state.address).catch(() => null);
        if (res && res.matched === true) record = res.record;
      }
      if (!record) {
        toast.error("No live CAD source returned details for this property's county.");
        return;
      }
      const freshType = record.propertyType?.trim() || null;
      if (!freshType || freshType === (state.propertyType ?? "").trim()) {
        toast.info("CAD classification is already current.");
        return;
      }
      setState((s) => ({ ...s, propertyType: freshType }));
      updateIntake({ propertyType: freshType });
      if (resolvedProperty?.id) {
        updatePropertyIdentity(resolvedProperty.id, { propertyType: freshType })
          .then((p) => setResolvedProperty(p))
          .catch((err) => console.error("Could not persist the fetched CAD class:", err));
      }
      toast.success(`Updated CAD classification to "${freshType}".`);
      loadModule("zoning", { force: true });
    } finally {
      setCadFetching(false);
    }
  }

  // Module 8's "Auto-source evidence" — pull everything the app CAN pull for
  // this property (the live CAD record; site GIS if we have coordinates),
  // then re-run the evidence module so it can mark checklist items
  // Verified / Found from real records before asking the user for anything.
  // Only ~6 counties expose a live CAD API (texas_cad_vendor_landscape
  // memory); the rest just don't add a record.
  async function handleAutoSourceEvidence() {
    setAutoSourcingEvidence(true);
    try {
      const pulled: string[] = [];
      let record: CadRecord | null = null;
      if (state.cad && state.accountNumber) {
        record = await cadLookupByAccount(state.cad, state.accountNumber).catch(() => null);
      }
      if (!record && state.address) {
        const res = await cadLookup(state.address).catch(() => null);
        if (res && res.matched === true) record = res.record;
      }
      if (record) {
        setEvidenceCadRecord(record);
        pulled.push("CAD record");
      }
      if (siteCoords && !siteGisMap.attempted && !siteGisMap.loading) {
        loadSiteGis(siteCoords.lat, siteCoords.lng);
        pulled.push("site GIS (FEMA + USGS)");
      }
      // Persist the pull as the property's base data so it survives the
      // page and every module reads it — not just held in memory here.
      if (user && resolvedProperty) {
        void refreshBaseData({ silent: true });
      }
      loadModule("evidence", { force: true });
      toast.success(
        pulled.length > 0
          ? `Pulled ${pulled.join(" and ")}. Re-checking your evidence…`
          : "No live county source for this property — re-checking against what's on file…",
      );
    } finally {
      setAutoSourcingEvidence(false);
    }
  }

  // Address → fetch the publicly-available property data, store it as the
  // "AI Fetched — Property Base Data" document (tagged to every module), and
  // upsert property_base_data. Runs automatically on report open when
  // there's no base data or it's stale (see the effect below), and on the
  // "Refresh" button. `silent` suppresses the toast (used by the auto path
  // unless the data actually changed).
  async function refreshBaseData(opts?: { silent?: boolean }) {
    if (!user || !resolvedProperty || baseDataBusy) return;
    setBaseDataBusy(true);
    try {
      const snapshot = await fetchPropertyBaseSnapshot(
        {
          address: resolvedProperty.address,
          cad: resolvedProperty.cad,
          accountNumber: resolvedProperty.accountNumber,
        },
        siteCoords ? { lat: siteCoords.lat, lng: siteCoords.lng } : null,
      );
      const { changed, changeNote } = await savePropertyBaseData(
        user.id,
        resolvedProperty,
        snapshot,
      );
      const fresh = await getPropertyBaseData(resolvedProperty.id);
      setBaseData(fresh);
      // Bring the new document into the report's document set.
      listDocuments(user.id)
        .then((docs) => {
          const forProperty = docs.filter(
            (d) => d.propertyId === resolvedProperty.id && d.deletedAt == null,
          );
          setCaseDocuments(forProperty);
          setEvidenceDocs(
            forProperty.filter(
              (d) =>
                d.useAsEvidence !== false &&
                (d.useAsEvidence === true ||
                  (d.modules?.length ?? 0) > 0 ||
                  d.documentType === EVIDENCE_DOCUMENT_TYPE ||
                  d.documentType === PROTEST_EVIDENCE_DOCUMENT_TYPE ||
                  d.documentType?.startsWith("Strategy Evidence: ") ||
                  d.documentType?.startsWith("Zoning: ") ||
                  d.documentType?.startsWith("Improvement: ") ||
                  d.documentType?.startsWith("Site: ") ||
                  d.documentType?.startsWith("Income: ")),
            ),
          );
        })
        .catch(() => {});
      if (changed && changeNote) {
        toast.success(`Property base data updated — ${changeNote}.`);
        loadModule("health", { force: true });
        loadModule("strategy", { force: true });
      } else if (!opts?.silent) {
        toast.success("Property base data refreshed.");
      }
    } catch (err) {
      if (!opts?.silent)
        toast.error(err instanceof Error ? err.message : "Could not refresh property base data.");
    } finally {
      setBaseDataBusy(false);
    }
  }

  // "Ask Corvus to Fetch Details" (Module 5) — pull the latest public
  // property data (CAD record + FEMA/USGS), store it as the property's base
  // data (tagged to every module), then re-run whichever module is open so
  // it reflects the fresh facts.
  async function handleFetchPublicData() {
    await refreshBaseData();
    const openId = openModel?.id;
    if (openId) loadModule(openId, { force: true });
  }
  // Which tier's checkout is currently redirecting, for the unpaid-property
  // "Subscribe" buttons in the banner below (real, one-click checkout right
  // here — see handleSubscribeToProperty — rather than sending the user off
  // to the Properties list to find this same property again).
  const [subscribingTier, setSubscribingTier] = useState<Tier | null>(null);
  const [checkoutInterval, setCheckoutInterval] = useState<BillingInterval>("month");
  const [checkoutPreview, setCheckoutPreview] = useState<{
    property: PropertyRecord;
    tier: Tier;
  } | null>(null);
  // Evidence (photos/repair estimates/appraisals) the user has uploaded for this
  // property, fed into the Improvement Condition module's analysis — see
  // handleUploadEvidence() and loadModule() below.
  const [evidenceDocs, setEvidenceDocs] = useState<DocumentRecord[]>([]);
  const [uploadingEvidence, setUploadingEvidence] = useState(false);
  // Real, user-confirmed "not applicable" marks for gated modules/factors/
  // components — see module-overrides.ts. Loaded once resolvedProperty
  // exists (same gate as the evidence-docs effect below, since overrides
  // are keyed by property id too).
  const [overrides, setOverrides] = useState<ModuleOverride[]>([]);
  // Whether module results are served from public.module_results instead of
  // re-generating on every visit (app_settings.ai_report_cache_enabled).
  // Defaults on; a false read leaves it on (never silently switch to the
  // expensive live-every-time path on a transient error).
  const [cacheEnabled, setCacheEnabled] = useState(true);
  useEffect(() => {
    getAiReportCacheEnabled().then(setCacheEnabled);
  }, []);
  // Module 3 (Market Value) — the user's include/exclude/add decisions for
  // comparable sales. Loaded once per property; every mutation is optimistic
  // (same pattern as `overrides` above) and re-runs the comps AI so its
  // per-comp verdicts stay consistent with the set the user actually kept.
  const [compSelections, setCompSelections] = useState<CompSelection[]>([]);
  // loadModule("comps") runs right after a tick is saved, from a closure that
  // still holds the previous selections — it reads this instead.
  const compSelectionsRef = useRef(compSelections);
  compSelectionsRef.current = compSelections;
  // Module 7 (Income Value) — the owner-confirmed income figures for this
  // property (see income-analysis.ts). Loaded once per property; every save is
  // optimistic and re-runs the income AI narrative + its dependents. null
  // until the owner has provided anything.
  const [incomeAnalysis, setIncomeAnalysis] = useState<IncomeAnalysis | null>(null);

  // The eager module batch folds overrides / comp selections / income figures
  // into the modules' cache-hash inputs (notApplicableContext, excluded comps,
  // the income NOI line). Each loads in its own effect below with no natural
  // "done" signal, so without these flags a page reload races them: the batch
  // fires with an empty list, hashes differently from the stored row, and
  // regenerates for nothing. One flag per source; the batch waits on all.
  const [overridesLoaded, setOverridesLoaded] = useState(false);
  const [compSelectionsLoaded, setCompSelectionsLoaded] = useState(false);
  const [incomeAnalysisLoaded, setIncomeAnalysisLoaded] = useState(false);
  const auxDataLoaded = overridesLoaded && compSelectionsLoaded && incomeAnalysisLoaded;

  // ?propertyId — open this exact saved property's report, whatever intake
  // currently holds. Used by the Properties page's bulk "Run AI Report" so
  // each tab is self-contained. Resolves once, seeds intake from the real
  // row, then the normal readIntake() flow below takes over on the next tick.
  const [propertyIdApplied, setPropertyIdApplied] = useState(!deepLinkPropertyId);
  // a link to a property that isn't in this account (deleted, or someone
  // else's) — say so and go to Properties, rather than silently landing on
  // a blank intake form
  const deepLinkMissingRef = useRef(false);
  useEffect(() => {
    if (!deepLinkPropertyId || !user || propertyIdApplied) return;
    let live = true;
    listProperties(user.id)
      .then((props) => {
        if (!live) return;
        const match = props.find((p) => p.id === deepLinkPropertyId);
        if (match) updateIntake({ ...buildAiReportIntakePatch(match), confirmed: true });
        else {
          deepLinkMissingRef.current = true;
          toast.error("That property isn't in your account.");
          nav({ to: "/dashboard/properties" });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (live) setPropertyIdApplied(true);
      });
    return () => {
      live = false;
    };
  }, [deepLinkPropertyId, user, propertyIdApplied, nav]);

  useEffect(() => {
    if (!propertyIdApplied) return; // wait for ?propertyId to seed intake first
    if (deepLinkMissingRef.current) return;
    const s = readIntake();
    if (!s.confirmed) {
      setState(s);
      nav({ to: "/intake" });
      return;
    }
    // Real "reached AI Review" signal for JourneyTracker (see aiReviewReached's
    // own comment in intake-store.ts) — set once, here, rather than every
    // render, since updateIntake's write is otherwise harmless but pointless
    // to repeat.
    setState(s.aiReviewReached ? s : updateIntake({ aiReviewReached: true }));
    const t = setTimeout(() => setAnalyzing(false), 1800);
    return () => clearTimeout(t);
  }, [nav, propertyIdApplied]);

  useEffect(() => {
    if (!user || !state.address) return;
    findExistingProperty(user.id, {
      address: state.address,
      cad: state.cad,
      accountNumber: state.accountNumber,
    })
      .then((property) => {
        setResolvedProperty(property);
        if (!property) return;
        return listProtests(user.id).then((protests) => {
          setExistingProtest(protests.find((p) => p.propertyId === property.id) ?? null);
        });
      })
      .catch((err) => console.error("Could not resolve this property for protest filing:", err));
    // user?.id, not the user object — a background TOKEN_REFRESHED hands us a
    // fresh user object and would otherwise re-run this (and everything keyed
    // on resolvedProperty) on every tab focus, briefly nulling the resolved
    // property and remounting the protest-authorization modal mid-flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, state.address, state.cad, state.accountNumber]);

  // The banner's Case Progress card — "what do I need to do next," in the
  // exact same terms and using the exact same rules View Case itself uses
  // (see case-next-action.ts). Only meaningful once a protest actually
  // exists; cleared the moment it doesn't so a stale action never survives
  // onto a different property.
  const [nextAction, setNextAction] = useState<CaseNextAction | null>(null);
  useEffect(() => {
    if (!resolvedProperty || !existingProtest) {
      setNextAction(null);
      return;
    }
    let cancelled = false;
    getCaseNextAction(resolvedProperty, existingProtest, evidenceDocs.length)
      .then((a) => {
        if (!cancelled) setNextAction(a);
      })
      .catch((err) => console.error("Could not compute the case's next action:", err));
    return () => {
      cancelled = true;
    };
  }, [resolvedProperty, existingProtest, evidenceDocs.length]);

  // Gates the eager module loads below — health/strategy/evidence include the
  // uploaded-evidence file names in their input (and therefore in the cache
  // hash), so they must not fire until this list has settled, or a reload
  // races it and a cached result misses just because the docs weren't in yet.
  const [evidenceDocsLoaded, setEvidenceDocsLoaded] = useState(false);
  // True once every evidence file has been read for what it says about value (or we gave up on a
  // file), so the score and savings are computed from the full picture once, not repeatedly as
  // each file finishes.
  const [valueSignalsSettled, setValueSignalsSettled] = useState(false);
  const signalAttempts = useRef<Set<string>>(new Set());
  // Every non-deleted document for this property — used by Module 10's Full
  // Case Report (case-report.ts) for the Key Documents section. evidenceDocs
  // above is the evidence-only subset the cache hash folds in.
  const [caseDocuments, setCaseDocuments] = useState<DocumentRecord[]>([]);
  // Refetch when a document changes elsewhere (View Case / Documents / another tab).
  const docsVersion = useDocumentsVersion();
  useEffect(() => {
    if (!user || !resolvedProperty) {
      setEvidenceDocsLoaded(!resolvedProperty); // no property => nothing to wait for
      return;
    }
    listDocuments(user.id)
      .then((docs) => {
        const forProperty = docs.filter(
          (d) => d.propertyId === resolvedProperty.id && d.deletedAt == null,
        );
        setCaseDocuments(forProperty);
        setEvidenceDocs(
          forProperty.filter(
            (d) =>
              d.useAsEvidence !== false &&
              (d.useAsEvidence === true ||
                (d.modules?.length ?? 0) > 0 ||
                d.documentType === EVIDENCE_DOCUMENT_TYPE ||
                d.documentType === PROTEST_EVIDENCE_DOCUMENT_TYPE ||
                d.documentType?.startsWith("Strategy Evidence: ") ||
                d.documentType?.startsWith("Zoning: ") ||
                d.documentType?.startsWith("Improvement: ") ||
                d.documentType?.startsWith("Site: ") ||
                d.documentType?.startsWith("Income: ")),
          ),
        );
      })
      .catch((err) => console.error("Could not load uploaded evidence for this property:", err))
      .finally(() => setEvidenceDocsLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, resolvedProperty, docsVersion]);

  useEffect(() => {
    if (!evidenceDocsLoaded) return;
    const pending = evidenceDocs.filter(
      (d) =>
        d.valueSignal?.schemaVersion !== VALUE_SIGNAL_SCHEMA_VERSION &&
        !signalAttempts.current.has(d.id),
    );
    if (pending.length === 0) {
      setValueSignalsSettled(true);
      return;
    }
    setValueSignalsSettled(false);
    let cancelled = false;
    void (async () => {
      for (const d of pending) {
        signalAttempts.current.add(d.id);
        try {
          await extractEvidenceValue(d.id);
        } catch (err) {
          console.error("Could not read this evidence file for value:", err);
        }
        if (cancelled) return;
      }
      // Pull the stored readings back in; the effect re-runs and settles.
      notifyDocumentsChanged();
    })();
    return () => {
      cancelled = true;
    };
  }, [evidenceDocs, evidenceDocsLoaded]);

  // Address → AI-fetched property base data. Loads the stored copy so the
  // "Property Base Data" strip renders immediately; auto-fetches once per
  // property when there's none or it's older than 30 days. siteCoords may
  // still be resolving — a manual Refresh or the weekly cron picks up site
  // GIS if it isn't ready yet.
  useEffect(() => {
    if (!user || !resolvedProperty) return;
    if (baseDataFetchedFor.current === resolvedProperty.id) return;
    baseDataFetchedFor.current = resolvedProperty.id;
    setBaseDataChecked(false);
    getPropertyBaseData(resolvedProperty.id)
      .then((bd) => {
        setBaseData(bd);
        const stale =
          !bd || Date.now() - new Date(bd.fetchedAt).getTime() > 30 * 24 * 60 * 60 * 1000;
        // The weekly cron sets last_change_note when it detects a CAD change
        // but leaves the doc for the client to rebuild — do that now, and
        // refresh the two modules that lean hardest on the assessed value.
        if (bd?.lastChangeNote) {
          toast.message(`Property base data changed — ${bd.lastChangeNote}`);
          void refreshBaseData({ silent: true }).then(() => {
            loadModule("health", { force: true });
            loadModule("strategy", { force: true });
          });
        } else if (stale) {
          void refreshBaseData({ silent: true });
        }
      })
      .catch((err) => console.error("Could not load property base data:", err))
      .finally(() => setBaseDataChecked(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, resolvedProperty]);

  useEffect(() => {
    if (!resolvedProperty) {
      setOverridesLoaded(true); // no property (intake preview) => nothing to wait for
      return;
    }
    setOverridesLoaded(false); // real property just arrived — hold the batch until this settles
    listModuleOverrides(resolvedProperty.id)
      .then(setOverrides)
      .catch((err) => console.error("Could not load module overrides for this property:", err))
      .finally(() => setOverridesLoaded(true));
  }, [resolvedProperty]);

  useEffect(() => {
    if (!resolvedProperty) {
      setCompSelectionsLoaded(true);
      return;
    }
    setCompSelectionsLoaded(false);
    listCompSelections(resolvedProperty.id)
      .then(setCompSelections)
      .catch((err) => console.error("Could not load comp selections for this property:", err))
      .finally(() => setCompSelectionsLoaded(true));
  }, [resolvedProperty]);

  useEffect(() => {
    if (!resolvedProperty) {
      setIncomeAnalysis(null);
      setIncomeAnalysisLoaded(true);
      return;
    }
    setIncomeAnalysisLoaded(false);
    getIncomeAnalysis(resolvedProperty.id)
      .then(setIncomeAnalysis)
      .catch((err) => console.error("Could not load income analysis for this property:", err))
      .finally(() => setIncomeAnalysisLoaded(true));
  }, [resolvedProperty]);

  // Which Module-7 source documents the owner has uploaded, by kind — drives
  // the Data Availability panel and the deterministic confidence bump.
  const incomeDocKinds = useMemo(() => {
    const kinds = new Set<string>();
    for (const d of evidenceDocs) {
      const m = d.documentType?.match(/^Income:\s*(.+)$/);
      if (m) kinds.add(m[1].trim());
    }
    return [...kinds];
  }, [evidenceDocs]);

  // Deterministic income-approach math (src/lib/income-approach.ts) — NEVER an
  // AI value. The AI layer (moduleData.income) only explains these numbers.
  const incomeFigures = useMemo<IncomeFigures>(
    () => ({
      grossPotentialIncome: incomeAnalysis?.grossPotentialIncome ?? null,
      otherIncome: incomeAnalysis?.otherIncome ?? null,
      vacancyPct: incomeAnalysis?.vacancyPct ?? null,
      operatingExpenses: incomeAnalysis?.operatingExpenses ?? null,
      noiStated: incomeAnalysis?.noiStated ?? null,
      rentableSqft: incomeAnalysis?.rentableSqft ?? null,
      capRatePct: incomeAnalysis?.capRatePct ?? null,
      capRateSource: incomeAnalysis?.capRateSource ?? null,
      documentKinds: incomeDocKinds,
    }),
    [incomeAnalysis, incomeDocKinds],
  );
  const incomeComputed = useMemo<IncomeApproach>(
    () => computeIncomeApproach(incomeFigures, state.totalValue ?? null),
    [incomeFigures, state.totalValue],
  );

  // Re-run Module 7's AI narrative (and its dependents) whenever the
  // owner-confirmed figures change — keyed on a stable digest so this fires
  // on the render AFTER the figures actually update, with a fresh
  // incomeComputed, rather than from saveIncomeAnalysis's stale closure.
  // Same "never a cold fetch" rule as everywhere else: only when the module
  // is open or has already run.
  const incomeReloadKey = incomeComputed.dataComplete
    ? [
        incomeComputed.gpi,
        incomeComputed.otherIncome,
        incomeComputed.vacancyPct,
        incomeComputed.operatingExpenses,
        incomeComputed.noiStated,
        incomeComputed.capRatePct,
        incomeComputed.capRateSource,
        incomeDocKinds.join(","),
      ].join("|")
    : "";
  const incomeLoadedKeyRef = useRef<string>("");
  useEffect(() => {
    if (!incomeReloadKey) return;
    const alreadyRan = !!(moduleData.income?.data || moduleData.income?.error);
    if (openId !== "income" && !alreadyRan) return; // never a cold fetch
    if (incomeLoadedKeyRef.current === incomeReloadKey) return; // already loaded for these figures
    incomeLoadedKeyRef.current = incomeReloadKey;
    loadModule("income", { force: true });
    reloadDependentModules("income");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomeReloadKey, openId]);

  // Re-run Module 2 whenever a per-strategy evidence doc is added (from the
  // card's "Data Needed" upload chip or the modal's StrategyDetail), on the
  // render after evidenceDocs updates so loadModule sees the new file. Only
  // when Module 2 has already run — never a cold fetch. Starts from the
  // mount count so an initial load doesn't re-trigger it.
  const strategyEvidenceCount = evidenceDocs.filter(
    (d) => d.modules?.includes("strategy") || d.documentType?.startsWith("Strategy Evidence: "),
  ).length;
  const strategyEvidenceSeenRef = useRef<number | null>(null);
  useEffect(() => {
    if (strategyEvidenceSeenRef.current === null) {
      strategyEvidenceSeenRef.current = strategyEvidenceCount;
      return;
    }
    if (strategyEvidenceCount <= strategyEvidenceSeenRef.current) {
      strategyEvidenceSeenRef.current = strategyEvidenceCount;
      return;
    }
    strategyEvidenceSeenRef.current = strategyEvidenceCount;
    if (moduleData.strategy?.data || moduleData.strategy?.error) {
      loadModule("strategy", { force: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategyEvidenceCount]);

  // Same, for Module 5 (Improvement Condition) — a photo uploaded from the
  // card's per-component control (EVIDENCE_DOCUMENT_TYPE) or the modal's
  // single upload (AI-tagged "Improvement: <component>") re-runs the
  // condition assessment + its dependents.
  const improvementEvidenceCount = evidenceDocs.filter(
    (d) =>
      d.modules?.includes("improvement") ||
      d.documentType === EVIDENCE_DOCUMENT_TYPE ||
      d.documentType?.startsWith("Improvement: "),
  ).length;
  const improvementEvidenceSeenRef = useRef<number | null>(null);
  useEffect(() => {
    if (improvementEvidenceSeenRef.current === null) {
      improvementEvidenceSeenRef.current = improvementEvidenceCount;
      return;
    }
    if (improvementEvidenceCount <= improvementEvidenceSeenRef.current) {
      improvementEvidenceSeenRef.current = improvementEvidenceCount;
      return;
    }
    improvementEvidenceSeenRef.current = improvementEvidenceCount;
    if (moduleData.improvement?.data || moduleData.improvement?.error) {
      loadModule("improvement", { force: true });
      reloadDependentModules("improvement");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [improvementEvidenceCount]);

  // Same, for Module 6 (Zoning & Classification) — a doc uploaded from the
  // card's per-aspect "Needs data" chip (tagged "Zoning: <aspect>") re-runs
  // the classification check + its dependents.
  const zoningEvidenceCount = evidenceDocs.filter(
    (d) => d.modules?.includes("zoning") || d.documentType?.startsWith("Zoning: "),
  ).length;
  const zoningEvidenceSeenRef = useRef<number | null>(null);
  useEffect(() => {
    if (zoningEvidenceSeenRef.current === null) {
      zoningEvidenceSeenRef.current = zoningEvidenceCount;
      return;
    }
    if (zoningEvidenceCount <= zoningEvidenceSeenRef.current) {
      zoningEvidenceSeenRef.current = zoningEvidenceCount;
      return;
    }
    zoningEvidenceSeenRef.current = zoningEvidenceCount;
    if (moduleData.zoning?.data || moduleData.zoning?.error) {
      loadModule("zoning", { force: true });
      reloadDependentModules("zoning");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoningEvidenceCount]);

  // Catch-all for the universal card "Upload data" control: modules 1/3/4/8/10
  // fold the evidence-doc list into their input but have no per-type digest
  // of their own (unlike 2/5/6 above), so any change to the total evidence
  // count re-runs the ones that have already generated. loadModule() dedupes,
  // so a strategy/improvement/zoning upload that also bumps this total just
  // regenerates those extra modules once — the intended "I added data, refresh
  // what it touched" behaviour.
  const totalEvidenceCount = evidenceDocs.length;
  const totalEvidenceSeenRef = useRef<number | null>(null);
  useEffect(() => {
    if (totalEvidenceSeenRef.current === null) {
      totalEvidenceSeenRef.current = totalEvidenceCount;
      return;
    }
    if (totalEvidenceCount <= totalEvidenceSeenRef.current) {
      totalEvidenceSeenRef.current = totalEvidenceCount;
      return;
    }
    totalEvidenceSeenRef.current = totalEvidenceCount;
    for (const id of ["health", "comps", "site", "evidence", "executive"]) {
      if (moduleData[id]?.data || moduleData[id]?.error) loadModule(id, { force: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalEvidenceCount]);

  // Module 8 Part 8's feed-forward: when a real evidence item TRANSITIONS to
  // Verified with a relatedModule attached, the Module 2-7 finding it names
  // is now backed by real evidence that finding's own last run didn't have
  // — so re-run that module for real, not just a "you might want to
  // refresh" hint. Compares against each item's own previously-seen status
  // (not just "have we ever triggered this key") so the property's initial
  // checklist — which can already show items Verified from day one, e.g.
  // straight off authoritativeFacts — is captured as a silent baseline on
  // first sight, never itself treated as a transition. Resets on property
  // change so a revisited property gets a fresh baseline.
  const evidenceStatusSeenRef = useRef<{ propertyId: string | null; status: Map<string, string> }>({
    propertyId: null,
    status: new Map(),
  });
  useEffect(() => {
    const items = (rawModuleData.evidence?.data as ModuleResultMap["evidence"] | undefined)?.items;
    if (!items || !resolvedProperty) return;
    if (evidenceStatusSeenRef.current.propertyId !== resolvedProperty.id) {
      evidenceStatusSeenRef.current = { propertyId: resolvedProperty.id, status: new Map() };
    }
    const seen = evidenceStatusSeenRef.current.status;
    for (const it of items) {
      const status = it.status ?? (it.availability === "Low" ? "Missing" : "Found");
      const key = it.item;
      const previous = seen.get(key);
      seen.set(key, status);
      if (previous === undefined) continue; // baseline — not a transition
      if (previous !== "Verified" && status === "Verified" && it.relatedModule) {
        const rm = MODULES.find((mm) => mm.id === it.relatedModule);
        loadModule(it.relatedModule, { force: true });
        toast.info(
          `New evidence confirmed — refreshing ${rm?.shortName ?? it.relatedModule} with the latest evidence.`,
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawModuleData.evidence?.data, resolvedProperty?.id]);

  // Save owner-confirmed income figures. Optimistic; the effect above then
  // re-runs Module 7 with the fresh numbers. The form always sends the
  // complete field set (values or explicit null), so this is a passthrough.
  async function saveIncomeAnalysis(input: IncomeAnalysisInput) {
    if (!user || !resolvedProperty) return;
    setIncomeAnalysis({
      grossPotentialIncome: input.grossPotentialIncome ?? null,
      otherIncome: input.otherIncome ?? null,
      vacancyPct: input.vacancyPct ?? null,
      operatingExpenses: input.operatingExpenses ?? null,
      noiStated: input.noiStated ?? null,
      rentableSqft: input.rentableSqft ?? null,
      capRatePct: input.capRatePct ?? null,
      capRateSource: input.capRateSource ?? null,
      sourceDocumentIds: input.sourceDocumentIds ?? [],
      notes: input.notes ?? null,
      updatedAt: new Date().toISOString(),
    });
    try {
      await upsertIncomeAnalysis(user.id, resolvedProperty.id, input);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save — please try again."));
      getIncomeAnalysis(resolvedProperty.id)
        .then(setIncomeAnalysis)
        .catch(() => {});
    }
  }

  // Include/exclude a comp, or save a hand-added / document-extracted comp.
  // Optimistic local update, then re-run Module 3's AI so recommendedKeys /
  // perComp / protestRecommendation reflect the new set.
  async function saveCompSelection(sel: CompSelectionInput) {
    if (!user || !resolvedProperty) return;
    setCompSelections((prev) => [
      ...prev.filter((s) => s.compKey !== sel.compKey),
      {
        compKey: sel.compKey,
        action: sel.action,
        address: sel.address ?? null,
        latitude: sel.latitude ?? null,
        longitude: sel.longitude ?? null,
        salePrice: sel.salePrice ?? null,
        saleDate: sel.saleDate ?? null,
        landSqft: sel.landSqft ?? null,
        buildingSqft: sel.buildingSqft ?? null,
        source: sel.source ?? null,
        notes: sel.notes ?? null,
        saleVerified: sel.saleVerified ?? false,
        sourceDocumentId: sel.sourceDocumentId ?? null,
      },
    ]);
    try {
      await upsertCompSelection(user.id, resolvedProperty.id, sel);
      loadModule("comps", { force: true });
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save — please try again."));
      listCompSelections(resolvedProperty.id)
        .then(setCompSelections)
        .catch(() => {});
    }
  }

  async function removeCompSelection(compKey: string) {
    if (!resolvedProperty) return;
    setCompSelections((prev) => prev.filter((s) => s.compKey !== compKey));
    try {
      await deleteCompSelection(resolvedProperty.id, compKey);
      loadModule("comps", { force: true });
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save — please try again."));
      listCompSelections(resolvedProperty.id)
        .then(setCompSelections)
        .catch(() => {});
    }
  }

  // Back to the AI's own top 5: drop every CAD tick/untick, and re-tick any
  // comp the owner added (its figures are kept).
  async function resetCompSelections() {
    if (!user || !resolvedProperty) return;
    const propertyId = resolvedProperty.id;
    const cadRows = compSelections.filter((s) => !s.compKey.startsWith("user:"));
    const untickedOwn = compSelections.filter(
      (s) => s.compKey.startsWith("user:") && s.action === "exclude",
    );
    setCompSelections((prev) =>
      prev
        .filter((s) => s.compKey.startsWith("user:"))
        .map((s) => ({ ...s, action: "include" as const })),
    );
    try {
      await Promise.all([
        ...cadRows.map((s) => deleteCompSelection(propertyId, s.compKey)),
        ...untickedOwn.map((s) =>
          upsertCompSelection(user.id, propertyId, { ...s, action: "include" }),
        ),
      ]);
      loadModule("comps", { force: true });
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save — please try again."));
      listCompSelections(propertyId)
        .then(setCompSelections)
        .catch(() => {});
    }
  }

  // Marks a module (itemKey omitted) or a specific site-factor/building-
  // component (itemKey set) as not applicable — persists it, updates local
  // state immediately (optimistic — the write above almost never fails, and
  // this is the exact same pattern uploadDocument-adjacent state already
  // uses elsewhere on this page), and force-reloads any module whose prompt
  // depends on this signal so the AI's own text stays consistent with what
  // just changed, not just the client-side display.
  async function markNotApplicable(moduleId: string, itemKey: string = WHOLE_MODULE_KEY) {
    if (!user || !resolvedProperty) return;
    try {
      await markModuleNotApplicable(user.id, resolvedProperty.id, moduleId, itemKey);
      setOverrides((prev) => [
        ...prev.filter((o) => !(o.moduleId === moduleId && o.itemKey === itemKey)),
        { moduleId, itemKey },
      ]);
      reloadDependentModules(moduleId);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save — please try again."));
    }
  }

  async function clearNotApplicable(moduleId: string, itemKey: string = WHOLE_MODULE_KEY) {
    if (!resolvedProperty) return;
    try {
      await clearModuleNotApplicable(resolvedProperty.id, moduleId, itemKey);
      setOverrides((prev) =>
        prev.filter((o) => !(o.moduleId === moduleId && o.itemKey === itemKey)),
      );
      reloadDependentModules(moduleId);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save — please try again."));
    }
  }

  // Only force-reloads a module that's already loaded (data or error) —
  // never triggers a fresh AI call for a module the user hasn't opened yet,
  // same discipline as every other loadModule() call on this page.
  function reloadDependentModules(moduleId: string) {
    const dependents =
      moduleId === "income"
        ? ["strategy", "evidence", "executive"]
        : moduleId === "site" || moduleId === "improvement" || moduleId === "zoning"
          ? [moduleId, "strategy", "evidence", "executive"]
          : [moduleId];
    for (const id of dependents) {
      if (moduleData[id]?.data || moduleData[id]?.error)
        loadModule(id, { force: true, background: true });
    }
  }

  // Shared by startProtest (below) and handleUploadEvidence — resolves the real
  // saved PropertyRecord this report is for, creating it on first use if the user
  // hasn't saved it yet. Both actions need a real property_id to attach to.
  async function ensureProperty(): Promise<PropertyRecord | null> {
    if (!user) return null;
    if (resolvedProperty) return resolvedProperty;
    try {
      const property = await addProperty(user.id, {
        address: state.address ?? "",
        cad: state.cad,
        accountNumber: state.accountNumber,
        ownerName: state.ownerName,
        propertyType: state.propertyType,
        landValue: state.landValue,
        improvementValue: state.improvementValue,
        totalValue: state.totalValue,
        taxYear: state.taxYear,
        valueYear: state.valueYear,
        upcomingValueYear: state.upcomingValueYear,
        valueHistory: state.valueHistory,
      });
      setResolvedProperty(property);
      return property;
    } catch (err) {
      console.error("Could not save this property:", err);
      return null;
    }
  }

  // Real, one-click checkout for THIS property, right from the banner below
  // — no detour through /dashboard/properties to find it again. The bracket
  // is already known from the property's own value; only the tier
  // (Owner-Managed vs CorvusPT-Managed) is a real choice only the customer
  // can make, so both real prices are shown rather than picking one. Opens
  // in a new tab (newTab: true) so the report stays put underneath; since
  // this tab never navigates away, the loading state is always released
  // here, not just on the failure path.
  //
  // Checkout is preceded by the case preview — what Corvus found for this
  // property (components/CasePreview.tsx) — and opens from that dialog's own
  // button, so the new tab is still opened straight from a click.
  async function handleSubscribeToProperty(tier: Tier) {
    const property = await ensureProperty();
    if (!property) {
      toast.error("Could not save this property. Please try again.");
      return;
    }
    setCheckoutPreview({ property, tier });
  }

  async function continueToCheckout(property: PropertyRecord, tier: Tier) {
    setSubscribingTier(tier);
    try {
      await startPropertyCheckout(property.id, tier, { newTab: true, interval: checkoutInterval });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not start checkout. Please try again.",
      );
    } finally {
      setSubscribingTier(null);
    }
  }

  async function startProtest() {
    // Real payment gate, not just a hidden/disabled button — startProtest is
    // reachable from more than one place (the banner button below AND
    // onStartProtest passed into the module preview modal), so the check
    // belongs here, once, rather than trusted to whichever caller happens to
    // render a button. myPlan alone isn't enough: it's an account-level
    // signal ("owner_managed" once ANY property is active), so a customer
    // with one paid property could otherwise file a protest on a second,
    // unpaid one — hasFullAccess is the real per-property answer (reads
    // resolvedProperty's own subscriptionStatus; see its own effect above).
    if (!hasFullAccess) {
      toast.error("Subscribe to this property before filing a protest.");
      return;
    }
    const property = await ensureProperty();
    if (!property) return;
    // Owner-managed customers file their own protest — ProtestAuthorizationFlow
    // is the CorvusPT Service Agreement (appoints CorvusPT as agent, 25%
    // contingency fee, "CorvusPT staff will follow up"), the correct flow only
    // for corvusrf_managed. Owner-managed skips straight to a real protest
    // record and their own case, where the real form they'll actually sign is
    // Form 50-132 itself (via File Protest), not an agent appointment.
    if (myPlan === "owner_managed") {
      if (!user) return;
      try {
        const created = await requestProtest(user.id, property.id, {
          address: property.address,
          userEmail: user.email ?? undefined,
          originalValue: property.totalValue,
          taxYear: property.taxYear,
        });
        setExistingProtest(created);
        generateCasePrep(created.id, user.id, property).catch((err) =>
          console.error("Case prep generation failed:", err),
        );
        toast.success("Protest started — let's get your form filed.");
        nav({ to: "/dashboard/case", search: { propertyId: property.id } });
      } catch (err) {
        toast.error(getErrorMessage(err, "Could not start your protest."));
      }
      return;
    }
    setAuthorizing(true);
  }

  // Shared pool across Improvement Condition's evidence upload and Module 2's
  // per-strategy evidence gate (up to 5-6 strategies) — raised from 4
  // (Improvement-only) to 8, then to 20 per explicit request for more
  // headroom on properties with many documents.
  const MAX_EVIDENCE_FILES = 20;

  // Takes a plain File[] rather than the FileList straight off an <input> — FileList
  // is a live view of the input, so if the caller clears input.value right after
  // selecting (to allow re-picking the same file later), the FileList empties out
  // before this async function gets around to reading it. Converting to an array in
  // the onChange handler itself, before the input is cleared, avoids that.
  //
  // `strategyId` tags uploads coming from Module 2's per-strategy evidence gate
  // (see StrategyDetail in ModulePreviewBody) with which strategy they satisfy;
  // omitted, it falls back to the original Improvement Condition document type so
  // that module's existing upload flow is unchanged.
  async function handleUploadEvidence(
    files: File[],
    strategyId?: string,
    // Explicit override for a caller that isn't Module 2 (strategyId) or
    // Module 5 (the EVIDENCE_DOCUMENT_TYPE default below) — Module 8's own
    // upload widget passes PROTEST_EVIDENCE_DOCUMENT_TYPE here so its files
    // are tagged the same as CaseDetailModal's evidence-checklist uploads,
    // not lumped in with Improvement Condition's.
    documentTypeOverride?: string,
  ) {
    if (!user) return;
    const property = await ensureProperty();
    if (!property) {
      toast.error("Could not save this property. Please try again.");
      return;
    }
    const room = MAX_EVIDENCE_FILES - evidenceDocs.length;
    if (room <= 0) {
      toast.error(`You can upload up to ${MAX_EVIDENCE_FILES} evidence files per property.`);
      return;
    }
    const toUpload = files.slice(0, room);
    const documentType =
      documentTypeOverride ??
      (strategyId ? `Strategy Evidence: ${strategyId}` : EVIDENCE_DOCUMENT_TYPE);
    setUploadingEvidence(true);
    try {
      const uploaded: { doc: DocumentRecord; file: File }[] = [];
      for (const file of toUpload) {
        if (file.size > UPLOAD_LIMITS.maxFileBytes) {
          toast.error(
            `${file.name} exceeds ${Math.round(UPLOAD_LIMITS.maxFileBytes / (1024 * 1024))} MB.`,
          );
          continue;
        }
        uploaded.push({
          doc: await uploadDocument(user.id, property.id, file, documentType),
          file,
        });
      }
      if (uploaded.length > 0) {
        setEvidenceDocs((prev) => [...prev, ...uploaded.map((u) => u.doc)]);
        toast.success(`Added ${uploaded.length} evidence file${uploaded.length === 1 ? "" : "s"}.`);
        // One classification per file → the module tags every relevant
        // module reads by (documents.modules). Runs after the toast so the
        // upload never blocks on it; the tags stream in and re-key the
        // per-module digests.
        void Promise.all(
          uploaded.map(async ({ doc, file }) => {
            const modules = await tagUploadedDocument(doc.id, file);
            if (modules.length > 0) {
              setEvidenceDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, modules } : d)));
            }
          }),
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not upload evidence.");
    } finally {
      setUploadingEvidence(false);
    }
  }

  // Module 3 — upload one sale document (closing statement / appraisal /
  // contract), read it with extract-comp-sale, and hand the pulled figures
  // back to AddCompForm so the user can confirm them before the comp is
  // saved as verified. Tagged "Comp Sale Evidence" so it's filterable in
  // Documents but kept out of the protest-evidence packet.
  async function extractCompSaleFromFile(file: File): Promise<CompSaleExtraction | null> {
    if (!user) return null;
    const property = await ensureProperty();
    if (!property) {
      toast.error("Could not save this property. Please try again.");
      return null;
    }
    if (file.size > UPLOAD_LIMITS.maxFileBytes) {
      toast.error(
        `${file.name} exceeds ${Math.round(UPLOAD_LIMITS.maxFileBytes / (1024 * 1024))} MB.`,
      );
      return null;
    }
    const doc = await uploadDocument(user.id, property.id, file, "Comp Sale Evidence");
    // A comp sale document — feeds the Comparable Sales module (and the
    // strategy that rests on it). Known kind, so tag it directly.
    void setDocumentModules(doc.id, ["comps", "strategy"]).catch(() => {});
    setEvidenceDocs((prev) => [...prev, { ...doc, modules: ["comps", "strategy"] }]);
    return await extractCompSale(doc.id);
  }

  // Module 7 — read one already-uploaded income document (tagged "Income: …"
  // via onUploadEvidence) with extract-income-financials and hand the pulled
  // figures back to IncomeFiguresForm to pre-fill. Nothing is saved until the
  // owner confirms the form.
  async function extractIncome(documentId: string) {
    return await extractIncomeFinancials(documentId);
  }

  // Free-text fallback for Module 2's per-strategy evidence gate (see
  // StrategyDetail) — persisted the same way the rest of intake state is, via
  // sessionStorage, so it survives a refresh but never leaves the browser.
  function answerStrategy(strategyId: string, answer: string) {
    const next = updateIntake({
      strategyAnswers: { ...(state.strategyAnswers ?? {}), [strategyId]: answer },
    });
    setState(next);
    toast.success("Answer saved.");
  }

  // Powers every module's "Ask AI" box (see ModuleQABox) — grounded in the
  // same record loadModule() sends, whatever that module has already
  // generated, AND the central documents tagged to this module + the
  // selected strategy's rationale, so the answer can name the evidence that
  // supports a finding and what's still missing.
  async function askQuestion(moduleId: string, question: string): Promise<string> {
    const input: ModuleAnalysisInput = {
      address: state.address,
      cad: state.cad,
      propertyType: state.propertyType,
      landValue: state.landValue,
      improvementValue: state.improvementValue,
      totalValue: state.totalValue,
      taxYear: state.taxYear,
    };
    const linkedDocs = evidenceDocs
      .filter((d) => d.modules?.includes(moduleId))
      .map((d) => ({ name: d.fileName, notes: d.aiNotes ?? null }));
    const strategyData = moduleData.strategy?.data as
      { rationale?: string; strategyRationale?: string } | undefined;
    const strategyRationale = strategyData?.strategyRationale ?? strategyData?.rationale ?? null;
    return askModuleQuestion(moduleId, question, input, moduleData[moduleId]?.data ?? null, {
      linkedDocs,
      strategyRationale,
    });
  }

  // "AI fills in the missing data" — drafts a starter data sheet for what a
  // module says it's missing, renders it to a PDF, files it in the central
  // repository, and tags it to that module (so it shows in that module's
  // document list, badged AI-generated). It is a reference document the
  // owner reviews — never fed back into a module as a real input.
  async function handleGenerateDataSheet(
    moduleId: string,
    moduleLabel: string,
    moduleResult: unknown,
  ): Promise<string | null> {
    if (!user) return null;
    const property = await ensureProperty();
    if (!property) {
      toast.error("Could not save this property. Please try again.");
      return null;
    }
    try {
      const sheet = await generateDataSheet(moduleId, moduleLabel, moduleResult, {
        address: state.address,
        cad: state.cad,
        propertyType: state.propertyType,
        totalValue: state.totalValue,
        taxYear: state.taxYear,
      });
      const file = await buildDataSheetFile(sheet);
      const doc = await uploadDocument(
        user.id,
        property.id,
        file,
        `${DATA_SHEET_DOCUMENT_TYPE_PREFIX}${moduleLabel}`,
      );
      await setDocumentModules(doc.id, [moduleId]).catch(() => {});
      setEvidenceDocs((prev) => [...prev, { ...doc, modules: [moduleId] }]);
      toast.success(`Starter data sheet added to your documents: ${sheet.title}`);
      return file.name;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not generate a data sheet.");
      return null;
    }
  }

  // One AI-written property profile for the whole report — restates the
  // real property record plus whatever real analysis has already run
  // (Module 1's score, Module 2's strategy, comps count), grounded only in
  // what's actually on file. Filed in Documents, untagged to any one
  // module. See generate-property-summary for the actual prompt.
  const [generatingPropertySummary, setGeneratingPropertySummary] = useState(false);
  async function handleGeneratePropertySummary() {
    if (!user) return;
    const property = await ensureProperty();
    if (!property) {
      toast.error("Could not save this property. Please try again.");
      return;
    }
    setGeneratingPropertySummary(true);
    try {
      const healthData = moduleData.health?.data as HealthScoreResult | undefined;
      const strategyData = moduleData.strategy?.data as ModuleResultMap["strategy"] | undefined;
      const summary = await generatePropertySummary(
        {
          address: state.address,
          cad: state.cad,
          ownerName: state.ownerName,
          accountNumber: state.accountNumber,
          propertyType: state.propertyType,
          landValue: state.landValue,
          improvementValue: state.improvementValue,
          totalValue: state.totalValue,
          taxYear: state.taxYear,
          valueHistory: (state.valueHistory ?? [])
            .map((h) => ({ year: h.year, total: h.appraisedValue ?? h.marketValue }))
            .filter((h): h is { year: number; total: number } => h.total != null),
        },
        {
          healthScore: healthData?.score ?? null,
          healthConclusion: healthData?.executiveConclusion ?? null,
          strategyRecommendation: strategyData?.topStrategySummary ?? null,
          compsCount: compsMap.data?.comps?.length ?? null,
          estimatedSavings: estimated.hasEstimate ? estimated.savings : null,
        },
      );
      const file = await buildPropertySummaryFile(summary);
      const doc = await uploadDocument(user.id, property.id, file, PROPERTY_SUMMARY_DOCUMENT_TYPE);
      setEvidenceDocs((prev) => [...prev, doc]);
      toast.success(`Property summary added to your documents: ${summary.title}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not generate a property summary.");
    } finally {
      setGeneratingPropertySummary(false);
    }
  }

  // opts.force  — always regenerate via the AI (Regenerate with AI).
  // opts.recheck — re-read module_results even though data is already shown:
  //   an identical input hash re-serves the stored bytes (no AI call), only a
  //   real input change regenerates. Backs the "Refresh" control.
  // opts.background — keep the current result on screen while it re-runs
  //   (marking a factor N/A); a failure keeps it too, with a toast.
  function loadModule(
    id: string,
    opts?: { force?: boolean; recheck?: boolean; background?: boolean },
  ) {
    // No AI call backs this module anymore — it renders straight from the
    // deterministic `estimated` value (see estimateSavings() above).
    if (id === "savings") return;
    // Module 7 only runs its AI narrative once the owner has provided enough
    // real figures to build the NOI ladder — before that there's nothing to
    // explain, and the module stays "Additional Data Needed" (no token spend,
    // and the eager-load effect already skips it via requiresUserData).
    if (id === "income" && !incomeComputed.dataComplete) return;
    const existing = moduleData[id];
    const background = !!opts?.background && !!existing?.data;
    if (
      (existing &&
        (existing.loading ||
          (existing.refreshing && !background) ||
          (existing.data && !opts?.force && !opts?.recheck))) ||
      !state.totalValue
    )
      return;
    // Only the latest request for a module may write its result — a
    // background re-run started twice in a row must not land out of order.
    const seq = (moduleRequestSeq.current[id] ?? 0) + 1;
    moduleRequestSeq.current[id] = seq;
    const isLatest = () => moduleRequestSeq.current[id] === seq;
    setModuleData((prev) => ({
      ...prev,
      [id]: background
        ? { ...prev[id], refreshing: true }
        : { data: null, loading: true, error: null },
    }));
    const input: ModuleAnalysisInput = {
      address: state.address,
      cad: state.cad,
      propertyType: state.propertyType,
      landValue: state.landValue,
      improvementValue: state.improvementValue,
      totalValue: state.totalValue,
      taxYear: state.taxYear,
    };

    // Module 2 ("strategy") ranks the same 5 arguments modules 3/4/5/7/6
    // investigate — scoped to just this module's own entry (not the whole
    // ranking) so its prompt gets one clear priority signal, not noise from
    // strategies it has nothing to do with. Only present once Module 2 has
    // resolved — see the eager-load effect's sequencing below.
    const strategyData = moduleData.strategy?.data as ModuleResultMap["strategy"] | undefined;
    if (strategyData) {
      const relevant = strategyData.strategies
        .filter((s) => s.relatedModules.includes(id))
        .map((s) => ({ strategy: s.name, score: s.strengthScore }));
      if (relevant.length > 0) input.priorityContext = relevant;
    }

    // Real, user-confirmed exclusions — see module-overrides.ts. Site/
    // improvement get their own exact factor/component list, hard-clamped
    // server-side (enforceSiteFactorRealData/enforceBuildingComponentRealData);
    // strategy/evidence/executive get prose context only, since their
    // missing-evidence output is free text, not a fixed schema this page
    // could reclamp itself — see notApplicableContext's own comment in the
    // edge function.
    if (id === "site") {
      const na = itemsNotApplicable(overrides, "site");
      if (na.length > 0) input.notApplicableFactors = na;
      // Site-tagged uploads re-run this module via the totalEvidenceCount
      // digest; they're not folded into the input/cache hash (that raced the
      // evidence-docs fetch on reload, and the site edge function has no
      // per-factor document handling anyway — its gating is siteGis +
      // notApplicableFactors).
    }
    if (id === "improvement") {
      const na = itemsNotApplicable(overrides, "improvement");
      if (na.length > 0) input.notApplicableComponents = na;
    }
    if (id === "strategy" || id === "evidence" || id === "executive") {
      const context: string[] = [];
      if (isModuleNotApplicable(overrides, "income")) {
        context.push(
          "Income Approach: user confirmed no P&L, rent roll, or operating statement is " +
            "available for this property.",
        );
      }
      const siteNA = itemsNotApplicable(overrides, "site");
      if (siteNA.length > 0) {
        context.push(`Land Condition: no documentation available for ${siteNA.join(", ")}.`);
      }
      const improvementNA = itemsNotApplicable(overrides, "improvement");
      if (improvementNA.length > 0) {
        context.push(`Improvement Condition: no photo available for ${improvementNA.join(", ")}.`);
      }
      // Module 6's finding flows downstream — comps selection, strategy
      // ranking, evidence needs, and the executive recommendation should all
      // be aware of a zoning/classification discrepancy and, separately,
      // whether it has valuation relevance.
      const zoningData = moduleData.zoning?.data as ModuleResultMap["zoning"] | undefined;
      if (zoningData) {
        const disc = zoningData.discrepancies[0]?.detail ?? "none detected";
        const exempt =
          zoningData.possibleExemptions.length > 0
            ? zoningData.possibleExemptions.join("; ")
            : "none";
        context.push(
          `Zoning & Classification (Module 6): classification looks ${zoningData.matches}. ` +
            `Detected discrepancy: ${disc}. Valuation relevance (separate): ${zoningData.valuationRelevance} ` +
            `Possible exemptions to raise with the ARB: ${exempt}.`,
        );
      }
      // Module 7's income indication flows downstream too — every figure here
      // is the deterministic result from income-approach.ts, not an AI value.
      if (incomeComputed.complete && incomeComputed.indicatedValue != null) {
        const gap = incomeComputed.gapPct;
        const dir =
          gap == null ? "" : gap > 0 ? `${Math.abs(gap)}% below` : `${Math.abs(gap)}% above`;
        context.push(
          `Income Approach (Module 7): NOI $${Math.round(incomeComputed.noi ?? 0).toLocaleString()} ` +
            `÷ cap rate ${incomeComputed.capRatePct}% = indicated value ` +
            `$${incomeComputed.indicatedValue.toLocaleString()}` +
            (dir ? `, which is ${dir} the CAD value` : "") +
            `. Cap-rate source: ${incomeComputed.capRateSource === "appraisal" ? "an appraisal" : "owner-entered"}.`,
        );
      }
      if (context.length > 0) input.notApplicableContext = context;
    }

    // Module 8 — everything the app can already verify, so the checklist can
    // mark items Verified/Found instead of asking the user. evidenceOnFile:
    // the real protest-evidence docs + their analyze-document read.
    // authoritativeFacts: real one-liners the app itself computes (nothing
    // fabricated). selectedStrategy: so Critical is judged against the
    // argument that strategy actually needs.
    if (id === "evidence") {
      const onFile = evidenceDocs.filter(
        (d) =>
          d.useAsEvidence === true ||
          (d.useAsEvidence !== false &&
            (d.modules?.includes("evidence") ||
              d.documentType === PROTEST_EVIDENCE_DOCUMENT_TYPE ||
              d.documentType?.startsWith("Evidence Category: "))),
      );
      if (onFile.length > 0) {
        input.evidenceOnFile = onFile.slice(0, 20).map((d) => ({
          name: d.fileName,
          category: d.category ?? null,
          aiNotes: d.aiNotes ?? null,
          verdict: d.aiVerdict ?? null,
        }));
      }
      input.selectedStrategy =
        (moduleData.strategy?.data as ModuleResultMap["strategy"] | undefined)?.strategies[0]
          ?.name ?? null;

      const facts: string[] = [];
      // Prefer the live record pulled by "Auto-source evidence"; otherwise
      // fall back to the property's stored AI-fetched base data so the
      // checklist can still verify against real records with no extra call.
      const bd = baseData?.snapshot;
      if (!evidenceCadRecord && bd?.cad) {
        const b = bd.cad;
        if (b.totalValue != null)
          facts.push(
            `AI-fetched base data (CAD): total assessed value $${b.totalValue.toLocaleString()}${b.taxYear ? ` (tax year ${b.taxYear})` : ""}.`,
          );
        if (b.landValue != null)
          facts.push(`AI-fetched base data (CAD): land value $${b.landValue.toLocaleString()}.`);
        if (b.improvementValue != null)
          facts.push(
            `AI-fetched base data (CAD): improvement value $${b.improvementValue.toLocaleString()}.`,
          );
        if (b.legalDescription)
          facts.push(`AI-fetched base data (CAD): legal description "${b.legalDescription}".`);
        if (b.deeds.length > 0)
          facts.push(
            `AI-fetched base data (CAD): ${b.deeds.length} recorded deed/transfer${b.deeds.length === 1 ? "" : "s"} on file.`,
          );
        if (bd.siteGis?.floodZone)
          facts.push(
            `AI-fetched base data (FEMA): flood zone ${bd.siteGis.floodZone.zone} — ${bd.siteGis.floodZone.label}${bd.siteGis.floodZone.inSFHA ? " (Special Flood Hazard Area)" : ""}.`,
          );
      }
      const cr = evidenceCadRecord;
      if (cr) {
        if (cr.totalValue != null)
          facts.push(`CAD record: total assessed value $${cr.totalValue.toLocaleString()}.`);
        if (cr.landValue != null)
          facts.push(`CAD record: land value $${cr.landValue.toLocaleString()}.`);
        if (cr.improvementValue != null)
          facts.push(`CAD record: improvement value $${cr.improvementValue.toLocaleString()}.`);
        if (cr.legalDescription)
          facts.push(`CAD record: legal description "${cr.legalDescription}".`);
        if (Array.isArray(cr.deeds) && cr.deeds.length > 0)
          facts.push(
            `CAD record: ${cr.deeds.length} recorded deed/transfer${cr.deeds.length === 1 ? "" : "s"} on file (most recent ${cr.deeds[0]?.date ?? "date n/a"}).`,
          );
        if (Array.isArray(cr.valueHistory) && cr.valueHistory.length >= 2) {
          const hv = cr.valueHistory
            .map((h) => ({ year: h.year, total: h.appraisedValue ?? h.marketValue ?? null }))
            .filter((h): h is { year: number; total: number } => h.total != null)
            .sort((a, b) => a.year - b.year);
          if (hv.length >= 2 && hv[0].total > 0) {
            const first = hv[0];
            const last = hv[hv.length - 1];
            const pct = Math.round(((last.total - first.total) / first.total) * 100);
            facts.push(
              `CAD value history: ${first.year} $${first.total.toLocaleString()} → ${last.year} $${last.total.toLocaleString()} (${pct >= 0 ? "+" : ""}${pct}%).`,
            );
          }
        }
      }
      const improvementData = moduleData.improvement?.data as
        ModuleResultMap["improvement"] | undefined;
      if (improvementData) {
        const poorComponents = improvementData.buildingComponents
          .filter((c) => !c.notApplicable && c.condition === "Poor")
          .map((c) => c.component);
        const obsolescenceParts: string[] = [];
        if (improvementData.functionalObsolescencePct != null)
          obsolescenceParts.push(
            `functional obsolescence ${improvementData.functionalObsolescencePct}%`,
          );
        if (improvementData.externalObsolescencePct != null)
          obsolescenceParts.push(
            `external/economic obsolescence ${improvementData.externalObsolescencePct}%`,
          );
        facts.push(
          `Improvement Condition (Module 5): ` +
            (poorComponents.length > 0
              ? `${poorComponents.join(", ")} rated Poor condition`
              : "no building component rated Poor from an uploaded photo") +
            (obsolescenceParts.length > 0 ? `; ${obsolescenceParts.join(", ")}` : "") +
            (improvementData.effectiveAgeYears != null
              ? `; effective age ~${improvementData.effectiveAgeYears} years`
              : "") +
            `.`,
        );
      }
      const zoningData = moduleData.zoning?.data as ModuleResultMap["zoning"] | undefined;
      if (zoningData) {
        facts.push(
          `Zoning & Classification (Module 6): classification looks ${zoningData.matches}` +
            (zoningData.discrepancies[0]?.detail
              ? `; discrepancy noted: ${zoningData.discrepancies[0].detail}`
              : "; no discrepancy detected") +
            `.`,
        );
      }
      if (siteGisMap.data) {
        const g = siteGisMap.data;
        if (g.floodZone)
          facts.push(
            `Site GIS (FEMA): flood zone ${g.floodZone.zone} — ${g.floodZone.label}${g.floodZone.inSFHA ? " (Special Flood Hazard Area)" : ""}.`,
          );
        if (g.elevationFt != null)
          facts.push(`Site GIS (USGS): ground elevation ~${Math.round(g.elevationFt)} ft.`);
      }
      if (incomeComputed.complete && incomeComputed.indicatedValue != null) {
        facts.push(
          `Income approach (Module 7, deterministic): NOI ÷ cap rate ${incomeComputed.capRatePct}% = indicated value $${incomeComputed.indicatedValue.toLocaleString()}.`,
        );
      }
      const cs = buildCompsSummary(compsMap.data);
      if (cs && cs.count > 0) {
        facts.push(
          `Comparable sales (Module 3): ${cs.count} comps, median $${cs.median.toLocaleString()} (range $${cs.min.toLocaleString()}–$${cs.max.toLocaleString()}).`,
        );
      }
      for (const c of evidenceAdj.contributions) {
        facts.push(
          `Owner-uploaded evidence (read by AI, ${c.importance} importance, ${c.direction}): ${c.label} — ${c.detail}`,
        );
      }
      if (facts.length > 0) input.authoritativeFacts = facts;
    }

    // Real signals (never fabricated) shared by Module 1 (health) and Module
    // 2 (strategy) — same helpers, same real sources, for both.
    if (id === "health" || id === "strategy") {
      input.compsSummary = buildCompsSummary(compsMap.data);
      input.assessmentRatio = getAssessmentRatioInfo(
        state.cad,
        classifyPropertyCategory(state.propertyType),
      );
      input.valueTrend = buildValueTrend(state.valueHistory);
      if (id === "health") {
        const stateHistory = (state.valueHistory ?? [])
          .map((h) => ({ year: h.year, total: h.appraisedValue ?? h.marketValue ?? null }))
          .filter((h): h is { year: number; total: number } => h.total != null)
          .sort((a, b) => a.year - b.year);
        // Fall back to the base-data snapshot's history when intake carries
        // none, so a base-data-backed property stops reporting "no historical
        // values" (it's on the CAD, we fetched it).
        const bdCad = baseData?.snapshot.cad ?? null;
        const bdHistory = (bdCad?.valueHistory ?? [])
          .filter((h): h is { year: number; total: number } => h.total != null)
          .sort((a, b) => a.year - b.year);
        input.valueHistory = stateHistory.length > 0 ? stateHistory : bdHistory;
        // Property detail the app actually has — from intake, else the
        // AI-fetched base data. Omitted (not guessed) when neither has it.
        input.legalDescription = state.legalDescription ?? bdCad?.legalDescription ?? null;
        input.subdivision = state.subdivision ?? bdCad?.subdivision ?? null;
        input.buildingSqft = bdCad?.buildingSqft ?? null;
        input.yearBuilt = bdCad?.yearBuilt ?? null;
        input.buildingClass = bdCad?.buildingClass ?? null;
        input.lotSizeAcres = bdCad?.lotSizeAcres ?? null;
        input.lastTransferDate = bdCad?.deeds?.[0]?.date ?? null;
        // The real comps gap feeds the deterministic health-score formula
        // (see computeHealthScore) — same computation the comps modal renders.
        const hStats = computeComparableStats(
          compsMap.data?.subject ?? null,
          compsMap.data?.comps ?? [],
          state.totalValue,
        );
        input.compsGapPct = hStats.valuationGapPct;
        if (evidenceAdj.applied) {
          input.evidence = {
            valueGapPct: evidenceAdj.valueGapPct,
            strength: evidenceAdj.strength,
            otherNet: evidenceAdj.otherNet,
          };
        }
      }
      input.evidenceFileNames = evidenceDocs.map((d) => d.fileName);
    }

    async function run() {
      if (id === "health") return getHealthScore(input);

      // Grounds the Market Value module's guidance in the real comps already
      // fetched for this property (median/range/count) instead of generic
      // advice — same real signal, same helper, as the Strategy module above.
      // Sends every ranked comp (same computation the modal renders — see
      // computeComparableStats) with a stable key + the user's own
      // exclude marks and any hand-added comps, so the model can recommend
      // the strongest 3-5 and judge each one against the real numbers.
      if (id === "comps") {
        input.compsSummary = buildCompsSummary(compsMap.data);
        input.subjectTrendPctPerYear = subjectValueTrendPctPerYear(state.valueHistory);
        const stats = computeComparableStats(
          compsMap.data?.subject ?? null,
          compsMap.data?.comps ?? [],
          state.totalValue,
          {
            excludedKeys: excludedCompKeys(compSelectionsRef.current),
            pinnedKeys: pinnedCompKeys(compSelectionsRef.current),
            subjectAddress: state.address,
            extraComps: compSelectionsToExtraComps(compSelectionsRef.current),
            subjectTrendPctPerYear: input.subjectTrendPctPerYear,
          },
        );
        // Only the final 5 — the AI's recommendation is about the comps the
        // owner is actually using.
        if (stats.selected.length > 0) {
          input.topComps = stats.selected.map((c) => ({
            key: c.key,
            address: c.address || `Property #${c.pid}`,
            distanceMi: c.distanceMi,
            marketValue: c.marketValue,
            similarity: c.similarity,
            excluded: c.excluded,
            userAdded: c.userAdded,
            saleVerified: c.saleVerified ?? undefined,
            flags: c.flags.length > 0 ? c.flags : undefined,
          }));
        }
        input.compsSubjectValue = stats.subjectValue;
      }

      // Module 4's real point GIS facts, when the sequencing effect above
      // already resolved them for this property's lat/lng — absent
      // entirely, never fabricated, for the counties with no lat/lng at
      // all. See enforceSiteFactorRealData in the edge function for how
      // this gates every factor's status server-side, not just here.
      if (id === "site" && siteGisMap.data) {
        input.siteGis = siteGisMap.data;
      }

      // Module 6 — the real classification/zoning data this app has (the
      // comps subject carries a zoning string for the TrueProdigy counties),
      // the comps' own classifications, and any docs the user uploaded onto
      // a zoning aspect. enforceZoningRealData gates each aspect on these.
      if (id === "zoning") {
        const subj = compsMap.data?.subject ?? null;
        input.zoningData = {
          cadClassification: state.propertyType ?? null,
          cadZoning: subj?.zoning ?? cityZoning?.label ?? null,
          legalDescription: state.legalDescription ?? null,
          subdivision: state.subdivision ?? null,
          comps: (compsMap.data?.comps ?? []).slice(0, 15).map((c) => ({
            classification: c.propType ?? null,
            zoning: c.zoning ?? null,
          })),
          uploadedDocs: evidenceDocs
            .filter((d) => d.modules?.includes("zoning") || d.documentType?.startsWith("Zoning: "))
            .map((d) => d.fileName),
        };
      }

      // Module 7 — the owner-confirmed income figures + the deterministic
      // EGI/NOI/indicated value (income-approach.ts). The AI only explains
      // these; enforceIncomeRealData server-side forces "inconclusive" if the
      // core figures or a cap rate are missing.
      if (id === "income") {
        input.incomeFigures = {
          grossPotentialIncome: incomeComputed.gpi,
          otherIncome: incomeComputed.otherIncome,
          vacancyPct: incomeComputed.vacancyPct,
          operatingExpenses: incomeComputed.operatingExpenses,
          egiComputed: incomeComputed.egi,
          noiComputed: incomeComputed.noiComputed,
          opexRatioPct: incomeComputed.opexRatioPct,
          rentableSqft: incomeAnalysis?.rentableSqft ?? null,
          documentKinds: incomeDocKinds,
        };
        input.capRate = {
          pct: incomeComputed.capRatePct,
          source: incomeComputed.capRateSource,
        };
        input.incomeIndicatedValue = incomeComputed.indicatedValue;
        input.cadValue = state.totalValue ?? null;
        const cs = computeComparableStats(
          compsMap.data?.subject ?? null,
          compsMap.data?.comps ?? [],
          state.totalValue,
        );
        input.compsIndicatedRange = cs.indicated
          ? { min: cs.indicated.min, median: cs.indicated.median, max: cs.indicated.max }
          : null;
      }

      // Module 10 reconciles Modules 2/3/8/9's already-real outputs — see the
      // sequencing effect above that waits for strategy + evidence to settle
      // before this ever fires, so these reads are the real thing, not
      // whatever happened to be in state on the first render.
      if (id === "executive") {
        const strategyData = moduleData.strategy?.data as ModuleResultMap["strategy"] | undefined;
        if (strategyData && strategyData.strategies.length > 0) {
          input.topStrategies = strategyData.strategies.slice(0, 2).map((s) => ({
            name: s.name,
            primaryReason: s.primaryReason,
            strengthScore: s.strengthScore,
            whySelected: s.whySelected,
            existingEvidence: s.existingEvidence,
            missingEvidence: s.missingEvidence,
          }));
        }
        const evidenceData = moduleData.evidence?.data as ModuleResultMap["evidence"] | undefined;
        if (evidenceData) {
          // priority/status are the real model now; the importance/availability
          // fallback keeps a stale cached shape working.
          const isCriticalMissing = (i: ModuleResultMap["evidence"]["items"][number]) =>
            i.priority
              ? i.priority === "Critical" && i.status === "Missing"
              : i.importance === "High" && i.availability === "Low";
          const isMissing = (i: ModuleResultMap["evidence"]["items"][number]) =>
            i.status ? i.status === "Missing" : i.availability === "Low";
          input.evidenceReadiness = {
            criticalMissing: evidenceData.items.filter(isCriticalMissing).map((i) => i.item),
            importantMissing: evidenceData.items
              .filter((i) => isMissing(i) && !isCriticalMissing(i))
              .map((i) => i.item),
            uploadedCount: evidenceDocs.length,
          };
        }
        const execStats = computeComparableStats(
          compsMap.data?.subject ?? null,
          compsMap.data?.comps ?? [],
          state.totalValue,
        );
        if (execStats.indicated) {
          input.compsIndicated = {
            min: execStats.indicated.min,
            median: execStats.indicated.median,
            max: execStats.indicated.max,
            gapPct: execStats.valuationGapPct,
            confidencePct: execStats.confidencePct,
          };
        }
        // Module 7's real income indication, when the owner completed it — a
        // second valuation view for the executive to weigh alongside comps.
        if (incomeComputed.complete && incomeComputed.indicatedValue != null) {
          input.incomeIndicated = {
            indicatedValue: incomeComputed.indicatedValue,
            gapPct: incomeComputed.gapPct,
            supports: incomeSupportsCad(incomeComputed),
            confidencePct: incomeComputed.confidencePct,
          };
        }
        if (savingsEstimate) {
          input.financialSummary = {
            savings: savingsEstimate.amount,
            basis: savingsEstimate.basis,
            reductionPct: savingsEstimate.basis === "formula" ? savingsEstimate.reductionPct : null,
            // Module 9's fuller deterministic result — see savings-analysis.ts.
            ...(savingsAnalysis.sufficient
              ? {
                  annualSavings: savingsAnalysis.annualSavings,
                  netBenefit: savingsAnalysis.netBenefit,
                  protestCost: savingsAnalysis.protestCost,
                  protestCostSource: savingsAnalysis.protestCostSource,
                  savingsToCostMultiple: savingsAnalysis.savingsToCostMultiple,
                  roiPct: savingsAnalysis.roiPct,
                  indicatedRange: savingsAnalysis.indicatedRange,
                  financialConfidence: savingsAnalysis.financialConfidence,
                  topScenarioReductionPct: savingsAnalysis.scenarios[2]?.reductionPct,
                }
              : {}),
          };
        }
        if (existingProtest && resolvedProperty) {
          const items = getPreFilingCheck(resolvedProperty, existingProtest);
          input.preFilingStatus = {
            missingBlocking: items
              .filter((i) => i.blocking && i.status === "missing")
              .map((i) => i.label),
          };
        }
      }

      // "Sources as per steps": every module gets its slice of the reconciled
      // base-data record (county, Regrid, ATTOM, Comptroller) — see
      // module-source-facts.ts for which facts go to which module.
      const sourceFacts = moduleSourceFacts(id, baseData?.snapshot);
      if (sourceFacts.length > 0) {
        input.authoritativeFacts = [...(input.authoritativeFacts ?? []), ...sourceFacts];
      }

      // Real typical economic-life range for this property's type (see
      // src/lib/improvement-condition.ts) — always attached, not gated on
      // anything, so the AI's effective-age estimate (when it has real
      // photo grounding for one) is anchored to an honest industry-general
      // figure rather than an unmoored guess.
      if (id === "improvement") {
        input.economicLifeYears = getTypicalEconomicLife(state.propertyType);
      }

      // Improvement Condition reads uploaded evidence (photos/repair estimates/
      // appraisals) back from storage and attaches it so the AI grounds its
      // guidance in what's actually shown rather than only general advice — see
      // handleUploadEvidence() above and ai-report-modules/index.ts's evidence
      // handling. Capped to the 4 most recent, mirroring the server-side cap.
      const improvementDocs = evidenceDocs.filter(
        (d) =>
          d.modules?.includes("improvement") ||
          d.documentType === EVIDENCE_DOCUMENT_TYPE ||
          d.documentType?.startsWith("Improvement: "),
      );
      if (id === "improvement" && improvementDocs.length > 0) {
        const recent = improvementDocs.slice(-4);
        const evidenceImages = await Promise.all(
          recent.map(async (doc) => {
            const url = await getDocumentUrl(doc.storagePath);
            const blob = await fetch(url).then((r) => r.blob());
            const dataUrl = await fileToDataUrl(blob);
            return { mimeType: blob.type || "image/jpeg", dataUrl };
          }),
        );
        return getModuleAnalysis("improvement", { ...input, evidenceImages });
      }
      return getModuleAnalysis(id as BatchModuleId, input);
    }

    // Serve a stored result (identical every visit, no AI call) when caching
    // is on, we have a real saved property to key against, this isn't an
    // explicit Regenerate, and the stored row was produced from the same
    // inputs. Otherwise generate and store.
    (async () => {
      // Module 8: items the owner marked "Document not available" — read fresh
      // here (before hashing) so marking one regenerates the checklist with it
      // kept under the same name and never re-requested under a new one.
      // Improvement Condition: the owner's confirmed building records
      if (id === "improvement" && resolvedProperty) {
        const imp = await loadImprovementData(resolvedProperty.id).catch(() => null);
        const rec = imp ? recordsForModule(imp) : null;
        if (imp && rec)
          input.improvementRecords = { ...rec, cardConditions: cardConditions(imp.items) };
      }
      // Land Condition: findings the owner confirmed from uploaded reports
      if (id === "site" && resolvedProperty) {
        const r = await listSiteReports(resolvedProperty.id).catch(() => null);
        const confirmed = r ? confirmedForModule(r.findings, r.reports) : [];
        if (confirmed.length > 0) input.siteDocumentFindings = confirmed;
      }
      if (id === "evidence" && resolvedProperty) {
        const marks = await listUnavailable(resolvedProperty.id).catch(() => null);
        if (marks && marks.size > 0) {
          input.unavailableEvidence = [...marks.values()]
            .sort((a, b) => a.item.localeCompare(b.item))
            .map((r) => ({ item: r.item, reason: reasonLabel(r.reason) }));
        }
      }
      const canCache = !!resolvedProperty && !!user && cacheEnabled;
      let inputHash: string | null = null;
      if (canCache) {
        try {
          inputHash = await hashModuleInput(id as BatchModuleId | "health", input);
          if (!opts?.force) {
            const hit = await getCachedModuleResult(resolvedProperty!.id, id);
            if (hit && hit.inputHash === inputHash) {
              if (!isLatest()) return;
              setModuleData((prev) => ({
                ...prev,
                [id]: { data: hit.result, loading: false, error: null, cachedAt: hit.updatedAt },
              }));
              return;
            }
          }
        } catch (e) {
          console.error("module cache read failed:", e); // fall through to a live call
        }
      }
      try {
        const data = await run();
        if (!isLatest()) return;
        setModuleData((prev) => ({ ...prev, [id]: { data, loading: false, error: null } }));
        if (canCache && inputHash) {
          saveModuleResult(user!.id, resolvedProperty!.id, id, inputHash, MODEL_TAG, data).catch(
            (e) => console.error("module cache write failed:", e),
          );
        }
      } catch (err) {
        if (!isLatest()) return;
        if (background) {
          setModuleData((prev) => ({ ...prev, [id]: { ...prev[id], refreshing: false } }));
          toast.error("Could not update this analysis — showing the previous result.");
          return;
        }
        setModuleData((prev) => ({
          ...prev,
          [id]: {
            data: null,
            loading: false,
            error: err instanceof Error ? err.message : "Could not generate this analysis.",
          },
        }));
      }
    })();
  }

  // Auto-retry a module that landed in an error state, instead of making the
  // user click "click to view & retry" themselves. invokeEdgeFunction already
  // retries transient 429/504s internally before ever surfacing an error here
  // (see src/lib/edge-functions.ts) — a module reaching this state exhausted
  // that whole budget, which live testing while chasing this same "modules
  // keep erroring" report showed happens during genuinely bad stretches of
  // Gemini congestion (per-call failure rates swinging from ~0% to 50%+
  // minute to minute), not a permanent problem. Capped at AUTO_RETRY_MAX so a
  // truly broken call (missing secret, bad input) doesn't hammer the API
  // forever — the existing manual retry link is still there as the fallback
  // once this budget is spent.
  const autoRetryRef = useRef<
    Record<string, { count: number; timer: ReturnType<typeof setTimeout> | null }>
  >({});
  const AUTO_RETRY_MAX = 3;
  const AUTO_RETRY_DELAY_MS = 6000;
  useEffect(() => {
    for (const [id, entry] of Object.entries(rawModuleData)) {
      const tracked = autoRetryRef.current[id];
      // A retry attempt itself sets {data: null, loading: true, error: null}
      // — indistinguishable from "never failed" by entry.error alone, which
      // would otherwise hit the branch below and wipe the count this same
      // attempt just incremented, before its outcome is even known (making
      // AUTO_RETRY_MAX effectively unbounded — confirmed by tracing it
      // through). Skip entirely while in flight; only a real settled result
      // (success below, or a fresh error two branches down) should touch
      // tracking.
      if (entry.loading) continue;
      if (!entry.error) {
        // A genuine success — clear tracking so a future failure on this
        // same module gets a fresh retry budget instead of inheriting an
        // old count.
        if (tracked) {
          if (tracked.timer) clearTimeout(tracked.timer);
          delete autoRetryRef.current[id];
        }
        continue;
      }
      if (tracked?.timer) continue; // a retry is already scheduled for this module
      const count = tracked?.count ?? 0;
      if (count >= AUTO_RETRY_MAX) continue;
      const timer = setTimeout(() => {
        autoRetryRef.current[id] = { count: count + 1, timer: null };
        loadModule(id, { force: true });
      }, AUTO_RETRY_DELAY_MS);
      autoRetryRef.current[id] = { count, timer };
    }
    // loadModule is intentionally excluded — same rationale as the eager-load
    // effects elsewhere on this page (it closes over moduleData for its own
    // fetch guard and would otherwise re-fire this effect on every load it
    // itself triggers).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawModuleData]);
  // Cleanup only, run once — cancels any still-pending auto-retry timers if
  // the user navigates away mid-retry rather than letting them fire (and
  // call setModuleData) against an unmounted page. Deliberately reads
  // autoRetryRef.current live inside the cleanup rather than a captured
  // snapshot — this ref isn't a DOM node, it's a running tally that keeps
  // growing for as long as the page is mounted, so the exhaustive-deps
  // warning's usual "copy .current to a variable" fix would only ever see
  // the empty object from right after mount, before any retry was ever
  // scheduled.
  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      for (const entry of Object.values(autoRetryRef.current)) {
        if (entry.timer) clearTimeout(entry.timer);
      }
    };
  }, []);

  function loadCompsMap() {
    if (compsMap.data || compsMap.loading) return;
    setCompsMap({ data: null, loading: true, attempted: true });
    getComps({
      cad: state.cad,
      accountNumber: state.accountNumber,
      address: state.address,
      totalValue: state.totalValue ?? undefined,
    })
      .then((data) => setCompsMap({ data, loading: false, attempted: true }))
      .catch(() => setCompsMap({ data: null, loading: false, attempted: true }));
  }

  // Real coordinates for Module 4's map/FEMA-flood/USGS-elevation/highway-
  // rail lookups — the real CAD subject when getComps() has one, otherwise
  // the geocoded fallback below. Neither is ever fabricated: a property with
  // no CAD coordinates AND a failed/no-match geocode simply has none, and
  // Module 4 honestly shows "Additional Data Needed" throughout, same as
  // before this fallback existed.
  const cadSubject = compsMap.data?.subject;
  const siteCoords: GeocodedPoint | null = cadSubject
    ? { lat: cadSubject.latitude, lng: cadSubject.longitude }
    : geocodedSubject.data;
  // True once we know for certain whether real coordinates exist at all —
  // either a CAD subject was there all along, or the geocode fallback has
  // itself settled (found something or genuinely didn't). Lets the firing
  // sequence below wait for a real answer instead of firing "site" with a
  // premature "no data" the instant compsMap alone settles.
  const siteCoordsSettled = !!cadSubject || geocodedSubject.attempted;

  const cityZoningKey = siteCoords ? `${siteCoords.lat},${siteCoords.lng}` : null;
  useEffect(() => {
    if (!siteCoords || !cityZoningKey) return;
    let live = true;
    lookupCityZoning(siteCoords.lat, siteCoords.lng)
      .then((r) => r.matches.map(zoningLabel).join("; ") || null)
      .catch(() => null)
      .then((label) => live && setCityZoning({ key: cityZoningKey, label }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityZoningKey]);
  // Module 6 waits for this so its input (and cache hash) is the same on
  // every visit; no coordinates = nothing to wait for.
  const cityZoningSettled =
    siteCoordsSettled && (!cityZoningKey || cityZoning?.key === cityZoningKey);

  // Only reachable once compsMap has settled with no subject of its own —
  // most counties (see getComps' own comment), so this is the common path,
  // not a rare edge case.
  useEffect(() => {
    if (!compsMap.attempted || compsMap.loading || compsMap.data?.subject) return;
    if (geocodedSubject.attempted || geocodedSubject.loading) return;
    const address = resolvedProperty?.address || state.address;
    if (!address) return;
    setGeocodedSubject({ data: null, loading: true, attempted: false });
    geocodeAddress(address)
      .then((point) => setGeocodedSubject({ data: point, loading: false, attempted: true }))
      .catch(() => setGeocodedSubject({ data: null, loading: false, attempted: true }));
  }, [
    compsMap.attempted,
    compsMap.loading,
    compsMap.data,
    resolvedProperty,
    state.address,
    geocodedSubject.attempted,
    geocodedSubject.loading,
  ]);

  // Real point GIS facts (Module 4) — only ever fetched once compsMap has
  // resolved a real lat/lng (see the firing effect below); most counties
  // have no lat/lng at all yet, in which case this is simply never called
  // and Module 4 honestly shows "Additional Data Needed" throughout.
  // `attempted` (distinct from `loading`) is what lets the sequencing effect
  // below tell "settled, no data" apart from "not started yet" — `loading:
  // false` alone can't, since both the initial and the post-fetch state
  // share it.
  function loadSiteGis(lat: number, lng: number) {
    if (siteGisMap.attempted || siteGisMap.loading) return;
    setSiteGisMap({ data: null, loading: true, attempted: true });
    getSiteGis({ lat, lng })
      .then((data) => setSiteGisMap({ data, loading: false, attempted: true }))
      .catch(() => setSiteGisMap({ data: null, loading: false, attempted: true }));
  }

  // Module 4 "Fetch details" — re-pull the FEMA flood zone + USGS elevation
  // for the property's coordinates, ignoring the once-only `attempted` guard
  // above, then re-run the module. No-op without coordinates.
  const [siteGisRefreshing, setSiteGisRefreshing] = useState(false);
  async function handleRefreshSiteGis() {
    if (!siteCoords) {
      toast.error("No coordinates on file for this property — can't fetch site data.");
      return;
    }
    setSiteGisRefreshing(true);
    setSiteGisMap({ data: null, loading: true, attempted: true });
    try {
      const data = await getSiteGis({ lat: siteCoords.lat, lng: siteCoords.lng }).catch(() => null);
      setSiteGisMap({ data, loading: false, attempted: true });
      toast.success(data ? "Site data refreshed." : "No live FEMA/USGS data for this location.");
      loadModule("site", { force: true });
    } finally {
      setSiteGisRefreshing(false);
    }
  }

  useEffect(() => {
    if (!user) {
      setBillingChecked(true);
      return;
    }
    getMyBilling(user.id)
      .then(({ plan }) => {
        setMyPlan(plan);
        // beta and the legacy flat-rate plans (from before the per-property
        // model existed) grant unconditional access from the account plan
        // alone. owner_managed/corvusrf_managed no longer do — each
        // property now has its own independent Stripe subscription (see
        // src/lib/properties.ts), so access for those two plans is fully
        // decided by the effect below instead, keyed on resolvedProperty's
        // own subscriptionStatus — left untouched here (not set to false)
        // so that effect, which runs after this one resolves myPlan, is
        // never raced into briefly reading a stale null plan as "not
        // owner_managed" and skipping its own real check.
        if (plan === "ai_report" || plan === "managed_protest" || plan === "beta") {
          setHasFullAccess(true);
        }
      })
      .catch(() => setHasFullAccess(false))
      .finally(() => setBillingChecked(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Per-property access for owner_managed/corvusrf_managed — confirmed live
  // bug this replaces: the previous version only ever set hasFullAccess to
  // true and never back to false, so once ANY property in a session was
  // found active, it stayed "true" for every OTHER property viewed
  // afterward too (switching from a paid property to a different, unpaid
  // one never revoked access — a real protest got filed on a property that
  // was never paid for). This always recomputes the full real answer from
  // scratch on every resolvedProperty change instead of only ever upgrading
  // it, so switching properties can revoke access, not just grant it. Never
  // touches beta/legacy plans (guarded by myPlan), which effect above
  // already decided unconditionally.
  //
  // Gated on the plans that grant access WITHOUT a property subscription
  // (beta + the two legacy flat-rate ones, all decided unconditionally by the
  // effect above), NOT on an allow-list of the two per-property tiers. That
  // allow-list was itself a bug: profiles.plan is only a coarse mirror of
  // "the tier of the most recently created active subscription" (see
  // getMyBilling's own comment in billing.ts), and it can legitimately read
  // 'free_ai_review' while a property still has a live subscription — most
  // obviously when an admin picks "Free AI Review" in the admin panel's plan
  // dropdown, which writes profiles.plan directly and is the one plan value
  // that dropdown still lets them choose. This effect then bailed out and
  // left hasFullAccess false, showing a paying customer the paywall on a
  // property they have an active subscription for, until some later Stripe
  // webhook happened to resync the mirror. Reproduced live before this fix.
  // The PROPERTY's own subscriptionStatus is the authority here; the mirror
  // never decides access on its own.
  useEffect(() => {
    if (myPlan === "beta" || myPlan === "ai_report" || myPlan === "managed_protest") return;
    setHasFullAccess(isPaidStatus(resolvedProperty?.subscriptionStatus));
  }, [myPlan, resolvedProperty]);

  // Auto-opens a module for a deep link (CaseDetailModal's "Upload Evidence —
  // Go to Module 8" button, ?openModule=evidence) — waits for billingChecked
  // so a paying customer never sees a flash of the paywall first, and only
  // ever fires once (openId stays whatever the user does with it after).
  //
  // billingChecked alone isn't enough, though: for owner_managed/
  // corvusrf_managed, hasFullAccess for a paid-tier module also depends on
  // resolvedProperty's own subscription (a SEPARATE async lookup keyed off
  // state.address — see the effect above), which billingChecked (an
  // ACCOUNT-level "myPlan" signal) says nothing about. Firing as soon as
  // billingChecked flips can race ahead of that property lookup and show a
  // real subscribed customer the wrong paywall on a direct deep link —
  // reproduced live via ?openModule=improvement, where hasFullAccess was
  // still its default false at the moment this fired even though the
  // property had an active subscription. Wait for the property lookup to
  // actually have a chance to settle first, unless there's genuinely no
  // address for it to look up (then it will never resolve, and
  // hasFullAccess staying false is the correct answer, not a race).
  const [deepLinkHandled, setDeepLinkHandled] = useState(false);
  // Mirror the open module and tabs into the URL (replace, not push) — see
  // validateSearch. Waits for a deep-linked module to open first, so the
  // URL's openModule isn't cleared before it's been honoured.
  useEffect(() => {
    if (deepLinkModuleId && !deepLinkHandled) return;
    const next = {
      openModule: openId ?? undefined,
      tab: topTab === "case" ? ("case" as const) : undefined,
      view: modulesTab === "valuation" ? ("valuation" as const) : undefined,
    };
    if (
      next.openModule === deepLinkModuleId &&
      next.tab === initialTopTab &&
      next.view === initialModulesView
    )
      return;
    nav({
      to: ".",
      search: (prev) => ({ ...prev, ...next }),
      replace: true,
      resetScroll: false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, topTab, modulesTab, deepLinkHandled]);
  useEffect(() => {
    if (!deepLinkModuleId || deepLinkHandled || !billingChecked) return;
    const target = MODULES.find((m) => m.id === deepLinkModuleId);
    if (!target) {
      setDeepLinkHandled(true);
      return;
    }
    const unconditionalAccess =
      myPlan === "beta" || myPlan === "ai_report" || myPlan === "managed_protest";
    const propertyLookupPending = !!state.address && !resolvedProperty;
    if (target.n > FREE_MODULE_COUNT && !unconditionalAccess && propertyLookupPending) return;
    openModule(target);
    setDeepLinkHandled(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    deepLinkModuleId,
    deepLinkHandled,
    billingChecked,
    hasFullAccess,
    resolvedProperty,
    myPlan,
    state.address,
  ]);

  // The exact same estimateSavings() call the intake savings screen uses (see
  // savings-estimate.ts) — comps tier first, then the formula tier (base rate +
  // real assessment-ratio + real 10-year value-trend adjustments). Previously
  // this page reimplemented a simplified version (base rate only, no
  // adjustments) and could additionally have this number overridden by a
  // Gemini-guessed percentage once the Savings module was opened — the same
  // property could show two different, and non-deterministic, savings figures
  // depending on which page you were on. Calling the one real function here
  // instead means this page and the intake flow always agree for the same
  // property, and the number never depends on an AI call.
  const [rawSavingsEstimate, setSavingsEstimate] =
    useState<Awaited<ReturnType<typeof estimateSavings>>>(null);
  useEffect(() => {
    if (!state.totalValue) return;
    estimateSavings({
      cad: state.cad,
      accountNumber: state.accountNumber,
      address: state.address,
      propertyType: state.propertyType,
      landValue: state.landValue,
      improvementValue: state.improvementValue,
      totalValue: state.totalValue,
      taxYear: state.taxYear,
      valueHistory: state.valueHistory,
    })
      .then(setSavingsEstimate)
      .catch((err) => console.error("Savings estimate failed:", err));
  }, [
    state.totalValue,
    state.cad,
    state.accountNumber,
    state.address,
    state.propertyType,
    state.landValue,
    state.improvementValue,
    state.taxYear,
    state.valueHistory,
  ]);

  // What the owner's uploaded evidence says about value (each file is read once by
  // extract-evidence-value and stored). Everything below is deterministic from those stored
  // readings, so the score and the savings only change when evidence is added or removed.
  const evidenceItems = useMemo(
    () =>
      evidenceDocs
        .filter((d) => !!d.valueSignal && d.valueSignal.kind !== "not_valuation_evidence")
        .map((d) => ({ docId: d.id, fileName: d.fileName, signal: d.valueSignal as ValueSignal })),
    [evidenceDocs],
  );
  const evidenceAdj = useMemo(
    () =>
      computeEvidenceAdjustment({
        cadValue: state.totalValue ?? null,
        baseIndicated: baseIndicatedValue(rawSavingsEstimate, state.totalValue ?? 0),
        baseBasis: rawSavingsEstimate?.basis ?? null,
        subjectSqft: baseData?.snapshot.cad?.buildingSqft ?? null,
        items: evidenceItems,
      }),
    [evidenceItems, rawSavingsEstimate, state.totalValue, baseData],
  );
  const savingsEstimate = useMemo(() => {
    if (!state.totalValue) return rawSavingsEstimate;
    const ratePct =
      rawSavingsEstimate?.effectiveTaxRatePct ??
      Math.round(getEffectiveTaxRate(state.cad) * 1000) / 10;
    return applyEvidenceToEstimate(rawSavingsEstimate, state.totalValue, ratePct, evidenceAdj);
  }, [rawSavingsEstimate, state.totalValue, state.cad, evidenceAdj]);
  // The per-analysis scores (Comparable Sales, Site, Improvement, Income, Zoning) come from the
  // Module 2 strategy ranking. Layer the evidence's importance-weighted effect on top at read
  // time, so a critical file raises them a lot, a minor one a little, and evidence that backs the
  // county lowers them. Nothing is written back to the cached results.
  const moduleData = useMemo(() => {
    if (!evidenceAdj.applied) return rawModuleData;
    const uplift = evidenceAdj.moduleUplift as Record<string, number>;
    const coverage = evidenceAdj.moduleCoverage as Record<string, number>;
    const next = { ...rawModuleData };

    // Modules 2-7: the per-analysis strength scores and confidence.
    const st = rawModuleData.strategy;
    const d = st?.data as ModuleResultMap["strategy"] | undefined;
    if (st && d) {
      const strategies = d.strategies
        .map((s, i) => {
          const pts = s.relatedModules.reduce(
            (best, m) => (Math.abs(uplift[m] ?? 0) > Math.abs(best) ? (uplift[m] ?? 0) : best),
            0,
          );
          const cov = s.relatedModules.reduce((best, m) => Math.max(best, coverage[m] ?? 0), 0);
          return {
            s: {
              ...s,
              strengthScore: applyPoints(s.strengthScore, pts),
              confidencePct: Math.min(95, s.confidencePct + Math.round(cov * 15)),
            },
            i,
          };
        })
        .sort((x, y) => y.s.strengthScore - x.s.strengthScore || x.i - y.i)
        .map((x) => x.s);
      next.strategy = { ...st, data: { ...d, strategies } };
    }

    // Modules 4 and 5: the "documentation priority" meters fall as important evidence covers them.
    for (const id of ["site", "improvement"] as const) {
      const m = rawModuleData[id];
      const md = m?.data as { priorityScore?: number } | undefined;
      if (m && md && typeof md.priorityScore === "number") {
        const reduced = Math.max(5, md.priorityScore - Math.round((coverage[id] ?? 0) * 25));
        next[id] = { ...m, data: { ...md, priorityScore: reduced } as never };
      }
    }

    // Module 10: the value to argue for follows the evidence-adjusted indication.
    const ex = rawModuleData.executive;
    const exd = ex?.data as ModuleResultMap["executive"] | undefined;
    if (ex && exd && evidenceAdj.indicatedValue != null) {
      next.executive = {
        ...ex,
        data: {
          ...exd,
          recommendedProtestValue: evidenceAdj.indicatedValue,
          recommendedProtestValueBasis:
            "Weighted from the county estimate and the evidence you uploaded, by how important each file is.",
        },
      };
    }
    return next;
  }, [rawModuleData, evidenceAdj]);
  const evidenceImpact = useMemo(
    () => ({
      adjustment: evidenceAdj,
      beforeAmount: rawSavingsEstimate?.amount ?? 0,
      afterAmount: savingsEstimate?.amount ?? 0,
      reading: !valueSignalsSettled,
      evidenceCount: evidenceDocs.length,
    }),
    [evidenceAdj, rawSavingsEstimate, savingsEstimate, valueSignalsSettled, evidenceDocs.length],
  );

  // Keep the saved estimate on the property (shown on the Properties page and dashboard) in step
  // with the evidence-adjusted figure, so the amount the owner sees saved everywhere moves when
  // they upload or remove evidence.
  const healthResult = moduleData.health?.data as HealthScoreResult | undefined;
  const lastSyncedScore = useRef<number | null>(null);
  useEffect(() => {
    if (!resolvedProperty || !valueSignalsSettled || !healthResult) return;
    if (lastSyncedScore.current === healthResult.score) return;
    lastSyncedScore.current = healthResult.score;
    syncHealthScore(resolvedProperty.id, {
      score: healthResult.score,
      summary: healthResult.executiveConclusion,
      factors: healthResult.factorsIncreasing,
    }).catch((err) => console.error("Could not save the updated score:", err));
  }, [resolvedProperty, valueSignalsSettled, healthResult]);

  const estimated = useMemo(() => {
    // `hasEstimate: false` means "no assessed value to estimate from at all"
    // (estimateSavings() returns null for that case on purpose — see its own
    // comment), which is NOT the same finding as "a real estimate that came
    // out at ~$0." Callers that render a "fairly assessed / no opportunity"
    // conclusion must check this first, or they state as fact something the
    // data can't support.
    if (!savingsEstimate || !state.totalValue)
      return {
        hasEstimate: false,
        reduction: 0,
        savings: 0,
        rationale: null as string | null,
        effectiveTaxRatePct: 0,
      };
    if (savingsEstimate.basis === "comps") {
      return {
        hasEstimate: true,
        reduction: Math.max(0, state.totalValue - savingsEstimate.compsMedian),
        savings: savingsEstimate.amount,
        rationale: `Estimated from ${savingsEstimate.compsCount} real comparable properties, at your county's ~${savingsEstimate.effectiveTaxRatePct}% effective tax rate.`,
        effectiveTaxRatePct: savingsEstimate.effectiveTaxRatePct,
      };
    }
    return {
      hasEstimate: true,
      reduction: Math.round(state.totalValue * (savingsEstimate.reductionPct / 100)),
      savings: savingsEstimate.amount,
      rationale: savingsEstimate.rationale,
      effectiveTaxRatePct: savingsEstimate.effectiveTaxRatePct,
    };
  }, [savingsEstimate, state.totalValue]);
  // Drives the analysis banner's hero savings figure sizing below — the
  // formatted string's own length, not viewport width, since a large enough
  // property can produce a 6+ digit savings figure on any screen size.
  const savingsDigits = useMemo(() => currency(estimated.savings).length, [estimated.savings]);

  // ── Module 9 (Estimated Savings) — the fuller deterministic financial
  // analysis (src/lib/savings-analysis.ts). Additive to `estimated` above,
  // which is shared with the intake savings screen and stays untouched. No
  // AI call anywhere in this module.
  const [savingsTaxInputs, setSavingsTaxInputs] = useState<SavingsTaxInputs | null>(null);
  useEffect(() => {
    if (!resolvedProperty) {
      setSavingsTaxInputs(null);
      return;
    }
    getSavingsTaxInputs(resolvedProperty.id)
      .then((r) =>
        setSavingsTaxInputs(
          r
            ? {
                taxableValue: r.taxableValue,
                exemptionsTotal: r.exemptionsTotal,
                protestCostOverride: r.protestCostOverride,
                projectionYears: r.projectionYears,
              }
            : null,
        ),
      )
      .catch((err) => console.error("Could not load savings tax inputs:", err));
  }, [resolvedProperty]);

  // Module 7 (Income Approach) and Module 5 (Improvement Condition) each
  // sometimes compute their own real indicated value for this property —
  // see computeSavingsAnalysis's own doc comment for why these only ever
  // pull the estimate's indicated value DOWN, never up. Both are gated on
  // the module's own "this is real, not a guess" signal: Income on
  // dataComplete (the owner-confirmed P&L figures), Improvement on
  // effectiveAgeYears being non-null (server-enforced null with zero real
  // photo evidence — see ai-report-modules.ts).
  const moduleImprovementData = moduleData.improvement?.data as
    ModuleResultMap["improvement"] | undefined;
  const moduleIndications = useMemo<ModuleIndication[]>(() => {
    const out: ModuleIndication[] = [];
    if (incomeComputed.dataComplete && incomeComputed.indicatedValue != null) {
      out.push({ source: "income", value: incomeComputed.indicatedValue });
    }
    if (moduleImprovementData?.effectiveAgeYears != null && state.improvementValue != null) {
      const dep = computeDepreciation(
        moduleImprovementData.effectiveAgeYears,
        getTypicalEconomicLife(state.propertyType),
        moduleImprovementData.functionalObsolescencePct,
        moduleImprovementData.externalObsolescencePct,
        state.improvementValue,
      );
      if (dep.conditionAdjustedValue != null && state.totalValue != null) {
        const adjustedTotal =
          state.totalValue - state.improvementValue + dep.conditionAdjustedValue;
        out.push({ source: "improvement", value: Math.round(adjustedTotal) });
      }
    }
    return out;
  }, [
    incomeComputed.dataComplete,
    incomeComputed.indicatedValue,
    moduleImprovementData,
    state.improvementValue,
    state.totalValue,
    state.propertyType,
  ]);

  // Module 9's protest cost comes from this property's real subscription —
  // Stripe's own figure when it has one (see protest-cost.ts).
  const [propertySubscription, setPropertySubscription] = useState<MySubscription | null>(null);
  const subscriptionId = resolvedProperty?.stripeSubscriptionId ?? null;
  const subscriptionPropertyId = resolvedProperty?.id ?? null;
  useEffect(() => {
    setPropertySubscription(null);
    if (!user || !subscriptionId) return;
    listMySubscriptions()
      .then((subs) =>
        setPropertySubscription(
          subs.find((s) => s.id === subscriptionId || s.propertyId === subscriptionPropertyId) ??
            null,
        ),
      )
      .catch(() => {});
  }, [user, subscriptionId, subscriptionPropertyId]);
  const protestCost = useMemo(
    () =>
      getProtestCost({
        accountPlan: myPlan,
        planTier: resolvedProperty?.planTier ?? null,
        subscriptionStatus: resolvedProperty?.subscriptionStatus ?? null,
        valueBracket: resolvedProperty?.valueBracket ?? null,
        subscription: propertySubscription,
        otherExpenses: savingsTaxInputs?.protestCostOverride ?? null,
      }),
    [myPlan, resolvedProperty, propertySubscription, savingsTaxInputs],
  );
  // The county's capped appraised value for the year on file, when the
  // value history carries one below the market value.
  const appraisedValue = useMemo(() => {
    const year = state.valueYear ?? state.taxYear;
    const row = state.valueHistory?.find((h) => h.year === year);
    if (!row?.appraisedValue || !row.marketValue || !state.totalValue) return null;
    // Only when the history's market value is the value on file.
    if (Math.abs(row.marketValue - state.totalValue) > state.totalValue * 0.01) return null;
    return row.appraisedValue < row.marketValue ? row.appraisedValue : null;
  }, [state.valueHistory, state.valueYear, state.taxYear, state.totalValue]);

  const savingsAnalysis = useMemo<SavingsAnalysis>(() => {
    const cs = computeComparableStats(
      compsMap.data?.subject ?? null,
      compsMap.data?.comps ?? [],
      state.totalValue,
    );
    return computeSavingsAnalysis({
      appraisedValue,
      planCost: protestCost,
      cadValue: state.totalValue ?? null,
      taxYear: state.taxYear ?? null,
      cad: state.cad ?? null,
      estimate: savingsEstimate,
      compsIndicated: cs.indicated
        ? { min: cs.indicated.min, median: cs.indicated.median, max: cs.indicated.max }
        : null,
      taxInputs: savingsTaxInputs ?? EMPTY_TAX_INPUTS,
      moduleIndications,
    });
  }, [
    savingsEstimate,
    savingsTaxInputs,
    compsMap.data,
    state.totalValue,
    state.taxYear,
    state.cad,
    moduleIndications,
    appraisedValue,
    protestCost,
  ]);

  // Persists savingsAnalysis's own annualSavings (not the raw savingsEstimate
  // amount) — the same module-aware number Module 9 shows, including any
  // Income/Improvement adjustment (see moduleIndications above). Before this,
  // this synced the pre-module baseline only, so uploading evidence or
  // saving income figures could visibly move Module 9's own number while the
  // dashboard/Properties-page total (read from this saved column) silently
  // stayed put — the actual bug behind "I added values but I don't see any
  // change in the protest amount I am saving."
  const lastSavedSavings = useRef<number | null>(null);
  useEffect(() => {
    if (
      !resolvedProperty ||
      !valueSignalsSettled ||
      !savingsEstimate ||
      !savingsAnalysis.sufficient
    )
      return;
    const amount = savingsAnalysis.annualSavings;
    if (lastSavedSavings.current === amount) return;
    lastSavedSavings.current = amount;
    if (resolvedProperty.estimatedSavings === amount) return;
    updatePropertySavings(resolvedProperty.id, {
      estimatedSavings: amount,
      savingsBasis: savingsEstimate.basis,
    }).catch((err) => console.error("Could not save the updated savings estimate:", err));
  }, [resolvedProperty, valueSignalsSettled, savingsEstimate, savingsAnalysis]);

  async function saveSavingsTaxInputs(input: SavingsTaxInputsInput) {
    if (!user || !resolvedProperty) return;
    setSavingsTaxInputs({
      taxableValue: input.taxableValue ?? null,
      exemptionsTotal: input.exemptionsTotal ?? null,
      protestCostOverride: input.protestCostOverride ?? null,
      projectionYears: input.projectionYears ?? null,
    });
    try {
      await upsertSavingsTaxInputs(user.id, resolvedProperty.id, input);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save — please try again."));
      getSavingsTaxInputs(resolvedProperty.id)
        .then((r) =>
          setSavingsTaxInputs(
            r
              ? {
                  taxableValue: r.taxableValue,
                  exemptionsTotal: r.exemptionsTotal,
                  protestCostOverride: r.protestCostOverride,
                  projectionYears: r.projectionYears,
                }
              : null,
          ),
        )
        .catch(() => {});
    }
  }

  // Re-run Module 10 when the savings analysis changes (tax inputs edited,
  // comps loaded, estimate resolved) — on the render after the memo settles,
  // ref-guarded, never a cold fetch. Same pattern as the income digest.
  const savingsDigest = savingsAnalysis.sufficient
    ? [
        savingsAnalysis.annualSavings,
        savingsAnalysis.netBenefit,
        savingsAnalysis.protestCost,
        savingsAnalysis.reductionBase,
        savingsAnalysis.financialConfidence,
        savingsAnalysis.indicatedRange?.low ?? "",
        savingsAnalysis.indicatedRange?.high ?? "",
      ].join("|")
    : "";
  const savingsDigestRef = useRef<string>("");
  useEffect(() => {
    if (!savingsDigest) return;
    if (savingsDigestRef.current === "") {
      savingsDigestRef.current = savingsDigest;
      return;
    }
    if (savingsDigestRef.current === savingsDigest) return;
    savingsDigestRef.current = savingsDigest;
    if (moduleData.executive?.data || moduleData.executive?.error) {
      loadModule("executive", { force: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savingsDigest]);

  // Eager-loads real data for the module overview grid below (real scores,
  // checklists, etc. instead of generic teaser text) as soon as the property
  // is known. Free-preview modules (1-3) load for everyone; the rest only
  // once hasFullAccess resolves true, so a signed-out visitor or an
  // unsubscribed user never burns an AI call analyzing a module they can't
  // see yet — they still get the same "Subscribe to unlock" card either way.
  // "savings" needs no call (estimateSavings() above already runs
  // unconditionally) and "income" needs user-uploaded data that doesn't
  // exist yet, so both are skipped here exactly like loadModule() itself
  // already skips "savings".
  // comps/site/improvement/zoning investigate the exact 5 strategies Module 2
  // ranks, so they're sequenced to fire after it (see the effect below) rather
  // than in this immediate batch — that lets each carry Module 2's per-
  // strategy score as priorityContext. First visit: the immediate batch fires
  // health + strategy + evidence; this wave adds comps/site/improvement/zoning
  // once strategy settles; executive follows once evidence settles too. Every
  // result is cached (public.module_results), so a return visit shows all 10
  // with zero AI calls. (An earlier pass deferred site/improvement/zoning/
  // executive to first card-open, but an un-opened card then sat on a
  // permanent "Analyzing" spinner — misleading — so they generate up front
  // again; the cost is one first-visit generation per property, not per view.)
  const SEQUENCED_AFTER_STRATEGY = new Set(["comps", "site", "improvement", "zoning"]);
  // How long the sequenced/executive effects wait for Strategy (or evidence)
  // to settle before firing anyway. It has to comfortably exceed one real
  // module call on the reasoning model (~25-30s observed for gemini-3.1-pro-
  // preview) — a shorter cap makes comps/executive fire WITHOUT the upstream
  // priorityContext on a cold first visit but WITH it on a cache-served
  // reload, so the two hash differently and the module regenerates every
  // reload. Better to wait: a genuinely stuck Strategy is rare, and the
  // module still generates, just a beat later.
  const STRATEGY_SETTLE_FALLBACK_MS = 40_000;
  // Module 10 (executive) reconciles Module 2's strategy AND Module 8's
  // evidence — firing it in this same immediate batch (as it did before this
  // sequencing was added) meant its own AI call went out before either had
  // resolved, reading moduleData.strategy/evidence as still undefined. See
  // the dedicated effect below.

  useEffect(() => {
    // evidenceDocsLoaded: health/strategy/evidence fold the evidence file
    // names into their cache hash — wait for that list so a reload's hash
    // matches the stored one instead of racing the fetch.
    // compsMap settled (attempted && !loading): health/strategy also fold
    // buildCompsSummary(compsMap.data) into the hash, so they must not fire
    // while that fetch is still in flight — otherwise a reload where the
    // fetch wins/loses the race by a different margin hashes differently and
    // regenerates for nothing. loadCompsMap() is kicked off by the effect
    // just below (also keyed on state.totalValue); this one is defined
    // first, so on the first pass compsMap.attempted is false and we wait
    // one render for it to settle.
    // auxDataLoaded: same reasoning for overrides / comp selections / income
    // figures — strategy's notApplicableContext (and site/improvement's
    // notApplicable* lists) is built from them, so a reload must not hash
    // the batch before all three have come back.
    if (
      !state.totalValue ||
      !evidenceDocsLoaded ||
      !auxDataLoaded ||
      !compsMap.attempted ||
      compsMap.loading ||
      !valueSignalsSettled ||
      (!!user && !!resolvedProperty && !baseDataChecked)
    )
      return;
    for (const m of MODULES) {
      // savings is deterministic (no AI); income waits for user figures;
      // executive waits for strategy + evidence (its own effect below);
      // the SEQUENCED set waits for strategy (the effect below this one).
      if (
        m.id === "savings" ||
        m.id === "income" ||
        m.id === "executive" ||
        SEQUENCED_AFTER_STRATEGY.has(m.id)
      )
        continue;
      if (m.n <= FREE_MODULE_COUNT || hasFullAccess) loadModule(m.id);
    }
    // loadModule closes over moduleData for its own-fetch guard, which is
    // exactly why it's left out of this dependency list — including it would
    // re-fire this effect (and, via the loading-state update inside
    // loadModule, immediately re-fire itself again) on every single module's
    // own load, an infinite loop just like the hub doors' entrance-animation
    // bug earlier. Property identity and access level are the only real
    // triggers for "should we start loading modules."
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.totalValue,
    hasFullAccess,
    evidenceDocsLoaded,
    auxDataLoaded,
    compsMap.attempted,
    compsMap.loading,
    baseDataChecked,
    valueSignalsSettled,
  ]);

  // comps/site/improvement/zoning wait for Module 2 (Strategy) to resolve —
  // or a capped 6s timeout, so a slow/failed Strategy call never stalls the
  // rest of the page indefinitely — before firing, so loadModule() above can
  // attach Module 2's per-strategy score as priorityContext to each. Also
  // kicks off the comps map fetch immediately (unsequenced): it's not an AI
  // call, and Module 2 itself wants compsSummary as an input when available.
  useEffect(() => {
    if (!state.totalValue) return;
    loadCompsMap();
    if (siteCoords) loadSiteGis(siteCoords.lat, siteCoords.lng);
    const strategyState = moduleData.strategy;
    const fire = () => {
      // site/improvement fold the overrides-derived notApplicable* lists into
      // their cache hash — don't fire this wave until overrides (and the
      // rest of the aux data) have come back, or a reload hashes them empty
      // and regenerates. See the immediate-batch effect above.
      if (!auxDataLoaded) return;
      for (const id of SEQUENCED_AFTER_STRATEGY) {
        // "comps" specifically also wants compsMap.data already populated
        // (see loadModule()'s own comps branch, which sends real topComps
        // for the Recommended Protest Use field) — loadCompsMap() right
        // above is fire-and-forget, so without this check "comps" could
        // fire in the very same tick as loadCompsMap() itself, well before
        // that fetch resolves (confirmed live: compsMap.data was still null
        // at the exact moment this ran). `!compsMap.attempted` (not just
        // `.loading`, which is also false before the fetch starts) is the
        // real "not settled yet" test: on a reload strategy is served
        // instantly from cache, so without it this effect fires "comps"
        // before loadCompsMap() has even flipped `.loading` true, and the
        // AI call goes out with no comps to reason over. Both flags are in
        // the dependency array below so this re-runs once the fetch settles.
        if (id === "comps" && (!compsMap.attempted || compsMap.loading)) continue;
        // "site" needs real coordinates settled (either a CAD subject or the
        // geocode fallback — see siteCoordsSettled above) AND, only when
        // coordinates actually exist, siteGisMap itself settled too —
        // otherwise it could fire while the GIS fetch is merely not-yet-
        // started instead of genuinely unavailable, and Module 4 would show
        // "Additional Data Needed" for something that was actually about to
        // resolve. `!siteGisMap.attempted` (not `siteGisMap.loading`) is the
        // right check here — `loading` is also false before the fetch
        // starts, so it can't tell "not started" apart from "settled" on
        // its own.
        if (
          id === "site" &&
          (compsMap.loading ||
            !siteCoordsSettled ||
            (!!siteCoords && (!siteGisMap.attempted || siteGisMap.loading)))
        ) {
          continue;
        }
        if (id === "zoning" && !cityZoningSettled) continue;
        const m = MODULES.find((mm) => mm.id === id);
        if (m && (m.n <= FREE_MODULE_COUNT || hasFullAccess)) loadModule(m.id);
      }
    };
    if (strategyState?.data || strategyState?.error) {
      fire();
      return;
    }
    const t = setTimeout(fire, STRATEGY_SETTLE_FALLBACK_MS);
    return () => clearTimeout(t);
    // Same rationale as the effect above for omitting loadModule/loadCompsMap/
    // loadSiteGis; moduleData.strategy's data/error (plus compsMap.loading/
    // .data, geocodedSubject's own settle state, and siteGisMap's own settle
    // state, for the races described above) are read explicitly instead of
    // the whole moduleData/compsMap/siteGisMap objects so this only re-fires
    // on those specific state transitions, not every other module's load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.totalValue,
    hasFullAccess,
    auxDataLoaded,
    moduleData.strategy?.data,
    moduleData.strategy?.error,
    compsMap.attempted,
    compsMap.loading,
    compsMap.data,
    geocodedSubject.attempted,
    geocodedSubject.loading,
    geocodedSubject.data,
    siteGisMap.attempted,
    siteGisMap.loading,
    cityZoningSettled,
  ]);

  // Module 10 (executive) reconciles Module 2's strategy and Module 8's
  // evidence into one final recommendation — it needs to actually read their
  // real output, so it waits for both to settle (data or error) before firing
  // its own call, same STRATEGY_SETTLE_FALLBACK_MS-capped pattern as the
  // comps/strategy effect above (a slow/failed dependency shouldn't stall
  // Module 10 indefinitely). Generated on first visit like the rest and then
  // cached; opening its card just serves the stored result.
  useEffect(() => {
    if (!state.totalValue || !hasFullAccess) return;
    const strategyState = moduleData.strategy;
    const evidenceState = moduleData.evidence;
    const strategyDone = !!(strategyState?.data || strategyState?.error);
    const evidenceDone = !!(evidenceState?.data || evidenceState?.error);
    if (strategyDone && evidenceDone) {
      loadModule("executive");
      return;
    }
    const t = setTimeout(() => loadModule("executive"), STRATEGY_SETTLE_FALLBACK_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.totalValue,
    hasFullAccess,
    moduleData.strategy?.data,
    moduleData.strategy?.error,
    moduleData.evidence?.data,
    moduleData.evidence?.error,
  ]);

  function openModule(m: Module) {
    if (hasFullAccess || m.n <= FREE_MODULE_COUNT) {
      setOpenId(m.id);
      if (m.id === "executive") {
        // executive generates from its own effect once strategy + evidence
        // settle (never with partial context that would then be cached). If
        // both are already done and it somehow hasn't run, kick it here.
        const sDone = !!(moduleData.strategy?.data || moduleData.strategy?.error);
        const eDone = !!(moduleData.evidence?.data || moduleData.evidence?.error);
        if (sDone && eDone) loadModule("executive");
      } else if (!m.requiresUserData) {
        loadModule(m.id);
      }
      // Modules 7 and 9 show the comparable-sales range alongside their own
      // numbers — load the same comps map Module 3 uses.
      if (m.id === "comps" || m.id === "income" || m.id === "savings") loadCompsMap();
      return;
    }
    setShowWall(true);
  }

  const openModel = MODULES.find((m) => m.id === openId) ?? null;
  // Not for a property the county itself codes as residential.
  const showCommercialValuation = classifyPropertyCategory(state.propertyType) !== "residential";
  const activeModulesTab = showCommercialValuation ? modulesTab : "modules";

  return (
    <EvidenceImpactContext.Provider value={evidenceImpact}>
      <div className="container-page py-10">
        <div role="tablist" className="mb-4 flex gap-1 border-b border-border print:hidden">
          {(
            [
              ["property", "Property Summary"],
              ["case", "Protest Case"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={topTab === id}
              onClick={() => setTopTab(id)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
                topTab === id
                  ? "border-accent text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Summary */}
        <section
          className={`grid gap-6 lg:grid-cols-[1.4fr_1fr] ${topTab === "property" ? "" : "hidden print:grid"}`}
        >
          <div className="card-elev p-6">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Source: Official CAD Record</span>
            </div>
            <h1 className="mt-3 font-serif text-3xl font-semibold">{state.address}</h1>
            <p className="text-muted-foreground text-sm">{state.cad}</p>
            <dl className="mt-5 grid gap-3 sm:grid-cols-3 text-sm">
              <Field label="Owner" value={state.ownerName} />
              <Field label="Account #" value={state.accountNumber} />
              <Field label="Type" value={state.propertyType} />
              <Field label="Land" value={currency(state.landValue)} />
              <Field label="Improvement" value={currency(state.improvementValue)} />
              <Field
                label={state.valueYear ? `Total (${state.valueYear})` : "Total"}
                value={state.totalValue ? currency(state.totalValue) : "Upcoming"}
                bold
              />
            </dl>
            {state.upcomingValueYear && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                * {state.upcomingValueYear} value: upcoming
              </p>
            )}
            <ValueHistorySection history={state.valueHistory ?? []} />
            {user && (
              <button
                type="button"
                onClick={handleGeneratePropertySummary}
                disabled={generatingPropertySummary}
                className="btn-outline mt-4 text-sm disabled:opacity-60"
              >
                {generatingPropertySummary ? "Generating…" : "Generate Property Summary"}
              </button>
            )}
          </div>
          <div className="card-elev overflow-hidden">
            {/* Keyed on the address: a new address mounts a fresh iframe
                instead of changing src, which the browser would record as a
                history entry — Back would then rewind the map, not the page. */}
            <iframe
              key={state.address ?? "Texas"}
              title="Property Map"
              className="w-full h-64 lg:h-full min-h-[240px]"
              src={`https://www.google.com/maps?q=${encodeURIComponent(state.address ?? "Texas")}&output=embed`}
              loading="lazy"
            />
          </div>
        </section>

        {/* Analysis banner — the savings figure is the whole point of this page for
          most visitors, so it gets a hero-scale treatment (was the same text-lg
          size as the "AI analysis completed" label above it, easy to skim past)
          rather than reading as one more line of body copy. Previously had
          continuous confetti bursts here; removed per explicit feedback that
          it read as cartoonish for what's otherwise a professional tax-filing
          tool — the gradient/glow/sheen surface below carries the "this is a
          good moment" read on its own, without particle animation. */}
        <section
          className={`relative card-elev overflow-hidden text-primary-foreground print:mt-6 ${topTab === "case" ? "" : "hidden print:block"}`}
        >
          {/* Richer than a flat bg-primary fill — a diagonal gradient with a
            faint accent-green undertone, so the banner reads as an
            intentionally celebratory surface even before any motion kicks in. */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(135deg, var(--primary) 0%, color-mix(in oklch, var(--primary) 82%, var(--accent) 18%) 50%, var(--primary) 100%)",
            }}
          />
          {/* Two ambient glow blobs — a flat solid-navy card read as plain/
            static for what's meant to be the page's one exciting moment.
            Emerald top-left near the number, warm gold bottom-right (offset
            pulse timing via the CSS itself), both z-0'd behind the real
            content below. */}
          {!analyzing && (
            <>
              <div
                className="savings-glow pointer-events-none absolute -left-24 -top-24 z-0 h-96 w-96 rounded-full"
                style={{
                  background:
                    "radial-gradient(circle, color-mix(in oklch, var(--accent) 55%, transparent) 0%, transparent 70%)",
                }}
              />
              <div
                className="savings-glow-warm pointer-events-none absolute -bottom-24 -right-24 z-0 h-96 w-96 rounded-full"
                style={{
                  background:
                    "radial-gradient(circle, color-mix(in oklch, var(--warning) 50%, transparent) 0%, transparent 70%)",
                }}
              />
              {/* Slow diagonal light sweep across the whole banner surface —
                see the savings-sheen-sweep keyframe in styles.css. */}
              <div className="savings-sheen pointer-events-none absolute -inset-y-12 left-0 z-0 w-1/3 bg-white/10" />
            </>
          )}
          <div className="relative z-10 flex flex-wrap items-start justify-between gap-6 p-5 sm:p-8">
            <div className="min-w-0">
              <p className="text-sm text-primary-foreground/80">
                {analyzing ? "AI is analyzing your property..." : "AI analysis completed."}
              </p>
              {analyzing ? (
                <p className="mt-1 font-serif text-lg sm:text-xl">
                  Preparing your property valuation review...
                </p>
              ) : estimated.savings >= 1 ? (
                <>
                  <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-primary-foreground/70">
                    {(existingProtest && resolvedProperty && existingProtest.status === "resolved"
                      ? buildCaseOutcome(resolvedProperty, existingProtest)
                      : null
                    )?.taxSavings != null
                      ? "Actual tax savings from your protest"
                      : "Estimated tax savings this year"}
                  </p>
                  {/* Sized off the actual formatted string's length, not just the
                    viewport — a fixed text-6xl/7xl/8xl scale (confirmed live)
                    clips off-card on a narrow phone once a large property's
                    savings run to 6+ digits ("$135,675" and up), since a wider
                    viewport can't be assumed to always mean a shorter number.
                    Common case (the vast majority of real properties) still
                    gets the full hero size below. */}
                  <p
                    className={`mt-1 flex w-fit items-center gap-2 font-serif font-bold leading-none text-accent ${
                      savingsDigits <= 7
                        ? "text-6xl sm:text-7xl lg:text-8xl"
                        : savingsDigits <= 9
                          ? "text-5xl sm:text-6xl lg:text-7xl"
                          : "text-4xl sm:text-5xl lg:text-6xl"
                    }`}
                  >
                    <TrendingUp className="h-8 w-8 shrink-0 sm:h-10 sm:w-10 lg:h-14 lg:w-14" />
                    <AnimatedNumber
                      value={
                        (existingProtest &&
                        resolvedProperty &&
                        existingProtest.status === "resolved"
                          ? buildCaseOutcome(resolvedProperty, existingProtest)
                          : null
                        )?.taxSavings ?? estimated.savings
                      }
                      format={currency}
                      duration={900}
                    />
                  </p>
                  {(existingProtest && resolvedProperty && existingProtest.status === "resolved"
                    ? buildCaseOutcome(resolvedProperty, existingProtest)
                    : null
                  )?.taxSavings == null && (
                    <p className="mt-2 max-w-md text-xs text-primary-foreground/70">
                      This estimate may change depending on the evidence provided and other relevant
                      factors.
                    </p>
                  )}
                </>
              ) : !estimated.hasEstimate ? (
                // No estimate at all — the CAD record carried no assessed value
                // (a brand-new/unassessed parcel, or a county feed that hasn't
                // synced this year's values yet). estimateSavings() returns null
                // for exactly this case rather than computing 0 * anything = 0,
                // and intake.tsx skips its whole Savings step when it does. This
                // banner used to fall straight through to the "fairly assessed"
                // branch below and tell the owner, confidently and wrongly, that
                // there was no savings opportunity — when the truth is we have
                // no value to judge from. Say that instead.
                <>
                  <p className="mt-2 font-serif text-2xl font-bold sm:text-3xl">
                    We need this year's value.
                  </p>
                  <p className="mt-2 max-w-md text-sm text-primary-foreground/80">
                    The county record for this property doesn't carry an assessed value yet, so we
                    can't estimate a savings opportunity. Upload your appraisal notice, or check
                    back once the county publishes this year's value.
                  </p>
                </>
              ) : (
                // Same reasoning as intake.tsx's Savings step — a real analysis
                // that lands on (near-)$0 isn't a failure, it means this
                // property's own assessed value already looks in line with real
                // comps/protest-outcome data. >= 1, not > 0: currency() rounds
                // to whole dollars, so a positive-but-sub-$1 amount would
                // otherwise still render as a bare, confusing "$0" hero.
                <>
                  <p className="mt-2 font-serif text-2xl font-bold text-accent sm:text-3xl">
                    Good news!
                  </p>
                  <p className="mt-2 max-w-md text-sm text-primary-foreground/80">
                    Your property appears to be fairly assessed. We found little or no opportunity
                    for additional tax savings this year.
                  </p>
                </>
              )}
            </div>
            <div className="print:hidden shrink-0 text-right text-sm">
              {hasFullAccess ? (
                <div className="text-primary-foreground/70 text-xs">
                  AI Report subscription active
                </div>
              ) : (
                <>
                  <div>
                    {FREE_MODULE_COUNT} of {MODULES.length} modules free
                  </div>
                  <div className="text-primary-foreground/70 text-xs">
                    Subscribe to unlock the rest
                  </div>
                </>
              )}
            </div>
          </div>
          {user && (
            <div className="relative z-10 border-t border-primary-foreground/20 px-5 pb-5 pt-3 print:hidden sm:px-8 sm:pb-8">
              {existingProtest ? (
                // Case Progress / Next Action — the stages shown, their labels,
                // and which one is "current" all come from case-next-action.ts,
                // the same rules View Case's own Prepare & File tab and Corvus
                // AI Guidance panel are built on, so this can never say
                // something View Case itself would disagree with. View Case is
                // the one action here — the next step itself is taken there.
                <div className="grid gap-3">
                  {nextAction ? (
                    <>
                      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5 text-xs">
                        {nextAction.timeline.map((stage, i) => (
                          <li key={stage.id} className="flex items-center gap-1.5">
                            {i > 0 && (
                              <span aria-hidden className="text-primary-foreground/30">
                                →
                              </span>
                            )}
                            <span
                              className={`whitespace-nowrap rounded-full px-2.5 py-1 font-medium ${
                                stage.status === "current"
                                  ? "bg-accent text-accent-foreground"
                                  : stage.status === "done"
                                    ? "bg-white/10 text-primary-foreground/70"
                                    : "text-primary-foreground/40"
                              }`}
                            >
                              {stage.status === "done" ? "✓ " : ""}
                              {stage.label}
                            </span>
                          </li>
                        ))}
                      </ol>
                      <p className="max-w-xl text-sm text-primary-foreground/80">
                        {nextAction.summary}
                      </p>
                    </>
                  ) : (
                    <div className="h-4 w-56 animate-pulse rounded bg-white/10" aria-hidden />
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    {resolvedProperty && (
                      <Link
                        to="/dashboard/case"
                        search={{ propertyId: resolvedProperty.id }}
                        className="btn-accent text-sm py-1.5 font-semibold"
                      >
                        View Protest Case
                      </Link>
                    )}
                  </div>
                </div>
              ) : hasFullAccess ? (
                <button onClick={startProtest} className="btn-accent text-sm py-1.5">
                  {myPlan === "owner_managed" ? "File Protest" : "Request Protest Filing"}
                </button>
              ) : // Real payment gate (see startProtest's own check) reflected
              // honestly here — real, one-click checkout for THIS property
              // right in the banner, not a dead-end link to go find it again
              // on the Properties list. The bracket is already known from
              // the property's own value; only the tier is a real choice,
              // so both real prices are shown. $5M+ is custom-priced and
              // never reaches checkout.
              isCustomPricedValue(resolvedProperty?.totalValue ?? state.totalValue) ? (
                <Link to="/contact" className="btn-accent text-sm py-1.5">
                  Custom pricing for $5M+ — Contact Us
                </Link>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {(["owner_managed", "corvusrf_managed"] as const).map((tier) => {
                    const bracket = bracketForValue(
                      resolvedProperty?.totalValue ?? state.totalValue,
                    );
                    return (
                      <button
                        key={tier}
                        disabled={!!subscribingTier}
                        onClick={() => handleSubscribeToProperty(tier)}
                        className="btn-accent text-sm py-1.5 disabled:opacity-60"
                      >
                        {subscribingTier === tier
                          ? "Redirecting…"
                          : `Subscribe — ${TIER_LABEL[tier]}, ${formatMoney(TIER_BRACKET_PRICES[tier][bracket])}/month`}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>

        {/* The selected property's own journey — follows the property picked at the top. */}
        {resolvedProperty && (
          <div className="mt-8 print:hidden">
            <JourneyTracker propertyId={resolvedProperty.id} />
          </div>
        )}

        {/* Modules */}
        <section className="mt-8 print:hidden">
          <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border">
            <div role="tablist" className="flex gap-1">
              {(
                [
                  ["modules", "10 Premium AI Modules"],
                  ...(showCommercialValuation
                    ? ([["valuation", "Commercial Valuation"]] as const)
                    : []),
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={activeModulesTab === id}
                  onClick={() => setModulesTab(id)}
                  className={`-mb-px border-b-2 px-3 py-2 font-serif text-lg font-semibold transition-colors sm:text-xl ${
                    activeModulesTab === id
                      ? "border-accent text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button onClick={() => window.print()} className="btn-outline mb-2 text-sm py-2">
              Export Report
            </button>
          </div>
          <p className="mt-2 text-muted-foreground text-sm">
            {hasFullAccess
              ? "All modules unlocked with your AI Report subscription."
              : `Modules 1-${FREE_MODULE_COUNT} are free for everyone. Subscribe to unlock modules ${FREE_MODULE_COUNT + 1}-${MODULES.length}.`}
          </p>

          {hasFullAccess && resolvedProperty && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-secondary/30 p-3 text-xs">
              <div className="min-w-0">
                <span className="font-semibold text-foreground">Property Base Data</span>
                {baseData ? (
                  <span className="text-muted-foreground">
                    {" — "}AI-fetched from{" "}
                    {baseData.snapshot.sources.length > 0
                      ? baseData.snapshot.sources.join(", ")
                      : "the address (no live county source)"}{" "}
                    · {new Date(baseData.fetchedAt).toLocaleDateString()}
                    {baseData.lastChangeNote ? ` · last change: ${baseData.lastChangeNote}` : ""}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {" — "}
                    {baseDataBusy ? "fetching from county + federal sources…" : "not fetched yet"}
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {baseData?.documentId && (
                  <Link
                    to="/dashboard/documents"
                    search={{ propertyId: resolvedProperty?.id }}
                    className="text-accent hover:underline"
                  >
                    View in Documents
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => void refreshBaseData()}
                  disabled={baseDataBusy}
                  className="btn-outline text-xs py-1 disabled:opacity-60"
                >
                  {baseDataBusy ? "Refreshing…" : "Refresh"}
                </button>
              </div>
            </div>
          )}

          {/* The six commercial valuation approaches side by side — Income,
              Sales Comparison, Equal & Uniform, Cost, Land / Improvement,
              Impairments (lib/commercial-valuation.ts). Not for a property the
              county itself codes as residential. */}
          {showCommercialValuation && activeModulesTab === "valuation" && (
            <CommercialValuationPanel
              userId={user?.id ?? null}
              propertyId={resolvedProperty?.id ?? null}
              cadValue={state.totalValue ?? null}
              landValue={state.landValue ?? null}
              improvementValue={state.improvementValue ?? null}
              acres={
                compsMap.data?.subject?.legalAcreage ?? baseData?.snapshot.cad?.lotSizeAcres ?? null
              }
              buildingSqft={baseData?.snapshot.cad?.buildingSqft ?? state.buildingSqft ?? null}
              yearBuilt={baseData?.snapshot.cad?.yearBuilt ?? state.yearBuilt ?? null}
              income={incomeComputed}
              compStats={
                compsMap.data
                  ? computeComparableStats(
                      compsMap.data.subject,
                      compsMap.data.comps,
                      state.totalValue,
                      {
                        excludedKeys: excludedCompKeys(compSelections),
                        pinnedKeys: pinnedCompKeys(compSelections),
                        subjectAddress: state.address,
                        extraComps: compSelectionsToExtraComps(compSelections),
                        subjectBuildingSqft: baseData?.snapshot.cad?.buildingSqft ?? null,
                      },
                    )
                  : null
              }
              knownConditions={
                baseData?.snapshot.siteGis?.floodZone?.inSFHA
                  ? [
                      `FEMA flood zone ${baseData.snapshot.siteGis.floodZone.zone} (special flood hazard area)`,
                    ]
                  : []
              }
              onAddIncomeData={() => {
                const m = MODULES.find((x) => x.id === "income");
                if (m) openModule(m);
              }}
              onAddSales={() => {
                const m = MODULES.find((x) => x.id === "comps");
                if (m) openModule(m);
              }}
            />
          )}

          <CaseResultContext.Provider
            value={
              existingProtest && resolvedProperty && existingProtest.status === "resolved"
                ? buildCaseOutcome(resolvedProperty, existingProtest)
                : null
            }
          >
            <div
              className={`mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3 ${activeModulesTab === "modules" ? "" : "hidden"}`}
            >
              {MODULES.map((m) => (
                <ModuleCard
                  key={m.id}
                  m={m}
                  unlocked={hasFullAccess || m.n <= FREE_MODULE_COUNT}
                  hasFullAccess={hasFullAccess}
                  moduleState={moduleData[m.id]}
                  moduleData={moduleData}
                  compsMap={compsMap}
                  siteGisMap={siteGisMap}
                  siteCoords={siteCoords}
                  estimated={estimated}
                  propertyType={state.propertyType}
                  address={resolvedProperty?.address || state.address}
                  totalValue={state.totalValue}
                  improvementValue={state.improvementValue}
                  overrides={overrides}
                  incomeComputed={incomeComputed}
                  incomeAnalysis={incomeAnalysis}
                  savingsAnalysis={savingsAnalysis}
                  uploadingEvidence={uploadingEvidence}
                  onUploadEvidence={handleUploadEvidence}
                  onSaveIncomeAnalysis={saveIncomeAnalysis}
                  onOpen={() => openModule(m)}
                  onForceReload={() => loadModule(m.id, { recheck: true })}
                />
              ))}
            </div>
          </CaseResultContext.Provider>
        </section>

        {/* Print-only linear report — reuses the exact same module-rendering logic as
          the modal above (ModulePreviewBody), stacking every module the user has
          already unlocked and viewed into one printable document. Deliberately
          does NOT trigger new AI calls at export time (no re-fetch here) — export
          captures "your report so far," the same content already shown on screen,
          rather than firing up to 9 fresh AI calls the moment someone clicks print. */}
        <section className="hidden print:block mt-8">
          <h2 className="font-serif text-2xl font-semibold">AI Property Tax Report</h2>
          <p className="text-sm text-muted-foreground">
            {state.address} · {state.cad}
            {generatedOn && ` · Generated ${generatedOn}`}
          </p>
          {(() => {
            const printable = MODULES.filter(
              (m) => moduleData[m.id]?.data != null || (m.id === "comps" && compsMap.data),
            );
            if (printable.length === 0) {
              return (
                <p className="mt-4 text-sm text-muted-foreground">
                  Open a module above, then use Export Report again to include it here.
                </p>
              );
            }
            return printable.map((m) => (
              <div key={m.id} className="mt-6" style={{ breakInside: "avoid" }}>
                <h3 className="font-serif text-lg font-semibold">{m.shortName}</h3>
                <div className="text-xs font-medium text-muted-foreground">{m.title}</div>
                <p className="text-sm text-muted-foreground">{m.question}</p>
                <ModulePreviewBody
                  m={m}
                  estimated={estimated}
                  state={state}
                  moduleState={moduleData[m.id]}
                  moduleData={moduleData}
                  compsMap={compsMap}
                  siteGisMap={siteGisMap}
                  siteCoords={siteCoords}
                  siteCoordsSettled={siteCoordsSettled}
                  onRetry={() => {}}
                  allowEvidenceUpload={false}
                  evidenceDocs={evidenceDocs}
                  uploadingEvidence={false}
                  onUploadEvidence={() => {}}
                  onForceReload={() => {}}
                  onReloadModule={() => {}}
                  onFetchCadDetails={() => {}}
                  onRefreshSiteGis={() => {}}
                  siteGisRefreshing={false}
                  cadFetching={false}
                  onAutoSourceEvidence={() => {}}
                  autoSourcingEvidence={false}
                  onFetchPublicData={() => {}}
                  fetchingPublicData={false}
                  onAnswerStrategy={() => {}}
                  onAskQuestion={() => Promise.resolve("")}
                  onGenerateDataSheet={() => Promise.resolve(null)}
                  existingProtest={null}
                  resolvedProperty={null}
                  caseDocuments={[]}
                  noticeSignedAt={null}
                  onOpenModule={() => {}}
                  onStartProtest={() => {}}
                  onViewCase={() => {}}
                  overrides={overrides}
                  onMarkNotApplicable={() => {}}
                  onClearNotApplicable={() => {}}
                  compSelections={compSelections}
                  onSaveCompSelection={() => {}}
                  onRemoveCompSelection={() => {}}
                  onResetCompSelections={() => {}}
                  onExtractCompSale={async () => null}
                  incomeAnalysis={incomeAnalysis}
                  incomeComputed={incomeComputed}
                  onSaveIncomeAnalysis={() => {}}
                  onExtractIncome={extractIncome}
                  savingsAnalysis={savingsAnalysis}
                  protestCost={protestCost}
                  savingsTaxInputs={savingsTaxInputs}
                  onSaveSavingsTaxInputs={() => {}}
                />
              </div>
            ));
          })()}
        </section>

        {/* Preview modal */}
        {openModel && (
          <Modal onClose={() => setOpenId(null)} wide>
            <span className="badge-soft">{hasFullAccess ? "Unlocked" : "Free Preview"}</span>
            <div className="mt-2 flex items-center gap-2">
              <NumberBadge n={openModel.n} color={openModel.color} size="lg" />
              <h3 className="font-serif text-2xl font-semibold">{openModel.shortName}</h3>
            </div>
            <div className="text-sm font-medium text-muted-foreground">{openModel.title}</div>
            <p className="text-muted-foreground">{openModel.question}</p>
            {!!moduleData[openModel.id]?.data && (
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {moduleData[openModel.id]?.refreshing ? (
                    <span className="inline-flex items-center gap-1">
                      <RefreshCw className="h-3 w-3 animate-spin" /> Updating in the background…
                    </span>
                  ) : moduleData[openModel.id]?.cachedAt ? (
                    `Updated ${relativeTime(moduleData[openModel.id]!.cachedAt)}`
                  ) : (
                    "Updated just now"
                  )}
                </span>
                {openModel.id !== "savings" && (
                  <>
                    {/* Refresh re-checks the cache: identical inputs → the exact
                      same stored result, no AI call. Only a real input change
                      re-runs the analysis. */}
                    <button
                      type="button"
                      onClick={() => loadModule(openModel.id, { recheck: true })}
                      disabled={moduleData[openModel.id]?.loading}
                      className="inline-flex items-center gap-1 font-medium text-accent hover:underline disabled:opacity-50"
                    >
                      <RefreshCw
                        className={`h-3 w-3 ${moduleData[openModel.id]?.loading ? "animate-spin" : ""}`}
                      />
                      Refresh
                    </button>
                    <span aria-hidden>·</span>
                    {/* Force a fresh AI pass — for re-wording an answer that reads
                      oddly. The figures are computed from CAD data, so they
                      barely move. */}
                    <button
                      type="button"
                      onClick={() => loadModule(openModel.id, { force: true })}
                      disabled={moduleData[openModel.id]?.loading}
                      title="Ask the AI to re-write the wording. Figures are computed from CAD data and won't move."
                      className="hover:underline disabled:opacity-50"
                    >
                      Regenerate with AI
                    </button>
                  </>
                )}
              </div>
            )}
            <ModulePreviewBody
              m={openModel}
              estimated={estimated}
              state={state}
              moduleState={moduleData[openModel.id]}
              moduleData={moduleData}
              compsMap={compsMap}
              siteGisMap={siteGisMap}
              siteCoords={siteCoords}
              siteCoordsSettled={siteCoordsSettled}
              onRetry={() => loadModule(openModel.id)}
              allowEvidenceUpload
              evidenceDocs={evidenceDocs}
              uploadingEvidence={uploadingEvidence}
              onUploadEvidence={handleUploadEvidence}
              onForceReload={() => loadModule(openModel.id, { recheck: true })}
              onFetchCadDetails={handleFetchCadDetails}
              onRefreshSiteGis={handleRefreshSiteGis}
              siteGisRefreshing={siteGisRefreshing}
              cadFetching={cadFetching}
              onAutoSourceEvidence={handleAutoSourceEvidence}
              autoSourcingEvidence={autoSourcingEvidence}
              onFetchPublicData={handleFetchPublicData}
              fetchingPublicData={baseDataBusy}
              onAnswerStrategy={answerStrategy}
              onAskQuestion={askQuestion}
              onGenerateDataSheet={handleGenerateDataSheet}
              existingProtest={existingProtest}
              resolvedProperty={resolvedProperty}
              caseDocuments={caseDocuments}
              noticeSignedAt={null}
              onOpenModule={(id) => {
                const target = MODULES.find((mm) => mm.id === id);
                if (target) openModule(target);
              }}
              onStartProtest={startProtest}
              onReloadModule={(id) => loadModule(id, { force: true })}
              onViewCase={() => {
                if (!resolvedProperty) return;
                // Same-window navigation (per product direction) — opening it
                // in a new tab left two tabs that each reloaded on focus.
                nav({ to: "/dashboard/case", search: { propertyId: resolvedProperty.id } });
              }}
              overrides={overrides}
              onMarkNotApplicable={markNotApplicable}
              onClearNotApplicable={clearNotApplicable}
              compSelections={compSelections}
              onSaveCompSelection={saveCompSelection}
              onRemoveCompSelection={removeCompSelection}
              onResetCompSelections={resetCompSelections}
              onExtractCompSale={extractCompSaleFromFile}
              incomeAnalysis={incomeAnalysis}
              incomeComputed={incomeComputed}
              onSaveIncomeAnalysis={saveIncomeAnalysis}
              onExtractIncome={extractIncome}
              savingsAnalysis={savingsAnalysis}
              protestCost={protestCost}
              savingsTaxInputs={savingsTaxInputs}
              onSaveSavingsTaxInputs={saveSavingsTaxInputs}
            />
            <div className="mt-6 flex gap-2 justify-end">
              <button onClick={() => setOpenId(null)} className="btn-outline">
                Return to Property Summary
              </button>
              {!hasFullAccess && (
                <Link to="/pricing" className="btn-accent">
                  Subscribe & Unlock Full Report
                </Link>
              )}
            </div>
          </Modal>
        )}

        {checkoutPreview && (
          <Modal wide onClose={() => setCheckoutPreview(null)}>
            <h3 className="font-serif text-2xl font-semibold">Before you subscribe</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Here&apos;s what Corvus AI found for this property, and exactly what unlocks.
            </p>
            <div className="mt-4">
              <CasePreviewFor property={checkoutPreview.property} />
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <BillingIntervalToggle value={checkoutInterval} onChange={setCheckoutInterval} />
              <span className="text-sm">
                <span className="font-semibold">
                  {planPriceLines(checkoutPreview.tier, checkoutInterval).amount}
                </span>{" "}
                {planPriceLines(checkoutPreview.tier, checkoutInterval).unit} ·{" "}
                <span className="text-muted-foreground">
                  {planPriceLines(checkoutPreview.tier, checkoutInterval).detail}
                </span>
              </span>
            </div>
            <CommitmentNote className="mt-3" />
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button onClick={() => setCheckoutPreview(null)} className="btn-outline">
                Not now
              </button>
              <button
                disabled={!!subscribingTier}
                onClick={async () => {
                  await continueToCheckout(checkoutPreview.property, checkoutPreview.tier);
                  setCheckoutPreview(null);
                }}
                className="btn-accent disabled:opacity-60"
              >
                {subscribingTier
                  ? "Redirecting…"
                  : `Continue to checkout — ${TIER_LABEL[checkoutPreview.tier]}`}
              </button>
            </div>
          </Modal>
        )}

        {/* Subscription wall */}
        {showWall && (
          <Modal onClose={() => setShowWall(false)}>
            <h3 className="font-serif text-2xl font-semibold">
              Unlock Your Complete AI Property Analysis
            </h3>
            <p className="text-muted-foreground mt-2">
              Modules 1-{FREE_MODULE_COUNT} are free to preview. Subscribe to unlock modules{" "}
              {FREE_MODULE_COUNT + 1}-{MODULES.length} and the complete property analysis.
            </p>
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              <Link to="/pricing" className="btn-accent">
                Subscribe & Unlock Full Report
              </Link>
              <Link to="/pricing" className="btn-outline">
                Compare Plans
              </Link>
              <button onClick={() => setShowWall(false)} className="btn-outline sm:col-span-2">
                Return to Property Summary
              </button>
            </div>
          </Modal>
        )}

        {authorizing && user && resolvedProperty && (
          <ProtestAuthorizationFlow
            userId={user.id}
            property={resolvedProperty}
            userEmail={user.email}
            isPaid={hasFullAccess}
            open={authorizing}
            onOpenChange={(open) => setAuthorizing(open)}
            onDone={(created) => {
              setExistingProtest(created);
              generateCasePrep(created.id, user.id, resolvedProperty).catch((err) =>
                console.error("Case prep generation failed:", err),
              );
            }}
          />
        )}
      </div>
    </EvidenceImpactContext.Provider>
  );
}
