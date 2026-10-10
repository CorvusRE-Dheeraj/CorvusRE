import type { ProtestRecord } from "./protests";
import type { FormSubmission } from "./protest-form-submissions";
import { filingSubmissionStatus } from "./filing-submission-status";

// Every property's protest as one fixed pipeline, and the single NEXT
// REQUIRED ACTION that moves it forward. Owner-managed CorvusPT only works if
// an owner who got a great valuation report can't then miss a procedural
// step, so this is derived purely from facts the case already records —
// never a separately tracked "done" flag that could drift.
//
//   Case Readiness → File Protest → Confirm Filing → Request CAD Evidence →
//   Informal → ARB → Decision → Appeal Decision → Close Case

export const PIPELINE_STAGES = [
  { id: "readiness", label: "Case Readiness" },
  { id: "file", label: "File Protest" },
  { id: "confirm", label: "Confirm Filing" },
  { id: "cad_evidence", label: "Request CAD Evidence" },
  { id: "informal", label: "Informal" },
  { id: "arb", label: "ARB" },
  { id: "decision", label: "Decision" },
  { id: "appeal", label: "Appeal Decision" },
  { id: "close", label: "Close Case" },
] as const;
export type StageId = (typeof PIPELINE_STAGES)[number]["id"];
export type StageState = "done" | "current" | "upcoming" | "skipped";

export type Urgency = "overdue" | "urgent" | "soon" | "normal";

export type NextAction = {
  stage: StageId | null; // null once the case is closed
  title: string;
  detail: string;
  dueDate: string | null; // YYYY-MM-DD
  dueLabel: string | null; // what the date is ("Protest deadline", "Hearing"…)
  urgency: Urgency;
  // Who has to act: the owner, or CorvusPT's team (Expert/Managed Help).
  owner: "you" | "corvus";
  // Where in View Case the action lives (see ANCHOR_TAB in
  // CaseDetailModal.tsx); "start" means there's no case yet.
  target: { kind: "anchor"; anchor: string } | { kind: "start" } | { kind: "none" };
};

export type NoticeFiling = Pick<
  FormSubmission,
  "signedAt" | "submittedAt" | "filingConfirmedAt" | "additionalRequestedAt" | "rejectedAt"
> & { filingMethod?: FormSubmission["filingMethod"] };

export type PipelineInput = {
  protest: ProtestRecord | null;
  notice: NoticeFiling | null; // the Notice of Protest's submission row
  protestDeadline: string | null;
  cadName: string | null;
  managed: boolean; // Expert/Managed Help — CorvusPT files and appears
  today: string; // YYYY-MM-DD, local
};

export type Pipeline = {
  stages: { id: StageId; label: string; state: StageState }[];
  next: NextAction;
  completed: number; // stages done or skipped
};

const RANK: Record<ProtestRecord["status"], number> = {
  requested: 0,
  filed: 1,
  under_review: 2,
  offer_received: 2,
  hearing_scheduled: 3,
  decision_received: 4,
  appealing: 5,
  arbitrating: 5,
  resolved: 6,
};

const day = (v: string | null | undefined) =>
  v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (Date.parse(`${toIso}T12:00:00Z`) - Date.parse(`${fromIso}T12:00:00Z`)) / 86_400_000,
  );
}

export function urgencyOf(dueDate: string | null, today: string): Urgency {
  if (!dueDate) return "normal";
  const d = daysBetween(today, dueDate);
  if (d < 0) return "overdue";
  if (d <= 3) return "urgent";
  if (d <= 14) return "soon";
  return "normal";
}

const fmt = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

// Texas: a binding-arbitration request or district-court petition is due
// within 60 days of receiving the ARB's order (Tax Code §41A.03, §42.21).
export const APPEAL_WINDOW_DAYS = 60;
// The district must hand over its hearing evidence at least 14 days before
// the hearing once the owner asks for it (Tax Code §41.461).
export const CAD_EVIDENCE_LEAD_DAYS = 14;

