import { CasePhaseGuide } from "@/components/CasePhaseGuide";
import { NextRequiredAction, PipelineStepper } from "@/components/CasePipeline";
import { CadEvidenceRequest } from "@/components/CadEvidenceRequest";
import { MockHearing } from "@/components/MockHearing";
import { casePipeline, localTodayIso, type NoticeFiling, type StageId } from "@/lib/case-pipeline";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { JourneyTracker } from "@/components/JourneyTracker";
import { CaseOutcomeSection, StageDecisionBanner } from "@/components/CaseOutcomeSection";
import { SectionErrorBoundary } from "@/components/SectionErrorBoundary";
import { FormalHearingActions } from "@/components/FormalHearingActions";
import { ArbitrationWorkflow } from "@/components/ArbitrationWorkflow";
import { CourtAppealWorkflow } from "@/components/CourtAppealWorkflow";
import { RelevantTaxUpdates } from "@/components/RelevantTaxUpdates";
import { type PropertyRecord } from "@/lib/properties";
import { acknowledgeGuidance, type ProtestRecord } from "@/lib/protests";
import { compactCurrency } from "@/lib/intake-store";
import { getCase, generateCasePrep, recordEscalation, type ProtestCase } from "@/lib/protest-case";
import { getCaseGuidance } from "@/lib/case-guidance";
import { useDocumentsVersion } from "@/lib/use-documents-version";
import { getCountyProtestInfo } from "@/lib/county-protest-info";
import { verifyCaseReadiness, type CaseReadinessConcern } from "@/lib/case-readiness";
import { uploadDocument, getProtestEvidenceDocuments, type DocumentRecord } from "@/lib/documents";
import { useCountyProcedures } from "@/lib/county-procedures";
import {
  getLatestSettlementAgreement,
  type SettlementAgreementRecord,
} from "@/lib/settlement-agreement";
import { getErrorMessage } from "@/lib/error-message";
import { getSubmission } from "@/lib/protest-form-submissions";
import { FilingMethodsList } from "@/components/FilingMethodsList";
import { Modal } from "@/components/Modal";
import { FinalOutcomeSection } from "@/components/FinalOutcomeSection";
import { Skeleton } from "@/components/ui/skeleton";
import { Scale } from "lucide-react";
import { PageHero } from "@/components/PageHero";
import { buildCaseOutcome, caseStageLabel } from "@/lib/case-outcome";
import { PostHearingDecision } from "@/components/PostHearingDecision";
import { InformalOutcomeBanner } from "@/components/case/shared";
import {
  CaseAuditTrailSection,
  CaseProgress,
  CaseRecordSection,
  EvidenceStatusCard,
  FiledProtestStatusCard,
} from "@/components/case/record";
import { DocumentsSection } from "@/components/case/filing";
import { InformalReviewSection, SettlementSignatureSection } from "@/components/case/informal";
import {
  DecisionNoticeSection,
  HearingNoticeSection,
  HearingPrepSection,
} from "@/components/case/hearing";
import { EscalationEvaluationSection } from "@/components/case/escalation";

// The case road's steps (case-pipeline.ts) open these tabs; Appeal Decision opens
// Arbitration or Court Appeal, and Request CAD Evidence its section on Formal Hearing.
const STAGE_TAB: Record<Exclude<StageId, "appeal" | "cad_evidence">, CaseTabId> = {
  readiness: "overview",
  file: "file",
  confirm: "file",
  informal: "informal",
  arb: "hearing",
  decision: "decision",
  close: "outcome",
};
const TAB_STAGE: Record<CaseTabId, StageId> = {
  overview: "readiness",
  file: "file",
  informal: "informal",
  hearing: "arb",
  decision: "decision",
  arbitration: "appeal",
  court: "appeal",
  outcome: "close",
};

type CaseTabId =
  "overview" | "file" | "informal" | "hearing" | "decision" | "arbitration" | "court" | "outcome";

// joinsPrev: shares the previous tab's step number (Arbitration and Court Appeal are
// two buttons under one step).
const CASE_TABS: { id: CaseTabId; label: string; lockedHint: string; joinsPrev?: boolean }[] = [
  { id: "overview", label: "Overview", lockedHint: "" },
  {
    id: "file",
    label: "Prepare & File",
    lockedHint: "Read and accept the filing notice on Overview first.",
  },
  {
    id: "informal",
    label: "Informal Review",
    lockedHint: "Unlocks once you have signed your Notice of Protest.",
  },
  {
    id: "hearing",
    label: "Formal Hearing",
    lockedHint: "Unlocks once you have signed your Notice of Protest.",
  },
  {
    id: "decision",
    label: "Post-hearing Options",
    lockedHint: "Unlocks after your hearing or a decision is recorded.",
  },
  {
    id: "arbitration",
    label: "Arbitration",
    lockedHint: "Unlocks after your hearing or a decision is recorded.",
  },
  {
    id: "court",
    label: "Court Appeal",
    lockedHint: "Unlocks after your hearing or a decision is recorded.",
    joinsPrev: true,
  },
  {
    id: "outcome",
    label: "Final Outcome",
    lockedHint: "Unlocks once your case is resolved.",
  },
];

// Arbitration / Court Appeal are done once that path was actually carried out —
// the request or petition filed, or the case resolved through it.
function escalationDone(id: CaseTabId, p: ProtestRecord): boolean {
  if (id === "arbitration")
    return (
      !!p.arbitrationFiledAt || (p.status === "resolved" && p.escalationPath === "arbitration")
    );
  if (id === "court")
    return (
      !!p.courtAppeal?.petitionFiledAt || (p.status === "resolved" && p.escalationPath === "appeal")
    );
  return false;
}

// The number shown for a tab: its position, minus tabs that share a step number.
function stepNumber(index: number): number {
  return index - CASE_TABS.slice(0, index + 1).filter((t) => t.joinsPrev).length;
}

// The anchor ids the deterministic guidance (case-guidance.ts) links to, and
// which tab each one lives in now — so a "Go to Documents" link can switch
// tabs before scrolling.
const ANCHOR_TAB: Record<string, CaseTabId> = {
  "case-progress": "overview",
  "case-readiness": "overview",
  "case-record": "overview",
  "case-audit-trail": "overview",
  "case-documents": "file",
  "case-upload-evidence": "file",
  "case-informal-review": "informal",
  "case-settlement-signature": "informal",
  "case-informal-outcome": "informal",
  "case-hearing-notice": "hearing",
  "case-cad-evidence": "hearing",
  "case-hearing-prep": "hearing",
  "case-decision-notice": "decision",
  "case-escalation": "decision",
};

