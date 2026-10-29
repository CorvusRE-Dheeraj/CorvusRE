// Informal Review tab: review scheduling, outcome and settlement (split out of CaseDetailModal.tsx).
import { SettlementHistory } from "@/components/SettlementHistory";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { askAboutDocument } from "@/lib/document-ai";
import { MarkdownLite } from "@/components/MarkdownLite";
import { AskAiMicButton } from "@/components/AskAiMicButton";
import { type PropertyRecord } from "@/lib/properties";
import { INFORMAL_STATUS_LABEL, type ProtestRecord, type InformalStatus } from "@/lib/protests";
import { currency } from "@/lib/intake-store";
import {
  updateInformalStatus,
  undoInformalStep,
  scheduleInformalReview,
  cancelInformalReviewMeeting,
  resolveInformalSettlement,
  saveInformalAppraiserCategory,
} from "@/lib/protest-case";
import { getCountyProtestInfo, informalReviewContact } from "@/lib/county-protest-info";
import { LEGAL_CONTACT } from "@/lib/legal";
import { CountyInformalContact, JoinInformalMeeting } from "@/components/case/informal-meeting";
import {
  uploadDocument,
  getDocumentById,
  getDocumentUrl,
  SETTLEMENT_DOCUMENT_TYPE,
  type DocumentRecord,
} from "@/lib/documents";
import {
  getLatestHearingNotice,
  type HearingNoticeRecord,
  type HearingMode,
} from "@/lib/hearing-notice";
import {
  getInformalReviewGuidance,
  buildInformalReviewMailto,
  type InformalReviewGuidance,
} from "@/lib/informal-review";
import {
  type DecisionExtraction,
  documentMismatch,
  SETTLEMENT_CATEGORIES,
} from "@/lib/decision-notice";
import {
  extractSettlementDocument,
  saveSettlementAgreement,
  confirmSettlementAgreement,
  signSettlementAgreement,
  recordSettlementResponse,
  verifySignedSettlementCopy,
  confirmSettlementOutcome,
  type SettlementAgreementRecord,
} from "@/lib/settlement-agreement";
import { getErrorMessage } from "@/lib/error-message";
import { downloadPdf } from "@/lib/protest-documents";
import { UndoButton } from "@/components/UndoButton";
import { UploadedDocBar } from "@/components/UploadedDocBar";
import { removeSettlement } from "@/lib/upload-undo";
import { SignaturePad, type SignatureValue } from "@/components/SignaturePad";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Calendar as DatePickerCalendar } from "@/components/ui/calendar";
import { CalendarDays } from "lucide-react";
import { Field } from "@/components/case/shared";

// Every real, trackable informal-review sub-state, in the same order the
// product spec listed them — the raw options for the status dropdown below.
// Distinct from INFORMAL_STATUS_LABEL (protests.ts), which collapses these
// to the shorter user-facing badge text; this dropdown shows the real,
// specific state the user is actually setting.
const INFORMAL_STATUS_OPTIONS: { value: InformalStatus; label: string }[] = [
  { value: "not_requested", label: "Not Requested" },
  { value: "requested", label: "Requested" },
  { value: "pending_response", label: "Pending County Response" },
  { value: "scheduled", label: "Scheduled" },
  { value: "proposed_value_received", label: "Proposed Value Received" },
  { value: "accepted", label: "Accepted" },
  { value: "rejected", label: "Rejected" },
  { value: "no_informal_available", label: "No Informal Available" },
  { value: "completed", label: "Informal Review Completed" },
];

