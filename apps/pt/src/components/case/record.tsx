// Case record, progress, audit trail and status cards (split out of CaseDetailModal.tsx).
import { SettlementHistory } from "@/components/SettlementHistory";
import { CountyRecordPanel } from "@/components/CountyRecordPanel";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { EvidenceChecklistPanel } from "@/components/EvidenceChecklistPanel";
import { setAutoRefile, type PropertyRecord } from "@/lib/properties";
import { type ProtestRecord } from "@/lib/protests";
import { currency } from "@/lib/intake-store";
import {
  recordSettlementOffer,
  acceptSettlement,
  scheduleHearing,
  getHearingPrep,
  recordArbDecision,
  recordEscalation,
  closeCase,
  getCaseResults,
  type ProtestCase,
} from "@/lib/protest-case";
import {
  getCaseRecord,
  caseRecordStage,
  outstandingProofPrompts,
  caseRecordCompletion,
  type CaseRecordItem,
} from "@/lib/case-record";
import {
  logCaseEvent,
  getCaseAuditTrail,
  caseAuditKindLabel,
  type CaseAuditEvent,
} from "@/lib/case-audit";
import { saveCaseRecordFields } from "@/lib/protest-case";
import { listDocuments } from "@/lib/documents";
import { useDocumentsVersion } from "@/lib/use-documents-version";
import { getPreFilingCheck, isPreFilingBlocked } from "@/lib/pre-filing-check";
import { uploadDocument, getFilingProofDocumentsFor, type DocumentRecord } from "@/lib/documents";
import { getErrorMessage } from "@/lib/error-message";
import {
  getSubmission,
  confirmFiling,
  requestAdditionalInfo,
  type FormSubmission,
} from "@/lib/protest-form-submissions";
import {
  filingSubmissionStatus,
  hasFilingReferenceNumber,
  confirmationMethodDescription,
  FILING_SUBMISSION_STATUS_LABEL,
  type FilingSubmissionStatus,
} from "@/lib/filing-submission-status";
import { computeEvidenceStatus, evidenceScore, EVIDENCE_STATUS_LABEL } from "@/lib/evidence-status";
import { getCachedModuleResult } from "@/lib/module-results-cache";
import type { ModuleResultMap } from "@/lib/ai-report-modules";
import { Modal } from "@/components/Modal";
import { removeLatestDocumentOfType } from "@/lib/upload-undo";
import { Skeleton } from "@/components/ui/skeleton";
import { EMPTY_FORM_SUBMISSION, FILING_METHOD_LABEL, Field } from "@/components/case/shared";

// Part 3's own small label map for the Notice of Protest's "Final Status" —
// deliberately separate from FILING_SUBMISSION_STATUS_LABEL (which is
// generic across all four documents in Part 2's own panels): this is the
// one and only place this app ever says "Protest Filed", and only once
// filingConfirmedAt is real — confirmFiling()'s existing discipline already
// enforces that it's never set just because the user said "submitted" or a
// delivery was confirmed; this card only ever surfaces what's already true.
function noticeFinalStatusLabel(status: FilingSubmissionStatus): string {
  switch (status) {
    case "unstarted":
      return "Not Filed Yet";
    case "method_chosen":
      return "Method Selected — Not Yet Submitted";
    case "awaiting_confirmation":
      return "Awaiting County Confirmation";
    case "additional_requested":
      return "Additional Information Requested";
    case "rejected":
      return "Rejected — Needs Correction";
    case "confirmed":
      return "Protest Filed";
  }
}

