// Per-permit submission history for the Train-Track Map: each filing is a
// round (supabase/dp/permit-submissions.sql) with its own city review clock,
// its own comments and its own engineer response window. Pure functions —
// the page and the tests share them.
import type { PermitRow } from "./projects";
import type { ReviewCommentRow } from "./project-activity";

export type SubmissionRow = {
  id: string;
  project_id: string;
  permit_id: string;
  round: number;
  submitted_at: string | null;
  review_started_at: string | null;
  expected_at: string | null;
  expected_basis: string | null;
  city_returned_at: string | null;
  outcome: "under_review" | "comments" | "approved" | "rejected";
  method: string | null;
  confirmation: string | null;
  package_version: string | null;
  submitted_by: string | null;
  qa_passed_at: string | null;
  notes: string | null;
};

export type RoundComment = Pick<
  ReviewCommentRow,
  | "id"
  | "project_id"
  | "permit_key"
  | "original"
  | "plain_language"
  | "responsible"
  | "status"
  | "priority"
> & {
  round: number | null;
  discipline: string | null;
  assigned_at: string | null;
  due_at: string | null;
  responded_at: string | null;
  verified_at: string | null;
};

export type HistoryPermit = Pick<
  PermitRow,
  | "id"
  | "project_id"
  | "permit_key"
  | "name"
  | "status"
  | "agency"
  | "permit_number"
  | "approved_at"
  | "expiry_date"
  | "current_reviewer"
>;

export type Round = SubmissionRow & { comments: RoundComment[] };

const DAY = 86_400_000;

export const OUTCOME_LABEL: Record<SubmissionRow["outcome"], string> = {
  under_review: "Under review",
  comments: "Comments received",
  approved: "Approved",
  rejected: "Rejected",
};

/** A permit's rounds, oldest first, each with its own comments. Comments
 *  logged before rounds existed (no round number) belong to the latest round. */
export function permitRounds(
  permit: Pick<HistoryPermit, "id" | "project_id" | "permit_key">,
  submissions: SubmissionRow[],
  comments: RoundComment[],
): Round[] {
  const rounds = submissions
    .filter((s) => s.permit_id === permit.id)
    .sort((a, b) => a.round - b.round);
  const last = rounds.at(-1)?.round;
  const mine = comments.filter(
    (c) => c.project_id === permit.project_id && c.permit_key === permit.permit_key,
  );
  return rounds.map((r) => ({
    ...r,
    comments: mine.filter((c) => (c.round ?? last) === r.round),
  }));
}

/** Elapsed calendar days (24 h, weekends included); an open interval runs to `now`. */
export function elapsedDays(start: string | null, end: string | null, now: Date): number | null {
  if (!start) return null;
  const a = Date.parse(start);
  const b = end ? Date.parse(end) : now.getTime();
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? (b - a) / DAY : null;
}

// Central Time — DP projects are Texas jurisdictions
export const DAY_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  month: "short",
  day: "numeric",
  year: "numeric",
});
export const TIME_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  hour: "numeric",
  minute: "2-digit",
});
export const fmtDate = (v: string | null | undefined, empty = "Not recorded") =>
  v ? DAY_FMT.format(new Date(v)) : empty;
export const fmtStamp = (v: string | null | undefined, empty = "Not recorded") =>
  v ? `${DAY_FMT.format(new Date(v))} · ${TIME_FMT.format(new Date(v))} CT` : empty;

export const LANE_COLORS = [
  "border-l-blue-600",
  "border-l-violet-600",
  "border-l-orange-500",
  "border-l-teal-600",
  "border-l-rose-500",
  "border-l-slate-500",
];

export const fmtDays = (v: number | null) => (v == null ? "Not recorded" : `${v.toFixed(1)} days`);

export type Clock = {
  start: string | null;
  end: string | null;
  value: number | null;
  state: string;
};

/** Submitted → the city's response (or now, while the review is open). */
export function cityClock(r: Round, now: Date): Clock {
  return {
    start: r.submitted_at,
    end: r.city_returned_at,
    value: elapsedDays(r.submitted_at, r.city_returned_at, now),
    state: !r.submitted_at ? "Not recorded" : r.city_returned_at ? "Completed" : "Ongoing",
  };
}

/** First comment assignment → last engineer response. Overlapping tasks count
 *  once (one elapsed window, not person-days); unassigned waiting is excluded. */