// noticeSigned: the Notice of Protest has been signed. That opens Informal
// Review and Formal Hearing without waiting for delivery or the county's
// acknowledgement (which can take days) — protest.status still only flips to
// "filed" once the county confirms.
function caseTabUnlocked(
  id: CaseTabId,
  protest: ProtestRecord,
  needsGuidanceAck: boolean,
  noticeSigned = false,
): boolean {
  const s = protest.status;
  const filed = s !== "requested";
  switch (id) {
    case "overview":
      return true;
    case "file":
      return filed || !needsGuidanceAck;
    case "informal":
    case "hearing":
      return filed || noticeSigned;
    case "outcome":
      return s === "resolved" || protest.informalStatus === "accepted";
    case "decision":
    case "arbitration":
    case "court":
      return (
        ["decision_received", "appealing", "arbitrating", "resolved"].includes(s) ||
        protest.hearingDate != null ||
        protest.arbDecision != null
      );
  }
}

// The tab the case should open on given where it is now — used for the
// initial render and to auto-advance when the status moves to a new phase.
function defaultCaseTab(protest: ProtestRecord, needsGuidanceAck: boolean): CaseTabId {
  switch (protest.status) {
    case "requested":
      return needsGuidanceAck ? "overview" : "file";
    case "filed":
    case "under_review":
    case "offer_received":
      return "informal";
    case "hearing_scheduled":
      return "hearing";
    case "decision_received":
      return "decision";
    case "appealing":
      return "court";
    case "arbitrating":
      return "arbitration";
    case "resolved":
      return "outcome";
    default:
      return "overview";
  }
}

