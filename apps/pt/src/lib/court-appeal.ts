// Court-appeal (district court petition for review) tracking for a case whose
// formal ARB hearing ended unsatisfactorily. Corvus ORGANIZES the case here —
// deadline, summary, attorney package, timeline — and never files anything or
// gives legal advice: the petition itself is the owner's and/or attorney's job.
// Everything below is deterministic; the AI pieces (case review, discussion
// questions, document summaries) live in the UI and are advisory only.
import type { PropertyRecord } from "./properties";
import type { ProtestRecord } from "./protests";

const DAY = 24 * 60 * 60 * 1000;

// ── Saved state (protests.court_appeal, one jsonb column) ────────────────
export type CourtUpdateType = "notice" | "filing" | "order" | "settlement" | "other";

export type CourtUpdate = {
  id: string;
  date: string; // ISO date the item is dated
  type: CourtUpdateType;
  title: string;
  summary: string; // AI (or user) summary of the document
  documentId: string | null;
};

export type CourtAttorney = {
  name: string;
  firm: string;
  email: string;
  phone: string;
};

export type CourtAppealData = {
  // The date the owner actually RECEIVED the final order — the 60 days run from
  // this, not from the order date, when it's known.
  orderReceivedDate?: string | null;
  deadlineAckAt?: string | null;
  packageAt?: string | null;
  legalReviewDoneAt?: string | null;
  attorney?: CourtAttorney | null;
  // Set only when the owner confirms the petition was filed.
  petitionFiledAt?: string | null;
  court?: string | null;
  caseNumber?: string | null;
  updates?: CourtUpdate[];
};

export const UPDATE_TYPE_LABEL: Record<CourtUpdateType, string> = {
  notice: "Court notice",
  filing: "Filing",
  order: "Order",
  settlement: "Settlement",
  other: "Other",
};

// ── Deadline & requirements ──────────────────────────────────────────────
export type CourtAppealReview = {
  // No ARB order recorded yet — nothing to count from.
  ready: boolean;
  deadline: string | null;
  daysRemaining: number | null;
  expired: boolean;
  // Which date the 60 days were counted from.
  basis: "received" | "order" | "unknown";
  courtName: string | null;
  requirements: string[];
  overSoahFloor: boolean;
};

function addDays(iso: string, days: number): string {
  return new Date(new Date(`${iso}T00:00:00`).getTime() + days * DAY).toISOString().slice(0, 10);
}

function daysUntil(iso: string, now: Date): number {
  const target = new Date(`${iso}T00:00:00`).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((target - today) / DAY);
}