export function casePipeline(input: PipelineInput): Pipeline {
  const { protest: p, notice, managed, today } = input;
  const rank = p ? RANK[p.status] : -1;
  const resolved = !!p && (p.status === "resolved" || !!p.closedAt);
  const settled = p?.informalStatus === "accepted";
  const filing = filingSubmissionStatus(
    notice ? { ...notice, filingMethod: notice.filingMethod ?? null } : null,
  );
  const hearingDate = day(p?.hearingDate);
  const decisionDate = day(p?.arbDecisionDate);

  const done: Record<StageId, boolean> = {
    readiness: !!p && (!!p.corvusGuidanceAckAt || rank >= 1 || !!notice?.signedAt),
    file: rank >= 1 || !!notice?.submittedAt,
    confirm: rank >= 1 || filing === "confirmed",
    cad_evidence: !!p?.cadEvidenceRequestedAt,
    informal:
      settled ||
      rank >= 3 ||
      resolved ||
      ["rejected", "no_informal_available", "completed"].includes(p?.informalStatus ?? ""),
    arb: !!p?.hearingCompletedAt || rank >= 4 || (resolved && !settled),
    decision: !!p?.arbDecision || rank >= 4,
    appeal:
      resolved ||
      p?.escalationPath === "accept" ||
      !!p?.arbitrationFiledAt ||
      !!p?.courtAppeal?.petitionFiledAt,
    close: resolved,
  };
  // The county's filing problems reopen Confirm Filing even after "filed".
  if (filing === "additional_requested" || filing === "rejected") done.confirm = false;

  const skipped: Partial<Record<StageId, boolean>> = {
    // Too late to matter once the hearing is behind the case, or there won't be one.
    cad_evidence: !done.cad_evidence && (rank >= 4 || settled || resolved),
    arb: settled,
    decision: settled,
    appeal: settled,
  };

  // An informal offer waiting for a reply comes before asking for the
  // district's hearing evidence — the evidence request stays to do, but the
  // offer is what needs answering now.
  const offerPending =
    p?.informalStatus === "proposed_value_received" && p.settlementOfferValue != null;

  let currentFound = false;
  const stages = PIPELINE_STAGES.map(({ id, label }) => {
    let state: StageState;
    if (skipped[id]) state = "skipped";
    else if (done[id]) state = "done";
    else if (id === "cad_evidence" && offerPending) state = "upcoming";
    else if (!currentFound) {
      state = "current";
      currentFound = true;
    } else state = "upcoming";
    return { id, label, state };
  });
  const current = stages.find((s) => s.state === "current")?.id ?? null;

  const action = (
    a: Omit<NextAction, "stage" | "urgency" | "owner"> & { owner?: "you" | "corvus" },
  ): NextAction => ({
    ...a,
    stage: current,
    owner: a.owner ?? "you",
    urgency: urgencyOf(a.dueDate, today),
  });
  const team = (
    title: string,
    detail = "Nothing is needed from you right now — we'll tell you if that changes.",
  ) =>
    action({
      title,
      detail,
      dueDate: null,
      dueLabel: null,
      owner: "corvus",
      target: { kind: "none" },
    });
  const cad = input.cadName ?? "the appraisal district";
  const deadline = day(input.protestDeadline);

  let next: NextAction;
  switch (current) {
    case null:
      next = action({
        title: "Case closed — nothing left to do",
        detail:
          "Your final value is recorded. Your savings and next year's deadlines stay on your dashboard.",
        dueDate: null,
        dueLabel: null,
        target: { kind: "none" },
      });
      break;
    case "readiness":
      next = !p
        ? action({
            title: "Start your protest case",
            detail:
              "Open a case for this property so Corvus AI can check it's ready to file — county, account, tax year, owner and deadline.",
            dueDate: deadline,
            dueLabel: "Protest deadline",
            target: { kind: "start" },
          })
        : action({
            title: "Run the case-readiness check",
            detail:
              "Read the filing guidance and let Corvus AI confirm the county, property, tax year, owner and deadline before anything is filed.",
            dueDate: deadline,
            dueLabel: "Protest deadline",
            target: { kind: "anchor", anchor: "case-readiness" },
          });
      break;
    case "file":
      if (managed) {
        next = team(
          "CorvusPT is filing your protest",
          `We'll file your Notice of Protest with ${cad} before the deadline${deadline ? ` (${fmt(deadline)})` : ""}.`,
        );
        break;
      }
      next = notice?.signedAt
        ? action({
            title: `File your signed Notice of Protest with ${cad}`,
            detail:
              "Submit it online, by mail, in person or by email — your county's accepted methods and address are in the filing step. Then tell Corvus AI how you sent it.",
            dueDate: deadline,
            dueLabel: "Protest deadline",
            target: { kind: "anchor", anchor: "case-documents" },
          })
        : action({
            title: "Complete and sign your Notice of Protest (Form 50-132)",
            detail:
              "Corvus AI has pre-filled it from your property record. Review it, choose your protest reasons and sign.",
            dueDate: deadline,
            dueLabel: "Protest deadline",
            target: { kind: "anchor", anchor: "case-documents" },
          });
      break;
    case "confirm":
      if (filing === "rejected") {
        next = action({
          title: "The county rejected your filing — fix it and refile",
          detail:
            "Check the county's reason, correct the Notice of Protest and file it again before the deadline.",
          dueDate: deadline,
          dueLabel: "Protest deadline",
          owner: managed ? "corvus" : "you",
          target: { kind: "anchor", anchor: "case-documents" },
        });
      } else if (filing === "additional_requested") {
        next = action({
          title: "The county asked for more information",
          detail:
            "Send what the county requested and record that you did — an unanswered request can stall the protest.",
          dueDate: deadline,
          dueLabel: "Protest deadline",
          owner: managed ? "corvus" : "you",
          target: { kind: "anchor", anchor: "case-documents" },
        });
      } else if (managed) {
        next = team("CorvusPT is confirming the county received your protest");
      } else {
        next = action({
          title: "Confirm the county received your protest",
          detail:
            "Record the confirmation number, or upload the portal receipt, certified-mail delivery or county email. Without proof of filing, a lost protest can't be recovered.",
          dueDate: deadline,
          dueLabel: "Protest deadline",
          target: { kind: "anchor", anchor: "case-documents" },
        });
      }
      break;
    case "cad_evidence":
      next = managed
        ? team(`CorvusPT is requesting ${cad}'s evidence for your hearing`)
        : action({
            title: `Request ${cad}'s evidence`,
            detail: `Ask in writing for the evidence the district will use at your hearing (Tax Code §41.461) — it must give it to you at least ${CAD_EVIDENCE_LEAD_DAYS} days before the hearing. Corvus AI drafts the request for you.`,
            dueDate: hearingDate ? addDays(hearingDate, -CAD_EVIDENCE_LEAD_DAYS) : null,
            dueLabel: hearingDate ? "Request well before" : null,
            target: { kind: "anchor", anchor: "case-cad-evidence" },
          });
      break;
    case "informal": {
      const status = p?.informalStatus ?? "not_requested";
      const reviewDate = day(p?.informalReviewDate);
      if (status === "proposed_value_received") {
        next = action({
          title: `Review the county's offer${p?.settlementOfferValue ? ` of ${usd(p.settlementOfferValue)}` : ""}`,
          detail:
            "Accepting settles the protest at that value; declining moves it to a formal ARB hearing. The decision is yours — Corvus AI's comparison of the offer is on your dashboard.",
          dueDate: null,
          dueLabel: null,
          target: { kind: "anchor", anchor: "case-informal-review" },
        });
      } else if (managed) {
        next = team(
          status === "scheduled" && reviewDate
            ? `CorvusPT meets the appraiser on ${fmt(reviewDate)}`
            : "CorvusPT is negotiating with the appraiser",
        );
      } else if (status === "scheduled") {
        next = action({
          title: "Attend your informal review",
          detail: "Bring your evidence packet. If the appraiser makes an offer, record it here.",
          dueDate: reviewDate,
          dueLabel: "Informal review",
          target: { kind: "anchor", anchor: "case-informal-review" },
        });
      } else if (status === "requested" || status === "pending_response") {
        next = action({
          title: "Follow up on your informal review",
          detail: `If ${cad} hasn't scheduled it, call or email them — or mark that no informal review is offered so your case moves to the ARB.`,
          dueDate: null,
          dueLabel: null,
          target: { kind: "anchor", anchor: "case-informal-review" },
        });
      } else {
        next = action({
          title: "Request an informal review with the appraiser",
          detail:
            "Most protests settle here, before any formal hearing. If your county doesn't offer one, mark that instead.",
          dueDate: null,
          dueLabel: null,
          target: { kind: "anchor", anchor: "case-informal-review" },
        });
      }
      break;
    }
    case "arb":
      if (managed) {
        next = team(
          hearingDate
            ? `CorvusPT represents you at the ARB on ${fmt(hearingDate)}`
            : "CorvusPT is waiting for your ARB hearing date",
        );
      } else if (!hearingDate) {
        next = action({
          title: "Watch for your ARB hearing notice",
          detail:
            "The county mails it at least 15 days before the hearing. Upload it as soon as it arrives so Corvus AI can track the date.",
          dueDate: null,
          dueLabel: null,
          target: { kind: "anchor", anchor: "case-hearing-notice" },
        });
      } else if (hearingDate >= today) {
        next = action({
          title: "Prepare for and attend your ARB hearing",
          detail:
            "Review your hearing-prep guide and evidence. Missing the hearing can end your protest.",
          dueDate: hearingDate,
          dueLabel: "ARB hearing",
          target: { kind: "anchor", anchor: "case-hearing-prep" },
        });
      } else {
        next = action({
          title: "Mark your ARB hearing as held",
          detail:
            "Tell Corvus AI the hearing happened so it can watch for the ARB's written decision.",
          dueDate: null,
          dueLabel: null,
          target: { kind: "anchor", anchor: "case-hearing-prep" },
        });
      }
      break;
    case "decision":
      next = action({
        title: managed ? "CorvusPT is waiting for the ARB's decision" : "Upload the ARB's decision",
        detail: managed
          ? "Forward the Order Determining Protest to us if it comes to you."
          : "The Order Determining Protest arrives by certified mail. Upload it — your appeal deadline runs from the day you receive it.",
        dueDate: null,
        dueLabel: null,
        owner: managed ? "corvus" : "you",
        target: { kind: "anchor", anchor: "case-decision-notice" },
      });
      break;
    case "appeal": {
      const due = decisionDate ? addDays(decisionDate, APPEAL_WINDOW_DAYS) : null;
      const path = p?.escalationPath;
      next = action({
        title:
          path === "arbitration"
            ? "File your binding arbitration request"
            : path === "appeal"
              ? "File your district court appeal"
              : "Decide: accept the ARB's decision, or appeal it",
        detail:
          path === "arbitration" || path === "appeal"
            ? `Due within ${APPEAL_WINDOW_DAYS} days of receiving the ARB's order.`
            : `Accept it, request binding arbitration, or appeal to district court — you have ${APPEAL_WINDOW_DAYS} days from receiving the order.`,
        dueDate: due,
        dueLabel: "Appeal deadline",
        target: { kind: "anchor", anchor: "case-escalation" },
      });
      break;
    }
    case "close":
      next = action({
        title: managed
          ? "CorvusPT is closing your case"
          : "Record the final value and close your case",
        detail:
          "Enter the final appraised value so Corvus AI can calculate your savings and roll the property into next year.",
        dueDate: null,
        dueLabel: null,
        owner: managed ? "corvus" : "you",
        target: { kind: "anchor", anchor: "case-progress" },
      });
      break;
  }

  // The protest deadline passed with nothing filed: say so, and lay out what
  // Texas law still allows, instead of a filing step that reads as routine.
  if (
    !managed &&
    (current === "readiness" || current === "file") &&
    deadline &&
    deadline < today &&
    // Only this year's deadline: an older date on file is stale, not missed.
    deadline.slice(0, 4) === today.slice(0, 4)
  ) {
    next = action({
      title: `The protest deadline passed on ${fmt(deadline)}`,
      detail:
        "A Notice of Protest is due by May 15 or 30 days after the appraisal notice, whichever is later (Tax Code §41.44). The review board may still accept a late protest for good cause if it's filed before the appraisal records are approved, usually in late July (§41.44(b)), and a protest is allowed if the required notice was never delivered (§41.411). Otherwise the next opportunity is next year's notice.",
      dueDate: null,
      dueLabel: null,
      target: { kind: "anchor", anchor: "case-progress" },
    });
  }

  return {
    stages,
    next,
    completed: stages.filter((s) => s.state === "done" || s.state === "skipped").length,
  };
}

export function localTodayIso(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
