// Formal Hearing tab: hearing notice, hearing prep and the ARB decision document (split out of CaseDetailModal.tsx).
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MarkdownLite } from "@/components/MarkdownLite";
import { type PropertyRecord } from "@/lib/properties";
import { type ProtestRecord, type AttendanceType } from "@/lib/protests";
import { currency } from "@/lib/intake-store";
import {
  scheduleHearing,
  recordArbDecision,
  saveAttendanceType,
  type ProtestCase,
} from "@/lib/protest-case";
import { getCountyProtestInfo } from "@/lib/county-protest-info";
import { uploadDocument, DECISION_DOCUMENT_TYPE, type DocumentRecord } from "@/lib/documents";
import {
  extractHearingNotice,
  saveHearingNotice,
  getLatestHearingNotice,
  type HearingNoticeRecord,
  type HearingNoticeExtraction,
} from "@/lib/hearing-notice";
import { getHearingPrepGuide, type HearingPrepGuide } from "@/lib/hearing-prep";
import { getHearingUserStatus, type HearingUserStatus } from "@/lib/hearing-status";
import {
  extractDecisionDocument,
  saveDecisionNotice,
  getLatestDecisionNotice,
  type DecisionNoticeRecord,
  type DecisionExtraction,
  documentMismatch,
  ARB_DECISION_CATEGORIES,
} from "@/lib/decision-notice";
import { type SettlementAgreementRecord } from "@/lib/settlement-agreement";
import { getEffectiveTaxRate } from "@/lib/texas-tax-rates";
import { getErrorMessage } from "@/lib/error-message";
import { UploadedDocBar } from "@/components/UploadedDocBar";
import { removeDecisionNotice, removeHearingNotice } from "@/lib/upload-undo";
import { Field, InformalOutcomeBanner } from "@/components/case/shared";

// "Once the protest has been filed" — real AI extraction from the actual
// hearing notice (or other county notice) the user uploads, cross-checked
// against the case's own known facts (see extract-hearing-notice's own
// deterministic discrepancy check), and — once a real hearing date is on
// it — fed straight into scheduleHearing() so it shows up wherever this
// app's calendar sync already reads hearing_date/time/location from (the
// webcal feed and the real Google Calendar sync both pick it up on their
// own next pass, no separate calendar code needed here).
const HEARING_NOTICE_DOCUMENT_TYPE = "Hearing Notice";