// "Collin Central Appraisal District" → "Collin County".
export function countyNameFromCad(cad: string | null | undefined): string | null {
  if (!cad) return null;
  const m = cad.match(/^([A-Za-z .'-]+?)\s+(?:County\s+)?(?:Central\s+)?(?:Appraisal|CAD)/i);
  const name = m?.[1]?.trim();
  return name ? `${name} County` : null;
}

export function reviewCourtAppeal(
  property: PropertyRecord,
  protest: ProtestRecord,
  data: CourtAppealData | null | undefined,
  now: Date = new Date(),
): CourtAppealReview {
  const received = data?.orderReceivedDate ?? null;
  const orderDate = protest.arbDecisionDate ?? null;
  const from = received ?? orderDate;
  const deadline = from ? addDays(from, 60) : null;
  const daysRemaining = deadline ? daysUntil(deadline, now) : null;
  const county = countyNameFromCad(property.cad);
  const value = protest.finalValue ?? protest.originalValue ?? property.totalValue ?? 0;

  return {
    ready: protest.arbDecision != null,
    deadline,
    daysRemaining,
    expired: daysRemaining != null && daysRemaining < 0,
    basis: received ? "received" : orderDate ? "order" : "unknown",
    courtName: county ? `District court of ${county}` : null,
    overSoahFloor: value > 1_000_000,
    requirements: [
      "A property owner generally has 60 days after receiving the ARB's final order to file a petition for review in district court (Tax Code Chapter 42).",
      county
        ? `File in the district court of the county where the property is located — ${county}.`
        : "File in the district court of the county where the property is located.",
      "Pay the undisputed portion of the tax before it becomes delinquent (Tax Code §42.08) — your attorney will confirm the amount and timing.",
      "Give the ARB the written notice of appeal your attorney advises; the exact timing turns on the date the petition is filed.",
      ...(value > 1_000_000
        ? [
            "For property valued over $1,000,000, an appeal to the State Office of Administrative Hearings (SOAH) may be an alternative — ask your attorney whether it fits.",
          ]
        : []),
    ],
  };
}

export const COURT_DISCLAIMER =
  "A court appeal is a legal proceeding. Corvus organizes your case, deadlines and documents — it does not file the petition, give legal advice, or predict an outcome. Deadlines run from the date you received the order and can turn on facts only you or an attorney can confirm; verify every date before you rely on it.";

// ── Stages & next action ─────────────────────────────────────────────────
export type CourtStageId =
  | "hearing"
  | "result"
  | "selected"
  | "legal_review"
  | "petition_filed"
  | "court_case"
  | "resolution";

export const COURT_STAGES: { id: CourtStageId; label: string }[] = [
  { id: "hearing", label: "Formal Hearing" },
  { id: "result", label: "Result" },
  { id: "selected", label: "Court Appeal Selected" },
  { id: "legal_review", label: "Attorney / Legal Review" },
  { id: "petition_filed", label: "Petition Filed" },
  { id: "court_case", label: "Court Case" },
  { id: "resolution", label: "Resolution" },
];

export function courtStages(
  protest: ProtestRecord,
  data: CourtAppealData | null | undefined,
): { id: CourtStageId; label: string; state: "done" | "current" | "upcoming" }[] {
  const closed = protest.status === "resolved" && protest.escalationPath === "appeal";
  let current: CourtStageId;
  if (closed) current = "resolution";
  else if (data?.petitionFiledAt) current = "court_case";
  else if (data?.attorney || data?.legalReviewDoneAt) current = "petition_filed";
  else current = "legal_review";
  const idx = COURT_STAGES.findIndex((s) => s.id === current);
  return COURT_STAGES.map((s, i) => ({
    ...s,
    state: closed || i < idx ? "done" : i === idx ? "current" : "upcoming",
  }));
}

export type CourtNextAction = {
  label: string;
  // Which section of the workflow the action lives in.
  target:
    "deadline" | "package" | "attorney" | "petition" | "updates" | "resolution" | "monitoring";
};

// The one thing that is actually needed next — in the order a person needs it.
export function courtNextAction(
  protest: ProtestRecord,
  data: CourtAppealData | null | undefined,
): CourtNextAction {
  if (protest.status === "resolved") {
    return { label: "Return the property to tax monitoring", target: "monitoring" };
  }
  if (data?.petitionFiledAt) return { label: "Add Court Update", target: "updates" };
  if (!data?.deadlineAckAt) return { label: "Review Court Appeal Deadline", target: "deadline" };
  if (!data?.packageAt) return { label: "Prepare Case for Attorney", target: "package" };
  if (!data?.attorney) return { label: "Add Attorney", target: "attorney" };
  return { label: "Confirm Petition Filed", target: "petition" };
}

// Unique-enough id for a timeline entry (no crypto dependency needed).
export function newUpdateId(): string {
  return `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// Timeline, newest last — filing + updates, for display.
export function courtTimeline(data: CourtAppealData | null | undefined): {
  date: string;
  title: string;
  detail: string;
}[] {
  const items: { date: string; title: string; detail: string }[] = [];
  if (data?.petitionFiledAt) {
    items.push({
      date: data.petitionFiledAt.slice(0, 10),
      title: "Petition filed",
      detail: [data.court, data.caseNumber ? `Case ${data.caseNumber}` : null]
        .filter(Boolean)
        .join(" · "),
    });
  }
  for (const u of data?.updates ?? []) {
    items.push({
      date: u.date,
      title: `${UPDATE_TYPE_LABEL[u.type]}: ${u.title}`,
      detail: u.summary,
    });
  }
  return items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
