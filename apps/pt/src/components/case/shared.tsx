// Small helpers and labels shared by the case-page modules (split out of CaseDetailModal.tsx).
import { type ProtestRecord } from "@/lib/protests";
import { type SettlementAgreementRecord } from "@/lib/settlement-agreement";
import { type FilingMethod, type FormSubmission } from "@/lib/protest-form-submissions";

export const FILING_METHOD_LABEL: Record<FilingMethod, string> = {
  online: "Online / County Website",
  mail: "Mail",
  in_person: "In Person",
  email: "Email",
};

export const EMPTY_FORM_SUBMISSION: FormSubmission = {
  fieldValues: {},
  signature: null,
  signedAt: null,
  documentId: null,
  filingMethod: null,
  filingConfirmationNumber: null,
  mailTrackingNumber: null,
  emailRecipient: null,
  emailSubject: null,
  emailSentAt: null,
  submittedAt: null,
  filingConfirmedAt: null,
  additionalRequestedAt: null,
  additionalRequestNote: null,
  mailDeliveredAt: null,
  rejectedAt: null,
  reminderFrequency: null,
  lastReminderSentAt: null,
};

// Amber, non-blocking notice at the top of the case (and inline in
// HearingPrepSection) whenever the county's informal proposed value is on
// the table but the owner hasn't recorded what came of it. Product asked
// for a warning, not a hard gate — the case still works, this just keeps
// the history honest.
export function InformalOutcomeBanner({
  protest,
  agreement,
  inline = false,
  onNavigate,
}: {
  protest: ProtestRecord;
  agreement: SettlementAgreementRecord | null;
  inline?: boolean;
  // Optional — jump to the Informal Review tab + settlement section. When
  // absent (the inline copy inside HearingPrepSection), falls back to a plain
  // same-page scroll.
  onNavigate?: (anchor: string) => void;
}) {
  const unresolved =
    protest.status !== "resolved" &&
    (protest.informalStatus === "proposed_value_received" ||
      (!!agreement && !agreement.outcomeConfirmedAt));
  if (!unresolved) return null;
  return (
    <div
      className={`${inline ? "mt-3" : "mt-4"} rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs`}
    >
      <div className="font-semibold text-amber-700">Informal outcome not confirmed yet</div>
      <p className="mt-1 text-muted-foreground">
        The county&apos;s informal proposed value hasn&apos;t been resolved. Record whether you
        accepted or rejected it, and whether you&apos;re satisfied, before working the formal
        hearing — otherwise the case history and savings won&apos;t be right.
      </p>
      <button
        type="button"
        onClick={() => {
          const anchor = document.getElementById("case-settlement-signature")
            ? "case-settlement-signature"
            : "case-informal-outcome";
          if (onNavigate) onNavigate(anchor);
          else
            document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
        className="btn-outline mt-2 text-xs py-1"
      >
        Go to the settlement section
      </button>
    </div>
  );
}

export function Field({
  label,
  value,
  bold,
  success,
}: {
  label: string;
  value: string;
  bold?: boolean;
  success?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`${bold ? "font-semibold" : ""} ${success ? "text-success" : ""}`}>
        {value}
      </div>
    </div>
  );
}