// Part 3 — the Filed Protest half of the status/action screen. Reads the
// exact same submission row Part 2's own FilingSubmissionFlow (for
// notice_of_protest) reads and writes; this card never duplicates that
// workflow, it only rolls the same real fields up into one glance +
// whichever action (Start/Continue/Review/View) makes sense right now.
export function FiledProtestStatusCard({
  userId,
  property,
  protest,
  evidenceCount,
  onOpen,
}: {
  userId: string;
  property: PropertyRecord;
  protest: ProtestRecord;
  evidenceCount: number;
  onOpen: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [submission, setSubmission] = useState<FormSubmission | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    getSubmission(protest.id, "notice_of_protest")
      .then((s) => {
        if (!live) return;
        setSubmission(s);
      })
      .catch((err) => console.error("Could not load the filed-protest status:", err))
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [protest.id, userId, property.id]);

  const blocked = isPreFilingBlocked(getPreFilingCheck(property, protest, evidenceCount));
  const status = filingSubmissionStatus(submission);
  const started = status !== "unstarted";
  // Notice signed but its delivery never recorded — every form is done, the
  // last step left is getting it to the county. Says so plainly instead of
  // "Not Filed Yet / Start Filing" (which reads as if nothing was done), while
  // still never claiming "Protest Filed" before the county confirms.
  // The district sent its hearing evidence for this protest, so it has the
  // protest on file even though the county's confirmation isn't recorded.
  const onFileWithDistrict =
    !!protest.cadEvidenceReceivedAt &&
    !["confirmed", "rejected", "additional_requested"].includes(status);
  const signedNotDelivered = !onFileWithDistrict && !started && !!submission?.signedAt;
  const statusLabel = onFileWithDistrict
    ? "On File — District Sent Its Evidence"
    : signedNotDelivered
      ? "Signed — Not Yet Delivered"
      : noticeFinalStatusLabel(status);

  return (
    <div className="mt-4 card-elev p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-serif text-base font-semibold">Filed Protest</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            status === "confirmed"
              ? "bg-success/15 text-success"
              : status === "additional_requested" || status === "rejected"
                ? "bg-destructive/10 text-destructive"
                : onFileWithDistrict
                  ? "bg-success/15 text-success"
                  : status === "awaiting_confirmation"
                    ? "bg-warning/15 text-warning-foreground"
                    : signedNotDelivered
                      ? "bg-warning/15 text-warning-foreground"
                      : "bg-secondary text-muted-foreground"
          }`}
        >
          {statusLabel}
        </span>
      </div>

      {loading ? (
        <p className="mt-2 text-xs text-muted-foreground">Loading…</p>
      ) : onFileWithDistrict ? (
        <p className="mt-2 text-xs text-muted-foreground">
          The district sent its hearing evidence for this protest, so your Notice of Protest is on
          file. Keep your proof of filing with the case — record the confirmation number or upload
          the receipt when you have it.
        </p>
      ) : signedNotDelivered ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Your Notice of Protest is signed. The last step is delivering it to the county — choose
          how you&apos;re filing, mark it submitted, then confirm once the county acknowledges it.
          This turns to &quot;Protest Filed&quot; when the county confirms.
        </p>
      ) : !started ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Corvus AI walks you through it one step at a time — the Pre-Filing Check, the exact county
          forms you need (Notice of Protest, and an agent or affidavit form only if they apply),
          signing, filing, and your evidence package.
        </p>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-4">
          <Field
            label="Submission Method"
            value={
              submission?.filingMethod
                ? FILING_METHOD_LABEL[submission.filingMethod]
                : "Not yet chosen"
            }
          />
          <Field
            label="Submission Date"
            value={
              submission?.submittedAt ? new Date(submission.submittedAt).toLocaleDateString() : "—"
            }
          />
          <Field
            label="Confirmation Method"
            value={confirmationMethodDescription(submission?.filingMethod ?? null) ?? "—"}
          />
          <Field
            label="County Confirmation"
            value={
              status === "confirmed"
                ? "Confirmed"
                : status === "rejected"
                  ? "Rejected"
                  : status === "additional_requested"
                    ? "More info requested"
                    : status === "awaiting_confirmation"
                      ? "Awaiting reply"
                      : "Not yet"
            }
          />
        </dl>
      )}

      {blocked && !started && (
        <p className="mt-2 text-xs text-warning-foreground">
          Action needed in the Pre-Filing Check — open the workflow to resolve it.
        </p>
      )}

      <button onClick={onOpen} className="btn-accent mt-3 text-xs py-1.5">
        {status === "confirmed"
          ? "View Filing"
          : onFileWithDistrict
            ? "Record Proof of Filing"
            : started
              ? "Continue Filing"
              : signedNotDelivered
                ? "Deliver & Confirm Filing"
                : blocked
                  ? "Review Pre-Filing Check"
                  : "Start Filing"}
      </button>
    </div>
  );
}

// Part 3 — the Evidence half of the status/action screen. criticalMissing
// comes from Module 8's own cached checklist (getCachedModuleResult, a plain
// read — no new AI call); the rest from the same "evidence" submission row
// Part 2's Evidence tab reads and writes. Never re-does either module's work,
// just tells the user which of the two states applies and what to do next.
export function EvidenceStatusCard({
  userId,
  property,
  protest,
  evidenceDocuments,
  onOpen,
}: {
  userId: string;
  property: PropertyRecord;
  protest: ProtestRecord;
  evidenceDocuments: DocumentRecord[];
  onOpen: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [submission, setSubmission] = useState<FormSubmission | null>(null);
  const [criticalMissingCount, setCriticalMissingCount] = useState<number | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [proofCount, setProofCount] = useState(0);
  const [requesting, setRequesting] = useState(false);
  const docsVersion = useDocumentsVersion();

  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all([
      getSubmission(protest.id, "evidence"),
      getCachedModuleResult(property.id, "evidence"),
      getFilingProofDocumentsFor(userId, property.id, "evidence"),
    ])
      .then(([s, cached, proofDocs]) => {
        if (!live) return;
        setSubmission(s);
        setProofCount(proofDocs.length);
        if (cached) {
          const items = (cached.result as ModuleResultMap["evidence"]).items ?? [];
          setCriticalMissingCount(
            items.filter((i) => i.priority === "Critical" && i.status === "Missing").length,
          );
          setScore(evidenceScore(items));
        } else {
          setCriticalMissingCount(null);
          setScore(null);
        }
      })
      .catch((err) => console.error("Could not load the evidence status:", err))
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [protest.id, property.id, userId, docsVersion]);

  async function handleRequestAdditional() {
    setRequesting(true);
    try {
      const at = await requestAdditionalInfo(userId, protest.id, "evidence");
      setSubmission((s) => ({ ...(s ?? EMPTY_FORM_SUBMISSION), additionalRequestedAt: at }));
      toast.info("Logged — showing as Additional Evidence Requested.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save this."));
    } finally {
      setRequesting(false);
    }
  }

  // Same popup-embed treatment as CasePlanSection's own — see its comment.
  const [showEvidencePanel, setShowEvidencePanel] = useState(false);
  function goToModule8() {
    setShowEvidencePanel(true);
  }

  const status = loading
    ? null
    : computeEvidenceStatus({
        evidenceDocCount: evidenceDocuments.length,
        criticalMissingCount,
        submission,
      });
  const methodChosen =
    status &&
    !["not_started", "evidence_required", "being_prepared", "ready_to_submit"].includes(status);

  return (
    <div id="case-upload-evidence" className="mt-4 card-elev p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-serif text-base font-semibold">Evidence</h2>
        {status && (
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              status === "complete" || status === "confirmed"
                ? "bg-success/15 text-success"
                : status === "additional_requested" || status === "rejected"
                  ? "bg-destructive/10 text-destructive"
                  : status === "awaiting_confirmation"
                    ? "bg-warning/15 text-warning-foreground"
                    : "bg-secondary text-muted-foreground"
            }`}
          >
            {EVIDENCE_STATUS_LABEL[status]}
          </span>
        )}
      </div>

      {loading || !status ? (
        <p className="mt-2 text-xs text-muted-foreground">Loading…</p>
      ) : (
        <>
          <p className="mt-2 text-xs text-muted-foreground">
            {evidenceDocuments.length} evidence document{evidenceDocuments.length === 1 ? "" : "s"}{" "}
            on this case
            {score != null && ` · Evidence Score ${score}%`}
            {criticalMissingCount != null &&
              criticalMissingCount > 0 &&
              ` · ${criticalMissingCount} critical item${criticalMissingCount === 1 ? "" : "s"} still missing`}
            .
          </p>
          {score != null && score < 70 && (
            <p className="mt-1 text-xs text-warning-foreground">
              Your evidence score is low — add more to strengthen the case.
            </p>
          )}

          {methodChosen && (
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-3">
              <Field
                label="Confirmation Method"
                value={confirmationMethodDescription(submission?.filingMethod ?? null) ?? "—"}
              />
              <Field
                label="Submission Date"
                value={
                  submission?.submittedAt
                    ? new Date(submission.submittedAt).toLocaleDateString()
                    : "—"
                }
              />
              <Field
                label="Submission Proof"
                value={
                  proofCount > 0
                    ? `${proofCount} document${proofCount === 1 ? "" : "s"}`
                    : hasFilingReferenceNumber(submission)
                      ? "Reference number on file"
                      : "None yet"
                }
              />
            </dl>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {(status === "not_started" ||
              status === "evidence_required" ||
              status === "being_prepared") && (
              <button onClick={goToModule8} className="btn-accent text-xs py-1.5">
                {evidenceDocuments.length > 0 ? "Upload More Evidence" : "Upload Evidence"}
              </button>
            )}
            {status === "ready_to_submit" && (
              <>
                <button onClick={onOpen} className="btn-accent text-xs py-1.5">
                  Submit Evidence
                </button>
                <button onClick={goToModule8} className="btn-outline text-xs py-1.5">
                  Upload Additional Evidence
                </button>
              </>
            )}
            {status === "awaiting_confirmation" && (
              <>
                <button onClick={onOpen} className="btn-outline text-xs py-1.5">
                  View Submission
                </button>
                <button onClick={onOpen} className="btn-accent text-xs py-1.5">
                  Submit Additional Evidence
                </button>
              </>
            )}
            {(status === "confirmed" || status === "complete") && (
              <>
                <button onClick={onOpen} className="btn-accent text-xs py-1.5">
                  Submit Additional Evidence
                </button>
                <button
                  onClick={handleRequestAdditional}
                  disabled={requesting}
                  className="text-xs text-accent hover:underline disabled:opacity-60"
                >
                  {requesting ? "Saving…" : "County asked for more?"}
                </button>
              </>
            )}
            {(status === "additional_requested" || status === "rejected") && (
              <>
                <button onClick={goToModule8} className="btn-accent text-xs py-1.5">
                  Add Evidence
                </button>
                <button onClick={onOpen} className="btn-outline text-xs py-1.5">
                  Continue to Evidence
                </button>
              </>
            )}
          </div>
          {showEvidencePanel && (
            <Modal onClose={() => setShowEvidencePanel(false)} wide>
              <EvidenceChecklistPanel property={property} userId={userId} />
            </Modal>
          )}
        </>
      )}
    </div>
  );
}

