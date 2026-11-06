import type { ProtestRecord, ProtestStatus } from "./protests";
import type { PropertyRecord } from "./properties";
import { isPaidStatus } from "./subscription-status";

// The customer's Journey Map (components/JourneyTracker.tsx) — its steps and
// how a protest's status maps onto them. One definition, so the Customer
// Support console (supportJourney below) follows exactly the same journey the
// customer sees instead of a separate workflow.
export const STEP_LABELS = [
  "Start",
  "Identify County",
  "Find Property",
  "Upload Documents",
  "AI Review",
  "Choose Service",
  "Prepare Filing",
  "Submit",
  "Track",
  "Decision",
  "Savings",
] as const;

// Steps 6-11 are driven by the real case: protests.status moves through this
// pipeline (advanced by CorvusPT staff via the admin panel).
export const STATUS_RANK: Record<ProtestStatus, number> = {
  requested: 1,
  filed: 2,
  under_review: 3,
  offer_received: 3,
  // A scheduled hearing is still the "Track" stage; Decision only completes once a decision exists.
  hearing_scheduled: 3,
  decision_received: 4,
  appealing: 4,
  arbitrating: 4,
  resolved: 5,
};

export type JourneyDeadline = {
  label: string;
  date: string;
  source: string; // where the date comes from
  verified: boolean; // from an official record (county / tax bill), not an estimate
};

export type JourneyFlag = { severity: "high" | "medium" | "low"; text: string };

export type SupportJourney = {
  steps: { label: string; done: boolean }[];
  stageIndex: number;
  stage: string;
  // activities that run alongside the main line (the Journey Map's side tracks)
  parallel: { label: string; status: string }[];
  outstanding: string[];
  deadlines: JourneyDeadline[];
  nextAction: string;
  // blocked steps and deadline risks — explained, never acted on by Support
  flags: JourneyFlag[];
};

