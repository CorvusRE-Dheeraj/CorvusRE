// Prepare & File: the filing popup — notice, forms, evidence package and delivery (split out of CaseDetailModal.tsx).
import { CadEvidenceRequest } from "@/components/CadEvidenceRequest";
import { VerificationNotice } from "@/components/VerificationNotice";
import { PortalCopySheet } from "@/components/PortalCopySheet";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { EvidenceChecklistPanel } from "@/components/EvidenceChecklistPanel";
import { updatePropertyIdentity, type PropertyRecord } from "@/lib/properties";
import { updateProtestTaxYear, type ProtestRecord } from "@/lib/protests";
import { markFiled } from "@/lib/protest-case";
import { saveCaseRecordFields } from "@/lib/protest-case";
import { listDocuments, previewKind } from "@/lib/documents";
import { useDocumentsVersion } from "@/lib/use-documents-version";
import {
  getCountyProtestInfo,
  COUNTY_PROTEST_INFO,
  type CountyProtestInfo,
} from "@/lib/county-protest-info";
import {
  getPreFilingCheck,
  isPreFilingBlocked,
  type PreFilingCheckItem,
} from "@/lib/pre-filing-check";
import {
  uploadDocument,
  getFilingProofDocumentsFor,
  filingProofDocumentType,
  getDocumentUrl,
  setDocumentProofKind,
  setDocumentType,
  type DocumentRecord,
} from "@/lib/documents";
import { COUNTY_EMAIL_DOCUMENT_TYPE } from "@/lib/county-email";
import { getCadRecordUrl } from "@/lib/cad-record-url";
import { verifyFilingProof, type FilingProofVerification } from "@/lib/filing-proof";
import {
  PROOF_KINDS,
  PROOF_KINDS_BY_METHOD,
  uspsTrackingUrl,
  type ProofKind,
} from "@/lib/proof-kinds";
import { getLatestHearingNotice } from "@/lib/hearing-notice";
import { getErrorMessage } from "@/lib/error-message";
import { getAuthorization, type AuthorizationRecord } from "@/lib/protest-authorizations";
import {
  getNoticeOfProtestDefaults,
  getAppointmentOfAgentDefaults,
  getAdditionalOwnerPropertyFields,
  getEvidenceDeclarationDefaults,
  buildPdf,
  signPdf,
  downloadPdf,
  resolveDateFields,
  NOTICE_OF_PROTEST_SCHEMA,
  APPOINTMENT_OF_AGENT_SCHEMA,
  EVIDENCE_DECLARATION_SCHEMA,
  type FieldValues,
} from "@/lib/protest-documents";
import {
  getSubmission,
  saveDraft,
  signAndSubmit,
  saveFilingMethod,
  saveFilingProofFields,
  markSubmitted,
  confirmFiling,
  requestAdditionalInfo,
  markRejected,
  saveReminderFrequency,
  type FormType,
  type FilingMethod,
  type FormSubmission,
  type ReminderFrequency,
} from "@/lib/protest-form-submissions";
import {
  filingSubmissionStatus,
  hasFilingReferenceNumber,
  confirmationMethodDescription,
  FILING_SUBMISSION_STATUS_LABEL,
} from "@/lib/filing-submission-status";
import {
  selectRelevantEvidence,
  buildEvidencePackagePdf,
  countPdfPages,
} from "@/lib/evidence-package";
import { getCachedModuleResult } from "@/lib/module-results-cache";
import type { ModuleResultMap } from "@/lib/ai-report-modules";
import { searchPropertiesByOwner } from "@/lib/cad-owner-search";
import { draftProtestReason } from "@/lib/protest-reason";
import {
  requiredFilingSteps,
  nextFilingStepAfter,
  optionalFilingSteps,
  FILING_STEP_META,
  isFilingStepDone,
  firstIncompleteFilingStep,
  describeFilingRequirements,
  type FilingStepId,
  type FilingStepStatusInput,
} from "@/lib/filing-workflow";
import { verdictMeta } from "@/lib/documents";
import { PdfFormEditor } from "@/components/PdfFormEditor";
import { Modal } from "@/components/Modal";
import { softDeleteDocuments } from "@/lib/upload-undo";
import { type SignatureValue } from "@/components/SignaturePad";
import { CORVUSPT_COUNTY_EMAIL } from "@/lib/county-email";
import { EMPTY_FORM_SUBMISSION, FILING_METHOD_LABEL } from "@/components/case/shared";

// Every county email CorvusPT drafts copies its county address, so replies
// file themselves under the case (see county-mail-inbound).
const COUNTY_REPLY_LINE = `Please include ${CORVUSPT_COUNTY_EMAIL} on any reply about this protest.`;

// Maps a blocking PreFilingCheckItem's label to the real property field it
// corrects and the input shape that field needs — County uses a closed
// dropdown of the exact cad strings the rest of the app recognizes (a
// free-typed county would silently break every county-specific lookup),
// everything else is free text/number/date.
const BLOCKING_FIELD_MAP: Record<
  string,
  {
    key: "cad" | "address" | "accountNumber" | "ownerName" | "taxYear" | "protestDeadline";
    type: "select" | "text" | "number" | "date";
  }
> = {
  County: { key: "cad", type: "select" },
  "Property Address": { key: "address", type: "text" },
  "Account Number": { key: "accountNumber", type: "text" },
  "Tax Year": { key: "taxYear", type: "number" },
  "Owner / Entity": { key: "ownerName", type: "text" },
  "Protest Deadline": { key: "protestDeadline", type: "date" },
};