// Renders as a full page (see routes/dashboard/_layout.case.tsx), not an
// overlay — previously this was a <Modal>; per product direction, View Case
// now navigates to its own URL instead of opening on top of whatever page
// triggered it. onBack is "return to wherever View Case was clicked from,"
// not "dismiss an overlay," even though the internal state/logic below is
// unchanged from the modal version.
export function CaseDetailView({
  userId,
  property: propertyProp,
  protest,
  onBack,
  initialAnchor,
  userEmail = null,
}: {
  userId: string;
  property: PropertyRecord;
  protest: ProtestRecord;
  onBack: () => void;
  // Opens straight at this section (a NEXT REQUIRED ACTION link).
  initialAnchor?: string;
  userEmail?: string | null;
}) {
  const [caseData, setCaseData] = useState<ProtestCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<ProtestRecord>(protest);
  // Local, editable copy — the Pre-Filing Check gate lets the customer
  // correct/confirm a missing identity field (see PreFilingGate) right
  // where Corvus flags it as blocking, without leaving this modal.
  const [property, setProperty] = useState<PropertyRecord>(propertyProp);
  // For a county without a hand-researched entry, loads what AI read off the
  // district's own site; this re-renders the case once it arrives, so every
  // getCountyProtestInfo() below picks it up.
  useCountyProcedures(property.cad);
  const [acknowledging, setAcknowledging] = useState(false);
  // The step-by-step filing workflow opens in its own focused popup.
  const [filingOpen, setFilingOpen] = useState(false);
  // Real signed_at off the Notice of Protest submission (see
  // protest-form-submissions.ts) — the one honest signal this app has for
  // "has the customer actually signed this," distinct from and never
  // conflated with "filed." Lifted here (not local to DocumentsSection) so
  // CorvusGuidancePanel/NextStepFooter can give correct guidance too.
  const [noticeSignedAt, setNoticeSignedAt] = useState<string | null>(null);
  // The Notice of Protest's full filing timestamps — what the case pipeline
  // reads for File Protest / Confirm Filing (see case-pipeline.ts).
  const [noticeFiling, setNoticeFiling] = useState<NoticeFiling | null>(null);
  // Real "Protest Evidence"-tagged documents for this property — evidence
  // now uploads exclusively through Module 8 (ai-report.tsx), not a
  // checklist inside this modal (see CasePlanSection's "Upload Evidence —
  // Go to Module 8" button below), so this is the one real source every
  // evidence-aware feature here (Corvus's guidance, Pre-Filing Check,
  // Generate Suggested Reason) reads from.
  const [evidenceDocuments, setEvidenceDocuments] = useState<DocumentRecord[]>([]);
  // Signing the Notice of Protest is what opens Informal Review / Formal
  // Hearing (see caseTabUnlocked) — noticeSignedAt already updates the moment
  // it is signed, so this needs no extra loading.
  const noticeSigned = !!noticeSignedAt;
  // Lifted (not local to SettlementSignatureSection) so the top-of-case
  // "informal outcome unconfirmed" banner and HearingPrepSection's inline
  // warning read the same record the settlement section writes.
  const [settlementAgreement, setSettlementAgreement] = useState<SettlementAgreementRecord | null>(
    null,
  );

  function load() {
    setLoading(true);
    getCase(protest.id)
      .then(setCaseData)
      .catch((err) => toast.error(err instanceof Error ? err.message : "Could not load this case."))
      .finally(() => setLoading(false));
    loadNoticeFiling();
    getProtestEvidenceDocuments(userId, property.id)
      .then(setEvidenceDocuments)
      .catch((err) => console.error("Could not load this case's evidence documents:", err));
    getLatestSettlementAgreement(protest.id)
      .then(setSettlementAgreement)
      .catch((err) => console.error("Could not load this case's settlement agreement:", err));
  }

  function loadNoticeFiling() {
    getSubmission(protest.id, "notice_of_protest")
      .then((s) => {
        setNoticeSignedAt(s?.signedAt ?? null);
        setNoticeFiling(s);
      })
      .catch((err) => console.error("Could not load Notice of Protest signing status:", err));
  }

  useEffect(load, [protest.id]);

  // An upload made elsewhere (the AI Report page, the Documents page, or another
  // tab) must reach the evidence counts/checks here without a manual reload.
  const docsVersion = useDocumentsVersion();
  useEffect(() => {
    if (docsVersion === 0) return;
    getProtestEvidenceDocuments(userId, property.id)
      .then(setEvidenceDocuments)
      .catch((err) => console.error("Could not refresh this case's evidence documents:", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docsVersion]);

  // If a fresher protest prop arrives with the filing notice already
  // accepted (e.g. this view stayed mounted while the parent refetched),
  // carry that in so the one-time notice doesn't reappear. Only ever fills
  // the ack — never clobbers a locally-edited field.
  useEffect(() => {
    if (protest.corvusGuidanceAckAt) {
      setCurrent((c) =>
        c.corvusGuidanceAckAt ? c : { ...c, corvusGuidanceAckAt: protest.corvusGuidanceAckAt },
      );
    }
  }, [protest.corvusGuidanceAckAt]);

  async function handleAcknowledgeGuidance() {
    setAcknowledging(true);
    try {
      await acknowledgeGuidance(protest.id);
      setCurrent((prev) => ({ ...prev, corvusGuidanceAckAt: new Date().toISOString() }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not continue — please try again.");
    } finally {
      setAcknowledging(false);
    }
  }

  // One-time per case: the AI Guidance & Filing Notice gates a not-yet-filed
  // case only until the customer has accepted it once (persisted as
  // protests.corvus_guidance_ack_at). After that it never shows again for
  // this case — reopening View Case, switching tabs, or a new session.
  const needsGuidanceAck = current.status === "requested" && !current.corvusGuidanceAckAt;

  // Which phase tab is open. Starts on the case's current phase; auto-advances
  // when the status moves to a new phase (recording a hearing jumps to the
  // Hearing tab), but manual navigation between unlocked tabs is otherwise free.
  const phaseDefault = defaultCaseTab(current, needsGuidanceAck);
  const [activeTab, setActiveTab] = useState<CaseTabId>(phaseDefault);
  // Re-runs only when the derived phase-tab string actually changes, so
  // recording a hearing (etc.) advances the open tab; unrelated re-renders
  // don't disturb manual navigation.
  useEffect(() => {
    setActiveTab(phaseDefault);
  }, [phaseDefault]);

  // A guidance "Go to X" link: switch to the tab that holds the anchor, then
  // scroll to it once the panel has mounted.
  function navigateTo(anchor: string) {
    if (anchor.startsWith("http") || anchor.startsWith("tel:") || anchor.startsWith("mailto:")) {
      goToGuidanceAnchor(anchor);
      return;
    }
    // The readiness check is the guidance notice on Overview until it's
    // accepted; after that it's the Pre-Filing Check inside the filing popup.
    if (anchor === "case-readiness" && !needsGuidanceAck) {
      if (activeTab !== "file") setActiveTab("file");
      setFilingOpen(true);
      return;
    }
    const targetTab = ANCHOR_TAB[anchor];
    if (targetTab && targetTab !== activeTab) setActiveTab(targetTab);
    // The filing steps live inside the popup — open it so the anchor exists.
    if (targetTab === "file") setFilingOpen(true);
    // Give the newly-mounted panel a couple of frames to appear.
    let tries = 0;
    const tryScroll = () => {
      const el = document.getElementById(anchor);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (tries++ < 6) requestAnimationFrame(tryScroll);
    };
    requestAnimationFrame(tryScroll);
  }

  // Which of the two escalation tabs a generic "open appeal / arbitration" link goes to.
  const escalationTab: CaseTabId = current.escalationPath === "appeal" ? "court" : "arbitration";

  const filingWasOpen = useRef(false);
  useEffect(() => {
    if (filingWasOpen.current && !filingOpen) loadNoticeFiling();
    filingWasOpen.current = filingOpen;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filingOpen]);

  // A NEXT REQUIRED ACTION link from another page lands on its section once.
  const openedAnchor = useRef(false);
  useEffect(() => {
    if (loading || !initialAnchor || openedAnchor.current) return;
    openedAnchor.current = true;
    navigateTo(initialAnchor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, initialAnchor]);

  const today = localTodayIso();
  const pipeline = casePipeline({
    protest: current,
    notice: noticeFiling,
    protestDeadline: property.protestDeadline,
    cadName: property.cad,
    managed: property.planTier === "corvusrf_managed",
    today,
  });

  function handleTabClick(id: CaseTabId) {
    if (caseTabUnlocked(id, current, needsGuidanceAck, noticeSigned)) {
      setActiveTab(id);
    } else {
      toast.info(
        CASE_TABS.find((t) => t.id === id)?.lockedHint ?? "This phase isn't available yet.",
      );
    }
  }

  return (
    <div>
      <button onClick={onBack} className="btn-outline text-sm mb-4">
        ← Back
      </button>
      {(() => {
        const outcome = current.status === "resolved" ? buildCaseOutcome(property, current) : null;
        // Some counties (Dallas among them) publish no assessed-value field at all — genuinely
        // null, not zero. Falling back to 0 would show "$0" as if the county assessed it at
        // nothing, so this shows "Not on file" instead of a fabricated figure.
        const original = current.originalValue ?? property.totalValue ?? null;
        return (
          <PageHero
            icon={Scale}
            title={`Case: ${property.address}`}
            tone={outcome ? "emerald" : current.status === "requested" ? "sky" : "violet"}
            subtitle="AI-generated from your property's official CAD record."
            badges={
              <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold text-white ring-1 ring-white/30">
                {caseStageLabel(current)}
              </span>
            }
            stats={[
              {
                label: "Original value",
                value: original ?? 0,
                format: (n) => compactCurrency(n),
                // 0 means the county hasn't published this year's value yet, not $0.
                ...(!original ? { text: "Pending" } : {}),
              },
              ...(outcome && outcome.finalValue != null
                ? [
                    {
                      label: "Final value",
                      value: outcome.finalValue,
                      format: (n: number) => compactCurrency(n),
                    },
                  ]
                : []),
              ...(outcome && outcome.taxSavings
                ? [
                    {
                      label: "Saved per year",
                      value: outcome.taxSavings,
                      format: (n: number) => compactCurrency(n),
                    },
                  ]
                : []),
            ]}
          />
        );
      })()}

      {loading ? (
        <div className="mt-4 grid gap-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : (
        <>
          {/* Case Readiness → … → Close Case, and the one NEXT REQUIRED ACTION
              that moves it forward (case-pipeline.ts) — always at the top. */}
          <div className="mt-4 grid gap-3">
            <NextRequiredAction
              pipeline={pipeline}
              today={today}
              propertyId={property.id}
              onGo={navigateTo}
            />
            <div className="card-elev min-w-0 p-4">
              <PipelineStepper
                pipeline={pipeline}
                openStage={TAB_STAGE[activeTab]}
                openAppeal={activeTab === "arbitration" || activeTab === "court" ? activeTab : null}
                onSelect={(stage, appeal) => {
                  if (stage === "cad_evidence") {
                    if (caseTabUnlocked("hearing", current, needsGuidanceAck, noticeSigned))
                      navigateTo("case-cad-evidence");
                    else handleTabClick("hearing");
                    return;
                  }
                  handleTabClick(stage === "appeal" ? (appeal ?? escalationTab) : STAGE_TAB[stage]);
                }}
              />
            </div>
          </div>
          {(() => {
            // Viewing a later phase than the one the case is actually in: say so, and
            // say what is still open, so nobody wonders why an earlier step keeps blinking.
            const order = CASE_TABS.map((t) => t.id);
            const isEscalation = activeTab === "arbitration" || activeTab === "court";
            const behind: CaseTabId | null = isEscalation
              ? current.status !== "resolved" && current.arbDecision == null
                ? "decision"
                : null
              : order.indexOf(activeTab) > order.indexOf(phaseDefault) &&
                  activeTab !== "overview" &&
                  activeTab !== "outcome"
                ? phaseDefault
                : null;
            if (!behind) return null;
            const label = CASE_TABS.find((t) => t.id === behind)?.label ?? "";
            const todo: Partial<Record<CaseTabId, string>> = {
              file: "Confirm you delivered your signed protest to the county, so your deadline is protected.",
              informal: "Record how the informal review ended.",
              hearing: "Add your hearing notice, then record what happened.",
              decision: "Record the ARB decision (upload the ARB order).",
            };
            return (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <p className="min-w-0 flex-1 basis-64">
                  <span className="font-semibold">Finish "{label}" first.</span> {todo[behind]}
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab(behind)}
                  className="btn-primary shrink-0 text-sm"
                >
                  Go to {label} →
                </button>
              </div>
            );
          })()}
          <CasePhaseGuide tab={activeTab} informalStatus={current.informalStatus} />

          {/* A crash inside one phase shows a notice there, not a blank case page. */}
          <SectionErrorBoundary key={activeTab} label="This part of your case">
            {activeTab === "overview" && (
              <div className="mt-3">
                <RelevantTaxUpdates
                  property={property}
                  protest={current}
                  topics={["protest", "arb", "deadlines", "valuation", "tax_rate"]}
                />
              </div>
            )}

            {/* --- Overview --- */}
            {activeTab === "overview" &&
              (needsGuidanceAck ? (
                <CorvusGuidanceGate
                  property={property}
                  protest={current}
                  evidenceCount={evidenceDocuments.length}
                  onAcknowledge={handleAcknowledgeGuidance}
                  acknowledging={acknowledging}
                />
              ) : (
                <div className="grid gap-1">
                  <CaseRoadmap
                    property={property}
                    protest={current}
                    evidenceDocumentCount={evidenceDocuments.length}
                    noticeSignedAt={noticeSignedAt}
                    needsGuidanceAck={needsGuidanceAck}
                    noticeSigned={noticeSigned}
                    onSelect={handleTabClick}
                    onNavigate={navigateTo}
                  />
                  <CorvusGuidancePanel
                    property={property}
                    protest={current}
                    evidenceDocumentCount={evidenceDocuments.length}
                    noticeSignedAt={noticeSignedAt}
                    onNavigate={navigateTo}
                  />
                  <InformalOutcomeBanner
                    protest={current}
                    agreement={settlementAgreement}
                    onNavigate={navigateTo}
                  />
                  <CaseProgress
                    protest={current}
                    property={property}
                    caseData={caseData}
                    onUpdate={(patch) => setCurrent((prev) => ({ ...prev, ...patch }))}
                    onPropertyUpdate={(patch) => setProperty((prev) => ({ ...prev, ...patch }))}
                  />
                  <CaseRecordSection
                    userId={userId}
                    protest={current}
                    property={property}
                    onUpdate={(patch) => setCurrent((prev) => ({ ...prev, ...patch }))}
                  />
                  <CaseAuditTrailSection protestId={protest.id} />
                  <NextStepFooter
                    property={property}
                    protest={current}
                    evidenceDocumentCount={evidenceDocuments.length}
                    noticeSignedAt={noticeSignedAt}
                    onNavigate={navigateTo}
                  />
                </div>
              ))}

            {/* --- Prepare & File --- */}
            {activeTab === "file" && (
              <div>
                <FiledProtestStatusCard
                  userId={userId}
                  property={property}
                  protest={current}
                  evidenceCount={evidenceDocuments.length}
                  onOpen={() => setFilingOpen(true)}
                />
                <EvidenceStatusCard
                  userId={userId}
                  property={property}
                  protest={current}
                  evidenceDocuments={evidenceDocuments}
                  onOpen={() => setFilingOpen(true)}
                />
                <CasePlanSection
                  userId={userId}
                  property={property}
                  protestId={protest.id}
                  caseData={caseData}
                  onReload={load}
                  onGoToPhase={handleTabClick}
                />
                {/* Journey tracker is otherwise root-level, Properties-page-only
                  (see SignedInJourney in routes/__root.tsx) — kept here too
                  since Prepare & File is where the filing steps it tracks
                  (Submit/Track/Decision/Savings) actually get worked. */}
                <div className="mt-6">
                  <JourneyTracker propertyId={property.id} />
                </div>
              </div>
            )}

            {filingOpen && (
              <Modal onClose={() => setFilingOpen(false)} xl>
                <DocumentsSection
                  userId={userId}
                  protest={current}
                  property={property}
                  strategyRecommendation={caseData?.strategyRecommendation ?? null}
                  noticeSignedAt={noticeSignedAt}
                  evidenceDocuments={evidenceDocuments}
                  onUpdate={(patch) => setCurrent((prev) => ({ ...prev, ...patch }))}
                  onPropertyUpdate={(patch) => setProperty((prev) => ({ ...prev, ...patch }))}
                  onNoticeSigned={setNoticeSignedAt}
                  onFinish={() => {
                    setFilingOpen(false);
                    handleTabClick("informal");
                  }}
                  onGoTo={(anchor) => {
                    setFilingOpen(false);
                    navigateTo(anchor);
                  }}
                  userEmail={userEmail}
                />
              </Modal>
            )}

            {/* --- Informal Review --- */}
            {activeTab === "informal" && (current.status !== "requested" || noticeSigned) && (
              <div>
                {/* Once settled, the result leads the tab. */}
                <CaseOutcomeSection
                  userId={userId}
                  stage="informal"
                  protest={current}
                  property={property}
                  agreement={settlementAgreement}
                  onAgreementChange={setSettlementAgreement}
                  onOpenAppeal={() => setActiveTab(escalationTab)}
                  onUpdate={(patch) => setCurrent((prev) => ({ ...prev, ...patch }))}
                />
                <InformalReviewSection
                  userId={userId}
                  protest={current}
                  property={property}
                  strategyRecommendation={caseData?.strategyRecommendation ?? null}
                  evidenceDocuments={evidenceDocuments}
                  onUpdate={(patch) => setCurrent((prev) => ({ ...prev, ...patch }))}
                  onAgreementChange={setSettlementAgreement}
                  onOpenHearing={() => setActiveTab("hearing")}
                />
                {/* The settlement upload lives in the Informal Review section above
                  (Submit Settlement document). This fuller flow only stays for a
                  case that already started a settlement here, so it isn't lost. */}
                {settlementAgreement && (
                  <SettlementSignatureSection
                    userId={userId}
                    protest={current}
                    property={property}
                    agreement={settlementAgreement}
                    onAgreementChange={setSettlementAgreement}
                    onUpdate={(patch) => setCurrent((prev) => ({ ...prev, ...patch }))}
                  />
                )}
              </div>
            )}

            {/* --- Formal Hearing --- */}
            {activeTab === "hearing" && (current.status !== "requested" || noticeSigned) && (
              <div className="space-y-5">
                {/* The hearing notice is the first step of the formal hearing —
                    it leads the tab until the ARB has decided. */}
                {!current.arbDecision && (
                  <HearingNoticeSection
                    userId={userId}
                    protest={current}
                    property={property}
                    onUpdate={(patch) => setCurrent((prev) => ({ ...prev, ...patch }))}
                  />
                )}
                {/* Once decided, the ARB result leads the tab. */}
                <CaseOutcomeSection
                  userId={userId}
                  stage="formal"
                  protest={current}
                  property={property}
                  agreement={settlementAgreement}
                  onAgreementChange={setSettlementAgreement}
                  onOpenAppeal={() => setActiveTab(escalationTab)}
                  onUpdate={(patch) => setCurrent((prev) => ({ ...prev, ...patch }))}
                />
                {current.arbDecision && (
                  <DecisionNoticeSection
                    userId={userId}
                    protest={current}
                    property={property}
                    onUpdate={(patch) => setCurrent((prev) => ({ ...prev, ...patch }))}
                  />
                )}
                {/* Request CAD Evidence comes before the hearing itself. */}
                <CadEvidenceRequest
                  userId={userId}
                  property={property}
                  protest={current}
                  userEmail={userEmail}
                  onChange={(patch) => setCurrent((prev) => ({ ...prev, ...patch }))}
                />
                <FormalHearingActions
                  userId={userId}
                  protest={current}
                  property={property}
                  onUpdate={(patch) => setCurrent((prev) => ({ ...prev, ...patch }))}
                  onOpenAppeal={() => setActiveTab(escalationTab)}
                />
                {current.arbDecision && (
                  <HearingNoticeSection
                    userId={userId}
                    protest={current}
                    property={property}
                    onUpdate={(patch) => setCurrent((prev) => ({ ...prev, ...patch }))}
                  />
                )}
                <HearingPrepSection
                  protest={current}
                  property={property}
                  caseData={caseData}
                  evidenceDocuments={evidenceDocuments}
                  settlementAgreement={settlementAgreement}
                  onUpdate={(patch) => setCurrent((prev) => ({ ...prev, ...patch }))}
                />
                <MockHearing
                  userId={userId}
                  property={property}
                  protest={current}
                  evidenceFiles={evidenceDocuments.map((d) => d.fileName)}
                />
              </div>
            )}

            {/* --- Post-hearing Options --- (the decision itself is on the
              Informal / Formal tab it came from) */}
            {activeTab === "decision" && (
              <div>
                <PostHearingDecision
                  userId={userId}
                  property={property}
                  protest={current}
                  evidenceDocumentCount={evidenceDocuments.length}
                />
                <EscalationEvaluationSection
                  protest={current}
                  property={property}
                  evidenceDocumentCount={evidenceDocuments.length}
                  onUpdate={(patch) => setCurrent((prev) => ({ ...prev, ...patch }))}
                  onChosen={(path) => setActiveTab(path === "appeal" ? "court" : "arbitration")}
                />
              </div>
            )}

            {/* --- Arbitration --- */}
            {activeTab === "arbitration" && (
              <div>
                <StageDecisionBanner kind="arbitration" property={property} protest={current} />
                {current.escalationPath === "arbitration" || current.arbitrationFiledAt ? (
                  <ArbitrationWorkflow
                    userId={userId}
                    protest={current}
                    property={property}
                    evidenceDocuments={evidenceDocuments}
                    caseData={caseData}
                    onUpdate={(patch) => setCurrent((prev) => ({ ...prev, ...patch }))}
                  />
                ) : (
                  <EscalationStart
                    kind="arbitration"
                    protest={current}
                    onUpdate={(patch) => setCurrent((prev) => ({ ...prev, ...patch }))}
                    onOtherTab={() => setActiveTab("court")}
                  />
                )}
              </div>
            )}

            {/* --- Court Appeal --- */}
            {activeTab === "court" && (
              <div>
                <StageDecisionBanner kind="appeal" property={property} protest={current} />
                {current.escalationPath === "appeal" || current.courtAppeal ? (
                  <CourtAppealWorkflow
                    userId={userId}
                    protest={current}
                    property={property}
                    evidenceDocuments={evidenceDocuments}
                    caseData={caseData}
                    onUpdate={(patch) => setCurrent((prev) => ({ ...prev, ...patch }))}
                  />
                ) : (
                  <EscalationStart
                    kind="appeal"
                    protest={current}
                    onUpdate={(patch) => setCurrent((prev) => ({ ...prev, ...patch }))}
                    onOtherTab={() => setActiveTab("arbitration")}
                  />
                )}
              </div>
            )}
            {/* --- Final Outcome --- */}
            {activeTab === "outcome" && (
              <FinalOutcomeSection
                protest={current}
                property={property}
                onOpenTab={(tab) => setActiveTab(tab)}
              />
            )}
          </SectionErrorBoundary>
        </>
      )}
    </div>
  );
}

// The not-started state of the Arbitration / Court Appeal tabs: the option
// evaluation (eligibility, deadlines) plus a button to begin that path. Each path
// is independent — an owner can start one and later also start the other.
function EscalationStart({
  kind,
  protest,
  onUpdate,
  onOtherTab,
}: {
  kind: "arbitration" | "appeal";
  protest: ProtestRecord;
  onUpdate: (patch: Partial<ProtestRecord>) => void;
  onOtherTab: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const label = kind === "arbitration" ? "binding arbitration" : "a court appeal";
  async function start() {
    setBusy(true);
    try {
      await recordEscalation(protest.id, kind);
      onUpdate({ escalationPath: kind, status: kind === "appeal" ? "appealing" : "arbitrating" });
      toast.success(
        kind === "arbitration"
          ? "Recorded — the case moved to arbitration."
          : "Recorded — the case moved to a court appeal.",
      );
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not record this next step."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-4">
      <div className="rounded-md border border-border p-4">
        <h2 className="text-sm font-semibold">
          {kind === "arbitration" ? "Binding arbitration" : "Court appeal"}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          You haven&apos;t started {label} for this case yet. Starting it doesn&apos;t close the
          other option — you can also use the{" "}
          <button type="button" onClick={onOtherTab} className="text-accent hover:underline">
            {kind === "arbitration" ? "Court Appeal" : "Arbitration"} tab
          </button>{" "}
          {kind === "arbitration" ? "before or after" : "in addition to or instead of arbitration"}.
        </p>
        <button
          type="button"
          onClick={() => void start()}
          disabled={busy}
          className="btn-accent mt-3 text-xs py-1.5 disabled:opacity-60"
        >
          {busy ? "Saving…" : kind === "arbitration" ? "Start arbitration" : "Start court appeal"}
        </button>
      </div>
    </div>
  );
}
// The Overview tab's centerpiece: the same 5 phases as the tab bar drawn as a
// numbered path, with the current stage's plain-language summary and the single
// most important next action called out right below it. This is the one
// authoritative "you are here + do this next" panel — CorvusGuidancePanel's list
// and NextStepFooter below it are deliberately lighter, secondary echoes of the
// same getCaseGuidance() data, never a competing instruction.
function CaseRoadmap({
  property,
  protest,
  evidenceDocumentCount,
  noticeSignedAt,
  needsGuidanceAck,
  noticeSigned,
  onSelect,
  onNavigate,
}: {
  property: PropertyRecord;
  protest: ProtestRecord;
  evidenceDocumentCount: number;
  noticeSignedAt: string | null;
  needsGuidanceAck: boolean;
  noticeSigned: boolean;
  onSelect: (id: CaseTabId) => void;
  onNavigate: (anchor: string) => void;
}) {
  const currentPhase = defaultCaseTab(protest, needsGuidanceAck);
  const currentIdx = CASE_TABS.findIndex((t) => t.id === currentPhase);
  const countyInfo = getCountyProtestInfo(property.cad);
  const guidance = getCaseGuidance(
    property,
    protest,
    evidenceDocumentCount,
    countyInfo,
    noticeSignedAt,
  );
  const next = guidance.nextSteps[0];
  return (
    <div className="mt-4 card-elev p-4">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Your protest, step by step
      </span>
      <ol className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-2 text-xs">
        {CASE_TABS.map((t, i) => {
          const isHub = t.id === "overview";
          const unlocked = caseTabUnlocked(t.id, protest, needsGuidanceAck, noticeSigned);
          const pathDone = escalationDone(t.id, protest);
          const groupDone =
            (t.id === "arbitration" && escalationDone("court", protest)) || pathDone;
          // See CaseTabBar's own version of this same fix above — Final
          // Outcome is the current step once the case closes, so the plain
          // "i < currentIdx" rule alone left it on a bare step number.
          const done =
            !isHub &&
            unlocked &&
            (i < currentIdx || groupDone || (t.id === "outcome" && protest.status === "resolved"));
          const here = i === currentIdx;
          const marker = isHub ? "⌂" : !unlocked ? "🔒" : done ? "✓" : String(stepNumber(i));
          return (
            <li key={t.id} className="flex items-center gap-1">
              {i > 0 && (
                <span aria-hidden className="text-muted-foreground/30">
                  {t.joinsPrev ? "/" : "→"}
                </span>
              )}
              <button
                type="button"
                onClick={() => onSelect(t.id)}
                disabled={!unlocked}
                className={`flex items-center gap-1.5 rounded-full py-0.5 pl-1 pr-2 font-medium ${
                  here
                    ? "bg-accent/15 text-accent"
                    : done
                      ? "text-success"
                      : unlocked
                        ? "text-muted-foreground hover:text-foreground"
                        : "text-muted-foreground/40"
                }`}
              >
                {!t.joinsPrev && (
                  <span
                    aria-hidden
                    className={`grid h-4 w-4 place-items-center rounded-full text-[10px] font-semibold leading-none ${
                      here
                        ? "bg-accent text-accent-foreground"
                        : done
                          ? "bg-success/20 text-success"
                          : unlocked
                            ? "border border-border"
                            : "bg-muted text-muted-foreground/50"
                    }`}
                  >
                    {marker}
                  </span>
                )}
                {t.label}
                {(t.joinsPrev || t.id === "arbitration") && pathDone && (
                  <span className="text-success">✓</span>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="mt-3 rounded-md border border-accent/30 bg-accent/5 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">
          You are here — {guidance.stageLabel}
        </p>
        <p className="mt-1 text-sm">{guidance.summary}</p>
        {next && (
          <div className="mt-2 text-sm">
            <span className="font-semibold">Next step: {next.label}.</span>
            {next.detail && <span className="text-muted-foreground"> {next.detail}</span>}
            {next.action && (
              <button
                onClick={() => onNavigate(next.action!.anchor)}
                className="btn-accent mt-2 block w-fit py-1.5 text-xs"
              >
                {next.action.label} →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Consent screen gating entry into a not-yet-filed case, shown on every open
// (not just the first) per explicit product direction — exact copy per the
// spec this was built from. An acknowledgment, not a legal document, so a
// checkbox + button is enough (no signature capture, unlike the real Service
// Agreement in ProtestAuthorizationFlow.tsx).
function CorvusGuidanceGate({
  property,
  protest,
  evidenceCount,
  onAcknowledge,
  acknowledging,
}: {
  property: PropertyRecord;
  protest: ProtestRecord;
  evidenceCount: number;
  onAcknowledge: () => void;
  acknowledging: boolean;
}) {
  const [checked, setChecked] = useState(false);
  const [concernsReviewed, setConcernsReviewed] = useState(false);
  const [concerns, setConcerns] = useState<CaseReadinessConcern[] | null>(null);
  const [verifyState, setVerifyState] = useState<"loading" | "done" | "error">("loading");

  const countyInfo = getCountyProtestInfo(property.cad);

  useEffect(() => {
    let live = true;
    setVerifyState("loading");
    verifyCaseReadiness(property, protest, evidenceCount)
      .then((c) => {
        if (!live) return;
        setConcerns(c);
        setVerifyState("done");
      })
      .catch(() => {
        if (live) setVerifyState("error");
      });
    return () => {
      live = false;
    };
    // Keyed on the case's identity, not the property/protest object refs —
    // this gate re-renders on unrelated state and `verifyCaseReadiness` is a
    // real AI call. While this gate is shown, none of the fields it checks
    // can change (the Pre-Filing fix rows only render after acknowledgment).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [property.id, protest.id, evidenceCount]);

  const hasHigh = (concerns ?? []).some((c) => c.severity === "high");
  const canContinue = checked && (!hasHigh || concernsReviewed) && !acknowledging;

  return (
    <div id="case-readiness" className="mt-4 grid scroll-mt-24 gap-4">
      <div className="card-elev p-4">
        <h2 className="text-sm font-semibold">AI Guidance & Filing Notice</h2>
        <div className="mt-1.5 grid gap-0.5 text-xs text-muted-foreground">
          <p>
            Corvus AI helps prepare your protest forms — by continuing, you authorize it to fill
            them in for you.
          </p>
          <p>
            You review and verify everything before signing or filing, and remain responsible for
            county requirements.
          </p>
        </div>
        <p className="mt-2 border-t border-border/60 pt-1.5 text-[11px] text-muted-foreground">
          {countyInfo ? (
            <>
              County procedures for {property.cad} were verified {countyInfo.verifiedAt}.{" "}
              <a
                href={countyInfo.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline underline-offset-2"
              >
                Source
              </a>
              . Confirm current county requirements before you file.
            </>
          ) : (
            <>
              No county-specific procedures are on file for {property.cad || "this county"} — the
              standard Texas Comptroller Form 50-132 process applies. Confirm current county
              requirements before you file.
            </>
          )}
        </p>
      </div>

      <div className="card-elev p-4">
        <h2 className="text-sm font-semibold">County Requirements Check</h2>
        {verifyState === "loading" ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Corvus AI is verifying this case against {property.cad || "the county"}'s requirements…
          </p>
        ) : verifyState === "error" ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Couldn't run the automated check — review the Pre-Filing Check below carefully before
            filing.
          </p>
        ) : (concerns ?? []).length === 0 ? (
          <p className="mt-2 text-xs text-success">
            Nothing looks inconsistent with the county's requirements. Still review the Pre-Filing
            Check below before filing.
          </p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {(concerns ?? []).map((c, i) => (
              <li
                key={i}
                className={`rounded-md border p-2.5 text-xs ${
                  c.severity === "high"
                    ? "border-destructive/30 bg-destructive/5"
                    : "border-warning/40 bg-warning/10"
                }`}
              >
                <span className="font-semibold">
                  {c.field}
                  {c.severity === "high" ? " — needs attention" : ""}:
                </span>{" "}
                <span className="text-muted-foreground">{c.concern}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {hasHigh && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={concernsReviewed}
            onChange={(e) => setConcernsReviewed(e.target.checked)}
            className="mt-0.5"
          />
          I have reviewed the concern(s) above and will confirm or correct them.
        </label>
      )}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-0.5"
        />
        I have read and understand this notice.
      </label>
      <button
        onClick={onAcknowledge}
        disabled={!canContinue}
        className="btn-accent w-fit text-sm disabled:opacity-60"
      >
        {acknowledging ? "Continuing…" : "Continue to Case"}
      </button>
    </div>
  );
}

// Shared by CorvusGuidancePanel and NextStepFooter below — a GuidanceStep's
// action.anchor is either a real element id already rendered by an existing
// section (scroll to it) or a real external URL (open it), never a route
// change or a new surface.
function goToGuidanceAnchor(anchor: string) {
  if (anchor.startsWith("http")) {
    window.open(anchor, "_blank", "noopener,noreferrer");
    return;
  }
  // mailto: in a new tab — when the browser hands email links to webmail
  // (Gmail, Outlook on the web), the same tab would navigate away from the
  // case and lose the customer's progress. A clicked link (not
  // window.open) isn't popup-blocked.
  if (anchor.startsWith("mailto:")) {
    const a = document.createElement("a");
    a.href = anchor;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.click();
    return;
  }
  // tel: hands off to the phone app; nothing navigates away
  if (anchor.startsWith("tel:")) {
    window.location.href = anchor;
    return;
  }
  const el = document.getElementById(anchor);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  // Target not in the DOM yet (a section that just conditionally mounted) —
  // try once more next frame before giving up, so the click is never a
  // silent no-op for a purely timing reason.
  requestAnimationFrame(() => {
    document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

// Ambient, ongoing guidance — purely additive, sits above the existing
// sections on every visit once the one-time filing notice above has been
// accepted for this case. Every fact it shows comes from getCaseGuidance()'s
// deterministic mapping of real case/property/county data — never
// AI-generated. No checkbox, no gating: informational only, and nothing
// below it is disabled or hidden by its presence.
function CorvusGuidancePanel({
  property,
  protest,
  evidenceDocumentCount,
  noticeSignedAt,
  onNavigate,
}: {
  property: PropertyRecord;
  protest: ProtestRecord;
  evidenceDocumentCount: number;
  noticeSignedAt: string | null;
  // Switch to the tab holding this anchor, then scroll to it.
  onNavigate: (anchor: string) => void;
}) {
  const [countyOpen, setCountyOpen] = useState(false);
  const countyInfo = getCountyProtestInfo(property.cad);
  const guidance = getCaseGuidance(
    property,
    protest,
    evidenceDocumentCount,
    countyInfo,
    noticeSignedAt,
  );

  // The #1 next step is already the headline call-to-action in CaseRoadmap
  // above — this panel only lists whatever comes after it, so the two never
  // repeat the same instruction.
  const otherSteps = guidance.nextSteps.slice(1);

  return (
    <div className="mt-4 card-elev p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Corvus AI Guidance
        </span>
        <span className="badge-soft">{guidance.stageLabel}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        County-specific reference for this stage. The action to take now is in the step-by-step
        panel above.
      </p>

      {otherSteps.length > 0 && (
        <div className="mt-3 grid gap-2 border-t border-border pt-3">
          <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Also on your list
          </h5>
          <ul className="grid gap-1.5">
            {otherSteps.map((step, i) => (
              <li key={i} className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{step.label}</span>
                {step.detail && <span> — {step.detail}</span>}
                {step.action && (
                  <button
                    onClick={() => onNavigate(step.action!.anchor)}
                    className="ml-2 text-xs text-accent hover:underline"
                  >
                    {step.action.label} →
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {countyInfo && (
        <div className="mt-3 border-t border-border pt-3">
          <button
            onClick={() => setCountyOpen((v) => !v)}
            className="text-xs font-semibold text-accent hover:underline"
          >
            {countyOpen ? "Hide" : "Show"} your county's protest process
          </button>
          {countyOpen && (
            <div className="mt-2 grid gap-2 text-xs text-muted-foreground">
              <div>
                <span className="font-medium text-foreground">How to file: </span>
                <FilingMethodsList countyInfo={countyInfo} />
              </div>
              {countyInfo.arbContact &&
                (countyInfo.arbContact.phone || countyInfo.arbContact.email) && (
                  <div>
                    <span className="font-medium text-foreground">ARB contact: </span>
                    {[countyInfo.arbContact.phone, countyInfo.arbContact.email]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                )}
              {countyInfo.informalReview && (
                <div>
                  <span className="font-medium text-foreground">Informal review: </span>
                  {countyInfo.informalReview.howToRequest}
                </div>
              )}
              <div className="pt-1">
                Source:{" "}
                <a
                  href={countyInfo.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  {countyInfo.cad}
                </a>{" "}
                (verified {countyInfo.verifiedAt})
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Repeats just the single most important next step at the very bottom of
// the modal, right above Close — CorvusGuidancePanel's own copy of this
// sits at the top, which a user scrolled down to Evidence
// Checklist/Documents/Case Progress (e.g. right after uploading a file or
// downloading a form) won't see without scrolling back up. Same real
// getCaseGuidance() data, not a separate/invented message. Renders nothing
// once there's genuinely no next step (e.g. a resolved case).
function NextStepFooter({
  property,
  protest,
  evidenceDocumentCount,
  noticeSignedAt,
  onNavigate,
}: {
  property: PropertyRecord;
  protest: ProtestRecord;
  evidenceDocumentCount: number;
  noticeSignedAt: string | null;
  onNavigate: (anchor: string) => void;
}) {
  const countyInfo = getCountyProtestInfo(property.cad);
  const guidance = getCaseGuidance(
    property,
    protest,
    evidenceDocumentCount,
    countyInfo,
    noticeSignedAt,
  );
  const next = guidance.nextSteps[0];
  if (!next) return null;

  return (
    <div className="sticky bottom-3 z-20 mt-5 rounded-2xl border border-accent/40 bg-card/95 p-3 text-sm shadow-lg backdrop-blur">
      <p className="text-xs font-semibold uppercase tracking-wide text-accent">
        Reminder — your next step
      </p>
      <p className="mt-1">
        <span className="font-semibold">{next.label}.</span>
        {next.detail && <span className="text-muted-foreground"> {next.detail}</span>}
      </p>
      {next.action && (
        <button
          onClick={() => onNavigate(next.action!.anchor)}
          className="btn-accent mt-2 block w-fit py-1.5 text-xs"
        >
          {next.action.label} →
        </button>
      )}
    </div>
  );
}

// Real Texas Comptroller forms (Form 50-132, Form 50-162 — see
// src/lib/protest-documents.ts), pre-filled from data already on this case.
// Neither is auto-signed; both need review + a real signature before filing.
// Strategy + Evidence Checklist + "Generate Case Plan" — shared by the customer
// modal (CaseDetailModal, above) and the staff modal (AdminCaseProgressModal),
// same reuse pattern as DocumentsSection/CaseProgress below. `userId` must be the
// case-owning CUSTOMER's id even when this renders inside the admin panel — both
// generateCasePrep()'s protest_evidence_items insert and uploadDocument()'s row/
// storage-path use it directly, and the customer's own RLS policies (unaffected by
// this component's admin-added INSERT/UPDATE policies) key off that same value.
export function CasePlanSection({
  userId,
  property,
  protestId,
  caseData,
  onReload,
  onGoToPhase,
}: {
  userId: string;
  property: PropertyRecord;
  protestId: string;
  caseData: ProtestCase | null;
  onReload: () => void;
  // Customer modal only: jump to the Informal Review or Formal Hearing tab.
  onGoToPhase?: (tab: "informal" | "hearing") => void;
}) {
  const [generating, setGenerating] = useState(false);
  const phaseButtons = onGoToPhase && (
    <>
      <button onClick={() => onGoToPhase("informal")} className="btn-outline w-fit text-sm">
        Go to Informal
      </button>
      <button onClick={() => onGoToPhase("hearing")} className="btn-outline w-fit text-sm">
        Go to Formal
      </button>
    </>
  );

  async function handleGenerate() {
    setGenerating(true);
    try {
      await generateCasePrep(protestId, userId, property);
      onReload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not generate the case plan.");
    } finally {
      setGenerating(false);
    }
  }

  const hasAnyPlan = !!caseData?.strategyRecommendation;

  if (!hasAnyPlan) {
    return (
      <div className="mt-4 grid gap-3">
        <p className="text-sm text-muted-foreground">No case plan yet.</p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="btn-accent w-fit text-sm disabled:opacity-60"
          >
            {generating ? "Generating…" : "Generate Case Plan"}
          </button>
          {phaseButtons}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 grid gap-5">
      <section>
        <h2 className="text-sm font-semibold">Strategy</h2>
        {caseData?.strategyRecommendation ? (
          <div className="mt-1">
            <span className="badge-soft">{caseData.strategyRecommendation}</span>
            {caseData.strategyConfidencePct != null && (
              <span className="ml-2 text-xs text-muted-foreground">
                {caseData.strategyConfidencePct}% confidence
              </span>
            )}
            {caseData.strategyRationale && (
              <p className="mt-1.5 text-sm text-muted-foreground">{caseData.strategyRationale}</p>
            )}
          </div>
        ) : (
          <div className="mt-1 flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Not available yet.</span>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="text-xs text-accent hover:underline disabled:opacity-60"
            >
              {generating ? "Retrying…" : "Retry"}
            </button>
          </div>
        )}
        {phaseButtons && <div className="mt-3 flex flex-wrap gap-2">{phaseButtons}</div>}
      </section>
      {/* Evidence upload lives in exactly one place on this tab now — the
          Evidence card above (EvidenceStatusCard), which has the richer
          context (score, critical-missing count) this section didn't. A
          second identical button here was pure duplication — see
          EvidenceStatusCard's own id="case-upload-evidence" for where
          getCaseGuidance's "Go to Upload Evidence" step now lands. */}
    </div>
  );
}

export { DocumentsSection } from "@/components/case/filing";
export { CaseProgress } from "@/components/case/record";