const daysUntil = (iso: string, today: string) =>
  Math.round(
    (Date.parse(`${iso.slice(0, 10)}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 864e5,
  );

const fmt = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

// A saved property's journey as Support sees it. Steps 1-5 (intake) are done
// for any saved property — the same assumption the Journey Map makes for a
// property from an earlier session — except "Find Property" needs the CAD
// account number and "Upload Documents" a document (or counts as skipped).
export function supportJourney(input: {
  property: PropertyRecord;
  protest: ProtestRecord | null;
  documents: number;
  packetSigned: boolean;
  bill?: { dueDate: string | null; status: string | null; amountDue: number | null } | null;
  today?: string;
}): SupportJourney {
  const { property: p, protest } = input;
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const rank = protest ? STATUS_RANK[protest.status] : 0;
  const paid = isPaidStatus(p.subscriptionStatus ?? null);
  const hasAccount = !!p.accountNumber?.trim();
  const done = [
    true,
    !!p.cad,
    hasAccount,
    true, // documents are optional on the Journey Map (skipped counts as done)
    true,
    paid || rank >= 1,
    rank >= 1,
    rank >= 2,
    rank >= 3,
    rank >= 4,
    rank >= 5,
  ];
  const first = done.findIndex((d) => !d);
  const stageIndex = first === -1 ? STEP_LABELS.length - 1 : first;

  const verification = p.verificationStatus ?? "pending";
  const held = verification === "needs_review" || verification === "rejected";

  const parallel: SupportJourney["parallel"] = [];
  parallel.push({
    label: "Property verification",
    status:
      verification === "verified"
        ? "Verified against the county record"
        : verification === "needs_review"
          ? "Flagged — waiting on staff review"
          : verification === "rejected"
            ? "Rejected — held"
            : verification === "test"
              ? "Test property"
              : "Not checked yet",
  });
  if (protest?.informalStatus && protest.informalStatus !== "not_requested")
    parallel.push({
      label: "Informal review",
      status: `${protest.informalStatus.replace(/_/g, " ")}${protest.informalReviewDate ? ` — ${fmt(protest.informalReviewDate)}` : ""}`,
    });
  if (protest?.hearingDate)
    parallel.push({
      label: "ARB hearing",
      status: `${protest.hearingCompletedAt ? "Held" : "Scheduled"} — ${fmt(protest.hearingDate)}`,
    });
  if (input.bill)
    parallel.push({
      label: "Tax payment",
      status: `${input.bill.status === "paid" ? "Paid" : (input.bill.status ?? "unpaid").replace(/_/g, " ")}${input.bill.dueDate ? ` — due ${fmt(input.bill.dueDate)}` : ""}`,
    });
  parallel.push({
    label: "Engagement packet",
    status: input.packetSigned ? "Signed" : "Not signed",
  });

  const outstanding: string[] = [];
  if (!hasAccount) outstanding.push("CAD account number");
  if (held) outstanding.push("Property verification review (Operations)");
  if (!paid) outstanding.push("Subscription for this property");
  if (rank >= 1 && !input.packetSigned) outstanding.push("Signed engagement packet");
  if (p.subscriptionStatus === "past_due" || p.subscriptionStatus === "unpaid")
    outstanding.push("Payment (last charge failed)");
  if (input.documents === 0 && rank <= 1)
    outstanding.push("Appraisal notice (optional, helps the case)");

  const deadlines: JourneyDeadline[] = [];
  if (p.protestDeadline)
    deadlines.push({
      label: "Protest deadline",
      date: p.protestDeadline.slice(0, 10),
      source:
        verification === "verified"
          ? "Verified property record"
          : "Property record (not verified yet)",
      verified: verification === "verified",
    });
  if (protest?.informalReviewDate)
    deadlines.push({
      label: "Informal review",
      date: protest.informalReviewDate.slice(0, 10),
      source: "County notice",
      verified: true,
    });
  if (protest?.hearingDate && !protest.hearingCompletedAt)
    deadlines.push({
      label: "ARB hearing",
      date: protest.hearingDate.slice(0, 10),
      source:
        protest.hearingLinkSource === "county_email"
          ? "County email"
          : "Hearing notice / entered by the owner",
      verified: protest.hearingLinkSource !== "owner",
    });
  if (input.bill?.dueDate && input.bill.status !== "paid")
    deadlines.push({
      label: "Tax payment due",
      date: input.bill.dueDate.slice(0, 10),
      source: "Tax bill",
      verified: true,
    });
  deadlines.sort((a, b) => a.date.localeCompare(b.date));

  const flags: JourneyFlag[] = [];
  if (held)
    flags.push({
      severity: "high",
      text: "Blocked: the property is held for verification review — filing and signing wait until Operations approves it.",
    });
  const pd = p.protestDeadline ? daysUntil(p.protestDeadline, today) : null;
  if (pd != null && pd >= 0 && rank < 2) {
    if (!paid && pd <= 21)
      flags.push({
        severity: pd <= 7 ? "high" : "medium",
        text: `Protest deadline in ${pd} days and the property isn't subscribed yet.`,
      });
    if (rank === 1 && !input.packetSigned && pd <= 21)
      flags.push({
        severity: pd <= 7 ? "high" : "medium",
        text: `Protest deadline in ${pd} days and the engagement packet isn't signed — CorvusPT can't file without it.`,
      });
    if (rank === 0 && paid && pd <= 14)
      flags.push({
        severity: pd <= 5 ? "high" : "medium",
        text: `Protest deadline in ${pd} days and no protest has been requested.`,
      });
  }
  if (pd != null && pd < 0 && rank === 0)
    flags.push({
      severity: "low",
      text: "The protest deadline has passed with no protest on file (late protests need good cause).",
    });
  if (protest?.hearingDate && !protest.hearingCompletedAt) {
    const hd = daysUntil(protest.hearingDate, today);
    if (hd >= 0 && hd <= 7 && input.documents === 0)
      flags.push({
        severity: "medium",
        text: `ARB hearing in ${hd} days and no evidence documents are uploaded.`,
      });
  }
  if (p.subscriptionStatus === "past_due" || p.subscriptionStatus === "unpaid")
    flags.push({ severity: "medium", text: "Payment failed — the subscription may lapse." });
  if (!hasAccount)
    flags.push({
      severity: "medium",
      text: "Blocked: no CAD account number, so the county record can't be matched.",
    });

  const nextAction = (() => {
    if (held)
      return "Wait for Operations to finish the verification review; tell the customer it's in progress.";
    if (!hasAccount)
      return "Ask the customer for the CAD account number (it's on the appraisal notice).";
    if (!paid && rank === 0) return "Help the customer choose a plan and subscribe.";
    if (rank === 1 && !input.packetSigned)
      return "Ask the customer to sign the engagement packet (Dashboard → Agreements).";
    if (rank === 0) return "Explain how to start the protest from the property's AI Report.";
    if (rank === 1)
      return "Filing is being prepared — no action needed from the customer unless asked.";
    if (rank === 2) return "Filed — the case is with the county; keep the customer posted.";
    if (rank === 3)
      return protest?.hearingDate
        ? "Help the customer prepare for the hearing (date, format, evidence)."
        : "Under county review — watch for an offer or hearing notice.";
    if (rank === 4)
      return "Decision received — explain the options; the decision itself is the customer's / Operations'.";
    return "Case resolved — check savings and Pay Taxes.";
  })();

  return {
    steps: STEP_LABELS.map((label, i) => ({ label, done: done[i] })),
    stageIndex,
    stage: STEP_LABELS[stageIndex],
    parallel,
    outstanding,
    deadlines,
    nextAction,
    flags,
  };
}
