// Permit-level records for the Train-Track Map (v4 layout): the parallel
// permit lanes, and the popup views — one permit's submission + comments,
// one round's complete record, and the Resubmission Manager (every round,
// with time at the city kept apart from time with the design team).
import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, Check, Download, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { inputCls } from "@/components/dp-ui";
import { Rail, TrackLabel } from "@/components/rail";
import { updatePermit, type PermitRow, type ProjectRow } from "@/lib/projects";
import {
  DAY_FMT,
  LANE_COLORS,
  LANE_HEX,
  OUTCOME_LABEL,
  TIME_FMT,
  fmtDate,
  fmtStamp,
  cityClock,
  elapsedDays,
  engineerWindow,
  fmtDays,
  historyCsv,
  historyTotals,
  laneStepState,
  stageName,
  type LaneStep,
  type Round,
} from "@/lib/permit-history";
import {
  TRACK_PORTFOLIO_KEY,
  setCommentDue,
  updateSubmission,
  type SubmissionPatch,
} from "@/lib/track-portfolio";

export type PermitTrack = {
  project: ProjectRow;
  permit: PermitRow;
  rounds: Round[];
  stage: number;
};

export type TrackView =
  | { type: "station"; n: number; ai?: boolean; permitId?: string }
  | {
      type: "permit";
      permitId: string;
      stage: string;
      tab: "overview" | "comments" | "history";
      round?: number;
      // opened from "Mark as already approved": the approval form starts open
      markApproved?: boolean;
    }
  | { type: "history"; projectId: string; permitKey: string }
  | { type: "round"; permitId: string; round: number };

type Nav = (v: TrackView) => void;

// ── formatting (Central Time — Texas jurisdictions) ─────────────────────────
function DateCell({ v, empty = "Not recorded" }: { v: string | null | undefined; empty?: string }) {
  if (!v) return <span className="text-muted-foreground">{empty}</span>;
  return (
    <>
      <time dateTime={v} className="block whitespace-nowrap">
        {DAY_FMT.format(new Date(v))}
      </time>
      <small className="block text-[10px] text-muted-foreground">
        {TIME_FMT.format(new Date(v))} CT
      </small>
    </>
  );
}

// ── small building blocks ──────────────────────────────────────────────────
export function StagePill({ stage }: { stage: number }) {
  const tone =
    stage < 18
      ? "border-slate-200 bg-slate-50 text-slate-700"
      : stage === 22
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : stage === 19
          ? "border-blue-200 bg-blue-50 text-blue-800"
          : "border-green-200 bg-green-50 text-green-800";
  return (
    <span
      className={cn("inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold", tone)}
    >
      {stageName(stage)}
    </span>
  );
}

function Metric({ value, label, note }: { value: ReactNode; label: string; note?: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3">
      <b className="block text-lg font-semibold tabular-nums text-foreground">{value}</b>
      <span className="block text-xs text-muted-foreground">{label}</span>
      {note && <small className="mt-0.5 block text-[11px] text-muted-foreground">{note}</small>}
    </div>
  );
}