export function engineerWindow(r: Round, now: Date): Clock {
  if (!r.comments.length)
    return {
      start: null,
      end: null,
      value: null,
      state: r.city_returned_at ? "Not required" : "Not started",
    };
  const assigned = r.comments
    .map((c) => c.assigned_at)
    .filter((x): x is string => !!x)
    .sort();
  if (!assigned.length) return { start: null, end: null, value: null, state: "Not assigned" };
  const complete = r.comments.every((c) => !!c.responded_at);
  const end = complete
    ? r.comments
        .map((c) => c.responded_at!)
        .sort()
        .at(-1)!
    : null;
  return {
    start: assigned[0],
    end,
    value: elapsedDays(assigned[0], end, now),
    state: complete ? "Completed" : "Ongoing",
  };
}

/** Which station of the map a round sits at (19–24 in the review loop, 27 approved). */
export function roundStage(r: Round): number {
  if (r.outcome === "approved") return 27;
  if (!r.city_returned_at) return 19;
  if (!r.comments.length) return 20;
  if (r.comments.some((c) => !c.assigned_at)) return 21;
  if (r.comments.some((c) => !c.responded_at)) return 22;
  if (!r.qa_passed_at) return 23;
  return 24;
}

/** The permit's current station — from its latest round, or how far its
 *  preparation got before the first filing. */
export function permitStage(permit: Pick<HistoryPermit, "status">, rounds: Round[]): number {
  const r = rounds.at(-1);
  if (r) return roundStage(r);
  if (permit.status === "approved") return 27;
  return permit.status === "preparing" ? 16 : 9;
}

const STAGE_NAME: Record<number, string> = {
  9: "Requirements in progress",
  16: "Package preparation",
  18: "Ready to submit",
  19: "City review",
  20: "Comments received",
  21: "Assigning comments",
  22: "Engineer response",
  23: "Compliance check",
  24: "Ready to resubmit",
  27: "Approved",
};
export const stageName = (n: number) => STAGE_NAME[n] ?? "In progress";

export type LaneStep = "submitted" | "review" | "comments" | "approved";

/** State of one of a permit lane's four steps: done, current or ahead. */
export function laneStepState(
  stage: number,
  rounds: Round[],
  step: LaneStep,
): "done" | "current" | "" {
  if (!rounds.length) return "";
  switch (step) {
    case "submitted":
      return "done";
    case "review":
      return stage === 19 ? "current" : "done";
    case "comments":
      return stage >= 20 && stage <= 24
        ? "current"
        : rounds.some((r) => r.comments.length)
          ? "done"
          : "";
    case "approved":
      return stage === 27 ? "current" : "";
  }
}

/** Totals across the rounds shown: completed city / engineer time, open clocks. */
export function historyTotals(rounds: Round[], now: Date) {
  let cityDone = 0,
    engineerDone = 0,
    open = 0;
  for (const r of rounds) {
    const c = cityClock(r, now),
      e = engineerWindow(r, now);
    if (c.state === "Completed") cityDone += c.value ?? 0;
    else if (c.state === "Ongoing") open++;
    if (e.state === "Completed") engineerDone += e.value ?? 0;
    else if (e.state === "Ongoing") open++;
  }
  return { rounds: rounds.length, cityDone, engineerDone, open };
}

export function historyCsv(
  rows: { project: string; permit: string; rounds: Round[] }[],
  now: Date,
): string {
  const out: (string | number)[][] = [
    [
      "Project",
      "Permit",
      "Submission",
      "Submitted",
      "Expected return",
      "City response",
      "City calendar days",
      "City clock",
      "Engineer assignment",
      "Engineer completion",
      "Engineer calendar days",
      "Engineer clock",
      "Next submission",
      "Outcome",
      "As of",
    ],
  ];
  for (const { project, permit, rounds } of rows)
    rounds.forEach((r, i) => {
      const c = cityClock(r, now),
        e = engineerWindow(r, now);
      out.push([
        project,
        permit,
        r.round,
        r.submitted_at ?? "",
        r.expected_at ?? "",
        r.city_returned_at ?? "",
        c.value == null ? "" : c.value.toFixed(1),
        c.state,
        e.start ?? "",
        e.end ?? "",
        e.value == null ? "" : e.value.toFixed(1),
        e.state,
        rounds[i + 1]?.submitted_at ?? "",
        OUTCOME_LABEL[r.outcome],
        now.toISOString(),
      ]);
    });
  return out
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
}