export function HearingNoticeSection({
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
  const [notice, setNotice] = useState<HearingNoticeRecord | null>(null);
  const [loadingNotice, setLoadingNotice] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pending, setPending] = useState<HearingNoticeExtraction | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getLatestHearingNotice(protest.id)
      .then(setNotice)
      .catch((err) => console.error("Could not load hearing notice:", err))
      .finally(() => setLoadingNotice(false));
  }, [protest.id]);

  const countyInfo = getCountyProtestInfo(property.cad);

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const extraction = await extractHearingNotice(property, file, countyInfo);
      setPending(extraction);
      setPendingFile(file);
    } catch (err) {
      setUploadError(getErrorMessage(err, "Could not read this notice. Please try again."));
    } finally {
      setUploading(false);
    }
  }

  async function handleConfirm() {
    if (!pending) return;
    setSaving(true);
    try {
      let documentId: string | null = null;
      if (pendingFile) {
        const doc = await uploadDocument(
          userId,
          property.id,
          pendingFile,
          HEARING_NOTICE_DOCUMENT_TYPE,
        );
        documentId = doc.id;
      }
      const saved = await saveHearingNotice(userId, protest.id, documentId, pending);
      setNotice(saved);
      setPending(null);
      setPendingFile(null);
      // Only advances the case (and, by extension, the calendar) when the
      // notice actually stated a real hearing date — a notice that's
      // something else entirely (an exemption denial, a value notice)
      // still saves for its own record, but doesn't invent a hearing.
      if (pending.hearingDate) {
        await scheduleHearing(protest.id, pending.hearingDate, {
          time: pending.hearingTime,
          location: pending.hearingLocation,
          mode: pending.hearingMode,
        });
        onUpdate({
          hearingDate: pending.hearingDate,
          hearingTime: pending.hearingTime,
          hearingLocation: pending.hearingLocation,
          hearingMode: pending.hearingMode,
          status: "hearing_scheduled",
        });
      }
      toast.success("Hearing notice saved.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save this notice."));
    } finally {
      setSaving(false);
    }
  }

  function handleDiscard() {
    setPending(null);
    setPendingFile(null);
    setUploadError(null);
  }

  if (loadingNotice) return null;

  const uploadLabel = notice ? "Upload an Updated Notice" : "Upload Hearing Notice";
  const uploadButton = (
    <label
      className={`inline-flex ${notice ? "btn-outline" : "btn-accent"} cursor-pointer text-xs py-1.5 ${uploading ? "pointer-events-none opacity-60" : ""}`}
    >
      {uploading ? "Reading your notice…" : uploadLabel}
      <input
        type="file"
        accept="image/*,.pdf"
        className="hidden"
        disabled={uploading}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) handleUpload(file);
        }}
      />
    </label>
  );

  return (
    <div id="case-hearing-notice" className="mt-5 border-t border-border pt-5">
      <h2 className="text-sm font-semibold">Hearing Notice</h2>

      {!notice && !pending && (
        <div className="mt-2 rounded-md border border-accent/30 bg-accent/5 p-3 text-sm">
          <p className="font-medium">Next Step</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Upload the hearing notice or other notice received from the county. AI will read it,
            check it against your case, and — if it states a real hearing date — get it onto your
            calendar.
          </p>
          <div className="mt-2">{uploadButton}</div>
          {uploadError && <p className="mt-2 text-xs text-destructive">{uploadError}</p>}
        </div>
      )}

      {!pending && notice && (
        <div className="mt-2 rounded-md border border-border p-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="grid gap-2 sm:grid-cols-2 text-xs">
              <Field label="Hearing Date" value={notice.hearingDate ?? "Not stated"} />
              <Field label="Hearing Time" value={notice.hearingTime ?? "Not stated"} />
              <Field label="Hearing Location" value={notice.hearingLocation ?? "Not stated"} />
              <Field label="Hearing Mode" value={notice.hearingMode} />
              <Field
                label="Evidence Submission Deadline"
                value={notice.evidenceSubmissionDeadline ?? "Not stated"}
              />
              <Field
                label="Appeal/Escalation Deadline"
                value={notice.appealDeadline ?? "Not stated"}
              />
              <Field label="County Contact" value={notice.countyContact ?? "Not stated"} />
              <Field label="Appraiser/Contact" value={notice.appraiserContact ?? "Not stated"} />
            </div>
          </div>
          <UploadedDocBar
            label="Hearing notice"
            busy={uploading}
            onReplace={(file) => handleUpload(file)}
            removeConfirm="This removes the notice and the hearing date it added to your case and calendar."
            onRemove={async () => {
              const { patch, previous } = await removeHearingNotice(protest, notice);
              setNotice(previous);
              if (Object.keys(patch).length > 0) onUpdate(patch);
            }}
          />
          {notice.discrepancies.length > 0 && (
            <div className="mt-3 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
              <span className="font-semibold">Discrepancies flagged:</span>
              <ul className="mt-1 grid gap-0.5">
                {notice.discrepancies.map((d, i) => (
                  <li key={i}>• {d}</li>
                ))}
              </ul>
            </div>
          )}
          {notice.submissionInstructions && (
            <div className="mt-3 text-xs">
              <div className="font-semibold text-foreground">Submission Instructions</div>
              <p className="text-muted-foreground">{notice.submissionInstructions}</p>
            </div>
          )}
          {notice.requiredDocuments.length > 0 && (
            <div className="mt-2 text-xs">
              <div className="font-semibold text-foreground">Required Documents</div>
              <ul className="mt-0.5 grid gap-0.5 text-muted-foreground">
                {notice.requiredDocuments.map((d, i) => (
                  <li key={i}>• {d}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-3 rounded-md bg-secondary/40 p-2 text-xs">
            <div className="font-semibold">Informal Review: {notice.informalReviewAvailable}</div>
            <p className="mt-0.5 text-muted-foreground">{notice.proceduralDifferences}</p>
          </div>
          {uploadError && <p className="mt-2 text-xs text-destructive">{uploadError}</p>}
        </div>
      )}

      {pending && (
        <div className="mt-2 rounded-md border border-accent/40 bg-accent/5 p-3 text-sm">
          <p className="font-medium">Review before saving</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Confirm this looks right — discard and re-upload if the wrong file was read.
          </p>
          {pending.discrepancies.length > 0 && (
            <div className="mt-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
              <span className="font-semibold">Discrepancies found:</span>
              <ul className="mt-1 grid gap-0.5">
                {pending.discrepancies.map((d, i) => (
                  <li key={i}>• {d}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-3 grid gap-2 sm:grid-cols-2 text-xs">
            <Field label="Hearing Date" value={pending.hearingDate ?? "Not stated"} />
            <Field label="Hearing Time" value={pending.hearingTime ?? "Not stated"} />
            <Field label="Hearing Location" value={pending.hearingLocation ?? "Not stated"} />
            <Field label="Hearing Mode" value={pending.hearingMode} />
            <Field label="Hearing Type" value={pending.hearingType ?? "Not stated"} />
            <Field
              label="Evidence Submission Deadline"
              value={pending.evidenceSubmissionDeadline ?? "Not stated"}
            />
            <Field
              label="Appeal/Escalation Deadline"
              value={pending.appealDeadline ?? "Not stated"}
            />
            <Field
              label="Account Number (on notice)"
              value={pending.accountNumber ?? "Not stated"}
            />
            <Field label="Tax Year (on notice)" value={pending.taxYear ?? "Not stated"} />
            <Field
              label="Property Address (on notice)"
              value={pending.propertyAddress ?? "Not stated"}
            />
            <Field label="County Contact" value={pending.countyContact ?? "Not stated"} />
            <Field label="Appraiser/Contact" value={pending.appraiserContact ?? "Not stated"} />
          </div>
          {pending.submissionInstructions && (
            <div className="mt-2 text-xs">
              <div className="font-semibold text-foreground">Submission Instructions</div>
              <p className="text-muted-foreground">{pending.submissionInstructions}</p>
            </div>
          )}
          {pending.requiredDocuments.length > 0 && (
            <div className="mt-2 text-xs">
              <div className="font-semibold text-foreground">Required Documents</div>
              <ul className="mt-0.5 grid gap-0.5 text-muted-foreground">
                {pending.requiredDocuments.map((d, i) => (
                  <li key={i}>• {d}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-3 rounded-md bg-secondary/40 p-2 text-xs">
            <div className="font-semibold">Informal Review: {pending.informalReviewAvailable}</div>
            <p className="mt-0.5 text-muted-foreground">{pending.proceduralDifferences}</p>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={handleConfirm}
              disabled={saving}
              className="btn-accent text-xs py-1.5 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Confirm & Save"}
            </button>
            <button
              onClick={handleDiscard}
              disabled={saving}
              className="btn-outline text-xs py-1.5"
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function GuideText({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  if (!value) return null;
  return (
    <div className="mt-2">
      <div className="text-xs font-semibold text-foreground">{label}</div>
      <MarkdownLite
        text={value}
        className={`mt-0.5 text-muted-foreground ${bold ? "font-medium text-foreground" : ""}`}
      />
    </div>
  );
}

function GuideList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2">
      <div className="text-xs font-semibold text-foreground">{label}</div>
      <ul className="mt-0.5 grid gap-0.5 text-muted-foreground">
        {items.map((item, i) => (
          <li key={i}>• {item}</li>
        ))}
      </ul>
    </div>
  );
}

const HEARING_STATUS_STYLE: Record<HearingUserStatus, string> = {
  "Hearing Scheduled": "bg-secondary text-foreground",
  "No Action Needed": "bg-secondary text-muted-foreground",
  "Upload Documents": "bg-amber-500/15 text-amber-700",
  "Attend Hearing": "bg-accent/15 text-accent",
};

const ATTENDANCE_TYPES: AttendanceType[] = ["Property Owner", "Authorized Agent", "Both"];

// The real, step-by-step ARB hearing prep guide — see hearing-prep.ts /
// hearing-prep-guide/index.ts for how it's grounded. Only shown once a
// hearing is actually scheduled; before that there's nothing real yet to
// prepare for.
export function HearingPrepSection({
  protest,
  property,
  caseData,
  evidenceDocuments,
  settlementAgreement,
  onUpdate,
}: {
  protest: ProtestRecord;
  property: PropertyRecord;
  caseData: ProtestCase | null;
  evidenceDocuments: DocumentRecord[];
  settlementAgreement: SettlementAgreementRecord | null;
  onUpdate: (patch: Partial<ProtestRecord>) => void;
}) {
  const [notice, setNotice] = useState<HearingNoticeRecord | null>(null);
  const [loadingNotice, setLoadingNotice] = useState(true);
  const [guide, setGuide] = useState<HearingPrepGuide | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [savingAttendance, setSavingAttendance] = useState(false);

  useEffect(() => {
    getLatestHearingNotice(protest.id)
      .then(setNotice)
      .catch((err) => console.error("Could not load hearing notice for prep guide:", err))
      .finally(() => setLoadingNotice(false));
  }, [protest.id]);

  const countyInfo = getCountyProtestInfo(property.cad);
  const hearingStatus = getHearingUserStatus(protest, !!notice, evidenceDocuments.length);

  async function handleGenerate() {
    setGenerating(true);
    setGenError(null);
    try {
      const result = await getHearingPrepGuide(
        property,
        protest,
        caseData?.strategyRecommendation ?? null,
        caseData?.strategyRationale ?? null,
        countyInfo,
        notice,
        evidenceDocuments.map((d) => d.fileName),
        null,
      );
      setGuide(result);
    } catch (err) {
      setGenError(
        getErrorMessage(err, "Could not generate your hearing prep guide. Please try again."),
      );
    } finally {
      setGenerating(false);
    }
  }

  async function handleAttendanceChange(value: AttendanceType) {
    setSavingAttendance(true);
    try {
      await saveAttendanceType(protest.id, value);
      onUpdate({ attendanceType: value });
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save who's attending."));
    } finally {
      setSavingAttendance(false);
    }
  }

  if (protest.status !== "hearing_scheduled" || loadingNotice) return null;

  return (
    <div id="case-hearing-prep" className="mt-5 border-t border-border pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Hearing Preparation</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${HEARING_STATUS_STYLE[hearingStatus]}`}
        >
          {hearingStatus}
        </span>
      </div>

      <InformalOutcomeBanner protest={protest} agreement={settlementAgreement} inline />

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Who&apos;s attending:</span>
        {ATTENDANCE_TYPES.map((opt) => (
          <button
            key={opt}
            onClick={() => handleAttendanceChange(opt)}
            disabled={savingAttendance}
            className={`rounded-full border px-2 py-1 ${
              protest.attendanceType === opt
                ? "border-accent bg-accent/10 text-accent"
                : "border-border text-muted-foreground"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>

      {(protest.attendanceType === "Authorized Agent" || protest.attendanceType === "Both") && (
        <div className="mt-2 rounded-md border border-border p-2.5 text-xs">
          {protest.assignedRepresentative ? (
            <>
              <span className="font-medium">Your CorvusPT representative: </span>
              {protest.assignedRepresentative}
              {protest.assignedRepSetAt && (
                <span className="text-muted-foreground">
                  {" "}
                  (assigned {new Date(protest.assignedRepSetAt).toLocaleDateString()})
                </span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">
              CorvusPT is assigning a representative for this hearing — check back before your
              hearing date.
            </span>
          )}
        </div>
      )}

      {!guide && (
        <div className="mt-3">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="btn-accent text-xs py-1.5 disabled:opacity-60"
          >
            {generating ? "Preparing your guide…" : "Generate Hearing Prep Guide"}
          </button>
          {genError && <p className="mt-2 text-xs text-destructive">{genError}</p>}
        </div>
      )}

      {guide && (
        <div className="mt-3 grid gap-4 text-sm">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="btn-outline w-fit text-xs py-1.5 disabled:opacity-60"
          >
            {generating ? "Regenerating…" : "Regenerate Guide"}
          </button>

          <div>
            <div className="font-semibold">Hearing Summary</div>
            <MarkdownLite className="mt-1 text-muted-foreground" text={guide.hearingSummary} />
          </div>

          {guide.evidencePacketNote && (
            <div className="rounded-md bg-secondary/40 p-2 text-xs">
              <div className="font-semibold">Evidence Packet</div>
              <MarkdownLite className="mt-0.5" text={guide.evidencePacketNote} />
            </div>
          )}

          <div className="rounded-md border border-border p-3">
            <div className="font-semibold text-accent">Step 1 — Before the Hearing</div>
            <GuideList label="What to review" items={guide.beforeHearing.whatToReview} />
            <GuideList
              label="Documents to have ready"
              items={guide.beforeHearing.documentsToHaveReady}
            />
            <GuideText label="Value to request" value={guide.beforeHearing.valueToRequest} />
            <GuideList label="Key evidence" items={guide.beforeHearing.keyEvidence} />
            <GuideText
              label="How to organize your evidence"
              value={guide.beforeHearing.howToOrganize}
            />
            <GuideText label="Preparing for questions" value={guide.beforeHearing.questionPrep} />
          </div>

          <div className="rounded-md border border-border p-3">
            <div className="font-semibold text-accent">Step 2 — During the Hearing</div>
            <GuideText label="Opening statement" value={guide.duringHearing.openingStatement} />
            <GuideText
              label="Property/value explanation"
              value={guide.duringHearing.valueExplanation}
            />
            <GuideText
              label="Presenting comparable evidence"
              value={guide.duringHearing.comparableEvidencePresentation}
            />
            <GuideText
              label="Condition/obsolescence arguments"
              value={guide.duringHearing.conditionArguments}
            />
            <GuideText label="Requested value" value={guide.duringHearing.requestedValue} bold />
            <GuideText label="Closing statement" value={guide.duringHearing.closingStatement} />
          </div>

          <GuideList label="Property-specific arguments" items={guide.propertySpecificArguments} />
          <GuideList label="Questions to ask" items={guide.questionsToAsk} />
          <GuideList label="Questions the ARB/appraiser may ask" items={guide.questionsArbMayAsk} />
          <GuideList label="Weaknesses & risk notes" items={guide.weaknessesAndRisks} />
          <GuideList label="Documents to have available" items={guide.documentsToHave} />
          <GuideText label="Submission instructions" value={guide.submissionInstructions} />
          <GuideText label="County contact" value={guide.countyContact} />
          <GuideText label="Hearing logistics" value={guide.hearingLogistics} />

          <p className="text-xs italic text-muted-foreground">{guide.disclaimer}</p>
        </div>
      )}
    </div>
  );
}

// After the hearing: upload the ARB Order / hearing decision / settlement /
// revised value notice / other final determination, AI extracts the real
// facts, and confirming applies them to the case via the SAME
// recordArbDecision() CaseProgress's own manual form already uses — this is
// an AI-assisted entry path into that one real mechanism, not a second one.
// decisionType (approved/partial/denied) is deliberately computed HERE from
// the real original/final values, never trusted from the model's own read
// of the document, same discipline as every other derived fact in this app.
export function DecisionNoticeSection({
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
  const [notice, setNotice] = useState<DecisionNoticeRecord | null>(null);
  const [loadingNotice, setLoadingNotice] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pending, setPending] = useState<DecisionExtraction | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getLatestDecisionNotice(protest.id)
      .then(setNotice)
      .catch((err) => console.error("Could not load decision notice:", err))
      .finally(() => setLoadingNotice(false));
  }, [protest.id]);

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const extraction = await extractDecisionDocument(property, protest, file);
      const wrong = documentMismatch(
        extraction,
        property,
        ARB_DECISION_CATEGORIES,
        "an ARB order or hearing decision",
      );
      if (wrong) {
        setUploadError(wrong);
        return;
      }
      setPending(extraction);
      setPendingFile(file);
    } catch (err) {
      setUploadError(getErrorMessage(err, "Could not read this document. Please try again."));
    } finally {
      setUploading(false);
    }
  }

  async function handleConfirm() {
    if (!pending) return;
    setSaving(true);
    try {
      let documentId: string | null = null;
      if (pendingFile) {
        const doc = await uploadDocument(userId, property.id, pendingFile, DECISION_DOCUMENT_TYPE);
        documentId = doc.id;
      }
      const saved = await saveDecisionNotice(userId, protest.id, documentId, pending);
      setNotice(saved);
      setPending(null);
      setPendingFile(null);

      if (pending.finalValue != null) {
        const decisionType: "partial" | "denied" =
          pending.originalValue != null && pending.finalValue < pending.originalValue
            ? "partial"
            : "denied";
        const decisionDate = pending.decisionDate ?? new Date().toISOString().slice(0, 10);
        await recordArbDecision(protest.id, {
          type: decisionType,
          date: decisionDate,
          finalValue: pending.finalValue,
        });
        onUpdate({
          arbDecision: decisionType,
          arbDecisionDate: decisionDate,
          finalValue: pending.finalValue,
          status: "decision_received",
        });
      }
      toast.success("Decision document saved.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save this document."));
    } finally {
      setSaving(false);
    }
  }

  function handleDiscard() {
    setPending(null);
    setPendingFile(null);
    setUploadError(null);
  }

  if (loadingNotice) return null;
  if (
    protest.status !== "hearing_scheduled" &&
    protest.status !== "decision_received" &&
    protest.status !== "resolved"
  )
    return null;

  const uploadLabel = notice ? "Upload an Updated Decision Document" : "Upload Decision Document";
  const uploadButton = (
    <label
      className={`inline-flex ${notice ? "btn-outline" : "btn-accent"} cursor-pointer text-xs py-1.5 ${uploading ? "pointer-events-none opacity-60" : ""}`}
    >
      {uploading ? "Reading your document…" : uploadLabel}
      <input
        type="file"
        accept="image/*,.pdf"
        className="hidden"
        disabled={uploading}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) handleUpload(file);
        }}
      />
    </label>
  );

  const reduction =
    protest.originalValue != null && protest.finalValue != null
      ? protest.originalValue - protest.finalValue
      : null;
  const savings =
    reduction != null && reduction > 0 ? reduction * getEffectiveTaxRate(property.cad) : null;

  return (
    <div id="case-decision-notice" className="mt-5 border-t border-border pt-5">
      <h2 className="text-sm font-semibold">Hearing Decision</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        After your hearing, upload the ARB Order, hearing decision, settlement, revised value
        notice, or other final determination you receive.
      </p>

      {!notice && !pending && (
        <div className="mt-2">
          {uploadButton}
          {uploadError && <p className="mt-2 text-xs text-destructive">{uploadError}</p>}
        </div>
      )}

      {!pending && notice && (
        <div className="mt-2 rounded-md border border-border p-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="grid gap-2 sm:grid-cols-2 text-xs">
              <Field label="Document Type" value={notice.documentCategory} />
              <Field label="Decision Date" value={notice.decisionDate ?? "Not stated"} />
              <Field
                label="Original Value"
                value={notice.originalValue != null ? currency(notice.originalValue) : "Not stated"}
              />
              <Field
                label="Final Value"
                value={notice.finalValue != null ? currency(notice.finalValue) : "Not stated"}
              />
              <Field label="Appeal Deadline" value={notice.appealDeadline ?? "Not stated"} />
              <Field label="Refund" value={notice.refundIndicator ?? "Not stated"} />
            </div>
          </div>
          <UploadedDocBar
            label="Decision document"
            busy={uploading}
            onReplace={(file) => handleUpload(file)}
            removeConfirm="This removes the document and the decision it recorded — your case goes back to the formal hearing."
            onRemove={async () => {
              const patch = await removeDecisionNotice(protest, notice);
              setNotice(null);
              if (Object.keys(patch).length > 0) onUpdate(patch);
            }}
          />
          {notice.discrepancies.length > 0 && (
            <div className="mt-3 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
              <span className="font-semibold">Discrepancies flagged:</span>
              <ul className="mt-1 grid gap-0.5">
                {notice.discrepancies.map((d, i) => (
                  <li key={i}>• {d}</li>
                ))}
              </ul>
            </div>
          )}
          {notice.settlementTerms && (
            <div className="mt-3 text-xs">
              <div className="font-semibold text-foreground">Terms</div>
              <p className="text-muted-foreground">{notice.settlementTerms}</p>
            </div>
          )}
          {notice.otherConditions && (
            <div className="mt-2 text-xs">
              <div className="font-semibold text-foreground">Other Conditions</div>
              <p className="text-muted-foreground">{notice.otherConditions}</p>
            </div>
          )}
        </div>
      )}

      {pending && (
        <div className="mt-2 rounded-md border border-accent/40 bg-accent/5 p-3 text-sm">
          <p className="font-medium">Review before saving</p>
          {pending.discrepancies.length > 0 && (
            <div className="mt-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
              <span className="font-semibold">Discrepancies found:</span>
              <ul className="mt-1 grid gap-0.5">
                {pending.discrepancies.map((d, i) => (
                  <li key={i}>• {d}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-3 grid gap-2 sm:grid-cols-2 text-xs">
            <Field label="Document Type" value={pending.documentCategory} />
            <Field label="Decision Date" value={pending.decisionDate ?? "Not stated"} />
            <Field
              label="Original Value"
              value={pending.originalValue != null ? currency(pending.originalValue) : "Not stated"}
            />
            <Field
              label="Final Value"
              value={pending.finalValue != null ? currency(pending.finalValue) : "Not stated"}
            />
            <Field label="Tax Year (on document)" value={pending.taxYear ?? "Not stated"} />
            <Field
              label="Account Number (on document)"
              value={pending.accountNumber ?? "Not stated"}
            />
            <Field label="Appeal Deadline" value={pending.appealDeadline ?? "Not stated"} />
            <Field label="Refund" value={pending.refundIndicator ?? "Not stated"} />
          </div>
          {pending.settlementTerms && (
            <div className="mt-2 text-xs">
              <div className="font-semibold text-foreground">Terms</div>
              <p className="text-muted-foreground">{pending.settlementTerms}</p>
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button
              onClick={handleConfirm}
              disabled={saving}
              className="btn-accent text-xs py-1.5 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Confirm & Save"}
            </button>
            <button
              onClick={handleDiscard}
              disabled={saving}
              className="btn-outline text-xs py-1.5"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {protest.arbDecision && protest.finalValue != null && (
        <div className="mt-3 grid gap-2 rounded-md bg-secondary/40 p-3 text-xs sm:grid-cols-2">
          <Field label="Decision Received" value={protest.arbDecisionDate ?? "Yes"} success />
          <Field
            label="Original Value"
            value={protest.originalValue != null ? currency(protest.originalValue) : "Not on file"}
          />
          <Field label="Final Value" value={currency(protest.finalValue)} bold />
          <Field
            label="Value Reduction"
            value={reduction != null ? currency(reduction) : "N/A"}
            success={reduction != null && reduction > 0}
          />
          <Field
            label="Estimated Tax Savings"
            value={savings != null ? `${currency(savings)}/yr` : "N/A"}
            success={savings != null}
          />
        </div>
      )}
    </div>
  );
}