function Box({ title, children, full }: { title: string; children: ReactNode; full?: boolean }) {
  return (
    <section className={cn("rounded-xl border border-border bg-card p-4", full && "sm:col-span-2")}>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function Fields({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[minmax(110px,0.8fr)_minmax(0,1fr)]">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="mb-1.5 font-semibold [overflow-wrap:anywhere] sm:mb-0">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const Notice = ({ children, tone = "blue" }: { children: ReactNode; tone?: "blue" | "amber" }) => (
  <div
    className={cn(
      "rounded-xl border px-3 py-2.5 text-xs",
      tone === "blue"
        ? "border-blue-100 bg-blue-50/60 text-slate-700"
        : "border-orange-200 bg-orange-50 text-orange-900",
    )}
  >
    {children}
  </div>
);

export function TimingHelp() {
  return (
    <details className="rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
      <summary className="cursor-pointer text-sm font-semibold text-foreground">
        How city and engineer times are calculated
      </summary>
      <p className="mt-2">
        <strong className="text-foreground">City time:</strong> from the date and time a submission
        was filed to the city's response or approval. An open review runs to now.
      </p>
      <p className="mt-1.5">
        <strong className="text-foreground">Engineer time:</strong> from the first comment assigned
        to the design team to the last response for that round. An unfinished response runs to now.
        Waiting before anyone is assigned isn't counted.
      </p>
      <p className="mt-1.5">
        <strong className="text-foreground">Separate gaps:</strong> city response → first
        assignment, and last engineer response → the next filing, are shown separately in each
        round's record. QA and filing time aren't engineer time.
      </p>
      <p className="mt-1.5">
        Durations are elapsed calendar days (weekends included), to one decimal. Overlapping
        engineer tasks count once — one response window, not person-days. Expected return dates are
        planning estimates, not city deadlines.
      </p>
    </details>
  );
}

function ClockMetric({ r, type }: { r: Round; type: "city" | "engineer" }) {
  const now = new Date();
  const t = type === "city" ? cityClock(r, now) : engineerWindow(r, now);
  return (
    <Metric
      value={t.value == null ? t.state : fmtDays(t.value)}
      label={type === "city" ? "City review time" : "Engineer revision time"}
      note={
        t.value == null
          ? "No elapsed time recorded"
          : t.state === "Ongoing"
            ? "Ongoing — runs to now"
            : "Completed interval"
      }
    />
  );
}

// ── the parallel permit lanes ──────────────────────────────────────────────
const LANE_STEPS: [LaneStep, string][] = [
  ["submitted", "Submitted"],
  ["review", "Under Review"],
  ["comments", "Comments / Response"],
  ["approved", "Approved"],
];

export function PermitLanes({ tracks, onView }: { tracks: PermitTrack[]; onView: Nav }) {
  if (!tracks.length)
    return (
      <p className="text-sm text-muted-foreground">No permits identified for this project yet.</p>
    );
  return (
    <div className="grid gap-3">
      <Notice>
        <strong>∥ Parallel tracks.</strong> Click Submitted for filing dates and the expected city
        return. Each permit moves on its own once its own prerequisites are met.
      </Notice>
      {tracks.map((t, i) => {
        const r = t.rounds.at(-1);
        const open = r?.comments.filter((c) => !c.responded_at).length ?? 0;
        const subtitle: Record<LaneStep, string> = {
          submitted: r ? `Latest: ${fmtDate(r.submitted_at)}` : "No submission recorded",
          review: r
            ? r.city_returned_at
              ? `Returned: ${fmtDate(r.city_returned_at)}`
              : `Expected: ${fmtDate(r.expected_at, "not estimated")}`
            : "Awaiting first submission",
          comments: r?.comments.length
            ? `${open} awaiting engineer response`
            : "No current comments",
          approved: t.permit.approved_at ? fmtDate(t.permit.approved_at) : "No approval recorded",
        };
        return (
          <article
            key={t.permit.id}
            id={`permit-${t.permit.id}`}
            className={cn(
              "min-w-0 rounded-xl border border-l-4 border-border bg-card p-4",
              LANE_COLORS[i % LANE_COLORS.length],
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-semibold">{t.permit.name}</h3>
                <p className="text-xs text-muted-foreground">
                  {[t.permit.permit_number, t.permit.agency].filter(Boolean).join(" · ") ||
                    "No application number yet"}{" "}
                  · {t.rounds.length} submission{t.rounds.length === 1 ? "" : "s"}
                </p>
              </div>
              <StagePill stage={t.stage} />
            </div>
            <div className="mt-3">
              <TrackLabel
                kind="parallel"
                label={t.permit.name}
                color={LANE_HEX[i % LANE_HEX.length]}
              />
              <Rail color={LANE_HEX[i % LANE_HEX.length]} />
            </div>
            <div className="my-3 flex items-stretch overflow-x-auto pb-1">
              {LANE_STEPS.map(([key, label], k) => {
                const state = laneStepState(t.stage, t.rounds, key);
                return (
                  <div key={key} className="flex min-w-0 flex-1 items-stretch">
                    {k > 0 && (
                      <span
                        className="flex w-7 shrink-0 items-center justify-center text-slate-400"
                        aria-hidden
                      >
                        <ArrowRight className="h-4 w-4" />
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        onView({
                          type: "permit",
                          permitId: t.permit.id,
                          stage: key,
                          tab: key === "comments" ? "comments" : "overview",
                        })
                      }
                      className={cn(
                        "min-w-[150px] flex-1 rounded-lg border-2 bg-card px-3 py-2 text-left transition-colors hover:bg-muted/40",
                        state === "current"
                          ? "border-green-600 bg-green-50"
                          : state === "done"
                            ? "border-slate-300"
                            : "border-border",
                      )}
                    >
                      <strong className="flex items-center gap-1.5 text-xs">
                        <span
                          className={cn(
                            "h-2 w-2 rounded-full",
                            state === "current" ? "bg-green-600" : "bg-slate-300",
                          )}
                          aria-hidden
                        />
                        {label}
                      </strong>
                      <small className="mt-0.5 block text-[11px] text-muted-foreground">
                        {subtitle[key]}
                      </small>
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>∥ This permit keeps its own status, review dates and comments.</span>
              <span className="flex flex-wrap gap-2">
                {t.permit.status !== "approved" && (
                  <button
                    type="button"
                    className="btn-outline px-2.5 py-1 text-xs"
                    onClick={() =>
                      onView({
                        type: "permit",
                        permitId: t.permit.id,
                        stage: "approved",
                        tab: "overview",
                        markApproved: true,
                      })
                    }
                  >
                    Mark as already approved
                  </button>
                )}
                <button
                  type="button"
                  className="btn-outline px-2.5 py-1 text-xs"
                  onClick={() =>
                    document
                      .getElementById(`loop-${t.permit.id}`)
                      ?.scrollIntoView({ behavior: "smooth", block: "start" })
                  }
                >
                  Open this permit's loop
                </button>
                <button
                  type="button"
                  className="btn-outline px-2.5 py-1 text-xs"
                  onClick={() =>
                    onView({
                      type: "history",
                      projectId: t.project.id,
                      permitKey: t.permit.permit_key,
                    })
                  }
                >
                  Submission history
                </button>
              </span>
            </div>
          </article>
        );
      })}
    </div>
  );
}

// ── one permit ─────────────────────────────────────────────────────────────
const STAGE_LABEL: Record<string, string> = {
  submitted: "Submitted",
  review: "City review",
  comments: "Comments / response",
  approved: "Approval",
  assign: "Responsibility assignment",
  engineer: "Engineer response",
  compliance: "Compliance check",
};

export function PermitView({
  view,
  track,
  onView,
  onChange,
}: {
  view: Extract<TrackView, { type: "permit" }>;
  track: PermitTrack;
  onView: Nav;
  onChange: (v: TrackView) => void;
}) {
  const { permit, rounds } = track;
  const r = rounds.find((x) => x.round === view.round) ?? rounds.at(-1);
  const tabs = [
    ["overview", "Submission details"],
    ["comments", "Review + comments"],
    ["history", "All submissions"],
  ] as const;
  return (
    <div className="grid gap-4">
      <ViewHead
        kicker="Permit-specific record"
        title={`${permit.name} / ${STAGE_LABEL[view.stage] ?? "Permit details"}`}
        subtitle={track.project.name ?? track.project.address ?? ""}
      />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {permit.permit_number && (
          <span className="rounded-full border border-border bg-muted/40 px-2.5 py-0.5">
            {permit.permit_number}
          </span>
        )}
        <StagePill stage={track.stage} />
        <span className="rounded-full border border-border bg-muted/40 px-2.5 py-0.5">
          {rounds.length} submission{rounds.length === 1 ? "" : "s"}
        </span>
      </div>
      <ApprovalPanel key={permit.id} permit={permit} startOpen={!!view.markApproved} />
      {r && (
        <label className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium">Viewing</span>
          <select
            className="min-w-0 max-w-full rounded-md border border-input bg-background px-2 py-1"
            value={r.round}
            onChange={(e) => onChange({ ...view, round: Number(e.target.value) })}
          >
            {rounds.map((c) => (
              <option key={c.round} value={c.round}>
                Submission {c.round} {c.round === 1 ? "(initial)" : "(resubmission)"} —{" "}
                {fmtDate(c.submitted_at)}
              </option>
            ))}
          </select>
          <span className="text-muted-foreground">
            Current permit stage: {stageName(track.stage)}
          </span>
        </label>
      )}
      <div
        className="flex flex-wrap gap-1.5 border-b border-border pb-2"
        role="group"
        aria-label="Permit detail views"
      >
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={view.tab === key}
            onClick={() => onChange({ ...view, tab: key })}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-semibold",
              view.tab === key
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border hover:bg-muted/50",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {!r ? (
        <div className="grid gap-3">
          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center">
            <h3 className="font-semibold">No submissions recorded</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {permit.name} is at {stageName(track.stage).toLowerCase()}. Filing dates and the
              expected return appear once it's marked submitted on the Permits page.
            </p>
          </div>
          <Box title="Independent permit lane">
            <Fields
              items={[
                ["Agency", permit.agency ?? "—"],
                ["Reviewer", permit.current_reviewer ?? "Not recorded"],
              ]}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Follows its own requirements; other permit lanes don't block it automatically.
            </p>
          </Box>
        </div>
      ) : view.tab === "history" ? (
        <>
          <HistoryGroup track={track} onView={onView} />
          <TimingHelp />
        </>
      ) : view.tab === "comments" ? (
        <CommentsPanel track={track} r={r} />
      ) : (
        <SubmissionOverview track={track} r={r} stage={view.stage} />
      )}
      {r && view.tab !== "history" && (
        <div className="flex flex-wrap justify-between gap-2">
          <button
            type="button"
            className="btn-outline text-xs"
            onClick={() => onView({ type: "round", permitId: permit.id, round: r.round })}
          >
            Open complete submission {r.round} record
          </button>
          <button
            type="button"
            className="btn-outline text-xs"
            onClick={() =>
              onView({ type: "history", projectId: track.project.id, permitKey: permit.permit_key })
            }
          >
            All submissions for this permit
          </button>
        </div>
      )}
    </div>
  );
}

const dateInput = (v: string | null | undefined) => (v ? v.slice(0, 10) : "");
const todayInput = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Record that a permit is already approved — e.g. approved before the project
// came into CorvusDP, or outside the tracked submissions. Marks it approved on
// the Permits page too; an open submission round is closed as approved.
function ApprovalPanel({ permit, startOpen }: { permit: PermitRow; startOpen: boolean }) {
  const qc = useQueryClient();
  const approved = permit.status === "approved";
  const [open, setOpen] = useState(startOpen && !approved);
  const [date, setDate] = useState(dateInput(permit.approved_at) || todayInput());
  const [number, setNumber] = useState(permit.permit_number ?? "");
  const [expiry, setExpiry] = useState(permit.expiry_date ?? "");
  const [doc, setDoc] = useState(permit.approval_doc_url ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!date) return setError("Enter the date the permit was approved.");
    if (date > todayInput()) return setError("The approval date can't be in the future.");
    if (expiry && expiry < date) return setError("The expiry date is before the approval date.");
    if (doc.trim() && !/^https:\/\/\S+$/i.test(doc.trim()))
      return setError("The approval document link must start with https://");
    setSaving(true);
    try {
      await updatePermit(permit.id, {
        status: "approved",
        approved_at: new Date(`${date}T12:00:00`).toISOString(),
        permit_number: number.trim() || null,
        expiry_date: expiry || null,
        approval_doc_url: doc.trim() || null,
      });
      await qc.invalidateQueries();
      setOpen(false);
      toast.success(`${permit.name} marked approved.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the approval.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return approved ? (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-green-200 bg-green-50 px-3 py-2.5 text-xs text-green-900">
        <span>
          <strong>Approved</strong>
          {permit.approved_at ? ` on ${fmtDate(permit.approved_at)}` : ""}
          {permit.permit_number ? ` · permit ${permit.permit_number}` : ""}
          {permit.expiry_date ? ` · expires ${fmtDate(permit.expiry_date)}` : ""}
        </span>
        <button
          type="button"
          className="btn-outline px-2.5 py-1 text-xs"
          onClick={() => setOpen(true)}
        >
          <Pencil className="h-3 w-3" aria-hidden /> Edit approval details
        </button>
      </div>
    ) : (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
        <span>Already approved by the city? Record it here.</span>
        <button
          type="button"
          className="btn-outline px-2.5 py-1 text-xs"
          onClick={() => setOpen(true)}
        >
          <Check className="h-3 w-3" aria-hidden /> Mark as already approved
        </button>
      </div>
    );
  }

  return (
    <section className="rounded-xl border-2 border-green-300 bg-green-50/60 p-4">
      <h3 className="text-sm font-semibold">
        {approved ? "Edit approval details" : "Mark this permit as already approved"}
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        For a permit the city has already approved. It moves to Approval on the map and is marked
        approved on the Permits page.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-medium">
          Approval date
          <input
            type="date"
            className={inputCls}
            value={date}
            max={todayInput()}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="grid gap-1 text-xs font-medium">
          Permit number <span className="font-normal text-muted-foreground">(optional)</span>
          <input
            className={inputCls}
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="e.g. BP-2026-01234"
          />
        </label>
        <label className="grid gap-1 text-xs font-medium">
          Expiry date <span className="font-normal text-muted-foreground">(optional)</span>
          <input
            type="date"
            className={inputCls}
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
          />
        </label>
        <label className="grid gap-1 text-xs font-medium">
          Approval document link{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
          <input
            type="url"
            className={inputCls}
            value={doc}
            onChange={(e) => setDoc(e.target.value)}
            placeholder="https://…"
          />
        </label>
      </div>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-accent" disabled={saving} onClick={save}>
          {saving ? "Saving…" : approved ? "Save approval details" : "Mark approved"}
        </button>
        <button
          type="button"
          className="btn-outline"
          disabled={saving}
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
    </section>
  );
}

export function ViewHead({
  kicker,
  title,
  subtitle,
}: {
  kicker: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="pr-8">
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {kicker}
      </div>
      <h2 className="font-serif text-xl font-semibold leading-tight">{title}</h2>
      {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

function SubmissionOverview({ track, r, stage }: { track: PermitTrack; r: Round; stage: string }) {
  const { permit, rounds } = track;
  const now = new Date();
  const eng = engineerWindow(r, now);
  const next = rounds.find((x) => x.round === r.round + 1);
  const overdue = !r.city_returned_at && r.expected_at && Date.parse(r.expected_at) < now.getTime();
  const open = r.comments.filter((c) => !c.responded_at).length;
  const dues = [
    ...new Set(
      r.comments
        .map((c) => c.due_at)
        .filter(Boolean)
        .sort()
        .map((d) => fmtDate(d)),
    ),
  ];
  return (
    <div className="grid gap-3">
      {stage === "approved" && (
        <Notice>
          <strong>
            {permit.approved_at
              ? `Approval recorded: ${fmtStamp(permit.approved_at)}`
              : "No approval recorded for this permit."}
          </strong>{" "}
          {permit.approved_at
            ? "Conditions of approval still need checking against the approval documents."
            : "This shows once the city approves it."}
        </Notice>
      )}
      {overdue && (
        <Notice tone="amber">
          The expected return date has passed with no city response recorded — time to follow up.
          (The expected date is a planning estimate, not a city deadline.)
        </Notice>
      )}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Metric
          value={`Submission ${r.round}`}
          label={r.round === 1 ? "Initial filing" : "Resubmission"}
          note="Each filing has its own city review clock"
        />
        <ClockMetric r={r} type="city" />
        <ClockMetric r={r} type="engineer" />
        <Metric
          value={`${r.comments.length} comment${r.comments.length === 1 ? "" : "s"}`}
          label="This submission"
          note={
            r.comments.length ? `${open} awaiting engineer response` : "No comments in this round"
          }
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <SubmissionEvidence track={track} r={r} />
        <Box title="City review + expected return">
          <Fields
            items={[
              ["Expected return", fmtStamp(r.expected_at, "Not estimated")],
              ["Expected-date basis", r.expected_basis ?? "—"],
              ["Review started", fmtStamp(r.review_started_at)],
              [
                "Actual city response",
                r.city_returned_at ? fmtStamp(r.city_returned_at) : "Pending",
              ],
              ["Reviewer", permit.current_reviewer ?? "Not recorded"],
              ["Round outcome", OUTCOME_LABEL[r.outcome]],
            ]}
          />
        </Box>
        <Box title="Engineer / architect response">
          <Fields
            items={[
              ["Comments assigned", eng.start ? fmtStamp(eng.start) : eng.state],
              ["All responses received", eng.end ? fmtStamp(eng.end) : eng.state],
              [
                "Response due",
                r.comments.length ? dues.join(" / ") || "Not set" : "Not required yet",
              ],
            ]}
          />
        </Box>
        <Box title="Compliance + next filing">
          <Fields
            items={[
              [
                "QA / compliance passed",
                r.qa_passed_at
                  ? fmtStamp(r.qa_passed_at)
                  : r.comments.length
                    ? "Not yet"
                    : "Not applicable to this round",
              ],
              ["Next resubmission", next ? fmtStamp(next.submitted_at) : "Not submitted"],
              [
                "Permit approval",
                permit.approved_at ? fmtStamp(permit.approved_at) : "Not recorded",
              ],
              ["Permit expiry", permit.expiry_date ? fmtDate(permit.expiry_date) : "Not recorded"],
            ]}
          />
        </Box>
      </div>
      <TimingHelp />
    </div>
  );
}

// filing evidence + planning fields, editable in place
function SubmissionEvidence({ track, r }: { track: PermitTrack; r: Round }) {
  const [editing, setEditing] = useState(false);
  return (
    <Box title="Submission details">
      {editing ? (
        <SubmissionEditor r={r} onDone={() => setEditing(false)} />
      ) : (
        <>
          <Fields
            items={[
              ["Submitted on", fmtStamp(r.submitted_at)],
              ["Package version", r.package_version ?? "—"],
              ["Application number", track.permit.permit_number ?? "—"],
              ["Confirmation / receipt", r.confirmation ?? "—"],
              ["Method", r.method ?? "—"],
              ["Submitted by", r.submitted_by ?? "—"],
              ...(r.notes ? ([["Notes", r.notes]] as [string, string][]) : []),
            ]}
          />
          <button
            type="button"
            className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
            onClick={() => setEditing(true)}
          >
            <Pencil className="h-3 w-3" aria-hidden /> Edit filing details & expected return
          </button>
        </>
      )}
    </Box>
  );
}

// <input type="datetime-local"> wants local "YYYY-MM-DDTHH:mm"
const toLocalInput = (v: string | null) => {
  if (!v) return "";
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

const useRefreshTrack = () => {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [TRACK_PORTFOLIO_KEY] });
};

function SubmissionEditor({ r, onDone }: { r: Round; onDone: () => void }) {
  const refresh = useRefreshTrack();
  const [f, setF] = useState({
    submitted_at: toLocalInput(r.submitted_at),
    expected_at: toLocalInput(r.expected_at),
    expected_basis: r.expected_basis ?? "",
    city_returned_at: toLocalInput(r.city_returned_at),
    method: r.method ?? "",
    confirmation: r.confirmation ?? "",
    package_version: r.package_version ?? "",
    submitted_by: r.submitted_by ?? "",
    notes: r.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = (key: keyof typeof f, label: string, type = "text") => (
    <label className="grid gap-1 text-xs">
      <span className="font-medium">{label}</span>
      <input
        type={type}
        className={cn(inputCls, "py-1.5 text-xs")}
        value={f[key]}
        onChange={(e) => setF({ ...f, [key]: e.target.value })}
      />
    </label>
  );
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (f.city_returned_at && f.submitted_at && f.city_returned_at < f.submitted_at) {
      setError("The city's response can't be before the filing.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const patch: SubmissionPatch = {
        submitted_at: fromLocalInput(f.submitted_at),
        expected_at: fromLocalInput(f.expected_at),
        expected_basis: f.expected_basis.trim() || null,
        city_returned_at: fromLocalInput(f.city_returned_at),
        method: f.method.trim() || null,
        confirmation: f.confirmation.trim() || null,
        package_version: f.package_version.trim() || null,
        submitted_by: f.submitted_by.trim() || null,
        notes: f.notes.trim() || null,
      };
      await updateSubmission(r.id, patch);
      await refresh();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="grid gap-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {field("submitted_at", "Submitted on", "datetime-local")}
        {field("city_returned_at", "City response", "datetime-local")}
        {field("expected_at", "Expected return", "datetime-local")}
        {field("expected_basis", "Basis for the expected date")}
        {field("method", "Method (portal, email, counter…)")}
        {field("confirmation", "Confirmation / receipt no.")}
        {field("package_version", "Package version")}
        {field("submitted_by", "Submitted by")}
      </div>
      {field("notes", "Notes")}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn-accent px-3 py-1 text-xs" disabled={busy}>
          Save
        </button>
        <button type="button" className="text-xs text-muted-foreground" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function CommentsPanel({ track, r }: { track: PermitTrack; r: Round }) {
  const refresh = useRefreshTrack();
  const now = new Date();
  const eng = engineerWindow(r, now);
  const next = track.rounds.find((x) => x.round === r.round + 1);
  return (
    <div className="grid gap-3">
      <Notice>
        Submission {r.round} · {track.permit.name}. These comments and turnaround times belong to
        this permit only.
      </Notice>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Metric value={r.comments.length} label="Total comments" />
        <Metric
          value={r.comments.filter((c) => !c.responded_at).length}
          label="Awaiting engineer response"
        />
        <Metric
          value={r.comments.filter((c) => c.responded_at && !c.verified_at).length}
          label="Responses awaiting QA"
        />
        <ClockMetric r={r} type="engineer" />
      </div>
      {!r.comments.length ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center">
          <h3 className="font-semibold">
            {r.outcome === "approved"
              ? "Approved without comments in this round"
              : "No city comments recorded"}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {r.city_returned_at
              ? "Log the city's comments on the Reviews page — they'll appear here with their engineer clock."
              : "The city review is still open. Comment assignments and engineer clocks haven't started."}
          </p>
        </div>
      ) : (
        <div className="max-w-full overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[860px] text-left text-[11px]">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                {[
                  "Comment",
                  "Discipline / assignee",
                  "Assigned",
                  "Engineer due",
                  "Response received",
                  "Elapsed response",
                  "QA status",
                ].map((h) => (
                  <th key={h} className="whitespace-nowrap px-2.5 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.comments.map((c, i) => (
                <tr key={c.id} className="border-t border-border align-top">
                  <td className="max-w-[260px] px-2.5 py-2">
                    <b>
                      C-{r.round}.{String(i + 1).padStart(2, "0")}
                    </b>
                    <br />
                    {c.plain_language || c.original}
                  </td>
                  <td className="px-2.5 py-2">
                    {c.discipline ?? "—"}
                    <small className="block text-muted-foreground">
                      {c.responsible || "Not assigned"}
                    </small>
                  </td>
                  <td className="px-2.5 py-2">
                    <DateCell v={c.assigned_at} empty="Not assigned" />
                  </td>
                  <td className="px-2.5 py-2">
                    <input
                      type="date"
                      aria-label={`Due date for comment ${i + 1}`}
                      className="rounded border border-input bg-background px-1 py-0.5 text-[11px]"
                      defaultValue={c.due_at ? c.due_at.slice(0, 10) : ""}
                      onChange={async (e) => {
                        await setCommentDue(
                          c.id,
                          e.target.value
                            ? new Date(`${e.target.value}T17:00:00`).toISOString()
                            : null,
                        );
                        await refresh();
                      }}
                    />
                  </td>
                  <td className="px-2.5 py-2">
                    <DateCell v={c.responded_at} empty="Awaiting response" />
                  </td>
                  <td className="px-2.5 py-2">
                    <span className="font-bold text-violet-700">
                      {fmtDays(elapsedDays(c.assigned_at, c.responded_at, now))}
                    </span>
                    {!c.responded_at && c.assigned_at && (
                      <span className="mt-0.5 block w-fit rounded bg-green-50 px-1 text-[10px] text-green-700">
                        Ongoing
                      </span>
                    )}
                  </td>
                  <td className="px-2.5 py-2">
                    {c.verified_at ? (
                      <>
                        Verified
                        <DateCell v={c.verified_at} />
                      </>
                    ) : c.responded_at ? (
                      "Awaiting QA"
                    ) : (
                      "Awaiting response"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {r.comments.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Box title="Current round handoff">
            <Fields
              items={[
                ["City returned comments", fmtStamp(r.city_returned_at)],
                ["Engineer window started", fmtStamp(eng.start)],
                ["All revisions completed", eng.end ? fmtStamp(eng.end) : "In progress"],
                ["Compliance passed", r.qa_passed_at ? fmtStamp(r.qa_passed_at) : "Not yet"],
              ]}
            />
          </Box>
          <Box title="Resubmission loop">
            <Fields
              items={[
                ["Next filing", next ? `Submission ${next.round}` : "Not yet submitted"],
                ["Next filing time", next ? fmtStamp(next.submitted_at) : "Pending"],
                [
                  "Next stage",
                  next
                    ? "City review restarted for this permit"
                    : eng.end
                      ? "Compliance + resubmission preparation"
                      : "Engineer responses",
                ],
              ]}
            />
          </Box>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Comments are logged, assigned and closed on the Reviews page; assignment, response and QA
        times are recorded from there automatically.
      </p>
      <TimingHelp />
    </div>
  );
}

// ── history ───────────────────────────────────────────────────────────────
function HistoryGroup({ track, onView }: { track: PermitTrack; onView: Nav }) {
  const now = new Date();
  const { permit, rounds } = track;
  return (
    <section className="grid gap-2">
      <div>
        <h3 className="flex flex-wrap items-center gap-2 font-semibold">
          {permit.name}
          <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-normal">
            {rounds.length} submission{rounds.length === 1 ? "" : "s"}
          </span>
        </h3>
        <p className="text-xs text-muted-foreground">
          {track.project.name ?? track.project.address} · Current: {stageName(track.stage)}
        </p>
      </div>
      {rounds.length ? (
        <div className="max-w-full overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[900px] text-left text-[11px]">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                {[
                  "Round",
                  "Submitted",
                  "Expected city return",
                  "Actual city return",
                  "City time",
                  "Engineer time",
                  "Next resubmission",
                  "City outcome",
                  "Record",
                ].map((h) => (
                  <th key={h} className="whitespace-nowrap px-2.5 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rounds.map((r, i) => {
                const c = cityClock(r, now),
                  e = engineerWindow(r, now),
                  next = rounds[i + 1];
                return (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="px-2.5 py-2">
                      <b>Submission {r.round}</b>
                      <small className="block text-muted-foreground">
                        {r.round === 1 ? "Initial filing" : "Resubmission"}
                      </small>
                    </td>
                    <td className="px-2.5 py-2">
                      <DateCell v={r.submitted_at} />
                    </td>
                    <td className="px-2.5 py-2">
                      <DateCell v={r.expected_at} empty="Not estimated" />
                    </td>
                    <td className="px-2.5 py-2">
                      <DateCell v={r.city_returned_at} empty="Pending city response" />
                    </td>
                    <td className="px-2.5 py-2">
                      <span className="font-bold text-blue-700">{fmtDays(c.value)}</span>
                      {c.state === "Ongoing" && (
                        <span className="mt-0.5 block w-fit rounded bg-green-50 px-1 text-[10px] text-green-700">
                          Ongoing
                        </span>
                      )}
                    </td>
                    <td className="px-2.5 py-2">
                      <span className="font-bold text-violet-700">
                        {e.value == null ? e.state : fmtDays(e.value)}
                      </span>
                      {e.state === "Ongoing" && (
                        <span className="mt-0.5 block w-fit rounded bg-green-50 px-1 text-[10px] text-green-700">
                          Ongoing
                        </span>
                      )}
                    </td>
                    <td className="px-2.5 py-2">
                      {next ? (
                        <DateCell v={next.submitted_at} />
                      ) : r.outcome === "approved" ? (
                        "Not required"
                      ) : (
                        "Not yet submitted"
                      )}
                    </td>
                    <td className="px-2.5 py-2">{OUTCOME_LABEL[r.outcome]}</td>
                    <td className="px-2.5 py-2">
                      <button
                        type="button"
                        className="btn-outline px-2 py-0.5 text-[11px]"
                        onClick={() =>
                          onView({ type: "round", permitId: permit.id, round: r.round })
                        }
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-center text-xs text-muted-foreground">
          No submissions recorded for this permit yet — no turnaround time to calculate.
        </div>
      )}
    </section>
  );
}

export function HistoryView({
  view,
  tracks,
  projects,
  onView,
  onChange,
}: {
  view: Extract<TrackView, { type: "history" }>;
  tracks: PermitTrack[];
  projects: ProjectRow[];
  onView: Nav;
  onChange: (v: TrackView) => void;
}) {
  const inProject = tracks.filter(
    (t) => view.projectId === "all" || t.project.id === view.projectId,
  );
  const shown = inProject.filter(
    (t) => view.permitKey === "all" || t.permit.permit_key === view.permitKey,
  );
  const permitTypes = [
    ...new Map(inProject.map((t) => [t.permit.permit_key, t.permit.name])).entries(),
  ];
  const totals = historyTotals(
    shown.flatMap((t) => t.rounds),
    new Date(),
  );
  function exportCsv() {
    const csv = historyCsv(
      shown.map((t) => ({
        project: t.project.name ?? t.project.address ?? "",
        permit: t.permit.name,
        rounds: t.rounds,
      })),
      new Date(),
    );
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "permit-submission-history.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }
  return (
    <div className="grid gap-4">
      <ViewHead
        kicker="Complete submission history"
        title="Resubmission Manager"
        subtitle="Every submission round, with time at the city kept apart from time with the design team."
      />
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid min-w-0 gap-1 text-xs sm:w-56">
          <span className="text-muted-foreground">Project</span>
          <select
            className={cn(inputCls, "py-1.5 text-xs")}
            value={view.projectId}
            onChange={(e) => onChange({ ...view, projectId: e.target.value, permitKey: "all" })}
          >
            <option value="all">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name ?? p.address}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-xs sm:w-56">
          <span className="text-muted-foreground">Permit type</span>
          <select
            className={cn(inputCls, "py-1.5 text-xs")}
            value={view.permitKey}
            onChange={(e) => onChange({ ...view, permitKey: e.target.value })}
          >
            <option value="all">All permit types</option>
            {permitTypes.map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn-outline text-xs"
          onClick={exportCsv}
          disabled={!shown.length}
        >
          <Download className="h-3.5 w-3.5" aria-hidden /> Export visible history (CSV)
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Metric
          value={totals.rounds}
          label="Submission rounds"
          note="1 = initial filing; 2+ = resubmissions"
        />
        <Metric
          value={fmtDays(totals.cityDone)}
          label="Completed city review time"
          note="Completed rounds only"
        />
        <Metric
          value={fmtDays(totals.engineerDone)}
          label="Completed engineer revision time"
          note="Completed response windows only"
        />
        <Metric
          value={totals.open}
          label="Open review / response clocks"
          note="Shown as Ongoing in the tables"
        />
      </div>
      <Notice>
        Expected dates are forecasts. Closed durations stop at the actual event; open ones are
        marked Ongoing and run to now.
      </Notice>
      {shown.map((t) => (
        <HistoryGroup key={t.permit.id} track={t} onView={onView} />
      ))}
      {!shown.length && (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-xs text-muted-foreground">
          No permits match these filters.
        </div>
      )}
      <TimingHelp />
    </div>
  );
}

// ── one round, complete ───────────────────────────────────────────────────
export function RoundView({
  track,
  roundNo,
  onView,
}: {
  track: PermitTrack;
  roundNo: number;
  onView: Nav;
}) {
  const r = track.rounds.find((x) => x.round === roundNo);
  if (!r) return <p className="text-sm text-muted-foreground">That submission isn't recorded.</p>;
  const now = new Date();
  const eng = engineerWindow(r, now);
  const next = track.rounds.find((x) => x.round === r.round + 1);
  const handoff = eng.start ? elapsedDays(r.city_returned_at, eng.start, now) : null;
  const packaging =
    eng.end && r.outcome !== "approved"
      ? elapsedDays(eng.end, next?.submitted_at ?? null, now)
      : null;
  const events = (
    [
      ["Submitted to city", r.submitted_at],
      ["City review started", r.review_started_at],
      [`City response: ${OUTCOME_LABEL[r.outcome]}`, r.city_returned_at],
      ["First assignment to engineers", eng.start],
      ["All engineer responses received", eng.end],
      ["Compliance / QA passed", r.qa_passed_at],
      ["Next resubmission filed", next?.submitted_at ?? null],
    ] as [string, string | null][]
  )
    .filter((e): e is [string, string] => !!e[1])
    .sort((a, b) => Date.parse(a[1]) - Date.parse(b[1]));
  return (
    <div className="grid gap-4">
      <ViewHead
        kicker="Complete round record"
        title={`Submission ${r.round} / ${track.permit.name}`}
        subtitle={track.project.name ?? track.project.address ?? ""}
      />
      <Notice>
        <strong>
          {track.permit.name} / Submission {r.round}
        </strong>{" "}
        · {r.round === 1 ? "Initial filing" : "Resubmission"} · {OUTCOME_LABEL[r.outcome]}
      </Notice>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <ClockMetric r={r} type="city" />
        <ClockMetric r={r} type="engineer" />
        <Metric
          value={handoff == null ? "Not started" : fmtDays(handoff)}
          label="City-to-engineer handoff"
          note="City response to first assignment"
        />
        <Metric
          value={packaging == null ? "Not started" : fmtDays(packaging)}
          label="After engineering, before filing"
          note={
            packaging == null
              ? "QA / coordination interval"
              : next
                ? "Completed QA / filing interval"
                : "Ongoing — runs to now"
          }
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <SubmissionEvidence track={track} r={r} />
        <Box title="Expected and actual city response">
          <Fields
            items={[
              ["Expected return", fmtStamp(r.expected_at, "Not estimated")],
              ["Expected-date basis", r.expected_basis ?? "—"],
              ["Reviewer", track.permit.current_reviewer ?? "Not recorded"],
              ["Actual response", r.city_returned_at ? fmtStamp(r.city_returned_at) : "Pending"],
              ["City outcome", OUTCOME_LABEL[r.outcome]],
            ]}
          />
        </Box>
        <Box title="Engineer response and QA">
          <Fields
            items={[
              ["First assignment", eng.start ? fmtStamp(eng.start) : eng.state],
              ["All responses received", eng.end ? fmtStamp(eng.end) : eng.state],
              [
                "Compliance passed",
                r.qa_passed_at
                  ? fmtStamp(r.qa_passed_at)
                  : r.comments.length
                    ? "Not yet"
                    : "Not applicable",
              ],
              ["Next resubmission", next ? fmtStamp(next.submitted_at) : "Not recorded"],
            ]}
          />
        </Box>
        <Box title="Actual-event timeline">
          {events.length ? (
            <ol className="ml-2 border-l-2 border-slate-200 pl-4">
              {events.map(([name, time]) => (
                <li key={name} className="relative mb-3 last:mb-0">
                  <span
                    className="absolute -left-[23px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-slate-500 ring-1 ring-slate-300"
                    aria-hidden
                  />
                  <strong className="block text-xs">{name}</strong>
                  <time className="text-[11px] text-muted-foreground">{fmtStamp(time)}</time>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-xs text-muted-foreground">No dated events recorded yet.</p>
          )}
        </Box>
      </div>
      {r.comments.length ? (
        <CommentsPanel track={track} r={r} />
      ) : (
        <>
          <Notice>
            No engineering comments in this round, so no engineer revision time is counted.
          </Notice>
          <TimingHelp />
        </>
      )}
      <div className="flex flex-wrap justify-between gap-2">
        <button
          type="button"
          className="btn-outline text-xs"
          onClick={() =>
            onView({
              type: "history",
              projectId: track.project.id,
              permitKey: track.permit.permit_key,
            })
          }
        >
          All submissions for this permit
        </button>
        {next && (
          <button
            type="button"
            className="btn-outline text-xs"
            onClick={() => onView({ type: "round", permitId: track.permit.id, round: next.round })}
          >
            Open submission {next.round}
          </button>
        )}
      </div>
    </div>
  );
}