// The complete case record — every proof/record item a fully-documented
// protest should hold (see src/lib/case-record.ts), what's on file, and what
// is still outstanding *for a stage the case has already reached*. Those are
// surfaced first as "needed now" prompts so the user uploads proof at each
// stage rather than scrambling at the end.
const RECORD_STAGE_LABEL: Record<string, string> = {
  filing: "Filing",
  informal: "Informal review",
  hearing: "Formal hearing",
  decision: "Decision",
  escalation: "Escalation",
  resolved: "Resolved",
};

export function CaseRecordSection({
  userId,
  protest,
  property,
  onUpdate,
}: {
  userId: string;
  protest: ProtestRecord;
  property: PropertyRecord;
  onUpdate: (patch: Partial<ProtestRecord>) => void;
}) {
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [countyCommLogged, setCountyCommLogged] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confNum, setConfNum] = useState(protest.filingConfirmationNumber ?? "");
  const [channel, setChannel] = useState(protest.filingChannel ?? "");
  const [tracking, setTracking] = useState(protest.certifiedMailTracking ?? "");
  const [reloadKey, setReloadKey] = useState(0);
  const docsVersion = useDocumentsVersion();

  useEffect(() => {
    let live = true;
    Promise.all([listDocuments(userId), getCaseAuditTrail(protest.id)])
      .then(([allDocs, events]) => {
        if (!live) return;
        setDocs(allDocs.filter((d) => d.propertyId === property.id));
        setCountyCommLogged(events.some((e) => e.kind === "county_communication"));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [userId, property.id, protest.id, reloadKey, docsVersion]);

  const stage = caseRecordStage(protest);
  const items = getCaseRecord(protest, {
    documents: docs,
    hearingNoticeOnFile: !!(protest.hearingLocation || protest.hearingTime),
    countyCommunicationLogged: countyCommLogged,
  });
  const prompts = outstandingProofPrompts(items, stage);
  const { onFile, applicable } = caseRecordCompletion(items);

  async function uploadFor(item: CaseRecordItem, files: File[]) {
    if (!item.docType || files.length === 0) return;
    setBusy(item.id);
    try {
      for (const file of files) {
        const doc = await uploadDocument(userId, property.id, file, item.docType);
        void logCaseEvent(protest.id, "document_added", `${item.label}: uploaded ${doc.fileName}.`);
      }
      toast.success("Added to the case record.");
      setReloadKey((k) => k + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not upload this file.");
    } finally {
      setBusy(null);
    }
  }

  async function saveField(patch: Parameters<typeof saveCaseRecordFields>[1], label: string) {
    setBusy(label);
    try {
      await saveCaseRecordFields(protest.id, patch);
      onUpdate(patch as Partial<ProtestRecord>);
      toast.success("Saved to the case record.");
      setReloadKey((k) => k + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save this.");
    } finally {
      setBusy(null);
    }
  }

  const byStage = new Map<string, CaseRecordItem[]>();
  for (const it of items) {
    byStage.set(it.stage, [...(byStage.get(it.stage) ?? []), it]);
  }

  return (
    <div id="case-record" className="mt-4 card-elev p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-serif text-base font-semibold">Case Record</h2>
        <span className="text-xs text-muted-foreground">
          {onFile}/{applicable} on file
        </span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        The supporting documents and proof this case keeps on file, stage by stage.
      </p>

      {prompts.length > 0 && (
        <div className="mt-2 rounded-md border border-warning/40 bg-warning/10 p-3">
          <p className="text-xs font-semibold text-warning-foreground">
            Upload proof for the current stage
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {prompts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-warning-foreground">{p.label}</span>
                {p.fulfil === "document" && p.docType && (
                  <label className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full border border-accent/40 bg-background px-2.5 py-1 font-semibold text-accent hover:bg-accent/10">
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      multiple
                      disabled={busy === p.id}
                      className="hidden"
                      onChange={(e) => {
                        void uploadFor(p, Array.from(e.target.files ?? []));
                        e.target.value = "";
                      }}
                    />
                    {busy === p.id ? "Uploading…" : "Upload"}
                  </label>
                )}
                {p.fulfil === "field" && (
                  <span className="shrink-0 text-[11px] text-muted-foreground">Enter it below</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Field entry for the structured items */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-muted-foreground">
          Filing confirmation number
          <div className="mt-1 flex gap-1">
            <input
              value={confNum}
              onChange={(e) => setConfNum(e.target.value)}
              placeholder="Portal / email / clerk number"
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
            />
            <button
              type="button"
              disabled={busy === "conf" || confNum === (protest.filingConfirmationNumber ?? "")}
              onClick={() =>
                saveField(
                  {
                    filingConfirmationNumber: confNum,
                    ...(channel
                      ? {
                          filingChannel: channel as "online" | "mail" | "in_person" | "email",
                        }
                      : {}),
                  },
                  "conf",
                )
              }
              className="btn-outline shrink-0 text-xs disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          Filed by
          <select
            value={channel}
            onChange={(e) => {
              setChannel(e.target.value);
              if (e.target.value)
                saveField(
                  {
                    filingChannel: e.target.value as "online" | "mail" | "in_person" | "email",
                  },
                  "channel",
                );
            }}
            className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
          >
            <option value="">—</option>
            <option value="online">Online portal</option>
            <option value="mail">Mail</option>
            <option value="in_person">In person</option>
            <option value="email">Email</option>
          </select>
        </label>
        {(channel === "mail" || channel === "" || protest.filingChannel === "mail") && (
          <label className="text-xs font-medium text-muted-foreground">
            Certified-mail tracking number
            <div className="mt-1 flex gap-1">
              <input
                value={tracking}
                onChange={(e) => setTracking(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
              />
              <button
                type="button"
                disabled={busy === "tracking" || tracking === (protest.certifiedMailTracking ?? "")}
                onClick={() => saveField({ certifiedMailTracking: tracking }, "tracking")}
                className="btn-outline shrink-0 text-xs disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </label>
        )}
        {!protest.evidenceSubmittedConfirmedAt && stage !== "filing" && (
          <div className="text-xs font-medium text-muted-foreground">
            Evidence submitted to the ARB?
            <button
              type="button"
              disabled={busy === "evsub"}
              onClick={() =>
                saveField({ evidenceSubmittedConfirmedAt: new Date().toISOString() }, "evsub")
              }
              className="btn-outline mt-1 block text-xs disabled:opacity-50"
            >
              Yes — I submitted it before the deadline
            </button>
          </div>
        )}
      </div>

      {/* Full record, grouped by stage */}
      <div className="mt-4 space-y-3">
        {["filing", "informal", "hearing", "decision", "escalation", "resolved"]
          .filter((s) => (byStage.get(s) ?? []).length > 0)
          .map((s) => (
            <div key={s}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {RECORD_STAGE_LABEL[s]}
              </p>
              <ul className="mt-1 space-y-1">
                {(byStage.get(s) ?? []).map((it) => (
                  <li key={it.id} className="flex items-start gap-2 text-xs">
                    <span
                      className={
                        it.status === "on_file"
                          ? "text-success"
                          : it.status === "outstanding"
                            ? "text-warning-foreground"
                            : "text-muted-foreground"
                      }
                    >
                      {it.status === "on_file" ? "●" : it.status === "outstanding" ? "○" : "–"}
                    </span>
                    <span className="flex-1">
                      <span className="font-medium text-foreground">{it.label}</span>
                      <span className="text-muted-foreground"> — {it.detail}</span>
                    </span>
                    {it.status === "outstanding" && it.fulfil === "document" && it.docType && (
                      <label className="shrink-0 cursor-pointer text-accent hover:underline">
                        <input
                          type="file"
                          accept="image/*,.pdf"
                          multiple
                          disabled={busy === it.id}
                          className="hidden"
                          onChange={(e) => {
                            void uploadFor(it, Array.from(e.target.files ?? []));
                            e.target.value = "";
                          }}
                        />
                        {busy === it.id ? "Uploading…" : "Upload"}
                      </label>
                    )}
                    {it.status === "on_file" && it.fulfil === "document" && it.docType && (
                      <span className="flex shrink-0 items-center gap-2">
                        <label className="cursor-pointer text-accent hover:underline">
                          <input
                            type="file"
                            accept="image/*,.pdf"
                            disabled={busy === it.id}
                            className="hidden"
                            onChange={(e) => {
                              const files = Array.from(e.target.files ?? []);
                              e.target.value = "";
                              if (files.length === 0) return;
                              void removeLatestDocumentOfType(property.id, it.docType as string)
                                .then(() => uploadFor(it, files))
                                .catch((err) =>
                                  toast.error(getErrorMessage(err, "Could not replace it.")),
                                );
                            }}
                          />
                          Replace
                        </label>
                        <button
                          type="button"
                          disabled={busy === it.id}
                          onClick={() => {
                            if (
                              !window.confirm(`Remove the latest ${it.label.toLowerCase()} upload?`)
                            )
                              return;
                            void removeLatestDocumentOfType(property.id, it.docType as string)
                              .then((id) => {
                                if (id) toast.success("Removed — upload the right file.");
                                else
                                  toast.info("There's no uploaded file for this item to remove.");
                                setReloadKey((k) => k + 1);
                              })
                              .catch((err) =>
                                toast.error(getErrorMessage(err, "Could not remove it.")),
                              );
                          }}
                          className="text-destructive hover:underline"
                        >
                          Remove
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </div>
    </div>
  );
}

// Append-only audit trail for this case (public.case_audit_events) — every
// status change, document, form, signature, submission, deadline, county
// communication and value recorded, newest first. Plus a control to log a
// county call/email that has no other home.
export function CaseAuditTrailSection({ protestId }: { protestId: string }) {
  const [events, setEvents] = useState<CaseAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    getCaseAuditTrail(protestId)
      .then((e) => {
        if (live) setEvents(e);
      })
      .catch(() => {})
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [protestId, reloadKey]);

  async function logCommunication(e: FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    try {
      await logCaseEvent(protestId, "county_communication", note.trim());
      setNote("");
      setReloadKey((k) => k + 1);
      toast.success("Logged.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div id="case-audit-trail" className="mt-4 card-elev p-4">
      <h2 className="font-serif text-base font-semibold">Audit Trail</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Every change and county contact on this case, timestamped.
      </p>

      <form onSubmit={logCommunication} className="mt-2 flex gap-1">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Log a county call or email (who, when, what was said)"
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
        />
        <button
          type="submit"
          disabled={busy || !note.trim()}
          className="btn-outline shrink-0 text-xs disabled:opacity-50"
        >
          {busy ? "Logging…" : "Log"}
        </button>
      </form>

      {loading ? (
        <div className="mt-3 grid gap-2">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
      ) : events.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          No recorded events yet — case actions you take here are logged automatically.
        </p>
      ) : (
        <ol className="mt-3 space-y-2">
          {events.map((ev) => (
            <li key={ev.id} className="flex gap-2 text-xs">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              <span className="flex-1">
                <span className="text-foreground">{ev.summary}</span>
                <span className="block text-[10px] text-muted-foreground">
                  {caseAuditKindLabel(ev.kind)} ·{" "}
                  {new Date(ev.occurredAt).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function CaseProgress({
  protest,
  property,
  caseData,
  onUpdate,
  onPropertyUpdate,
}: {
  protest: ProtestRecord;
  property: PropertyRecord;
  caseData: ProtestCase | null;
  onUpdate: (patch: Partial<ProtestRecord>) => void;
  // Optional — only the real customer-facing case view (CaseDetailModal)
  // passes this; the admin panel's own CaseProgress usage
  // (AdminCaseProgressModal.tsx) works off a synthetic property stub with no
  // real update path, so it simply doesn't get the auto-refile toggle below.
  // Auto-refile is a customer self-service preference, not something staff
  // need to set on someone's behalf.
  onPropertyUpdate?: (patch: Partial<PropertyRecord>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [autoRefileSaving, setAutoRefileSaving] = useState(false);
  const [showOfferForm, setShowOfferForm] = useState(false);
  const [offerValue, setOfferValue] = useState("");
  const [offerDate, setOfferDate] = useState(new Date().toISOString().slice(0, 10));
  const [showHearingForm, setShowHearingForm] = useState(false);
  const [hearingDateInput, setHearingDateInput] = useState("");
  const [showHearingSummary, setShowHearingSummary] = useState(false);
  const [showDecisionForm, setShowDecisionForm] = useState(false);
  const [decisionType, setDecisionType] = useState<"approved" | "partial" | "denied">("partial");
  const [decisionDate, setDecisionDate] = useState(new Date().toISOString().slice(0, 10));
  const [decisionValue, setDecisionValue] = useState("");
  const [showCloseForm, setShowCloseForm] = useState(false);
  const [closeValue, setCloseValue] = useState("");

  async function submitOffer(e: FormEvent) {
    e.preventDefault();
    if (!offerValue) return;
    setBusy(true);
    try {
      const value = Number(offerValue);
      await recordSettlementOffer(protest.id, { value, receivedAt: offerDate });
      onUpdate({
        settlementOfferValue: value,
        settlementOfferReceivedAt: offerDate,
        status: "offer_received",
      });
      setShowOfferForm(false);
      toast.success("Settlement offer recorded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record this offer.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAcceptOffer() {
    if (protest.settlementOfferValue == null) return;
    setBusy(true);
    try {
      await acceptSettlement(protest.id, protest.settlementOfferValue);
      onUpdate({
        finalValue: protest.settlementOfferValue,
        escalationPath: "accept",
        closedAt: new Date().toISOString(),
        status: "resolved",
      });
      toast.success("Offer accepted — case closed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not accept this offer.");
    } finally {
      setBusy(false);
    }
  }

  async function submitHearing(e: FormEvent) {
    e.preventDefault();
    if (!hearingDateInput) return;
    setBusy(true);
    try {
      await scheduleHearing(protest.id, hearingDateInput);
      onUpdate({ hearingDate: hearingDateInput, status: "hearing_scheduled" });
      setShowHearingForm(false);
      toast.success("Hearing date recorded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record this hearing date.");
    } finally {
      setBusy(false);
    }
  }

  async function submitDecision(e: FormEvent) {
    e.preventDefault();
    if (!decisionValue) return;
    setBusy(true);
    try {
      const finalValue = Number(decisionValue);
      await recordArbDecision(protest.id, { type: decisionType, date: decisionDate, finalValue });
      const resolved = decisionType === "approved";
      onUpdate({
        arbDecision: decisionType,
        arbDecisionDate: decisionDate,
        finalValue,
        status: resolved ? "resolved" : "decision_received",
        ...(resolved ? { closedAt: new Date().toISOString(), escalationPath: "accept" } : {}),
      });
      setShowDecisionForm(false);
      toast.success("ARB decision recorded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record this decision.");
    } finally {
      setBusy(false);
    }
  }

  async function handleEscalate(path: "appeal" | "arbitration") {
    setBusy(true);
    try {
      await recordEscalation(protest.id, path);
      onUpdate({ escalationPath: path, status: path === "appeal" ? "appealing" : "arbitrating" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record this next step.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAcceptDecision() {
    if (protest.finalValue == null) return;
    setBusy(true);
    try {
      await acceptSettlement(protest.id, protest.finalValue);
      onUpdate({
        escalationPath: "accept",
        closedAt: new Date().toISOString(),
        status: "resolved",
      });
      toast.success("Decision accepted — case closed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not close this case.");
    } finally {
      setBusy(false);
    }
  }

  async function submitClose(e: FormEvent) {
    e.preventDefault();
    if (!closeValue) return;
    setBusy(true);
    try {
      const finalValue = Number(closeValue);
      await closeCase(protest.id, finalValue);
      onUpdate({ finalValue, closedAt: new Date().toISOString(), status: "resolved" });
      setShowCloseForm(false);
      toast.success("Case closed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not close this case.");
    } finally {
      setBusy(false);
    }
  }

  const results = getCaseResults(protest, property);

  async function handleToggleAutoRefile(enabled: boolean) {
    setAutoRefileSaving(true);
    try {
      const updated = await setAutoRefile(property.id, enabled);
      onPropertyUpdate?.({
        autoRefile: updated.autoRefile,
        autoRefileAuthorizedAt: updated.autoRefileAuthorizedAt,
      });
      toast.success(enabled ? "Auto re-file turned on." : "Auto re-file turned off.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update auto re-file.");
    } finally {
      setAutoRefileSaving(false);
    }
  }

  return (
    <div id="case-progress" className="mt-4 card-elev p-4">
      <h2 className="font-serif text-base font-semibold">Case Progress</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Record what has happened — settlement offers, the hearing date, the ARB&apos;s decision.
      </p>
      <CountyRecordPanel protestId={protest.id} />

      {protest.status === "resolved" ? (
        results ? (
          <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
            <Field label="Original Value" value={currency(protest.originalValue ?? undefined)} />
            <Field label="Final Value" value={currency(protest.finalValue ?? undefined)} />
            <Field label="Value Reduction" value={currency(results.valueReduction)} bold />
            <Field
              label="Actual Tax Savings"
              value={currency(results.actualSavings)}
              bold
              success
            />
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Case closed — no final value on file.
          </p>
        )
      ) : null}

      {protest.status === "resolved" && onPropertyUpdate && (
        <label className="mt-4 flex items-start gap-2.5 rounded-md border border-border p-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={!!property.autoRefile}
            disabled={autoRefileSaving}
            onChange={(e) => handleToggleAutoRefile(e.target.checked)}
          />
          <span>
            <span className="font-medium">Auto re-file next year</span>
            {property.autoRefile && property.autoRefileAuthorizedAt && (
              <span className="text-muted-foreground">
                {" "}
                — authorized {new Date(property.autoRefileAuthorizedAt).toLocaleDateString()}
              </span>
            )}
            <span className="block text-xs text-muted-foreground">
              When on, CorvusPT automatically starts next year&apos;s protest once the new tax
              year's cycle begins — no action needed from you beyond signing the actual Notice of
              Protest when it's ready. Off by default; turn it off any time.
            </span>
          </span>
        </label>
      )}

      {protest.status !== "resolved" && (
        <div className="mt-3 grid gap-4">
          {/* Settlement offer */}
          {protest.status === "offer_received" ? (
            <div className="rounded-md border border-border p-3 text-sm">
              <div className="font-medium">
                Settlement offer: {currency(protest.settlementOfferValue ?? undefined)}
                {protest.settlementOfferReceivedAt && ` (${protest.settlementOfferReceivedAt})`}
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={handleAcceptOffer}
                  disabled={busy}
                  className="btn-accent text-xs py-1.5 disabled:opacity-60"
                >
                  Accept Offer
                </button>
                <span className="text-xs text-muted-foreground self-center">
                  or schedule a hearing below to proceed instead
                </span>
              </div>
              {protest.settlementOfferValue != null && (
                <div className="mt-3">
                  <SettlementHistory
                    compact
                    cad={property.cad}
                    propertyType={property.propertyType}
                    value={protest.originalValue ?? property.totalValue}
                    offer={
                      protest.originalValue
                        ? { original: protest.originalValue, offer: protest.settlementOfferValue }
                        : null
                    }
                  />
                </div>
              )}
            </div>
          ) : (
            protest.status !== "decision_received" &&
            protest.status !== "appealing" &&
            protest.status !== "arbitrating" && (
              <div>
                {showOfferForm ? (
                  <form
                    onSubmit={submitOffer}
                    className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end"
                  >
                    <label className="grid gap-1 text-xs">
                      Offer amount<span className="text-destructive"> *</span>
                      <input
                        required
                        value={offerValue}
                        onChange={(e) => setOfferValue(e.target.value)}
                        inputMode="decimal"
                        className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                      />
                    </label>
                    <label className="grid gap-1 text-xs">
                      Date received<span className="text-destructive"> *</span>
                      <input
                        required
                        type="date"
                        value={offerDate}
                        onChange={(e) => setOfferDate(e.target.value)}
                        className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={busy}
                      className="btn-accent text-xs py-1.5 disabled:opacity-60"
                    >
                      Save
                    </button>
                  </form>
                ) : (
                  <button
                    onClick={() => setShowOfferForm(true)}
                    className="btn-outline text-xs py-1.5"
                  >
                    Record Settlement Offer
                  </button>
                )}
              </div>
            )
          )}

          {/* Hearing */}
          {(protest.status === "hearing_scheduled" ||
            (protest.status !== "decision_received" &&
              protest.status !== "appealing" &&
              protest.status !== "arbitrating")) && (
            <div>
              {protest.status === "hearing_scheduled" ? (
                <div className="rounded-md border border-border p-3 text-sm">
                  <div className="font-medium">Hearing scheduled: {protest.hearingDate}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      onClick={() => setShowHearingSummary((v) => !v)}
                      className="btn-outline text-xs py-1.5"
                    >
                      {showHearingSummary ? "Hide" : "View"} Hearing Summary
                    </button>
                    <button
                      onClick={() => setShowDecisionForm((v) => !v)}
                      className="btn-outline text-xs py-1.5"
                    >
                      Record ARB Decision
                    </button>
                  </div>
                  {showHearingSummary && caseData && (
                    <pre className="mt-3 whitespace-pre-wrap rounded-md bg-secondary/40 p-3 text-xs">
                      {getHearingPrep(caseData, property.address)}
                    </pre>
                  )}
                  {showDecisionForm && (
                    <form onSubmit={submitDecision} className="mt-3 grid gap-2 sm:grid-cols-2">
                      <label className="grid gap-1 text-xs">
                        Decision
                        <select
                          value={decisionType}
                          onChange={(e) => setDecisionType(e.target.value as typeof decisionType)}
                          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                        >
                          <option value="approved">Approved (full reduction granted)</option>
                          <option value="partial">Partial reduction</option>
                          <option value="denied">Denied</option>
                        </select>
                      </label>
                      <label className="grid gap-1 text-xs">
                        Decision date<span className="text-destructive"> *</span>
                        <input
                          required
                          type="date"
                          value={decisionDate}
                          onChange={(e) => setDecisionDate(e.target.value)}
                          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                        />
                      </label>
                      <label className="grid gap-1 text-xs sm:col-span-2">
                        Final determined value<span className="text-destructive"> *</span>
                        <input
                          required
                          value={decisionValue}
                          onChange={(e) => setDecisionValue(e.target.value)}
                          inputMode="decimal"
                          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={busy}
                        className="btn-accent text-xs py-1.5 w-fit disabled:opacity-60"
                      >
                        Save Decision
                      </button>
                    </form>
                  )}
                </div>
              ) : (
                <div>
                  {showHearingForm ? (
                    <form onSubmit={submitHearing} className="flex flex-wrap items-end gap-2">
                      <label className="grid gap-1 text-xs">
                        Hearing date<span className="text-destructive"> *</span>
                        <input
                          required
                          type="date"
                          value={hearingDateInput}
                          onChange={(e) => setHearingDateInput(e.target.value)}
                          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={busy}
                        className="btn-accent text-xs py-1.5 disabled:opacity-60"
                      >
                        Save
                      </button>
                    </form>
                  ) : (
                    <button
                      onClick={() => setShowHearingForm(true)}
                      className="btn-outline text-xs py-1.5"
                    >
                      Schedule a Hearing
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Decision received, non-approved — next steps */}
          {protest.status === "decision_received" && (
            <div className="rounded-md border border-border p-3 text-sm">
              <div className="font-medium">
                ARB decision: {protest.arbDecision} — final value{" "}
                {currency(protest.finalValue ?? undefined)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">What's next?</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={handleAcceptDecision}
                  disabled={busy}
                  className="btn-accent text-xs py-1.5 disabled:opacity-60"
                >
                  Accept
                </button>
                <button
                  onClick={() => handleEscalate("appeal")}
                  disabled={busy}
                  className="btn-outline text-xs py-1.5 disabled:opacity-60"
                >
                  File Judicial Appeal
                </button>
                <button
                  onClick={() => handleEscalate("arbitration")}
                  disabled={busy}
                  className="btn-outline text-xs py-1.5 disabled:opacity-60"
                >
                  Request Binding Arbitration
                </button>
              </div>
            </div>
          )}

          {/* Appealing / arbitrating */}
          {(protest.status === "appealing" || protest.status === "arbitrating") && (
            <div className="rounded-md border border-border p-3 text-sm">
              <div className="font-medium">
                {protest.status === "appealing"
                  ? "Judicial appeal in progress."
                  : "Binding arbitration in progress."}
              </div>
              {protest.status === "arbitrating" ? (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Texas requires agents to file a Request for Binding Arbitration online, not on
                  paper — file at{" "}
                  <a
                    href="https://www.texas.gov/propertytaxarbitration"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline"
                  >
                    texas.gov/propertytaxarbitration
                  </a>
                  . A deposit is required with the request (refunded if the arbitrator's value lands
                  closer to the owner's opinion of value than the ARB's).
                </p>
              ) : (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  A judicial appeal is a lawsuit filed in district court (Tax Code Chapter 42), not
                  a Comptroller form — it typically requires an attorney and isn't something this
                  app files. See the Comptroller's{" "}
                  <a
                    href="https://comptroller.texas.gov/taxes/property-tax/protests/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline"
                  >
                    Appraisal Protests and Appeals
                  </a>{" "}
                  overview for background.
                </p>
              )}
              {showCloseForm ? (
                <form onSubmit={submitClose} className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="grid gap-1 text-xs">
                    Final determined value<span className="text-destructive"> *</span>
                    <input
                      required
                      value={closeValue}
                      onChange={(e) => setCloseValue(e.target.value)}
                      inputMode="decimal"
                      className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={busy}
                    className="btn-accent text-xs py-1.5 disabled:opacity-60"
                  >
                    Save
                  </button>
                </form>
              ) : (
                <button
                  onClick={() => setShowCloseForm(true)}
                  className="btn-outline text-xs py-1.5 mt-2"
                >
                  Record Final Outcome
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