// The protest deadline on file, editable before filing — the date the
// district's notice gives can differ from the one saved (e.g. a late-mailed
// notice moves it to 30 days after delivery, Tax Code §41.44(a)). When it has
// passed, this is where the case's "deadline passed" action lands.
function ProtestDeadlineEditor({
  property,
  onSaved,
}: {
  property: PropertyRecord;
  onSaved: (patch: Partial<PropertyRecord>) => void;
}) {
  const current = property.protestDeadline ?? null;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const passed = !!current && current < today;
  const [editing, setEditing] = useState(passed);
  const [value, setValue] = useState(current ?? "");
  const [saving, setSaving] = useState(false);
  const fmt = (d: string) =>
    new Date(`${d}T12:00:00`).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });

  async function save() {
    if (!value || value === current) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const updated = await updatePropertyIdentity(property.id, { protestDeadline: value });
      onSaved(updated);
      toast.success(`Protest deadline updated to ${fmt(value)}.`);
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the deadline.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      id="case-deadline"
      className={`mt-3 scroll-mt-4 rounded-md border p-3 text-sm ${
        passed ? "border-destructive/30 bg-destructive/5" : "border-border bg-secondary/30"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Protest deadline:</span>
        <span className={passed ? "font-semibold text-destructive" : ""}>
          {current ? fmt(current) : "Not on file"}
          {passed ? " — passed" : ""}
        </span>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs font-medium text-accent hover:underline"
          >
            Change
          </button>
        )}
      </div>
      {passed && (
        <p className="mt-1 text-xs text-muted-foreground">
          If your appraisal notice gives a later date — for example it was mailed late, which moves
          the deadline to 30 days after it was delivered — update it here and continue filing. The
          review board may also accept a late protest for good cause if it&apos;s filed before the
          appraisal records are approved, usually in late July (§41.44(b)).
        </p>
      )}
      {editing && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="protest-deadline-input">
            Protest deadline
          </label>
          <input
            id="protest-deadline-input"
            type="date"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          />
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !value}
            className="btn-primary text-xs py-1.5 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save deadline"}
          </button>
          {!passed && (
            <button
              type="button"
              onClick={() => {
                setValue(current ?? "");
                setEditing(false);
              }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PreFilingCheckList({
  items,
  blocked,
  propertyId,
  protestId,
  propertyTaxYear,
  onFixed,
  onProtestFixed,
}: {
  items: PreFilingCheckItem[];
  blocked: boolean;
  propertyId: string;
  protestId: string;
  propertyTaxYear?: number | null;
  onFixed: (patch: Partial<PropertyRecord>) => void;
  // Only ever needed for the Tax Year row's protest/property mismatch case
  // (see resolveField in pre-filing-check.ts) — every other row fixes the
  // property record via onFixed.
  onProtestFixed: (patch: Partial<ProtestRecord>) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Pre-Filing Check</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            blocked ? "bg-destructive/10 text-destructive" : "bg-success/15 text-success"
          }`}
        >
          {blocked ? "Action Needed" : "Ready to File"}
        </span>
      </div>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {items.map((item) => {
          const missing = item.status === "missing";
          const needsReview = item.status === "needs_review";
          const field = missing || needsReview ? BLOCKING_FIELD_MAP[item.label] : undefined;
          return (
            <div key={item.label} className="grid gap-1 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{item.label}</span>
                <span
                  className={`truncate ${
                    missing
                      ? "text-destructive"
                      : needsReview
                        ? "text-warning-foreground"
                        : "text-success"
                  }`}
                  title={item.value ?? undefined}
                >
                  {missing ? "Missing" : needsReview ? "Needs review" : (item.value ?? "Confirmed")}
                </span>
              </div>
              {needsReview && item.issue && <p className="text-warning-foreground">{item.issue}</p>}
              {field && (
                <PreFilingFixRow
                  label={item.label}
                  field={field.key}
                  inputType={field.type}
                  resolveField={item.resolveField ?? "property"}
                  propertyId={propertyId}
                  protestId={protestId}
                  propertyTaxYear={propertyTaxYear}
                  onFixed={onFixed}
                  onProtestFixed={onProtestFixed}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Lets the customer directly correct/confirm a missing blocking field,
// right where Corvus flags it — the real fix for a property that never had
// this data (e.g. added via CAD search rather than an uploaded notice AI
// could extract a real deadline from). Saves via updatePropertyIdentity and
// bubbles the real updated field back up so PreFilingGate re-evaluates
// immediately, same pattern as CaseProgress's forms.
//
// resolveField="protest" is the one exception (Tax Year's protest/property
// mismatch — see resolveField in pre-filing-check.ts): editing the property
// record there can never clear the flag, since the property side is already
// correct and it's the protest's own stale tax_year snapshot that's wrong.
// That case writes via updateProtestTaxYear instead, and is pre-filled with
// the property's real current tax year so the user isn't left guessing what
// to type.
function PreFilingFixRow({
  label,
  field,
  inputType,
  resolveField,
  propertyId,
  protestId,
  onFixed,
  onProtestFixed,
  propertyTaxYear,
}: {
  label: string;
  field: "cad" | "address" | "accountNumber" | "ownerName" | "taxYear" | "protestDeadline";
  inputType: "select" | "text" | "number" | "date";
  resolveField: "property" | "protest";
  propertyId: string;
  protestId: string;
  onFixed: (patch: Partial<PropertyRecord>) => void;
  onProtestFixed: (patch: Partial<ProtestRecord>) => void;
  propertyTaxYear?: number | null;
}) {
  const [value, setValue] = useState(
    resolveField === "protest" && propertyTaxYear != null ? String(propertyTaxYear) : "",
  );
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!value.trim()) return;
    setSaving(true);
    try {
      if (resolveField === "protest") {
        const updated = await updateProtestTaxYear(protestId, Number(value));
        onProtestFixed(updated);
      } else {
        const patch = field === "taxYear" ? { taxYear: Number(value) } : { [field]: value };
        const updated = await updatePropertyIdentity(propertyId, patch);
        onFixed(updated);
      }
      toast.success(`${label} saved.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Could not save ${label}.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {inputType === "select" ? (
        <select
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-input bg-background px-1.5 py-1 text-xs"
        >
          <option value="">Select {label}…</option>
          {Object.keys(COUNTY_PROTEST_INFO).map((cad) => (
            <option key={cad} value={cad}>
              {cad}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={inputType === "number" ? "number" : inputType === "date" ? "date" : "text"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={`Enter ${label}`}
          className="min-w-0 flex-1 rounded-md border border-input bg-background px-1.5 py-1 text-xs"
        />
      )}
      <button
        onClick={handleSave}
        disabled={saving || !value.trim()}
        className="shrink-0 btn-outline px-2 py-1 text-[11px] disabled:opacity-60"
      >
        {saving ? "Saving…" : "Confirm/edit"}
      </button>
    </div>
  );
}

// A real, county-confirmed method wins; when none is confirmed for this
// county, all four still show (matches the honest "not confirmed, check
// the website directly" fallback the instructions block below gives per
// method) rather than leaving the picker with nothing to choose.
function availableFilingMethods(countyInfo: CountyProtestInfo | null): FilingMethod[] {
  const methods: FilingMethod[] = [];
  if (countyInfo?.filingMethod.online) methods.push("online");
  if (countyInfo?.filingMethod.mail) methods.push("mail");
  if (countyInfo?.filingMethod.inPerson) methods.push("in_person");
  if (countyInfo?.filingMethod.email.available) methods.push("email");
  return methods.length > 0 ? methods : ["online", "mail", "in_person", "email"];
}

// mailto: can't attach a file (same known limitation as PdfFormEditor's own
// buildFilingMailto) — the draft tells the user that plainly rather than
// silently producing an email with nothing attached.
function buildFilingEmailDraft(
  docLabel: string,
  property: PropertyRecord,
): { subject: string; body: string } {
  return {
    subject: `${docLabel} — ${property.address}`,
    body: `Please find my ${docLabel} for ${property.address}${
      property.accountNumber ? ` (Account #${property.accountNumber})` : ""
    }.\n\n(Attach your downloaded, signed PDF to this email before sending — it isn't included automatically.)`,
  };
}

// Shown right after the Notice of Protest is signed, so filing it (Go to
// County CAD, below) never reads as blocked on the evidence package or the
// other forms — see describeFilingRequirements's own comment for why this is
// general Texas process fact rather than a county-specific rule this app
// doesn't actually have.
function FilingRequirementsPanel({
  steps,
  hearingDate,
}: {
  steps: FilingStepId[];
  hearingDate: string | null;
}) {
  const note = describeFilingRequirements(steps, hearingDate);
  return (
    <div className="rounded-md border border-border p-3 text-xs">
      <p className="font-medium text-foreground">
        What has to go with this filing — and what can follow
      </p>
      <p className="mt-1.5">
        <span className="font-semibold text-success">Due now: </span>
        <span className="text-muted-foreground">{note.dueNow}</span>
      </p>
      {note.canWaitUntil.length > 0 && (
        <div className="mt-1.5">
          <span className="font-semibold text-foreground">Can follow: </span>
          <ul className="mt-1 grid gap-1 text-muted-foreground">
            {note.canWaitUntil.map((item) => (
              <li key={item.label}>
                • <span className="font-medium text-foreground">{item.label}</span> — {item.detail}.
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// One real "how are you actually getting this document to the county, and
// what proves you did" flow — used identically for all four documents the
// filing workflow tracks (File Protest, Agent/Representative, Evidence
// Affidavit, Evidence). A county can allow a different method for each, so
// this is scoped per (protest, formType), never once per case. Self-
// contained: loads and saves its own submission row and proof documents,
// and only tells its parent about the one thing that actually changes the
// case's own state — the moment this document is confirmed with the county
// (onConfirmed), so the caller can react (flip protest.status for the
// Notice of Protest, or set evidenceSubmittedConfirmedAt for Evidence).
function FilingSubmissionFlow({
  userId,
  property,
  protest,
  formType,
  docLabel,
  countyInfo,
  onConfirmed,
  // Bumped by a caller (Generate Evidence Package, once it saves a new
  // proof document) to force this panel to re-fetch its own submission +
  // proof list — it has no other reason to know that happened.
  refreshToken,
}: {
  userId: string;
  property: PropertyRecord;
  protest: ProtestRecord;
  formType: FormType;
  docLabel: string;
  countyInfo: CountyProtestInfo | null;
  onConfirmed: (at: string) => void;
  refreshToken?: number;
}) {
  const [loading, setLoading] = useState(true);
  const [submission, setSubmission] = useState<FormSubmission | null>(null);
  const [proofDocs, setProofDocs] = useState<DocumentRecord[]>([]);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [proofCheck, setProofCheck] = useState<FilingProofVerification | null>(null);
  const [checkingProof, setCheckingProof] = useState(false);
  const [proofCheckError, setProofCheckError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [confNumInput, setConfNumInput] = useState("");
  const [trackingInput, setTrackingInput] = useState("");
  const [emailRecipientInput, setEmailRecipientInput] = useState("");
  const [emailSubjectInput, setEmailSubjectInput] = useState("");
  const [showCountyRequest, setShowCountyRequest] = useState(false);
  const [countyRequestNote, setCountyRequestNote] = useState("");
  // County emails read from CorvusPT's agent mailbox (county-email.ts) for this
  // property — any of them can be attached as proof in one step.
  const [countyEmailDocs, setCountyEmailDocs] = useState<DocumentRecord[]>([]);
  const docsVersion = useDocumentsVersion();

  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all([
      getSubmission(protest.id, formType),
      getFilingProofDocumentsFor(userId, property.id, formType),
      listDocuments(userId),
    ])
      .then(([s, docs, all]) => {
        if (!live) return;
        setSubmission(s);
        setProofDocs(docs);
        setCountyEmailDocs(
          all.filter(
            (d) => d.propertyId === property.id && d.documentType === COUNTY_EMAIL_DOCUMENT_TYPE,
          ),
        );
        setConfNumInput(s?.filingConfirmationNumber ?? "");
        setTrackingInput(s?.mailTrackingNumber ?? "");
        setEmailRecipientInput(s?.emailRecipient ?? countyInfo?.filingMethod.email.address ?? "");
        const draft = buildFilingEmailDraft(docLabel, property);
        setEmailSubjectInput(s?.emailSubject ?? draft.subject);
      })
      .catch((err) => console.error(`Could not load filing status for ${docLabel}:`, err))
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [protest.id, formType, userId, property.id, refreshToken, docsVersion]);

  async function chooseMethod(method: FilingMethod) {
    setSavingField("method");
    try {
      await saveFilingMethod(userId, protest.id, formType, method);
      setSubmission((s) => ({ ...(s ?? EMPTY_FORM_SUBMISSION), filingMethod: method }));
      // Mirrors into the case-level field File Protest already had —
      // CaseRecordSection keeps reading real, current data instead of a
      // second, disconnected copy the user would have to enter twice.
      if (formType === "notice_of_protest") {
        saveCaseRecordFields(protest.id, { filingChannel: method }).catch((err) =>
          console.error("Could not mirror filing method to the case record:", err),
        );
      }
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save this."));
    } finally {
      setSavingField(null);
    }
  }

  async function saveConfirmationNumber() {
    setSavingField("conf");
    try {
      const value = confNumInput.trim() || null;
      await saveFilingProofFields(userId, protest.id, formType, {
        filingConfirmationNumber: value,
      });
      setSubmission((s) => ({ ...(s ?? EMPTY_FORM_SUBMISSION), filingConfirmationNumber: value }));
      if (formType === "notice_of_protest") {
        saveCaseRecordFields(protest.id, { filingConfirmationNumber: value }).catch((err) =>
          console.error("Could not mirror confirmation number to the case record:", err),
        );
      }
      toast.success("Saved.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save this."));
    } finally {
      setSavingField(null);
    }
  }

  async function saveTrackingNumber() {
    setSavingField("tracking");
    try {
      const value = trackingInput.trim() || null;
      await saveFilingProofFields(userId, protest.id, formType, { mailTrackingNumber: value });
      setSubmission((s) => ({ ...(s ?? EMPTY_FORM_SUBMISSION), mailTrackingNumber: value }));
      if (formType === "notice_of_protest") {
        saveCaseRecordFields(protest.id, { certifiedMailTracking: value }).catch((err) =>
          console.error("Could not mirror tracking number to the case record:", err),
        );
      }
      toast.success("Saved.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save this."));
    } finally {
      setSavingField(null);
    }
  }

  async function handleUploadProof(files: File[]) {
    setUploadingProof(true);
    try {
      const uploaded: DocumentRecord[] = [];
      for (const file of files) {
        uploaded.push(
          await uploadDocument(userId, property.id, file, filingProofDocumentType(formType)),
        );
      }
      const next = [...proofDocs, ...uploaded];
      setProofDocs(next);
      handleCheckProof(next);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not upload this file."));
    } finally {
      setUploadingProof(false);
    }
  }

  async function handleCheckProof(docs: DocumentRecord[] = proofDocs) {
    if (docs.length === 0) return;
    setCheckingProof(true);
    setProofCheckError(null);
    try {
      const result = await verifyFilingProof(property, docs);
      setProofCheck(result);
      // Suggestions, never decisions: label proof the owner hasn't labeled yet
      // (they can change it), and pre-fill — not save — an empty confirmation /
      // tracking number the AI could actually read.
      for (const f of result.findings) {
        const doc = docs.find((d) => d.fileName === f.fileName);
        if (doc && !doc.proofKind) {
          setDocumentProofKind(doc.id, f.proofKind)
            .then(() =>
              setProofDocs((cur) =>
                cur.map((d) => (d.id === doc.id ? { ...d, proofKind: f.proofKind } : d)),
              ),
            )
            .catch((err) => console.error("Could not label proof:", err));
        }
      }
      const conf = result.findings.find((f) => f.confirmationNumber)?.confirmationNumber;
      if (conf && !confNumInput.trim()) setConfNumInput(conf);
      const track = result.findings.find((f) => f.trackingNumber)?.trackingNumber;
      if (track && !trackingInput.trim()) setTrackingInput(track);
      if ((conf && !confNumInput.trim()) || (track && !trackingInput.trim())) {
        toast.info("Found a reference number in your proof — review it and press Save.");
      }
    } catch (err) {
      setProofCheckError(getErrorMessage(err, "Could not check this proof."));
    } finally {
      setCheckingProof(false);
    }
  }

  // Moves a county email (received in the agent mailbox) into this document's proof (re-filing it under
  // this form's proof type) and runs the same AI check an upload gets.
  async function attachCountyEmail(docId: string) {
    const doc = countyEmailDocs.find((d) => d.id === docId);
    if (!doc) return;
    try {
      const type = filingProofDocumentType(formType);
      await setDocumentType(doc.id, type);
      const moved = { ...doc, documentType: type };
      setCountyEmailDocs((cur) => cur.filter((d) => d.id !== doc.id));
      const next = [...proofDocs, moved];
      setProofDocs(next);
      handleCheckProof(next);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not attach this email."));
    }
  }

  async function changeProofKind(doc: DocumentRecord, kind: ProofKind) {
    setProofDocs((cur) => cur.map((d) => (d.id === doc.id ? { ...d, proofKind: kind } : d)));
    try {
      await setDocumentProofKind(doc.id, kind);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save this label."));
    }
  }

  async function saveDeliveredDate(value: string) {
    setSavingField("delivered");
    try {
      // A date input gives "YYYY-MM-DD" — stored as noon UTC so it reads as the
      // same calendar day in any US timezone.
      const at = value ? new Date(`${value}T12:00:00Z`).toISOString() : null;
      await saveFilingProofFields(userId, protest.id, formType, { mailDeliveredAt: at });
      setSubmission((s) => ({ ...(s ?? EMPTY_FORM_SUBMISSION), mailDeliveredAt: at }));
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save this."));
    } finally {
      setSavingField(null);
    }
  }

  // The county came back wanting more — any document, not just Evidence. The
  // request itself can be attached below as "County request for more information".
  async function handleCountyRequest() {
    setConfirming(true);
    try {
      const note = countyRequestNote.trim() || null;
      const at = await requestAdditionalInfo(userId, protest.id, formType, note);
      setSubmission((s) => ({
        ...(s ?? EMPTY_FORM_SUBMISSION),
        additionalRequestedAt: at,
        additionalRequestNote: note,
      }));
      setShowCountyRequest(false);
      toast.info(`Logged — ${docLabel} shows as Additional Information Requested.`);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save this."));
    } finally {
      setConfirming(false);
    }
  }

  // The customer's own "I delivered this" report — the same real signal for
  // every method now (Online/Mail/In Person included, not just Email). Not
  // the same as the county actually confirming it — see handleConfirm below.
  async function handleMarkSubmitted() {
    setConfirming(true);
    try {
      const at = await markSubmitted(userId, protest.id, formType);
      setSubmission((s) => ({ ...(s ?? EMPTY_FORM_SUBMISSION), submittedAt: at }));
      toast.success("Logged — showing as Awaiting County Confirmation.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save this."));
    } finally {
      setConfirming(false);
    }
  }

  // The one honest source of "the county actually has this" — the
  // customer's own explicit click, same discipline as markFiled() elsewhere
  // in this app. Never auto-confirmed from the AI read above, which is
  // advisory only, and never set just because the customer marked it
  // submitted — that's a real, separate, earlier event.
  async function handleConfirm() {
    setConfirming(true);
    try {
      const at = await confirmFiling(userId, protest.id, formType);
      setSubmission((s) => ({ ...(s ?? EMPTY_FORM_SUBMISSION), filingConfirmedAt: at }));
      onConfirmed(at);
      toast.success(`${docLabel} marked as filed with the county.`);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save this."));
    } finally {
      setConfirming(false);
    }
  }

  async function handleReject() {
    setConfirming(true);
    try {
      const at = await markRejected(userId, protest.id, formType);
      setSubmission((s) => ({ ...(s ?? EMPTY_FORM_SUBMISSION), rejectedAt: at }));
      toast.info(`${docLabel} marked as rejected — fix it and mark as submitted again.`);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save this."));
    } finally {
      setConfirming(false);
    }
  }

  // Email is mocked — Corvus prepares the draft, but sending and reading any
  // reply both happen in the user's own mail client (this app has no email
  // account integration). "Sent" and "the county confirmed" are deliberately
  // two separate, manual steps rather than one click, so the case never
  // claims a confirmation this app can't actually see. Sets the same generic
  // submittedAt every other method uses, plus email's own sent-log fields.
  async function handleMarkEmailSent() {
    setConfirming(true);
    try {
      const at = new Date().toISOString();
      await Promise.all([
        saveFilingProofFields(userId, protest.id, formType, {
          emailRecipient: emailRecipientInput.trim() || null,
          emailSubject: emailSubjectInput.trim() || null,
          emailSentAt: at,
        }),
        markSubmitted(userId, protest.id, formType),
      ]);
      setSubmission((s) => ({
        ...(s ?? EMPTY_FORM_SUBMISSION),
        emailRecipient: emailRecipientInput.trim() || null,
        emailSubject: emailSubjectInput.trim() || null,
        emailSentAt: at,
        submittedAt: at,
      }));
      toast.success("Logged — showing as Awaiting County Confirmation.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save this."));
    } finally {
      setConfirming(false);
    }
  }

  if (loading) {
    return <p className="mt-3 text-xs text-muted-foreground">Loading filing status…</p>;
  }

  const method = submission?.filingMethod ?? null;
  const status = filingSubmissionStatus(submission);
  const methods = availableFilingMethods(countyInfo);
  const cadUrl = getCadRecordUrl({
    cad: property.cad ?? "",
    accountNumber: property.accountNumber,
  });
  const emailDraft = buildFilingEmailDraft(docLabel, property);
  const emailAddress = countyInfo?.filingMethod.email.address ?? null;
  const mailtoHref = emailAddress
    ? `mailto:${encodeURIComponent(emailAddress)}?cc=${encodeURIComponent(
        CORVUSPT_COUNTY_EMAIL,
      )}&subject=${encodeURIComponent(
        emailSubjectInput || emailDraft.subject,
      )}&body=${encodeURIComponent(`${emailDraft.body}\n\n${COUNTY_REPLY_LINE}`)}`
    : null;
  const canConfirm = hasFilingReferenceNumber(submission) || proofDocs.length > 0;
  // The submit form (method-specific input + proof + "Mark as Submitted")
  // shows whenever there's genuinely something to (re)submit — not yet
  // submitted, or bounced back (rejected / additional info requested).
  const canEditSubmission =
    status === "method_chosen" || status === "rejected" || status === "additional_requested";
  // The kinds that fit this method first, then the rest.
  const preferredKinds = method ? PROOF_KINDS_BY_METHOD[method] : [];
  const proofKindOptions = [
    ...PROOF_KINDS.filter((k) => preferredKinds.includes(k.id)),
    ...PROOF_KINDS.filter((k) => !preferredKinds.includes(k.id)),
  ];

  const proofBlock = (
    <div className="mt-3">
      {proofDocs.length > 0 && (
        <ul className="mb-2 grid gap-1.5 text-xs">
          {proofDocs.map((doc) => (
            <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 truncate text-foreground">{doc.fileName}</span>
              <select
                value={doc.proofKind ?? ""}
                onChange={(e) => changeProofKind(doc, e.target.value as ProofKind)}
                aria-label={`What kind of proof is ${doc.fileName}?`}
                className="rounded-md border border-input bg-background px-2 py-1 text-xs"
              >
                <option value="" disabled>
                  What kind of proof is this?
                </option>
                {proofKindOptions.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm(`Remove ${doc.fileName} from this filing's proof?`)) return;
                  void softDeleteDocuments([doc.id])
                    .then(() => {
                      setProofDocs((cur) => cur.filter((d) => d.id !== doc.id));
                      toast.success("Proof removed — upload the right file.");
                    })
                    .catch((err) => toast.error(getErrorMessage(err, "Could not remove it.")));
                }}
                className="text-destructive hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <label
        className={`inline-flex btn-outline cursor-pointer py-1.5 text-xs ${uploadingProof ? "pointer-events-none opacity-60" : ""}`}
      >
        {uploadingProof ? "Uploading…" : "Upload Proof"}
        <input
          type="file"
          accept="image/*,.pdf"
          multiple
          className="hidden"
          disabled={uploadingProof}
          onChange={(e) => {
            const selected = e.target.files ? Array.from(e.target.files) : [];
            e.target.value = "";
            if (selected.length > 0) handleUploadProof(selected);
          }}
        />
      </label>
      {countyEmailDocs.length > 0 && (
        <select
          value=""
          onChange={(e) => e.target.value && attachCountyEmail(e.target.value)}
          aria-label="Attach a county email as proof"
          className="ml-2 rounded-md border border-input bg-background px-2 py-1.5 text-xs"
        >
          <option value="">Attach a county email…</option>
          {countyEmailDocs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.fileName}
            </option>
          ))}
        </select>
      )}
      {checkingProof && (
        <p className="mt-2 text-xs text-muted-foreground">Checking what this shows…</p>
      )}
      {proofCheckError && <p className="mt-2 text-xs text-destructive">{proofCheckError}</p>}
      {proofCheck && !checkingProof && (
        <div className="mt-2 rounded-md border border-border p-2.5 text-xs">
          <div className="font-medium">AI check — review before confirming</div>
          <div className="mt-1.5 grid gap-1.5">
            {proofCheck.findings.map((f, i) => (
              <div key={i}>
                <span className="font-medium">{f.fileName}:</span>{" "}
                {f.hasVisibleSignature ? (
                  <span className="text-success">
                    signature visible
                    {f.signatureNameObserved ? ` (${f.signatureNameObserved})` : ""}
                  </span>
                ) : (
                  <span className="text-warning-foreground">no signature visible</span>
                )}
                {f.dateObserved && (
                  <>
                    {" · date: "}
                    <span className={f.dateYearPlausible === false ? "text-destructive" : ""}>
                      {f.dateObserved}
                      {f.dateYearPlausible === false
                        ? " — looks like it may be a prior year, please double-check"
                        : ""}
                    </span>
                  </>
                )}
                <p className="mt-0.5 text-muted-foreground">{f.notes}</p>
              </div>
            ))}
          </div>
          {proofCheck.overallAssessment && (
            <p className="mt-1.5 text-muted-foreground">{proofCheck.overallAssessment}</p>
          )}
          <button
            type="button"
            onClick={() => handleCheckProof()}
            className="mt-1.5 text-accent hover:underline"
          >
            Re-check
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="mt-3 rounded-md border border-accent/40 bg-accent/5 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          How you&apos;re filing this
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            status === "confirmed"
              ? "bg-success/15 text-success"
              : status === "rejected" || status === "additional_requested"
                ? "bg-destructive/10 text-destructive"
                : status === "awaiting_confirmation"
                  ? "bg-warning/15 text-warning-foreground"
                  : "bg-secondary text-muted-foreground"
          }`}
        >
          {FILING_SUBMISSION_STATUS_LABEL[status]}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {methods.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => chooseMethod(m)}
            disabled={
              savingField === "method" ||
              status === "confirmed" ||
              status === "awaiting_confirmation"
            }
            className={`rounded-full px-2.5 py-1 text-xs font-medium disabled:cursor-default ${
              method === m
                ? "bg-accent/15 text-accent"
                : "border border-border text-muted-foreground hover:bg-secondary"
            }`}
          >
            {FILING_METHOD_LABEL[m]}
          </button>
        ))}
      </div>

      {!method && (
        <p className="mt-2 text-xs text-muted-foreground">
          Pick how you&apos;re filing this to see the right instructions.
        </p>
      )}

      {method && status === "confirmed" && submission?.filingConfirmedAt && (
        <p className="mt-2 text-xs text-success">
          ✓ Confirmed with the county on{" "}
          {new Date(submission.filingConfirmedAt).toLocaleDateString()} via{" "}
          {FILING_METHOD_LABEL[method].toLowerCase()}.
        </p>
      )}

      {method && status === "rejected" && (
        <p className="mt-2 text-xs text-destructive">
          The county rejected this
          {submission?.rejectedAt
            ? ` on ${new Date(submission.rejectedAt).toLocaleDateString()}`
            : ""}
          — review what&apos;s below, fix it, and mark as submitted again.
        </p>
      )}

      {method && status !== "confirmed" && (
        <div className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
          {method === "online" &&
            (countyInfo?.filingMethod.online ? (
              <>
                <p>
                  {countyInfo.cad} accepts online filing.
                  {countyInfo.filingMethod.online.notes
                    ? ` ${countyInfo.filingMethod.online.notes}`
                    : ""}
                </p>
                {submission?.fieldValues && Object.keys(submission.fieldValues).length > 0 && (
                  <PortalCopySheet values={submission.fieldValues} />
                )}
                <a
                  href={countyInfo.filingMethod.online.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-accent mt-2 inline-flex text-xs py-1.5"
                >
                  Go to County Portal →
                </a>
              </>
            ) : (
              <>
                <p>
                  We don&apos;t have a confirmed online portal for {property.cad ?? "this county"}{" "}
                  on file — try its CAD record page instead.
                </p>
                {cadUrl && (
                  <a
                    href={cadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-outline mt-2 inline-flex text-xs py-1.5"
                  >
                    Go to County CAD →
                  </a>
                )}
              </>
            ))}

          {method === "mail" &&
            (countyInfo?.filingMethod.mail ? (
              <>
                <p className="font-medium text-foreground">
                  {countyInfo.filingMethod.mail.address}
                </p>
                {countyInfo.filingMethod.mail.notes && (
                  <p className="mt-1">{countyInfo.filingMethod.mail.notes}</p>
                )}
              </>
            ) : (
              <p>
                We don&apos;t have a confirmed mailing address for {property.cad ?? "this county"}{" "}
                on file — check its website directly.
              </p>
            ))}
          {method === "mail" && property.protestDeadline && (
            <p className="mt-1">
              Deadline: {new Date(`${property.protestDeadline}T00:00:00`).toLocaleDateString()} —
              mail early enough to arrive (or be postmarked) by then.
            </p>
          )}

          {method === "in_person" &&
            (countyInfo?.filingMethod.inPerson ? (
              <>
                <p className="font-medium text-foreground">
                  {countyInfo.filingMethod.inPerson.address}
                </p>
                <p className="mt-1">
                  {countyInfo.filingMethod.inPerson.notes ||
                    "Hours and appointment requirements aren't confirmed for this county — check its website."}
                </p>
              </>
            ) : (
              <p>
                We don&apos;t have a confirmed in-person location for{" "}
                {property.cad ?? "this county"} on file — check its website directly.
              </p>
            ))}
          {method === "in_person" && (
            <p className="mt-1">Bring a government-issued photo ID and a printed copy of this.</p>
          )}

          {method === "email" &&
            (emailAddress ? (
              <>
                <p>Draft to send from your own email — CorvusPT doesn&apos;t send it for you:</p>
                <div className="mt-1 rounded-md border border-border bg-background p-2 text-foreground">
                  <p>
                    <span className="font-medium">To:</span> {emailAddress}
                  </p>
                  <p>
                    <span className="font-medium">Subject:</span>{" "}
                    {emailSubjectInput || emailDraft.subject}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{emailDraft.body}</p>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {mailtoHref && (
                    <a
                      href={mailtoHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-outline text-xs py-1.5"
                    >
                      Open in Mail App →
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      navigator.clipboard
                        .writeText(emailDraft.body)
                        .then(() => toast.success("Copied."))
                        .catch(() => toast.error("Could not copy."))
                    }
                    className="btn-outline text-xs py-1.5"
                  >
                    Copy
                  </button>
                </div>
              </>
            ) : (
              <p>
                No confirmed email address on file for {property.cad ?? "this county"} — use another
                method, or check its website.
              </p>
            ))}
        </div>
      )}

      {method === "online" && canEditSubmission && (
        <div className="mt-3 grid gap-2">
          <label className="grid gap-1 text-xs">
            Confirmation number{" "}
            <span className="text-muted-foreground">(optional — counts as proof on its own)</span>
            <div className="flex gap-1">
              <input
                value={confNumInput}
                onChange={(e) => setConfNumInput(e.target.value)}
                placeholder="Portal confirmation code"
                className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
              <button
                type="button"
                onClick={saveConfirmationNumber}
                disabled={savingField === "conf"}
                className="btn-outline shrink-0 text-xs disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </label>
          {proofBlock}
          <button
            type="button"
            onClick={handleMarkSubmitted}
            disabled={!canConfirm || confirming}
            title={canConfirm ? undefined : "Enter a confirmation number or upload proof first"}
            className="btn-accent w-fit text-xs py-1.5 disabled:opacity-60"
          >
            {confirming ? "Saving…" : "Mark as Submitted"}
          </button>
        </div>
      )}

      {method === "mail" && canEditSubmission && (
        <div className="mt-3 grid gap-2">
          <label className="grid gap-1 text-xs">
            Certified-mail tracking number
            <div className="flex gap-1">
              <input
                value={trackingInput}
                onChange={(e) => setTrackingInput(e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
              <button
                type="button"
                onClick={saveTrackingNumber}
                disabled={savingField === "tracking"}
                className="btn-outline shrink-0 text-xs disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </label>
          {trackingInput.trim() && (
            <a
              href={uspsTrackingUrl(trackingInput)}
              target="_blank"
              rel="noopener noreferrer"
              className="w-fit text-xs text-accent underline"
            >
              Track with USPS
            </a>
          )}
          {proofBlock}
          <button
            type="button"
            onClick={handleMarkSubmitted}
            disabled={!canConfirm || confirming}
            title={canConfirm ? undefined : "Enter a tracking number or upload proof first"}
            className="btn-accent w-fit text-xs py-1.5 disabled:opacity-60"
          >
            {confirming ? "Saving…" : "Mark as Submitted"}
          </button>
          <p className="text-[11px] text-muted-foreground">
            Mailing it doesn&apos;t by itself mean the county accepted it — this stays{" "}
            {FILING_SUBMISSION_STATUS_LABEL.method_chosen.toLowerCase()} until it&apos;s confirmed.
          </p>
        </div>
      )}

      {method === "in_person" && canEditSubmission && (
        <div className="mt-3 grid gap-2">
          {proofBlock}
          <button
            type="button"
            onClick={handleMarkSubmitted}
            disabled={!canConfirm || confirming}
            title={canConfirm ? undefined : "Upload proof first (a stamped copy, receipt, etc.)"}
            className="btn-accent w-fit text-xs py-1.5 disabled:opacity-60"
          >
            {confirming ? "Saving…" : "Mark as Submitted"}
          </button>
        </div>
      )}

      {method === "email" && canEditSubmission && (
        <div className="mt-3 grid gap-2">
          <label className="grid gap-1 text-xs">
            Recipient
            <input
              value={emailRecipientInput}
              onChange={(e) => setEmailRecipientInput(e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="grid gap-1 text-xs">
            Subject
            <input
              value={emailSubjectInput}
              onChange={(e) => setEmailSubjectInput(e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <p className="text-[11px] text-muted-foreground">Attaching a screenshot is optional.</p>
          {proofBlock}
          <button
            type="button"
            onClick={handleMarkEmailSent}
            disabled={confirming}
            className="btn-accent w-fit text-xs py-1.5 disabled:opacity-60"
          >
            {confirming ? "Saving…" : "Mark as Sent"}
          </button>
        </div>
      )}

      {/* Mailed: the tracking number shows it was sent; the delivery date is
          the carrier's own word that it arrived. */}
      {method === "mail" &&
        submission?.mailTrackingNumber &&
        (status === "awaiting_confirmation" || status === "confirmed") && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border p-3 text-xs">
            <span>
              Tracking {submission.mailTrackingNumber} ·{" "}
              <a
                href={uspsTrackingUrl(submission.mailTrackingNumber)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline"
              >
                Track with USPS
              </a>
            </span>
            <label className="flex items-center gap-2">
              Delivered on
              <input
                type="date"
                defaultValue={submission.mailDeliveredAt?.slice(0, 10) ?? ""}
                onBlur={(e) => {
                  const next = e.target.value;
                  if (next !== (submission.mailDeliveredAt?.slice(0, 10) ?? ""))
                    saveDeliveredDate(next);
                }}
                disabled={savingField === "delivered"}
                className="rounded-md border border-input bg-background px-2 py-1 text-xs"
              />
            </label>
          </div>
        )}

      {status === "additional_requested" && submission?.additionalRequestNote && (
        <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
          <span className="font-semibold">What the county asked for:</span>{" "}
          {submission.additionalRequestNote}
        </p>
      )}

      {/* The county came back wanting more — note what they asked for and
          attach their notice. Evidence has its own request flow below. */}
      {formType !== "evidence" &&
        (status === "awaiting_confirmation" || status === "confirmed") &&
        (showCountyRequest ? (
          <div className="mt-3 grid gap-2 rounded-md border border-border p-3 text-xs">
            <label className="grid gap-1">
              What did {property.cad ?? "the county"} ask for?
              <textarea
                value={countyRequestNote}
                onChange={(e) => setCountyRequestNote(e.target.value)}
                rows={2}
                className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <p className="text-muted-foreground">
              Attach their notice or email below, labeled &ldquo;County request for more
              information&rdquo;.
            </p>
            {proofBlock}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCountyRequest}
                disabled={confirming}
                className="btn-accent text-xs py-1.5 disabled:opacity-60"
              >
                {confirming ? "Saving…" : "Log County Request"}
              </button>
              <button
                type="button"
                onClick={() => setShowCountyRequest(false)}
                className="btn-outline text-xs py-1.5"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowCountyRequest(true)}
            className="mt-2 text-xs text-accent hover:underline"
          >
            County asked for more information?
          </button>
        ))}

      {/* Once anyone marks it submitted, the same "now what" block applies
          regardless of method — the only real difference is what confirmation
          from the county actually looks like (confirmationMethodDescription). */}
      {status === "awaiting_confirmation" && method && (
        <div className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
          <p className="font-semibold text-warning-foreground">Awaiting County Confirmation</p>
          <p className="mt-1 text-muted-foreground">
            {method === "email" ? (
              <>
                Sent to {submission?.emailRecipient || emailAddress || "the county"}
                {submission?.emailSentAt
                  ? ` on ${new Date(submission.emailSentAt).toLocaleDateString()}`
                  : ""}
                .{" "}
              </>
            ) : (
              submission?.submittedAt &&
              `Marked submitted on ${new Date(submission.submittedAt).toLocaleDateString()}. `
            )}
            What confirmation from {property.cad ?? "the county"} usually looks like:{" "}
            {confirmationMethodDescription(method)}. If you don&apos;t hear back within about 10
            business days,{" "}
            {countyInfo?.arbContact?.phone
              ? `call ${countyInfo.arbContact.phone}`
              : "follow up with the appraisal district"}{" "}
            to confirm receipt.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={confirming}
              className="btn-accent text-xs py-1.5 disabled:opacity-60"
            >
              {confirming ? "Saving…" : "County Confirmed"}
            </button>
            <button
              type="button"
              onClick={handleReject}
              disabled={confirming}
              className="btn-outline text-destructive text-xs py-1.5 disabled:opacity-60"
            >
              Rejected?
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function DocumentsSection({
  userId,
  protest,
  property,
  strategyRecommendation,
  noticeSignedAt,
  evidenceDocuments,
  onUpdate,
  onNoticeSigned,
  // Correct a blocking Pre-Filing Check field (County / Deadline / …) right in
  // the workflow's first step. Optional — omitted by the admin copy.
  onPropertyUpdate,
  // Staff must never sign a legal filing on a customer's behalf — the admin
  // panel's copy of this section (AdminCaseProgressModal) passes false to
  // hide signing entirely, keeping Save Progress/Download available for
  // staff to help prep the form without ever touching the signature step.
  allowSigning = true,
  // Called from the last filing step's footer: close the popup and move on to the
  // next case phase. Omitted by the admin copy.
  onFinish,
  // Close the popup and jump to a section of the case (hearing notice, county
  // evidence) — the Evidence step's prerequisites live there.
  onGoTo,
  userEmail = null,
}: {
  userId: string;
  protest: ProtestRecord;
  property: PropertyRecord;
  strategyRecommendation: string | null;
  noticeSignedAt: string | null;
  evidenceDocuments: DocumentRecord[];
  onUpdate: (patch: Partial<ProtestRecord>) => void;
  onNoticeSigned: (signedAt: string | null) => void;
  onPropertyUpdate?: (patch: Partial<PropertyRecord>) => void;
  allowSigning?: boolean;
  onFinish?: () => void;
  onGoTo?: (anchor: string) => void;
  userEmail?: string | null;
}) {
  const [authorization, setAuthorization] = useState<AuthorizationRecord | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [editingForm, setEditingForm] = useState<"protest" | "agent" | "evidence" | null>(null);
  const [values, setValues] = useState<FieldValues>({});
  const [downloading, setDownloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [signingOpen, setSigningOpen] = useState(false);
  const [signature, setSignature] = useState<SignatureValue | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [generatingReason, setGeneratingReason] = useState(false);
  // Same real signed_at signal as the Notice of Protest's noticeSignedAt
  // (see CaseDetailModal.tsx), but for the Appointment of Agent form —
  // kept local here rather than lifted, since nothing outside Documents
  // currently needs it. Loaded whenever the agent editor opens, below.
  const [agentFormSignedAt, setAgentFormSignedAt] = useState<string | null>(null);
  // Same again for the Evidence Declaration (Form 50-283) — note that
  // "signed" here only means the in-app signature was drawn and saved, not
  // that the affidavit was actually notarized (see PdfFormEditor's own
  // notarization notice for formKind "evidence-declaration").
  const [evidenceDeclarationSignedAt, setEvidenceDeclarationSignedAt] = useState<string | null>(
    null,
  );

  // The saved Notice of Protest "how will you appear at the ARB hearing"
  // answer, loaded eagerly (not just when the editor opens) — it decides
  // whether the Evidence Affidavit step is part of this filing.
  const [noticeHearingAppearance, setNoticeHearingAppearance] = useState<string | null>(null);

  useEffect(() => {
    getAuthorization(protest.id)
      .then(setAuthorization)
      .catch((err) => console.error(err))
      .finally(() => setAuthLoading(false));
  }, [protest.id]);

  // Eager load of the two secondary forms' signed-at + the notice's hearing
  // answer, so the step bar can show completion / decide the step set without
  // opening each editor first. openAgentEditor / openEvidenceDeclarationEditor
  // still refresh these when they run.
  useEffect(() => {
    getSubmission(protest.id, "notice_of_protest")
      .then((s) => {
        const v = s?.fieldValues?.["ARB hearing"];
        setNoticeHearingAppearance(typeof v === "string" && v ? v : null);
      })
      .catch(() => {});
    getSubmission(protest.id, "appointment_of_agent")
      .then((s) => setAgentFormSignedAt(s?.signedAt ?? null))
      .catch(() => {});
    getSubmission(protest.id, "evidence_declaration")
      .then((s) => setEvidenceDeclarationSignedAt(s?.signedAt ?? null))
      .catch(() => {});
  }, [protest.id]);

  const filingInput = useMemo(
    () => ({
      attendanceType: protest.attendanceType,
      hasAgentAuthorization: false,
      hearingAppearance: noticeHearingAppearance,
    }),
    [protest.attendanceType, noticeHearingAppearance],
  );
  const filingSteps = useMemo(() => requiredFilingSteps(filingInput), [filingInput]);
  // Agent / Representative is optional unless this case has actually
  // signalled an agent is involved (see optionalFilingSteps) — it's always
  // shown, but shouldn't hold up auto-advance/"first incomplete" while it's
  // just an open option, not real required work.
  const optionalSteps = useMemo(() => optionalFilingSteps(filingInput), [filingInput]);
  const preFilingItems = getPreFilingCheck(property, protest, evidenceDocuments.length);
  const preFilingBlocked = isPreFilingBlocked(preFilingItems);
  // Shared with filing-workflow.ts so this step bar and anything else reading
  // the same case (the AI Report page's Case Progress card) can never
  // disagree on what "done" means for a step.
  const filingStepStatus: FilingStepStatusInput = {
    preFilingBlocked,
    noticeSignedAt,
    agentFormSignedAt,
    evidenceDeclarationSignedAt,
    evidenceSubmittedConfirmedAt: protest.evidenceSubmittedConfirmedAt ?? null,
  };
  const stepDone = (id: FilingStepId) => isFilingStepDone(id, filingStepStatus);
  const firstIncomplete = firstIncompleteFilingStep(filingSteps, filingStepStatus, optionalSteps);
  const [activeStep, setActiveStep] = useState<FilingStepId>(
    preFilingBlocked ? "prefiling" : firstIncomplete,
  );
  // Auto-advance: when the step the user is currently on gets completed, move
  // them to the next step that still needs work — so they never have to figure
  // out "what's next". Manual back-navigation to review a completed step is
  // preserved (only advances if they were sitting on the step that just
  // finished).
  const prevFirstIncomplete = useRef(firstIncomplete);
  useEffect(() => {
    const prev = prevFirstIncomplete.current;
    prevFirstIncomplete.current = firstIncomplete;
    if (!filingSteps.includes(activeStep)) {
      setActiveStep(firstIncomplete);
    } else if (preFilingBlocked && activeStep !== "prefiling") {
      setActiveStep("prefiling");
    } else if (prev !== firstIncomplete && activeStep === prev) {
      // the next step in order — the optional Agent step shows before Evidence
      setActiveStep(nextFilingStepAfter(filingSteps, activeStep, filingStepStatus, optionalSteps));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filingSteps.join(","), preFilingBlocked, firstIncomplete]);

  // Nothing after File Protest (agent form, affidavit, evidence) opens until
  // the Notice of Protest is signed — it's the filing everything else hangs on.
  const noticeDone = stepDone("file");
  const fileIndex = filingSteps.indexOf("file");
  const stepLocked = (id: FilingStepId) =>
    (preFilingBlocked && id !== "prefiling") ||
    (!noticeDone && fileIndex >= 0 && filingSteps.indexOf(id) > fileIndex);

  function selectStep(id: FilingStepId) {
    // While the Pre-Filing Check is blocked, nothing after it is actionable.
    if (preFilingBlocked && id !== "prefiling") {
      toast.info("Finish the Pre-Filing Check first — resolve the flagged field(s).");
      return;
    }
    if (stepLocked(id)) {
      toast.info("File your Notice of Protest first.");
      return;
    }
    setActiveStep(id);
  }

  // The Evidence tab's own FilingSubmissionFlow already ran confirmFiling()
  // (real timestamp, its own toast/loading state) — this just mirrors that
  // moment into the existing evidenceSubmittedConfirmedAt column, which
  // case-next-action.ts / pre-filing-check.ts / the Case Record already read.
  function handleEvidenceFilingConfirmed(at: string) {
    saveCaseRecordFields(protest.id, { evidenceSubmittedConfirmedAt: at }).catch((err) =>
      console.error("Could not save the evidence-submitted confirmation:", err),
    );
    onUpdate({ evidenceSubmittedConfirmedAt: at });
  }

  const formType: FormType | null =
    editingForm === "protest"
      ? "notice_of_protest"
      : editingForm === "agent"
        ? "appointment_of_agent"
        : editingForm === "evidence"
          ? "evidence_declaration"
          : null;
  const templatePath =
    editingForm === "protest"
      ? "forms/50-132.pdf"
      : editingForm === "agent"
        ? "forms/50-162.pdf"
        : "forms/50-283.pdf";
  const schema =
    editingForm === "protest"
      ? NOTICE_OF_PROTEST_SCHEMA
      : editingForm === "agent"
        ? APPOINTMENT_OF_AGENT_SCHEMA
        : EVIDENCE_DECLARATION_SCHEMA;

  // Opens immediately with computed defaults (no loading state on click), then
  // swaps in a saved draft/signed submission if one exists — a prior Save
  // Progress or Sign & Submit always wins over freshly-computed defaults.
  function openProtestEditor() {
    const defaults = getNoticeOfProtestDefaults(
      property,
      property.taxYear,
      strategyRecommendation,
      authorization,
    );
    setValues(defaults);
    setEditingForm("protest");
    setSigningOpen(false);
    setSignature(null);
    getSubmission(protest.id, "notice_of_protest")
      .then((existing) => {
        if (existing) {
          setValues(existing.fieldValues);
          return;
        }
        // No saved draft — auto-draft the "facts to resolve protest" text from
        // the case's evidence so the form opens as complete as Corvus can make
        // it. Always editable; the user still reviews before signing.
        if (evidenceDocuments.length > 0 && !defaults["Facts to resolve protest"]) {
          draftProtestReason(property, strategyRecommendation, evidenceDocuments)
            .then((text) =>
              setValues((v) =>
                v["Facts to resolve protest"] ? v : { ...v, "Facts to resolve protest": text },
              ),
            )
            .catch((err) => console.error("Auto-draft of protest reason failed:", err));
        }
      })
      .catch((err) => console.error("Could not load saved Notice of Protest draft:", err));
  }

  function openAgentEditor() {
    if (!authorization) return;
    setValues(getAppointmentOfAgentDefaults(authorization, property));
    setEditingForm("agent");
    setSigningOpen(false);
    setSignature(null);
    setAgentFormSignedAt(null);
    getSubmission(protest.id, "appointment_of_agent")
      .then((existing) => {
        if (existing) {
          setValues(existing.fieldValues);
          setAgentFormSignedAt(existing.signedAt);
        }
      })
      .catch((err) => console.error("Could not load saved Appointment of Agent draft:", err))
      .finally(fillAdditionalOwnerProperties);
  }

  function openEvidenceDeclarationEditor() {
    setValues(getEvidenceDeclarationDefaults(property, property.taxYear, evidenceDocuments.length));
    setEditingForm("evidence");
    setSigningOpen(false);
    setSignature(null);
    setEvidenceDeclarationSignedAt(null);
    getSubmission(protest.id, "evidence_declaration")
      .then((existing) => {
        if (existing) {
          setValues(existing.fieldValues);
          setEvidenceDeclarationSignedAt(existing.signedAt);
        }
      })
      .catch((err) => console.error("Could not load saved Evidence Declaration draft:", err));
  }

  // Same popup-embed treatment as CasePlanSection's own — see its comment.
  const [showEvidencePanel, setShowEvidencePanel] = useState(false);
  function goToModule8() {
    setShowEvidencePanel(true);
  }

  // Form 50-162 authorizes an agent for possibly several properties at once —
  // this case's own property already fills the first slot; this looks up any
  // OTHER real properties on file under the same owner name, in the same
  // appraisal district (an authorization is filed per-district, so a sibling
  // property in a different county doesn't belong on this form), and fills
  // the remaining slots. Reuses the exact same owner-name search Add
  // Ownerships already uses — real CAD data, never guessed. Runs after the
  // saved-draft check above (whichever wins) and only ever fills slots that
  // are still empty, so it can never clobber a saved draft or an edit the
  // user already made.
  async function fillAdditionalOwnerProperties() {
    const ownerName =
      property.ownerName || (authorization?.isEntity ? authorization.entityName : null);
    if (!ownerName || !property.cad) return;
    try {
      const { matches } = await searchPropertiesByOwner(ownerName);
      const isCurrentProperty = (m: (typeof matches)[number]) =>
        property.accountNumber && m.accountNumber
          ? m.accountNumber === property.accountNumber
          : m.propertyAddress.trim().toLowerCase() === property.address.trim().toLowerCase();
      const additional = matches.filter((m) => m.cad === property.cad && !isCurrentProperty(m));
      if (additional.length === 0) return;
      setValues((prev) =>
        prev["Appraisal District Account Number_3"] ||
        prev["Physical or Situs Address of Property_3"]
          ? prev
          : { ...prev, ...getAdditionalOwnerPropertyFields(additional) },
      );
    } catch (err) {
      console.error("Could not search for other properties under this ownership:", err);
    }
  }

  function handleFieldChange(name: string, value: string | boolean) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSaveProgress() {
    if (!formType) return;
    setSaving(true);
    try {
      await saveDraft(userId, protest.id, formType, values);
      toast.success("Progress saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save your progress.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const bytes = await buildPdf(templatePath, schema, values);
      const filenameBase = property.accountNumber ?? property.id;
      downloadPdf(
        bytes,
        editingForm === "protest"
          ? `Notice-of-Protest-${filenameBase}.pdf`
          : editingForm === "agent"
            ? `Appointment-of-Agent-${filenameBase}.pdf`
            : `Evidence-Declaration-${filenameBase}.pdf`,
      );
      // Downloading shouldn't be able to lose edits either — save silently
      // alongside it (no separate toast — the real next-step message below
      // covers this action).
      if (formType)
        await saveDraft(userId, protest.id, formType, values).catch((err) => console.error(err));
      toast.success(
        editingForm === "protest"
          ? "Downloaded. Review it, then use Sign & Submit above to file this protest — or deliver this PDF to your county yourself."
          : editingForm === "agent"
            ? "Downloaded. Once signed, deliver this PDF to your appraisal district."
            : "Downloaded. This affidavit isn't valid until signed before a notary public.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not generate this document.");
    } finally {
      setDownloading(false);
    }
  }

  async function handleConfirmSign() {
    if (!formType || !signature) return;
    setSubmitting(true);
    try {
      // Last-chance correction — catches a date field that was never blurred
      // (e.g. filled by clicking a suggestion chip last) before it's baked
      // into the signed PDF and the saved record.
      const resolvedValues = resolveDateFields(schema, values);
      setValues(resolvedValues);
      const signedAt = new Date();
      const bytes = await signPdf(templatePath, schema, resolvedValues, signature, signedAt);
      const filenameBase = property.accountNumber ?? property.id;
      const fileName =
        editingForm === "protest"
          ? `Signed-Notice-of-Protest-${filenameBase}.pdf`
          : editingForm === "agent"
            ? `Signed-Appointment-of-Agent-${filenameBase}.pdf`
            : `Signed-Evidence-Declaration-${filenameBase}.pdf`;
      const file = new File([bytes as BlobPart], fileName, { type: "application/pdf" });
      const doc = await uploadDocument(
        userId,
        property.id,
        file,
        editingForm === "protest"
          ? "Signed Notice of Protest"
          : editingForm === "agent"
            ? "Signed Appointment of Agent"
            : "Signed Evidence Declaration",
      );
      await signAndSubmit(userId, protest.id, formType, resolvedValues, signature, doc.id);
      // Signing here is NOT the same as filing — this app has no e-filing
      // integration with any county, so it can't truthfully claim the
      // protest has been filed the moment it's signed. Status stays
      // "requested"; the customer confirms filing themselves, once they've
      // actually delivered it, via the "Mark as Filed" action below. For the
      // Evidence Declaration specifically, signing here isn't even a
      // complete signature yet — see the notarization notice in
      // PdfFormEditor.
      if (editingForm === "protest") onNoticeSigned(signedAt.toISOString());
      else if (editingForm === "agent") setAgentFormSignedAt(signedAt.toISOString());
      else setEvidenceDeclarationSignedAt(signedAt.toISOString());
      downloadPdf(bytes, fileName);
      setSigningOpen(false);
      setSignature(null);
      toast.success(
        editingForm === "protest"
          ? 'Signed and saved. This does not file your protest — deliver it to your county (online, by mail, or in person), then click "Mark as Filed" below.'
          : editingForm === "agent"
            ? "Signed and saved. Deliver this PDF to your appraisal district to put it into effect."
            : "Saved. This does not complete your affidavit — Texas law requires it be signed before a notary public.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not sign this document.");
    } finally {
      setSubmitting(false);
    }
  }

  // Just closes the editor — actually recording how/whether this was filed
  // now happens in the always-visible FilingSubmissionFlow panel on the tab
  // behind it (kept the same name since it's already wired as
  // PdfFormEditor's onMarkFiled prop).
  function handleMarkFiled() {
    setEditingForm(null);
  }

  // The Notice of Protest's own FilingSubmissionFlow confirms with the real
  // county — that's the one honest signal this app has for "filed" (no
  // e-filing integration exists), so it's what actually advances the case.
  async function handleNoticeFilingConfirmed() {
    try {
      await markFiled(protest.id);
      onUpdate({ status: "filed" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not mark this case as filed.");
    }
  }

  // Reads the customer's own uploaded evidence and drafts a suggestion for
  // Form 50-132's "Facts to resolve protest" field — never auto-inserted,
  // never automatic; only ever runs from the explicit "Generate Suggested
  // Reason" click inside PdfFormEditor, and always lands in an editable
  // field the customer must review before signing. See protest-reason.ts.
  async function handleGenerateReason() {
    setGeneratingReason(true);
    try {
      const text = await draftProtestReason(property, strategyRecommendation, evidenceDocuments);
      // The two forms' aiSuggestable field has a different real name — 50-132's
      // "Facts to resolve protest" vs. 50-283's "Sect5-1" (Section 5,
      // Statement of Facts or Arguments — see EVIDENCE_DECLARATION_SCHEMA).
      handleFieldChange(editingForm === "evidence" ? "Sect5-1" : "Facts to resolve protest", text);
      toast.success("Suggested — review and edit before signing.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not generate a suggestion.");
    } finally {
      setGeneratingReason(false);
    }
  }

  const countyInfo = getCountyProtestInfo(property.cad);
  const hasEvidence = evidenceDocuments.length > 0;

  return (
    <div id="case-documents">
      <h2 className="font-serif text-lg font-semibold">File Your Protest</h2>
      <p className="text-xs text-muted-foreground">
        Corvus AI takes you through only the steps this case needs — one at a time. Official Texas
        Comptroller forms, pre-filled; review every field, then sign. Completed forms save to your
        Documents.
      </p>
      <VerificationNotice status={property.verificationStatus} note={property.verificationNote} />
      {protest.status === "requested" && (
        <ProtestDeadlineEditor property={property} onSaved={onPropertyUpdate ?? (() => {})} />
      )}

      <FilingStepBar
        steps={filingSteps}
        active={activeStep}
        isDone={stepDone}
        isLocked={stepLocked}
        onSelect={selectStep}
      />
      <p className="mt-2 text-xs text-muted-foreground">{FILING_STEP_META[activeStep].blurb}</p>

      {/* --- Step: Pre-Filing Check --- */}
      {activeStep === "prefiling" && (
        <div className="mt-3">
          <PreFilingCheckList
            items={preFilingItems}
            blocked={preFilingBlocked}
            propertyId={property.id}
            protestId={protest.id}
            propertyTaxYear={property.taxYear}
            onFixed={onPropertyUpdate ?? (() => {})}
            onProtestFixed={(patch) => onUpdate(patch)}
          />
          {preFilingBlocked ? (
            <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              Corvus AI can't confirm this case is ready to file — resolve the field(s) marked
              "Missing" or "Needs review" above (use the editor beside each). The filing steps
              unlock once this is clear.
            </div>
          ) : (
            <div className="mt-3 rounded-md border border-success/30 bg-success/5 p-3 text-sm text-success">
              Everything checks out — continue to File Protest.
            </div>
          )}
        </div>
      )}

      {/* --- Step: File Protest --- */}
      {activeStep === "file" && (
        <div className="mt-3 grid gap-3">
          {!hasEvidence && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-accent/30 bg-accent/5 p-3 text-sm">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Tip (optional):</span> Upload whatever
                evidence you already have first — AI can then suggest a stronger strategy and draft
                the "facts to resolve protest" text for you.
              </p>
              <button
                onClick={goToModule8}
                className="btn-outline shrink-0 whitespace-nowrap text-xs py-1.5"
              >
                Upload Evidence First
              </button>
            </div>
          )}
          {showEvidencePanel && (
            <Modal onClose={() => setShowEvidencePanel(false)} wide>
              <EvidenceChecklistPanel property={property} userId={userId} />
            </Modal>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={openProtestEditor} className="btn-accent text-xs py-1.5">
              File Protest
            </button>
            {noticeSignedAt && (
              <>
                <span className="text-xs text-success">✓ Signed</span>
                <Link
                  to="/dashboard/documents"
                  search={{ propertyId: property.id }}
                  className="text-xs text-accent hover:underline"
                >
                  View in Documents tab →
                </Link>
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Opens the Notice of Protest (Form 50-132) pre-filled from your case — Corvus AI drafts
            the "reasons" from your evidence; review every field, then Save, Sign &amp; download.
            The signed form is saved to your Documents.
          </p>

          {noticeSignedAt ? (
            <>
              <FilingRequirementsPanel steps={filingSteps} hearingDate={protest.hearingDate} />
              <FilingSubmissionFlow
                userId={userId}
                property={property}
                protest={protest}
                formType="notice_of_protest"
                docLabel="Notice of Protest"
                countyInfo={countyInfo}
                onConfirmed={handleNoticeFilingConfirmed}
              />
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Sign your Notice of Protest above to see how to file it with{" "}
              {property.cad ?? "your county"}.
            </p>
          )}
        </div>
      )}

      {/* --- Step: Agent / Representative --- */}
      {activeStep === "agent" && (
        <div className="mt-3 grid gap-2">
          <div>
            <button
              onClick={openAgentEditor}
              disabled={authLoading || !authorization}
              className="btn-accent text-xs py-1.5 disabled:opacity-60"
              title={
                !authLoading && !authorization
                  ? "Autofill needs a signed authorization on file for this case"
                  : undefined
              }
            >
              {agentFormSignedAt
                ? "Review Appointment of Agent"
                : "Open Appointment of Agent (Form 50-162)"}
            </button>
          </div>
          {!authLoading && !authorization && (
            <p className="text-xs text-muted-foreground">
              A signed authorization must be on file before this form can be pre-filled.
            </p>
          )}
          {agentFormSignedAt ? (
            <FilingSubmissionFlow
              userId={userId}
              property={property}
              protest={protest}
              formType="appointment_of_agent"
              docLabel="Appointment of Agent"
              countyInfo={countyInfo}
              onConfirmed={() => {}}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              Sign the Appointment of Agent above to see how to file it.
            </p>
          )}
        </div>
      )}

      {/* --- Step: Evidence Affidavit / Declaration --- */}
      {activeStep === "affidavit" && (
        <div className="mt-3 grid gap-2">
          <div>
            <button onClick={openEvidenceDeclarationEditor} className="btn-accent text-xs py-1.5">
              {evidenceDeclarationSignedAt
                ? "Review Affidavit of Evidence"
                : "Open Affidavit of Evidence (Form 50-283)"}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Form 50-283 is a sworn affidavit — after you sign it in-app, it must be notarized before
            it's delivered to the ARB.
          </p>
          {evidenceDeclarationSignedAt ? (
            <FilingSubmissionFlow
              userId={userId}
              property={property}
              protest={protest}
              formType="evidence_declaration"
              docLabel="Evidence Affidavit"
              countyInfo={countyInfo}
              onConfirmed={() => {}}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              Sign the affidavit above (and have it notarized) to see how to file it.
            </p>
          )}
        </div>
      )}

      {/* --- Step: Evidence --- */}
      {activeStep === "evidence" && (
        <FilingEvidenceStep
          evidenceDocuments={evidenceDocuments}
          strategyRecommendation={strategyRecommendation}
          userId={userId}
          property={property}
          protest={protest}
          countyInfo={countyInfo}
          onConfirmed={handleEvidenceFilingConfirmed}
          affidavitSignedAt={evidenceDeclarationSignedAt}
          onOpenAffidavit={openEvidenceDeclarationEditor}
          onGoTo={onGoTo}
          userEmail={userEmail}
          onProtestChange={onUpdate}
        />
      )}

      {(() => {
        const idx = filingSteps.indexOf(activeStep);
        const next = idx >= 0 ? filingSteps[idx + 1] : undefined;
        const done = stepDone(activeStep);
        const blocked =
          (preFilingBlocked && activeStep === "prefiling") ||
          (activeStep === "file" && !noticeDone);
        return (
          <div
            className={`mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 ${
              done ? "border-success/30 bg-success/5" : "border-border bg-secondary/40"
            }`}
          >
            <div className="min-w-0 basis-56 flex-1 text-sm">
              <div className="text-xs text-muted-foreground">
                Step {idx + 1} of {filingSteps.length}: {FILING_STEP_META[activeStep].label}
              </div>
              <div className={done ? "font-medium text-success" : "font-medium"}>
                {done
                  ? "✓ This step is complete."
                  : blocked
                    ? activeStep === "file"
                      ? "File your Notice of Protest above to continue."
                      : "Fix the flagged items above to continue."
                    : !next
                      ? "Finish the checklist above, then submit your evidence before your hearing."
                      : optionalSteps.includes(activeStep)
                        ? "Optional — only if someone will represent you. Otherwise, go on to the next step."
                        : "Not finished yet. Complete it above, or skip ahead."}
              </div>
            </div>
            {next ? (
              <button
                type="button"
                onClick={() => selectStep(next)}
                disabled={blocked}
                className="btn-primary shrink-0 text-sm disabled:opacity-60"
              >
                Next step: {FILING_STEP_META[next].label} →
              </button>
            ) : onFinish ? (
              <button type="button" onClick={onFinish} className="btn-primary shrink-0 text-sm">
                {done ? "Done — go to Informal Review →" : "Skip for now — go to Informal Review →"}
              </button>
            ) : (
              <span className="text-sm text-muted-foreground">
                {done ? "All filing steps are done." : "This is the last step."}
              </span>
            )}
          </div>
        );
      })()}

      {editingForm && (
        <PdfFormEditor
          title={
            editingForm === "protest"
              ? "Notice of Protest (Form 50-132)"
              : editingForm === "agent"
                ? "Appointment of Agent (Form 50-162)"
                : "Property Owner's Affidavit of Evidence (Form 50-283)"
          }
          sections={schema}
          values={values}
          onChange={handleFieldChange}
          onDownload={handleDownload}
          downloading={downloading}
          onSaveProgress={handleSaveProgress}
          saving={saving}
          allowSigning={allowSigning}
          signingOpen={signingOpen}
          onOpenSigning={() => {
            setSignature(null);
            setSigningOpen(true);
          }}
          onCancelSigning={() => {
            setSigningOpen(false);
            setSignature(null);
          }}
          signature={signature}
          onSignatureChange={setSignature}
          onConfirmSign={handleConfirmSign}
          submitting={submitting}
          expectedSignerName={(() => {
            const key =
              editingForm === "protest"
                ? "Print Name of Property Owner or Authorized Representative"
                : editingForm === "agent"
                  ? "Name of Property Owner"
                  : "Affiant Name_2";
            const v = values[key];
            return typeof v === "string" && v ? v : undefined;
          })()}
          onClose={() => setEditingForm(null)}
          formKind={
            editingForm === "protest"
              ? "protest"
              : editingForm === "agent"
                ? "agent"
                : "evidence-declaration"
          }
          countyInfo={countyInfo}
          signedAt={
            editingForm === "protest"
              ? noticeSignedAt
              : editingForm === "agent"
                ? agentFormSignedAt
                : evidenceDeclarationSignedAt
          }
          caseStatus={protest.status}
          onMarkFiled={handleMarkFiled}
          markingFiled={false}
          hasEvidence={hasEvidence}
          generatingReason={generatingReason}
          onGenerateReason={handleGenerateReason}
        />
      )}
    </div>
  );
}

// The filing workflow's step indicator — the 2–4 active steps as
// "1 File Protest → 2 Agent → …", each marked done / current / upcoming. The
// user always sees where they are; a step is clickable once it's in the set
// (upcoming steps are shown but reading-only until the prior work is done —
// enforced by the panels themselves, not disabled here, so the user can look
// ahead).
function FilingStepBar({
  steps,
  active,
  isDone,
  isLocked,
  onSelect,
}: {
  steps: FilingStepId[];
  active: FilingStepId;
  isDone: (id: FilingStepId) => boolean;
  // Blocked Pre-Filing Check, or Notice of Protest not yet signed.
  isLocked: (id: FilingStepId) => boolean;
  onSelect: (id: FilingStepId) => void;
}) {
  return (
    <ol className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs">
      {steps.map((id, i) => {
        const done = isDone(id);
        const here = id === active;
        const locked = isLocked(id);
        return (
          <li key={id} className="flex items-center gap-1">
            {i > 0 && <span className="text-muted-foreground/40">→</span>}
            <button
              type="button"
              onClick={() => onSelect(id)}
              aria-current={here ? "step" : undefined}
              className={`rounded-full px-2.5 py-1 font-medium ${
                here
                  ? "bg-accent/15 text-accent"
                  : locked
                    ? "text-muted-foreground/40"
                    : done
                      ? "text-success hover:bg-secondary"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              <span className="tabular-nums">{locked ? "🔒" : done ? "✓" : i + 1}</span>{" "}
              {FILING_STEP_META[id].label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// The workflow's Evidence step: the case's real evidence at a glance, what's
// still critically missing, a way to go add more (Module 8), and a record that
// the package was submitted to the county. Uses the "Protest Evidence"-tagged
// documents already loaded for this case — never a separate list.
function FilingEvidenceStep({
  evidenceDocuments,
  strategyRecommendation,
  userId,
  property,
  protest,
  countyInfo,
  onConfirmed,
  affidavitSignedAt,
  onOpenAffidavit,
  onGoTo,
  userEmail,
  onProtestChange,
}: {
  evidenceDocuments: DocumentRecord[];
  strategyRecommendation: string | null;
  userId: string;
  property: PropertyRecord;
  protest: ProtestRecord;
  countyInfo: CountyProtestInfo | null;
  onConfirmed: (at: string) => void;
  affidavitSignedAt: string | null;
  onOpenAffidavit: () => void;
  onGoTo?: (anchor: string) => void;
  userEmail?: string | null;
  onProtestChange?: (patch: Partial<ProtestRecord>) => void;
}) {
  // The district's-evidence request lives in this step too (same section as
  // the Formal Hearing tab) — request it and upload what comes back here.
  const scrollToCad = () =>
    document
      .getElementById("evidence-step-cad")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  // What has to be in place before evidence is submitted: the ARB's hearing
  // notice, the district's own evidence (requested and received — Tax Code
  // §41.461), and the signed Evidence Affidavit (Form 50-283) that goes in
  // with the evidence.
  const [noticeOnFile, setNoticeOnFile] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    const fromCase = !!(protest.hearingLocation || protest.hearingTime);
    getLatestHearingNotice(protest.id)
      .then((n) => {
        if (live) setNoticeOnFile(!!n || fromCase);
      })
      .catch(() => {
        if (live) setNoticeOnFile(fromCase);
      });
    return () => {
      live = false;
    };
  }, [protest.id, protest.hearingLocation, protest.hearingTime]);
  const prereqs: {
    key: string;
    label: string;
    done: boolean;
    action: { label: string; onClick: () => void } | null;
  }[] = [
    {
      key: "notice",
      label: "Hearing notice uploaded",
      done: !!noticeOnFile,
      action: onGoTo
        ? { label: "Upload hearing notice", onClick: () => onGoTo("case-hearing-notice") }
        : null,
    },
    {
      key: "requested",
      label: "County's evidence requested from the district",
      done: !!protest.cadEvidenceRequestedAt,
      action: onProtestChange
        ? { label: "Request it", onClick: scrollToCad }
        : onGoTo
          ? { label: "Request it", onClick: () => onGoTo("case-cad-evidence") }
          : null,
    },
    {
      key: "received",
      label: "County's evidence received and uploaded",
      done: !!protest.cadEvidenceReceivedAt,
      action: onProtestChange
        ? { label: "Upload it", onClick: scrollToCad }
        : onGoTo
          ? { label: "Upload it", onClick: () => onGoTo("case-cad-evidence") }
          : null,
    },
    {
      key: "affidavit",
      label: "Evidence Affidavit (Form 50-283) signed",
      done: !!affidavitSignedAt,
      action: { label: affidavitSignedAt ? "Review" : "Fill & sign", onClick: onOpenAffidavit },
    },
  ];
  const ready = prereqs.every((p) => p.done);
  const withIssues = evidenceDocuments.filter(
    (d) => d.aiVerdict === "issues" || d.aiVerdict === "invalid",
  );
  // Bumped once the package builder saves a new proof document, so the
  // FilingSubmissionFlow below (which loaded its own proof list before that
  // existed) picks it up without a full page reload.
  const [refreshToken, setRefreshToken] = useState(0);
  const [showEvidencePanel, setShowEvidencePanel] = useState(false);
  return (
    <div className="mt-3 grid gap-3 text-sm">
      <div
        className={`rounded-lg border p-3 ${ready ? "border-success/30 bg-success/5" : "border-warning/40 bg-warning/5"}`}
      >
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Before you submit your evidence
        </div>
        <ul className="mt-2 grid gap-1.5">
          {prereqs.map((p) => (
            <li key={p.key} className="flex flex-wrap items-center justify-between gap-2">
              <span className={p.done ? "text-success" : ""}>
                {p.done ? "✓" : "○"} {p.label}
              </span>
              {p.action && (!p.done || p.key === "affidavit") && (
                <button
                  type="button"
                  onClick={p.action.onClick}
                  className="btn-outline px-2.5 py-1 text-xs"
                >
                  {p.action.label}
                </button>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-muted-foreground">
          * The signed affidavit is added to your evidence package and submitted with it. It must be
          notarized before delivery to the ARB.
        </p>
      </div>
      {onProtestChange && (
        <div id="evidence-step-cad" className="scroll-mt-4">
          <CadEvidenceRequest
            userId={userId}
            property={property}
            protest={protest}
            userEmail={userEmail ?? null}
            onChange={onProtestChange}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {evidenceDocuments.length} evidence document{evidenceDocuments.length === 1 ? "" : "s"} on
          this case
          {withIssues.length > 0 && ` · ${withIssues.length} flagged by AI review`}
        </span>
        <button
          onClick={() => setShowEvidencePanel(true)}
          className="btn-outline shrink-0 text-xs py-1.5"
        >
          Add / organize evidence
        </button>
      </div>
      {showEvidencePanel && (
        <Modal onClose={() => setShowEvidencePanel(false)} wide>
          <EvidenceChecklistPanel property={property} userId={userId} />
        </Modal>
      )}

      {evidenceDocuments.length === 0 ? (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning-foreground">
          No evidence has been uploaded for this case yet. Module 8 finds and verifies what it can
          from public records, then flags only the critical evidence you need to provide.
        </div>
      ) : (
        <ul className="grid gap-1">
          {evidenceDocuments.slice(0, 12).map((d) => {
            const v = verdictMeta(d.aiVerdict);
            return (
              <li
                key={d.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs"
              >
                <span className="truncate">{d.fileName}</span>
                <span
                  className={`shrink-0 font-semibold ${
                    v.tone === "success"
                      ? "text-success"
                      : v.tone === "warning"
                        ? "text-warning-foreground"
                        : "text-destructive"
                  }`}
                >
                  {d.aiCheckedAt ? v.label : "Not checked"}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {strategyRecommendation && (
        <p className="text-xs text-muted-foreground">
          Organize the package around your protest strategy: {strategyRecommendation}
        </p>
      )}

      {evidenceDocuments.length > 0 && (
        <EvidencePackageBuilder
          userId={userId}
          property={property}
          protest={protest}
          evidenceDocuments={evidenceDocuments}
          onSaved={() => setRefreshToken((t) => t + 1)}
        />
      )}

      {ready ? (
        <FilingSubmissionFlow
          userId={userId}
          property={property}
          protest={protest}
          formType="evidence"
          docLabel="Evidence Package"
          countyInfo={countyInfo}
          onConfirmed={onConfirmed}
          refreshToken={refreshToken}
        />
      ) : (
        <div className="rounded-md border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
          Evidence submission unlocks once the steps above are complete.
        </div>
      )}
    </div>
  );
}

// Generate Evidence Package — combines the real evidence documents Module 8
// already matched to this case's checklist into one downloadable PDF, using
// selectRelevantEvidence/buildEvidencePackagePdf (evidence-package.ts). The
// user can add/remove/reorder before generating; saving it becomes the
// Evidence submission's own real proof (FilingSubmissionFlow above), so
// there's exactly one "Evidence Submitted" toggle, not a second one here.
function EvidencePackageBuilder({
  userId,
  property,
  protest,
  evidenceDocuments,
  onSaved,
}: {
  userId: string;
  property: PropertyRecord;
  protest: ProtestRecord;
  evidenceDocuments: DocumentRecord[];
  onSaved: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deadline, setDeadline] = useState<string | null>(null);
  const [reminderFrequency, setReminderFrequencyState] = useState<ReminderFrequency>("weekly");
  const [generating, setGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBytes, setPreviewBytes] = useState<Uint8Array | null>(null);
  const [previewPages, setPreviewPages] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  // Every OTHER document already uploaded for this property (survey, permit,
  // photos...) that Module 8 didn't tag as evidence — offered below so the
  // package can include them without re-uploading anything.
  const [otherDocs, setOtherDocs] = useState<DocumentRecord[]>([]);
  const [showOthers, setShowOthers] = useState(false);
  const docsVersion = useDocumentsVersion();

  useEffect(() => {
    let live = true;
    listDocuments(userId)
      .then((docs) => {
        if (!live) return;
        const inEvidence = new Set(evidenceDocuments.map((d) => d.id));
        setOtherDocs(
          docs.filter(
            (d) =>
              d.propertyId === property.id &&
              !inEvidence.has(d.id) &&
              // Only what can actually be merged into the PDF, and never the
              // filing-proof copies (a previous package or signed forms).
              previewKind(d.fileName) !== "none" &&
              !d.documentType?.startsWith("Filing Proof"),
          ),
        );
      })
      .catch((err) => console.error("Could not load this property's other documents:", err));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, property.id, docsVersion, evidenceDocuments.length]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all([
      getCachedModuleResult(property.id, "evidence"),
      getLatestHearingNotice(protest.id),
      getSubmission(protest.id, "evidence"),
    ])
      .then(([cached, notice, submission]) => {
        if (!live) return;
        const items = cached ? ((cached.result as ModuleResultMap["evidence"]).items ?? []) : null;
        const preselected = selectRelevantEvidence(evidenceDocuments, items);
        setSelectedIds((preselected.length > 0 ? preselected : evidenceDocuments).map((d) => d.id));
        setDeadline(notice?.evidenceSubmissionDeadline ?? null);
        setReminderFrequencyState(submission?.reminderFrequency ?? "weekly");
        // Seed a real row at the default frequency so send-evidence-reminders
        // has something to find — "by default, weekly reminders" shouldn't
        // require the user to first open this dropdown and pick "Weekly"
        // themselves. Weekly, not daily — a customer with several properties
        // getting one email per property per day read as spam.
        if (!submission) {
          saveReminderFrequency(userId, protest.id, "evidence", "weekly").catch((err) =>
            console.error("Could not seed the default reminder frequency:", err),
          );
        }
      })
      .catch((err) => console.error("Could not prepare the evidence package builder:", err))
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // Runs once per property/case — evidenceDocuments changing (a fresh
    // array reference on every parent render) shouldn't re-run this and
    // silently reset an in-progress selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [property.id, protest.id]);

  // The signed Evidence Affidavit goes in with the evidence — select it once
  // it exists (the user can still untick it).
  const autoAffidavit = useRef<string | null>(null);
  useEffect(() => {
    const aff = otherDocs.find((d) => d.documentType === "Signed Evidence Declaration");
    if (!aff || autoAffidavit.current === aff.id) return;
    autoAffidavit.current = aff.id;
    setSelectedIds((prev) => (prev.includes(aff.id) ? prev : [...prev, aff.id]));
  }, [otherDocs]);

  const allDocs = [...evidenceDocuments, ...otherDocs];
  // The main list: the evidence documents, plus any extra the user has ticked.
  const listedDocs = [...evidenceDocuments, ...otherDocs.filter((d) => selectedIds.includes(d.id))];
  const addableDocs = otherDocs.filter((d) => !selectedIds.includes(d.id));

  function toggle(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }
  function moveUp(id: string) {
    setSelectedIds((prev) => {
      const i = prev.indexOf(id);
      if (i <= 0) return prev;
      const next = [...prev];
      [next[i - 1], next[i]] = [next[i], next[i - 1]];
      return next;
    });
  }
  function moveDown(id: string) {
    setSelectedIds((prev) => {
      const i = prev.indexOf(id);
      if (i === -1 || i >= prev.length - 1) return prev;
      const next = [...prev];
      [next[i + 1], next[i]] = [next[i], next[i + 1]];
      return next;
    });
  }

  async function handleGenerate() {
    setGenerating(true);
    try {
      const selectedDocs = selectedIds
        .map((id) => allDocs.find((d) => d.id === id))
        .filter((d): d is DocumentRecord => !!d);
      const files = [];
      for (const d of selectedDocs) {
        const url = await getDocumentUrl(d.storagePath);
        const bytes = await fetch(url).then((r) => r.arrayBuffer());
        files.push({ fileName: d.fileName, bytes });
      }
      const pdfBytes = await buildEvidencePackagePdf(files);
      setPreviewBytes(pdfBytes);
      setPreviewPages(await countPdfPages(pdfBytes).catch(() => null));
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(new Blob([pdfBytes as BlobPart], { type: "application/pdf" }));
      });
      toast.success("Package generated — review it below.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not generate the package."));
    } finally {
      setGenerating(false);
    }
  }

  async function handleSaveToDocuments() {
    if (!previewBytes) return;
    setSaving(true);
    try {
      const fileName = `Evidence-Package-${property.accountNumber ?? property.id}.pdf`;
      const file = new File([previewBytes as BlobPart], fileName, { type: "application/pdf" });
      await uploadDocument(userId, property.id, file, filingProofDocumentType("evidence"));
      toast.success("Saved to Documents — this is now your Evidence proof.");
      onSaved();
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save this."));
    } finally {
      setSaving(false);
    }
  }

  function handleDownload() {
    if (!previewBytes) return;
    downloadPdf(previewBytes, `Evidence-Package-${property.accountNumber ?? property.id}.pdf`);
  }

  async function handleReminderChange(freq: ReminderFrequency) {
    setReminderFrequencyState(freq);
    try {
      await saveReminderFrequency(userId, protest.id, "evidence", freq);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save this."));
    }
  }

  if (loading) {
    return <p className="text-xs text-muted-foreground">Preparing the evidence package builder…</p>;
  }

  return (
    <div className="rounded-md border border-border p-3 text-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Generate Evidence Package
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Corvus AI pre-selected the documents Module 8 already matched to your case — add, remove, or
        reorder before generating.
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {deadline
          ? `Deadline: ${new Date(`${deadline}T00:00:00`).toLocaleDateString()}.`
          : "Deadline not confirmed yet — check your hearing notice."}
      </p>

      <ul className="mt-2 grid gap-1">
        {listedDocs.map((d) => {
          const idx = selectedIds.indexOf(d.id);
          const checked = idx !== -1;
          return (
            <li
              key={d.id}
              className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs"
            >
              <input type="checkbox" checked={checked} onChange={() => toggle(d.id)} />
              <span className="min-w-0 flex-1 truncate">{d.fileName}</span>
              {checked && (
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => moveUp(d.id)}
                    disabled={idx === 0}
                    className="text-muted-foreground disabled:opacity-30"
                    aria-label={`Move ${d.fileName} up`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveDown(d.id)}
                    disabled={idx === selectedIds.length - 1}
                    className="text-muted-foreground disabled:opacity-30"
                    aria-label={`Move ${d.fileName} down`}
                  >
                    ↓
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {addableDocs.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowOthers((v) => !v)}
            aria-expanded={showOthers}
            className="text-xs text-accent hover:underline"
          >
            {showOthers
              ? "Hide other documents"
              : `+ Add from your other documents (${addableDocs.length})`}
          </button>
          {showOthers && (
            <ul className="mt-1.5 grid gap-1">
              {addableDocs.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center gap-2 rounded-md border border-dashed border-border px-2 py-1 text-xs"
                >
                  <span className="min-w-0 flex-1 truncate">{d.fileName}</span>
                  {d.documentType && (
                    <span className="hidden shrink-0 text-muted-foreground sm:inline">
                      {d.documentType.replace(/^Evidence Category: /, "")}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => toggle(d.id)}
                    className="shrink-0 font-medium text-accent hover:underline"
                    aria-label={`Add ${d.fileName} to the package`}
                  >
                    Add
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <label className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        Remind me:
        <select
          value={reminderFrequency}
          onChange={(e) => handleReminderChange(e.target.value as ReminderFrequency)}
          className="rounded-md border border-input bg-background px-1.5 py-1 text-xs"
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="off">Off</option>
        </select>
      </label>

      <div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating || selectedIds.length === 0}
          className="btn-accent mt-3 text-xs py-1.5 disabled:opacity-60"
        >
          {generating ? "Generating…" : "Generate Package"}
        </button>
      </div>

      {previewUrl && (
        <div className="mt-3">
          {previewPages != null && previewBytes && (
            <p className="mb-1 text-xs text-muted-foreground">
              Package ready — {previewPages} page{previewPages === 1 ? "" : "s"},{" "}
              {(previewBytes.byteLength / (1024 * 1024)).toFixed(1)} MB. If the preview below is
              blank, your browser is blocking its built-in PDF viewer — use Open in new tab or
              Download.
            </p>
          )}
          <iframe
            title="Evidence package preview"
            src={previewUrl}
            className="h-64 w-full rounded-md border border-border"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.open(previewUrl, "_blank", "noopener,noreferrer")}
              className="btn-outline text-xs py-1.5"
            >
              Open in new tab
            </button>
            <button
              type="button"
              onClick={handleSaveToDocuments}
              disabled={saving}
              className="btn-accent text-xs py-1.5 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save to Documents"}
            </button>
            <button type="button" onClick={handleDownload} className="btn-outline text-xs py-1.5">
              Download
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