// "14:30" (the value an <input type="time"> yields) → "2:30 PM", the same
// human display string the hearing-notice extraction stores, so the informal
// review's time reads the same everywhere (calendar title included).
function formatInputTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h)) return hhmm;
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m ?? 0).padStart(2, "0")} ${period}`;
}

// The reverse — a stored "2:30 PM" back to "14:30" so it can seed the
// <input type="time"> when the section re-opens. Returns "" for anything
// that doesn't parse.
function parseTimeToInput(display: string | null | undefined): string {
  if (!display) return "";
  const m = display.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return "";
  let h = Number(m[1]);
  const period = m[3]?.toUpperCase();
  if (period === "PM" && h < 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

// Same "local calendar date, no timezone math" convention as the rest of this
// file's date-only fields (see pre-filing-check.ts's own comment on this) —
// built from/read back via the Date object's local getters, never toISOString,
// so a viewer west of UTC never sees the day roll back by one.
function dateInputToDate(v: string): Date | undefined {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function dateToDateInput(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

const INFORMAL_REVIEW_MODES: HearingMode[] = [
  "In Person",
  "Phone",
  "Videoconference",
  "Affidavit",
  "Unknown",
];

export function InformalReviewSection({
  userId,
  protest,
  property,
  strategyRecommendation,
  evidenceDocuments,
  onUpdate,
  onAgreementChange,
  onOpenHearing,
}: {
  userId: string;
  protest: ProtestRecord;
  property: PropertyRecord;
  strategyRecommendation: string | null;
  evidenceDocuments: DocumentRecord[];
  onUpdate: (patch: Partial<ProtestRecord>) => void;
  onAgreementChange: (a: SettlementAgreementRecord | null) => void;
  onOpenHearing: () => void;
}) {
  const [updatingStatus, setUpdatingStatus] = useState(false);
  // Shown after marking the review completed cancelled a scheduled meeting.
  const [cancelledNotice, setCancelledNotice] = useState<string | null>(null);
  const [dateInput, setDateInput] = useState(protest.informalReviewDate ?? "");
  const [timeInput, setTimeInput] = useState(parseTimeToInput(protest.informalReviewTime));
  const [modeInput, setModeInput] = useState<HearingMode>(
    protest.informalReviewMode ?? "In Person",
  );
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [guidance, setGuidance] = useState<InformalReviewGuidance | null>(null);
  const [loadingGuidance, setLoadingGuidance] = useState(false);
  const [guidanceError, setGuidanceError] = useState<string | null>(null);
  const [notice, setNotice] = useState<HearingNoticeRecord | null>(null);
  // "Submit Settlement Document": the file is read, uploaded, and the protest
  // closed at the settled value. If the value can't be read off the document,
  // the user types it (settleNeedsValue) before the case is closed.
  const [settling, setSettling] = useState(false);
  const [settleFile, setSettleFile] = useState<File | null>(null);
  const [settleExtraction, setSettleExtraction] = useState<DecisionExtraction | null>(null);
  const [settleNeedsValue, setSettleNeedsValue] = useState(false);
  const [settleValueInput, setSettleValueInput] = useState("");

  // Inline Q&A — stateless, same engine as the site-wide Ask AI widget
  // (ask-about-document). Only the latest question/answer is kept on screen.
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [qaError, setQaError] = useState<string | null>(null);

  const countyInfo = getCountyProtestInfo(property.cad);
  const contact = informalReviewContact(countyInfo);
  // How to join, by mode — prefilled with what's on file, else the county's
  // own number / office address.
  const [linkInput, setLinkInput] = useState(protest.informalReviewLink ?? "");
  const [phoneInput, setPhoneInput] = useState(
    protest.informalReviewPhone ?? contact?.phones[0] ?? "",
  );
  const [locationInput, setLocationInput] = useState(
    protest.informalReviewLocation ?? contact?.inPersonAddress ?? "",
  );
  // The county's email can fill these in while the tab is open.
  useEffect(() => {
    if (protest.informalReviewLink) setLinkInput(protest.informalReviewLink);
    if (protest.informalReviewPhone) setPhoneInput(protest.informalReviewPhone);
  }, [protest.informalReviewLink, protest.informalReviewPhone]);

  // The latest hearing/county notice already read for this case — grounds the
  // guidance below (see getInformalReviewGuidance's noticeContext arg). Same
  // call HearingNoticeSection and HearingPrepSection already make.
  useEffect(() => {
    getLatestHearingNotice(protest.id)
      .then((n) => {
        setNotice(n);
        // Seed the date only from a notice that's actually about an informal
        // review — never the formal ARB hearing date.
        if (n?.hearingDate && /informal/i.test(n.hearingType ?? "")) {
          setDateInput((prev) => prev || n.hearingDate!);
        }
      })
      .catch((err) => console.error("Could not load hearing notice:", err));
  }, [protest.id]);

  async function handleStatusChange(status: InformalStatus) {
    setUpdatingStatus(true);
    try {
      await updateInformalStatus(protest.id, status);
      onUpdate({ informalStatus: status });
      // Completed means the meeting isn't happening any more — take a
      // still-scheduled one off the case and the calendar, and say so.
      if (status === "completed" && protest.informalReviewDate) {
        const previous = {
          date: protest.informalReviewDate,
          time: protest.informalReviewTime ?? null,
          mode: protest.informalReviewMode ?? null,
        };
        await cancelInformalReviewMeeting(protest.id, previous);
        onUpdate({
          informalReviewDate: null,
          informalReviewTime: null,
          informalReviewMode: null,
          informalReviewLink: null,
          informalReviewPhone: null,
          informalReviewLocation: null,
          informalReviewLinkSource: null,
        });
        const when = new Date(`${previous.date.slice(0, 10)}T12:00:00`).toLocaleDateString(
          "en-US",
          {
            month: "short",
            day: "numeric",
            year: "numeric",
          },
        );
        const msg = `Your informal review meeting on ${when}${previous.time ? ` at ${previous.time}` : ""} was cancelled and removed from your calendar.`;
        setCancelledNotice(msg);
        toast.info(msg);
      }
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not update this status."));
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handleInformalCompleted() {
    await handleStatusChange("completed");
    toast.success(
      "Informal review marked completed. If you reached a settlement, submit the settlement document — otherwise continue to the Formal Hearing tab.",
    );
  }

  // The owner is not satisfied with what the informal review produced — same
  // "rejected" informal status the settlement flow uses, which is what moves the
  // case to the formal hearing.
  async function handleUnsatisfied() {
    await handleStatusChange("rejected");
    toast.success("Recorded — the case moved to a formal hearing.");
  }

  async function closeWithSettlement(
    file: File,
    extraction: DecisionExtraction | null,
    settledValue: number,
  ) {
    setSettling(true);
    try {
      const doc = await uploadDocument(userId, property.id, file, SETTLEMENT_DOCUMENT_TYPE);
      if (extraction) {
        onAgreementChange(await saveSettlementAgreement(userId, protest.id, doc.id, extraction));
      }
      await resolveInformalSettlement(protest.id, settledValue);
      onUpdate({
        status: "resolved",
        finalValue: settledValue,
        escalationPath: "accept",
        closedAt: new Date().toISOString(),
        informalStatus: "accepted",
      });
      setSettleFile(null);
      setSettleExtraction(null);
      setSettleNeedsValue(false);
      toast.success(`Settlement document submitted — protest closed at ${currency(settledValue)}.`);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not submit the settlement document."));
    } finally {
      setSettling(false);
    }
  }

  async function handleSettlementFile(file: File) {
    setSettling(true);
    let extraction: DecisionExtraction | null = null;
    try {
      extraction = await extractSettlementDocument(property, protest, file);
    } catch {
      // Unreadable by AI — fall through to asking for the settled value.
    }
    setSettling(false);
    const wrong = extraction
      ? documentMismatch(
          extraction,
          property,
          SETTLEMENT_CATEGORIES,
          "a signed settlement agreement",
        )
      : null;
    if (wrong) {
      toast.error(wrong);
      return;
    }
    const value = extraction?.finalValue ?? null;
    if (value != null && value > 0) {
      await closeWithSettlement(file, extraction, value);
      return;
    }
    setSettleFile(file);
    setSettleExtraction(extraction);
    setSettleValueInput("");
    setSettleNeedsValue(true);
  }

  async function handleConfirmSettleValue() {
    const value = Number(settleValueInput.replace(/[^0-9.]/g, ""));
    if (!settleFile || !Number.isFinite(value) || value <= 0) {
      toast.error("Enter the settled value from the document.");
      return;
    }
    await closeWithSettlement(settleFile, settleExtraction, value);
  }

  async function handleSaveSchedule(e: FormEvent) {
    e.preventDefault();
    if (!dateInput) return;
    const link = modeInput === "Videoconference" ? linkInput.trim() || null : null;
    if (link && !/^https:\/\/\S+$/i.test(link)) {
      toast.error("Paste the full meeting link, starting with https://");
      return;
    }
    const phone =
      modeInput === "Phone" || modeInput === "Videoconference" ? phoneInput.trim() || null : null;
    const location = modeInput === "In Person" ? locationInput.trim() || null : null;
    // Still the county email's link/dial-in if the owner didn't change them.
    const linkSource =
      protest.informalReviewLinkSource === "county_email" &&
      link === (protest.informalReviewLink ?? null) &&
      (phone ?? null) === (protest.informalReviewPhone ?? null)
        ? "county_email"
        : "owner";
    setSavingSchedule(true);
    try {
      const displayTime = timeInput ? formatInputTime(timeInput) : null;
      await scheduleInformalReview(protest.id, dateInput, {
        time: displayTime,
        mode: modeInput,
        link,
        phone,
        location,
        linkSource,
      });
      onUpdate({
        informalStatus: "scheduled",
        informalReviewDate: dateInput,
        informalReviewTime: displayTime,
        informalReviewMode: modeInput,
        informalReviewLink: link,
        informalReviewPhone: phone,
        informalReviewLocation: location,
        informalReviewLinkSource: linkSource,
      });
      toast.success("Informal review scheduled — added to your calendar.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save this schedule."));
    } finally {
      setSavingSchedule(false);
    }
  }

  async function handleGetGuidance() {
    setLoadingGuidance(true);
    setGuidanceError(null);
    try {
      const result = await getInformalReviewGuidance(
        property,
        countyInfo,
        strategyRecommendation,
        property.estimatedSavings,
        evidenceDocuments.map((d) => d.fileName),
        notice,
      );
      setGuidance(result);
      // Saved quietly — never its own prominent field, see the schema
      // comment on informal_appraiser_category — just so it's on file the
      // next time this case's guidance is looked at (by staff, say).
      saveInformalAppraiserCategory(protest.id, result.appraiserCategory).catch((err) =>
        console.error("Could not save appraiser category:", err),
      );
    } catch (err) {
      setGuidanceError(getErrorMessage(err, "Could not get guidance. Please try again."));
    } finally {
      setLoadingGuidance(false);
    }
  }

  async function handleAsk(e: FormEvent) {
    e.preventDefault();
    await askQuestion();
  }

  // Split out from handleAsk so the mic's onFinal can submit the just-spoken
  // text directly instead of relying on `question` state having flushed from
  // the same setQuestion() call that filled it — the two can otherwise race.
  async function askQuestion(override?: string) {
    const q = (override ?? question).trim();
    if (!q || asking) return;
    setAsking(true);
    setQaError(null);
    setAnswer(null);
    try {
      const context = [
        `Property: ${property.address}${property.cad ? `, ${property.cad}` : ""}`,
        property.accountNumber ? `Account: ${property.accountNumber}` : null,
        property.taxYear ? `Tax year: ${property.taxYear}` : null,
        strategyRecommendation ? `Case strategy: ${strategyRecommendation}` : null,
        countyInfo?.informalReview?.howToRequest
          ? `County informal-review process: ${countyInfo.informalReview.howToRequest}`
          : null,
        notice
          ? `Uploaded notice — hearing date ${notice.hearingDate ?? "n/a"}, evidence deadline ${
              notice.evidenceSubmissionDeadline ?? "n/a"
            }, county contact ${notice.countyContact ?? "n/a"}, informal review available: ${
              notice.informalReviewAvailable
            }. Instructions: ${notice.submissionInstructions ?? "none stated"}`
          : "No county notice uploaded for this case yet.",
        guidance
          ? `Guidance already shown to the user — steps: ${guidance.steps.join(
              " | ",
            )}; where to schedule: ${guidance.whereToSchedule || "unknown"}; deadlines: ${
              guidance.applicableDeadlines.join(" | ") || "none"
            }.`
          : null,
      ]
        .filter(Boolean)
        .join("\n");
      const { answer: a } = await askAboutDocument({
        question: `About the informal review for this Texas property tax protest: ${q}`,
        context,
      });
      setAnswer(a);
    } catch (err) {
      setQaError(getErrorMessage(err, "Could not answer that. Please try again."));
    } finally {
      setAsking(false);
    }
  }

  const mailto = guidance ? buildInformalReviewMailto(guidance) : null;
  const scheduled = protest.informalStatus === "scheduled" && !!protest.informalReviewDate;

  return (
    <div id="case-informal-review" className="mt-5 border-t border-border pt-5">
      <h2 className="text-sm font-semibold">Informal Review</h2>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="badge-soft">{INFORMAL_STATUS_LABEL[protest.informalStatus]}</span>
        <select
          aria-label="Informal review status"
          value={protest.informalStatus}
          disabled={updatingStatus}
          onChange={(e) => handleStatusChange(e.target.value as InformalStatus)}
          className="rounded-md border border-input bg-background px-2 py-1 text-xs disabled:opacity-60"
        >
          {INFORMAL_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* The offer itself, where the owner works the informal review — the
          amount, how it compares, and where to accept it. */}
      {protest.settlementOfferValue != null && protest.status !== "resolved" && (
        <div className="mt-3 grid gap-2 rounded-md border border-accent/40 bg-accent/5 p-3 text-sm">
          <div>
            <span className="font-semibold">
              {property.cad ?? "The district"} offered {currency(protest.settlementOfferValue)}
            </span>
            {protest.settlementOfferReceivedAt && (
              <span className="text-muted-foreground">
                {" "}
                on{" "}
                {new Date(
                  `${protest.settlementOfferReceivedAt.slice(0, 10)}T12:00:00`,
                ).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
              </span>
            )}
            {protest.originalValue != null && protest.originalValue > 0 && (
              <span className="text-muted-foreground">
                {" "}
                — down from {currency(protest.originalValue)}
              </span>
            )}
            .
          </div>
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
          <p className="text-xs text-muted-foreground">
            To accept it, use Accept Offer under Case Progress on Overview — or, if it&apos;s
            settled in writing, submit the signed settlement below.
          </p>
        </div>
      )}

      {protest.status === "resolved" && protest.arbDecision == null && (
        <div className="mt-3 rounded-md border border-border p-3 text-sm">
          <p className="font-medium">This protest was closed by an informal settlement.</p>
          <UploadedDocBar
            label="Settlement document"
            busy={settling}
            removeConfirm="This removes the settlement and reopens the case at the informal review."
            onReplace={async (file) => {
              const patch = await removeSettlement(protest, {
                propertyId: property.id,
                documentType: SETTLEMENT_DOCUMENT_TYPE,
              });
              onAgreementChange(null);
              onUpdate(patch);
              await handleSettlementFile(file);
            }}
            onRemove={async () => {
              const patch = await removeSettlement(protest, {
                propertyId: property.id,
                documentType: SETTLEMENT_DOCUMENT_TYPE,
              });
              onAgreementChange(null);
              onUpdate(patch);
            }}
          />
        </div>
      )}
      {protest.status !== "resolved" && protest.informalStatus === "completed" && (
        <div className="mt-3 rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-sm">
          <div className="font-semibold">Next: tell us how the informal review ended</div>
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">You agreed on a value:</span> upload the
              signed settlement below. That closes your protest.
            </li>
            <li>
              <span className="font-medium text-foreground">You did not agree:</span> click
              Unsatisfied below. We will move you on to a formal hearing.
            </li>
          </ul>
        </div>
      )}
      {protest.status !== "resolved" &&
        ["completed", "rejected", "no_informal_available"].includes(protest.informalStatus) && (
          <UndoButton
            className="mt-3 block"
            label="Undo my last informal step"
            confirm="This puts the informal review back to where it was, so you can mark it completed, upload the settlement, or choose Unsatisfied again."
            successMessage="Undone — the informal review is open again."
            onUndo={async () => onUpdate(await undoInformalStep(protest))}
          />
        )}
      {protest.status !== "resolved" && protest.informalStatus === "rejected" && (
        <div className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <p className="font-medium">
            Informal review result was unsatisfactory, so the case moved to a formal hearing.
          </p>
          <button
            type="button"
            onClick={onOpenHearing}
            className="mt-1.5 text-xs text-accent hover:underline"
          >
            Go to Formal Hearing →
          </button>
        </div>
      )}
      {cancelledNotice && (
        <div
          role="alert"
          className="mt-3 flex items-start justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
        >
          <span>{cancelledNotice}</span>
          <button
            type="button"
            onClick={() => setCancelledNotice(null)}
            aria-label="Dismiss"
            className="text-muted-foreground hover:text-foreground"
          >
            ×
          </button>
        </div>
      )}
      {contact &&
        property.cad &&
        !["completed", "accepted", "rejected"].includes(protest.informalStatus) && (
          <CountyInformalContact
            cad={property.cad}
            contact={contact}
            howToRequest={countyInfo?.informalReview?.howToRequest ?? null}
          />
        )}
      {/* Schedule — available until the informal review is completed (or skipped/rejected).
          Saving it sets the status to "scheduled" and feeds the in-platform
          calendar + Google/ICS sync (see scheduleInformalReview). */}
      {!["completed", "accepted", "rejected", "no_informal_available"].includes(
        protest.informalStatus,
      ) && (
        <form onSubmit={handleSaveSchedule} className="mt-3 rounded-md border border-border p-3">
          <div className="text-xs font-semibold text-foreground">Schedule the informal review</div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Enter the date, time, and mode you arranged with the appraisal district — it goes
            straight onto your calendar.
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div className="grid gap-1 text-xs">
              <span>Date</span>
              <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="Date"
                    className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  >
                    <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                    {dateInput
                      ? new Date(`${dateInput}T00:00:00`).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })
                      : "Pick a date"}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-0">
                  <DatePickerCalendar
                    mode="single"
                    selected={dateInputToDate(dateInput)}
                    onSelect={(d) => {
                      if (d) setDateInput(dateToDateInput(d));
                      setCalendarOpen(false);
                    }}
                    disabled={{ before: new Date(new Date().setHours(0, 0, 0, 0)) }}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <label className="grid gap-1 text-xs">
              Time
              <input
                type="time"
                value={timeInput}
                onChange={(e) => setTimeInput(e.target.value)}
                className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <label className="grid gap-1 text-xs">
              Mode
              <select
                value={modeInput}
                onChange={(e) => setModeInput(e.target.value as HearingMode)}
                className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              >
                {INFORMAL_REVIEW_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            {modeInput === "Videoconference" && (
              <label className="grid w-full min-w-0 gap-1 text-xs sm:w-auto sm:min-w-[260px] sm:flex-1">
                Meeting link
                <input
                  type="url"
                  inputMode="url"
                  value={linkInput}
                  onChange={(e) => setLinkInput(e.target.value)}
                  placeholder="https://… (from the district's email)"
                  className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                />
              </label>
            )}
            {(modeInput === "Phone" || modeInput === "Videoconference") && (
              <label className="grid gap-1 text-xs">
                {modeInput === "Phone" ? "Phone number" : "Dial-in (optional)"}
                <input
                  type="tel"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="(469) 742-9200"
                  className="w-44 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                />
              </label>
            )}
            {modeInput === "In Person" && (
              <label className="grid w-full min-w-0 gap-1 text-xs sm:w-auto sm:min-w-[260px] sm:flex-1">
                Address
                <input
                  value={locationInput}
                  onChange={(e) => setLocationInput(e.target.value)}
                  placeholder="The district's office address"
                  className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                />
              </label>
            )}
            <button
              type="submit"
              disabled={savingSchedule || !dateInput}
              className="btn-accent text-xs py-1.5 disabled:opacity-60"
            >
              {savingSchedule ? "Saving…" : "Save & add to calendar"}
            </button>
          </div>
          {modeInput === "Videoconference" && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Districts email the video link before the review. When that email reaches CorvusPT
              (forward it to {LEGAL_CONTACT.email} if it came to you), Corvus AI adds the link here.
            </p>
          )}
          {scheduled && (
            <>
              <p className="mt-2 text-xs text-muted-foreground">
                On file: {protest.informalReviewDate}
                {protest.informalReviewTime ? ` at ${protest.informalReviewTime}` : ""}
                {protest.informalReviewMode ? ` · ${protest.informalReviewMode}` : ""} ·{" "}
                <Link to="/dashboard/calendar" className="text-accent hover:underline">
                  View on calendar
                </Link>
              </p>
              <JoinInformalMeeting protest={protest} />
            </>
          )}
        </form>
      )}

      <div className="mt-3">
        <button
          type="button"
          onClick={handleGetGuidance}
          disabled={loadingGuidance}
          className="btn-outline text-xs py-1.5 disabled:opacity-60"
        >
          {loadingGuidance
            ? "Reading your case…"
            : guidance
              ? "Refresh Guidance"
              : "Get Informal Review Guidance"}
        </button>
        {guidanceError && <p className="mt-1 text-xs text-destructive">{guidanceError}</p>}
      </div>

      {guidance && (
        <div className="mt-3 grid gap-3 rounded-md border border-border p-3 text-sm">
          <div>
            <span className="font-semibold">Available: </span>
            <span className="text-muted-foreground">{guidance.available}</span>
          </div>

          {guidance.steps.length > 0 && (
            <div className="text-xs">
              <div className="font-semibold text-foreground">
                Steps to schedule &amp; complete it
              </div>
              <ol className="mt-1 grid list-decimal gap-1 pl-4 text-muted-foreground">
                {guidance.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2 text-xs">
            <div>
              <div className="font-semibold text-foreground">Where to Schedule</div>
              <MarkdownLite
                className="text-muted-foreground"
                text={guidance.whereToSchedule || "Not stated."}
              />
            </div>
            <div>
              <div className="font-semibold text-foreground">Who to Contact</div>
              <MarkdownLite
                className="text-muted-foreground"
                text={guidance.whoToContact || "Not confirmed."}
              />
            </div>
            <div>
              <div className="font-semibold text-foreground">How to Request It</div>
              <MarkdownLite
                className="text-muted-foreground"
                text={guidance.howToRequest || "Not confirmed."}
              />
            </div>
            <div>
              <div className="font-semibold text-foreground">What Value to Request</div>
              <MarkdownLite
                className="text-muted-foreground"
                text={guidance.requestedValueGuidance}
              />
            </div>
            <div>
              <div className="font-semibold text-foreground">Responding to a Proposed Value</div>
              <MarkdownLite
                className="text-muted-foreground"
                text={guidance.respondingToProposedValue}
              />
            </div>
            <div>
              <div className="font-semibold text-foreground">What to Say</div>
              <MarkdownLite className="text-muted-foreground" text={guidance.whatToSay} />
            </div>
            <div>
              <div className="font-semibold text-foreground">What Not to Say</div>
              <MarkdownLite className="text-muted-foreground" text={guidance.whatNotToSay} />
            </div>
            <div className="sm:col-span-2">
              <div className="font-semibold text-foreground">Does Accepting End the Case?</div>
              <MarkdownLite className="text-muted-foreground" text={guidance.acceptingEndsCase} />
            </div>
          </div>

          {guidance.applicableDeadlines.length > 0 && (
            <div className="text-xs">
              <div className="font-semibold text-foreground">Applicable Deadlines</div>
              <ul className="mt-0.5 grid gap-0.5 text-muted-foreground">
                {guidance.applicableDeadlines.map((d, i) => (
                  <li key={i}>• {d}</li>
                ))}
              </ul>
            </div>
          )}
          {guidance.documentsToProvide.length > 0 && (
            <div className="text-xs">
              <div className="font-semibold text-foreground">Documents to Provide</div>
              <ul className="mt-0.5 grid gap-0.5 text-muted-foreground">
                {guidance.documentsToProvide.map((d, i) => (
                  <li key={i}>• {d}</li>
                ))}
              </ul>
            </div>
          )}
          {guidance.evidenceToUse.length > 0 && (
            <div className="text-xs">
              <div className="font-semibold text-foreground">Evidence to Use</div>
              <ul className="mt-0.5 grid gap-0.5 text-muted-foreground">
                {guidance.evidenceToUse.map((d, i) => (
                  <li key={i}>• {d}</li>
                ))}
              </ul>
            </div>
          )}

          {(guidance.missingInfo.length > 0 || guidance.nextSteps.length > 0) && (
            <div className="rounded-md bg-accent/5 border border-accent/30 p-2 text-xs">
              {guidance.missingInfo.length > 0 && (
                <>
                  <div className="font-semibold text-foreground">
                    Missing from your notice — do this to fill the gap
                  </div>
                  <ul className="mt-0.5 grid gap-0.5 text-muted-foreground">
                    {guidance.missingInfo.map((d, i) => (
                      <li key={i}>• {d}</li>
                    ))}
                  </ul>
                </>
              )}
              {guidance.nextSteps.length > 0 && (
                <div className={guidance.missingInfo.length > 0 ? "mt-2" : ""}>
                  <div className="font-semibold text-foreground">Next steps</div>
                  <ol className="mt-0.5 grid list-decimal gap-0.5 pl-4 text-muted-foreground">
                    {guidance.nextSteps.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}

          {mailto ? (
            <div>
              <a
                href={mailto}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-accent text-xs py-1.5 inline-flex"
              >
                Draft Email to {guidance.contactEmail}
              </a>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Opens your email app with a suggested request pre-filled — review and edit before
                sending.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No confirmed email contact on file for this county — use the phone/contact info above,
              or check {property.cad ?? "your appraisal district"}'s website directly.
            </p>
          )}
        </div>
      )}

      {/* Ask the AI a follow-up about the informal review / preparation. */}
      <form onSubmit={handleAsk} className="mt-3">
        <div className="text-xs font-semibold text-foreground">Ask about the informal review</div>
        <div className="mt-1 flex flex-wrap items-end gap-2">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={2}
            aria-label="Ask about the informal review"
            placeholder="e.g. Can I bring new comps to the informal that weren't in my protest?"
            className="min-w-[16rem] flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
          <AskAiMicButton
            onTranscript={setQuestion}
            onFinal={(text) => void askQuestion(text)}
            disabled={asking}
          />
          <button
            type="submit"
            disabled={asking || !question.trim()}
            className="btn-outline text-xs py-1.5 disabled:opacity-60"
          >
            {asking ? "Asking…" : "Ask"}
          </button>
        </div>
        {qaError && <p className="mt-1 text-xs text-destructive">{qaError}</p>}
        {answer && (
          <div className="mt-2 rounded-md border border-border bg-secondary/30 p-2 text-xs">
            <MarkdownLite text={answer} />
          </div>
        )}
      </form>

      {/* How the informal review ended — at the end of the section. */}
      {protest.status !== "resolved" && (
        <div
          id="case-informal-outcome"
          className="mt-3 flex scroll-mt-24 flex-wrap items-center gap-2"
        >
          {!["completed", "accepted", "rejected", "no_informal_available"].includes(
            protest.informalStatus,
          ) && (
            <button
              type="button"
              onClick={() => void handleInformalCompleted()}
              disabled={updatingStatus}
              className="btn-outline text-xs py-1.5 disabled:opacity-60"
            >
              Informal review completed
            </button>
          )}
          {!["accepted", "rejected", "no_informal_available"].includes(protest.informalStatus) && (
            <button
              type="button"
              onClick={() => void handleUnsatisfied()}
              disabled={updatingStatus}
              className="btn-outline text-xs py-1.5 text-destructive disabled:opacity-60"
            >
              Unsatisfied
            </button>
          )}
          <label
            className={`btn-accent inline-flex cursor-pointer text-xs py-1.5 ${settling ? "pointer-events-none opacity-60" : ""}`}
          >
            {settling ? "Submitting…" : "Submit Settlement document"}
            <input
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              disabled={settling}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void handleSettlementFile(file);
              }}
            />
          </label>
          <span className="text-[11px] text-muted-foreground">
            Uploading the signed settlement closes this protest.
          </span>
        </div>
      )}
      {settleNeedsValue && settleFile && (
        <div className="mt-2 rounded-md border border-border p-3 text-xs">
          <p className="text-muted-foreground">
            We couldn't read the settled value from {settleFile.name}. Enter the agreed value to
            close the protest.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={settleValueInput}
              onChange={(e) => setSettleValueInput(e.target.value)}
              inputMode="decimal"
              placeholder="Settled value, e.g. 480000"
              aria-label="Settled value"
              className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={() => void handleConfirmSettleValue()}
              disabled={settling}
              className="btn-accent text-xs py-1.5 disabled:opacity-60"
            >
              {settling ? "Closing…" : "Close protest"}
            </button>
            <button
              type="button"
              onClick={() => {
                setSettleNeedsValue(false);
                setSettleFile(null);
              }}
              className="text-muted-foreground hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// The county's proposed value / settlement offer, end to end: AI reads the
// real settled value/terms off the uploaded document, the owner says
// whether they've already accepted/rejected it, otherwise they confirm it
// looks right and sign here (or upload the copy they signed in person for
// AI to verify), and finally they confirm Satisfied / Not Satisfied — which
// resolves the case at the settled value or unlocks formal-hearing prep.
// See settlement-agreement.ts for the read/verify/sign/outcome mechanics.
export function SettlementSignatureSection({
  userId,
  protest,
  property,
  agreement,
  onAgreementChange,
  onUpdate,
}: {
  userId: string;
  protest: ProtestRecord;
  property: PropertyRecord;
  agreement: SettlementAgreementRecord | null;
  onAgreementChange: (a: SettlementAgreementRecord | null) => void;
  onUpdate: (patch: Partial<ProtestRecord>) => void;
}) {
  const [originalDoc, setOriginalDoc] = useState<DocumentRecord | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pending, setPending] = useState<DecisionExtraction | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [signature, setSignature] = useState<SignatureValue | null>(null);
  const [signerName, setSignerName] = useState("");
  const [signing, setSigning] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [recordingResponse, setRecordingResponse] = useState(false);
  const [verifyingCopy, setVerifyingCopy] = useState(false);
  const [signedCopyExtraction, setSignedCopyExtraction] = useState<DecisionExtraction | null>(null);
  const [confirmingOutcome, setConfirmingOutcome] = useState(false);

  useEffect(() => {
    if (agreement?.documentId) {
      getDocumentById(userId, agreement.documentId)
        .then(setOriginalDoc)
        .catch(() => {});
    }
  }, [agreement?.documentId, userId]);

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const extraction = await extractSettlementDocument(property, protest, file);
      const wrong = documentMismatch(
        extraction,
        property,
        SETTLEMENT_CATEGORIES,
        "a settlement offer or agreement",
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

  async function handleSaveExtraction() {
    if (!pending || !pendingFile) return;
    setSaving(true);
    try {
      const doc = await uploadDocument(userId, property.id, pendingFile, SETTLEMENT_DOCUMENT_TYPE);
      setOriginalDoc(doc);
      const saved = await saveSettlementAgreement(userId, protest.id, doc.id, pending);
      onAgreementChange(saved);
      setPending(null);
      setPendingFile(null);
      toast.success("Settlement document saved — tell us what came of it below.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save this document."));
    } finally {
      setSaving(false);
    }
  }

  async function handleResponse(status: "not_yet" | "accepted" | "rejected") {
    if (!agreement) return;
    setRecordingResponse(true);
    try {
      await recordSettlementResponse(protest.id, agreement.id, status);
      onAgreementChange({
        ...agreement,
        responseStatus: status,
        responseRecordedAt: new Date().toISOString(),
      });
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save your response."));
    } finally {
      setRecordingResponse(false);
    }
  }

  async function handleConfirmLooksCorrect() {
    if (!agreement) return;
    setConfirming(true);
    try {
      await confirmSettlementAgreement(agreement.id);
      onAgreementChange({ ...agreement, userConfirmedAt: new Date().toISOString() });
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save your confirmation."));
    } finally {
      setConfirming(false);
    }
  }

  async function handleSign() {
    if (!agreement || !signature || !originalDoc || !signerName.trim()) return;
    setSigning(true);
    try {
      const { record } = await signSettlementAgreement(
        userId,
        agreement,
        property,
        originalDoc,
        signature,
        signerName.trim(),
      );
      onAgreementChange(record);
      toast.success(
        "Signed. Download the completed settlement below, then confirm whether you're satisfied.",
      );
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not sign this document."));
    } finally {
      setSigning(false);
    }
  }

  async function handleVerifySignedCopy(file: File) {
    if (!agreement) return;
    setVerifyingCopy(true);
    try {
      const { record, extraction } = await verifySignedSettlementCopy(
        userId,
        agreement,
        property,
        protest,
        file,
      );
      onAgreementChange(record);
      setSignedCopyExtraction(extraction);
      toast.success(
        extraction.signaturePresent === "No"
          ? "Uploaded, but AI couldn't find a completed signature on it — double-check the copy."
          : "Signed copy verified.",
      );
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not verify this signed copy."));
    } finally {
      setVerifyingCopy(false);
    }
  }

  async function handleDownloadSigned() {
    if (!agreement?.signedDocumentId) return;
    setDownloading(true);
    try {
      const doc = await getDocumentById(userId, agreement.signedDocumentId);
      if (!doc) throw new Error("Could not find the signed document.");
      const url = await getDocumentUrl(doc.storagePath);
      const res = await fetch(url);
      const bytes = new Uint8Array(await res.arrayBuffer());
      downloadPdf(bytes, doc.fileName);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not download the signed document."));
    } finally {
      setDownloading(false);
    }
  }

  async function handleOutcome(outcome: "satisfied" | "not_satisfied") {
    if (!agreement) return;
    const accepted = agreement.responseStatus === "accepted" || !!agreement.signedAt;
    if (accepted && outcome === "satisfied" && agreement.settledValue == null) {
      toast.error("No settled value on file yet — upload the settlement document above first.");
      return;
    }
    setConfirmingOutcome(true);
    try {
      await confirmSettlementOutcome(protest.id, agreement.id, outcome);
      onAgreementChange({
        ...agreement,
        outcome,
        outcomeConfirmedAt: new Date().toISOString(),
      });
      if (accepted && outcome === "satisfied") {
        const settledValue = agreement.settledValue as number;
        await resolveInformalSettlement(protest.id, settledValue);
        onUpdate({
          status: "resolved",
          finalValue: settledValue,
          escalationPath: "accept",
          closedAt: new Date().toISOString(),
          informalStatus: "accepted",
        });
        toast.success(`Settlement accepted — case resolved at ${currency(settledValue)}.`);
      } else {
        await updateInformalStatus(protest.id, "rejected");
        onUpdate({ informalStatus: "rejected" });
        toast.success("Outcome recorded — formal-hearing prep is now unlocked.");
      }
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not record this outcome."));
    } finally {
      setConfirmingOutcome(false);
    }
  }

  function handleDiscard() {
    setPending(null);
    setPendingFile(null);
    setUploadError(null);
  }

  if (protest.status === "requested" || protest.status === "resolved") return null;

  const uploadButton = (
    <label
      className={`inline-flex ${agreement ? "btn-outline" : "btn-accent"} cursor-pointer text-xs py-1.5 ${uploading ? "pointer-events-none opacity-60" : ""}`}
    >
      {uploading
        ? "Reading your document…"
        : agreement
          ? "Upload a Different Settlement Offer"
          : "Upload Settlement Offer"}
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

  const notResponded = agreement != null && agreement.responseStatus == null && !agreement.signedAt;
  const signHerePath =
    agreement != null &&
    !agreement.signedAt &&
    (agreement.responseStatus === "not_yet" || agreement.responseStatus == null);
  const canOfferSignedCopy =
    agreement != null &&
    !agreement.signedAt &&
    !agreement.signedCopyVerifiedAt &&
    agreement.responseStatus !== "rejected";
  const readyForOutcome =
    agreement != null &&
    !agreement.outcomeConfirmedAt &&
    (agreement.responseStatus === "accepted" ||
      agreement.responseStatus === "rejected" ||
      !!agreement.signedAt ||
      !!agreement.signedCopyVerifiedAt);

  return (
    <div id="case-settlement-signature" className="mt-5 border-t border-border pt-5">
      <h2 className="text-sm font-semibold">Settlement / Proposed Value</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        When the county proposes a value or sends a settlement, upload it here. AI reads the real
        settled value and terms; you tell us whether you&apos;ve already accepted or rejected it, or
        sign it here (or upload the copy you signed in person), then confirm whether you&apos;re
        satisfied with the outcome.
      </p>

      {!agreement && !pending && (
        <div className="mt-2">
          {uploadButton}
          {uploadError && <p className="mt-2 text-xs text-destructive">{uploadError}</p>}
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
            <Field
              label="Settled Value"
              value={pending.finalValue != null ? currency(pending.finalValue) : "Not stated"}
              bold
            />
            <Field label="Tax Year (on document)" value={pending.taxYear ?? "Not stated"} />
            <Field
              label="Account Number (on document)"
              value={pending.accountNumber ?? "Not stated"}
            />
          </div>
          {pending.settlementTerms && (
            <div className="mt-2 text-xs">
              <div className="font-semibold text-foreground">Terms</div>
              <p className="text-muted-foreground">{pending.settlementTerms}</p>
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button
              onClick={handleSaveExtraction}
              disabled={saving}
              className="btn-accent text-xs py-1.5 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save & Continue"}
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

      {!pending && agreement && (
        <div className="mt-2 rounded-md border border-border p-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="grid gap-2 sm:grid-cols-2 text-xs">
              <Field
                label="Settled Value"
                value={
                  agreement.settledValue != null ? currency(agreement.settledValue) : "Not stated"
                }
                bold
              />
              <Field label="Tax Year (on document)" value={agreement.taxYear ?? "Not stated"} />
            </div>
            {uploadButton}
          </div>
          {agreement.discrepancies.length > 0 && (
            <div className="mt-3 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
              <span className="font-semibold">Discrepancies flagged:</span>
              <ul className="mt-1 grid gap-0.5">
                {agreement.discrepancies.map((d, i) => (
                  <li key={i}>• {d}</li>
                ))}
              </ul>
            </div>
          )}
          {agreement.termsSummary && (
            <div className="mt-3 text-xs">
              <div className="font-semibold text-foreground">Terms</div>
              <p className="text-muted-foreground">{agreement.termsSummary}</p>
            </div>
          )}

          {notResponded && (
            <div className="mt-3 border-t border-border pt-3">
              <div className="text-xs font-semibold">Have you already responded to this offer?</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={() => handleResponse("accepted")}
                  disabled={recordingResponse}
                  className="btn-outline text-xs py-1.5 disabled:opacity-60"
                >
                  I&apos;ve accepted it
                </button>
                <button
                  onClick={() => handleResponse("rejected")}
                  disabled={recordingResponse}
                  className="btn-outline text-xs py-1.5 disabled:opacity-60"
                >
                  I&apos;ve rejected it
                </button>
                <button
                  onClick={() => handleResponse("not_yet")}
                  disabled={recordingResponse}
                  className="btn-outline text-xs py-1.5 disabled:opacity-60"
                >
                  Not yet
                </button>
              </div>
            </div>
          )}

          {signHerePath && !agreement.userConfirmedAt && (
            <div className="mt-3 border-t border-border pt-3">
              <button
                onClick={handleConfirmLooksCorrect}
                disabled={confirming}
                className="btn-accent text-xs py-1.5 disabled:opacity-60"
              >
                {confirming ? "Saving…" : "This Looks Correct — OK to Sign"}
              </button>
            </div>
          )}

          {signHerePath && agreement.userConfirmedAt && (
            <div className="mt-3 rounded-md border border-accent/40 bg-accent/5 p-3">
              <div className="text-xs font-semibold">Sign to accept this settlement</div>
              <label className="mt-2 grid gap-1 text-xs">
                Your full legal name
                <input
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  placeholder="Full legal name"
                  className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                />
              </label>
              <div className="mt-2">
                <SignaturePad onChange={setSignature} />
              </div>
              <button
                onClick={handleSign}
                disabled={signing || !signature || !signerName.trim() || !originalDoc}
                className="btn-accent mt-3 text-xs py-1.5 disabled:opacity-60"
              >
                {signing ? "Signing…" : "Sign & Accept"}
              </button>
              {!originalDoc && (
                <p className="mt-2 text-xs text-destructive">
                  The original uploaded document couldn&apos;t be found — re-upload it above.
                </p>
              )}
            </div>
          )}

          {canOfferSignedCopy && (
            <div className="mt-3 border-t border-border pt-3">
              <div className="text-xs font-semibold">Signed it in person at the CAD office?</div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Upload the copy you signed — AI verifies the value, date, tax year, terms, and that
                it&apos;s actually signed.
              </p>
              <label
                className={`mt-2 inline-flex btn-outline cursor-pointer text-xs py-1.5 ${
                  verifyingCopy ? "pointer-events-none opacity-60" : ""
                }`}
              >
                {verifyingCopy ? "Verifying…" : "Upload Signed Copy"}
                <input
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  disabled={verifyingCopy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) handleVerifySignedCopy(file);
                  }}
                />
              </label>
            </div>
          )}

          {agreement.signedCopyVerifiedAt && (
            <div className="mt-3 rounded-md bg-secondary/40 p-2 text-xs">
              <div className="font-semibold text-foreground">
                Signed copy verified {new Date(agreement.signedCopyVerifiedAt).toLocaleDateString()}
              </div>
              <div className="mt-1 grid gap-1 sm:grid-cols-2">
                <Field
                  label="Value on signed copy"
                  value={
                    signedCopyExtraction?.finalValue != null
                      ? currency(signedCopyExtraction.finalValue)
                      : agreement.settledValue != null
                        ? currency(agreement.settledValue)
                        : "Not stated"
                  }
                />
                <Field
                  label="Signed date"
                  value={signedCopyExtraction?.signedDate ?? "Not stated"}
                />
                <Field
                  label="Tax year on copy"
                  value={signedCopyExtraction?.taxYear ?? agreement.taxYear ?? "Not stated"}
                />
                <Field
                  label="Signature present"
                  value={signedCopyExtraction?.signaturePresent ?? "Unclear"}
                />
              </div>
              {signedCopyExtraction?.discrepancies &&
                signedCopyExtraction.discrepancies.length > 0 && (
                  <div className="mt-2 rounded-md bg-destructive/10 p-2 text-destructive">
                    <span className="font-semibold">Discrepancies on the signed copy:</span>
                    <ul className="mt-1 grid gap-0.5">
                      {signedCopyExtraction.discrepancies.map((d, i) => (
                        <li key={i}>• {d}</li>
                      ))}
                    </ul>
                  </div>
                )}
            </div>
          )}

          {agreement.signedAt && (
            <div className="mt-3 rounded-md bg-secondary/40 p-3 text-xs">
              <div className="font-semibold text-foreground">
                Signed {new Date(agreement.signedAt).toLocaleDateString()}
              </div>
              <p className="mt-1 text-muted-foreground">
                Download the completed settlement and submit it to your county — there&apos;s no
                county-wide e-filing system, so delivering it is still on you.
              </p>
              <button
                onClick={handleDownloadSigned}
                disabled={downloading}
                className="btn-accent mt-2 text-xs py-1.5 disabled:opacity-60"
              >
                {downloading ? "Preparing…" : "Download Completed Settlement"}
              </button>
            </div>
          )}

          {readyForOutcome && (
            <div className="mt-3 rounded-md border border-accent/40 bg-accent/5 p-3">
              <div className="text-xs font-semibold">Are you satisfied with this outcome?</div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                This is what moves the case forward. Satisfied with an accepted value closes the
                case at that value. Not satisfied — or a rejected offer — unlocks formal-hearing
                prep.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={() => handleOutcome("satisfied")}
                  disabled={confirmingOutcome || agreement.responseStatus === "rejected"}
                  className="btn-accent text-xs py-1.5 disabled:opacity-60"
                >
                  Satisfied
                </button>
                <button
                  onClick={() => handleOutcome("not_satisfied")}
                  disabled={confirmingOutcome}
                  className="btn-outline text-xs py-1.5 disabled:opacity-60"
                >
                  Not satisfied
                </button>
              </div>
            </div>
          )}

          {agreement.outcomeConfirmedAt && (
            <div className="mt-3 rounded-md bg-secondary/40 p-3 text-xs">
              <div className="font-semibold text-foreground">
                Outcome recorded:{" "}
                {agreement.outcome === "satisfied" ? "Satisfied" : "Not satisfied"}
              </div>
              <p className="mt-1 text-muted-foreground">
                {agreement.outcome === "satisfied" &&
                (agreement.responseStatus === "accepted" || agreement.signedAt)
                  ? "Case resolved at the settled value."
                  : "Proceeding to the formal hearing — prep is unlocked below."}
              </p>
            </div>
          )}

          <p className="mt-3 text-[11px] text-muted-foreground">
            Your county&apos;s CAD website usually reflects an accepted value within a few business
            days — check there to confirm it took effect.
          </p>
        </div>
      )}
    </div>
  );
}
