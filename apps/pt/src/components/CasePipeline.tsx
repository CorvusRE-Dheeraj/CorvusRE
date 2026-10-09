import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { AlertTriangle, ArrowRight, Check, Clock, Users } from "lucide-react";
import type { NextAction, Pipeline, Urgency } from "@/lib/case-pipeline";
import { daysBetween } from "@/lib/case-pipeline";

const URGENCY_STYLE: Record<Urgency, { box: string; chip: string }> = {
  overdue: {
    box: "border-destructive bg-destructive/10",
    chip: "bg-destructive text-destructive-foreground",
  },
  urgent: {
    box: "border-destructive/70 bg-destructive/5",
    chip: "bg-destructive/15 text-destructive",
  },
  soon: { box: "border-warning bg-warning/10", chip: "bg-warning/20 text-warning-foreground" },
  normal: { box: "border-accent bg-accent/5", chip: "bg-accent/15 text-accent" },
};

function dueText(next: NextAction, today: string): string | null {
  if (!next.dueDate) return null;
  const d = daysBetween(today, next.dueDate);
  const date = new Date(`${next.dueDate}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const when =
    d < 0
      ? `${-d} day${d === -1 ? "" : "s"} overdue`
      : d === 0
        ? "due today"
        : d === 1
          ? "due tomorrow"
          : `${d} days left`;
  return `${next.dueLabel ? `${next.dueLabel}: ` : ""}${date} · ${when}`;
}

// The large NEXT REQUIRED ACTION banner — one per property, always showing
// the single thing that moves the case forward (case-pipeline.ts).
// `onGo` handles the action in place (View Case scrolls to the anchor);
// without it the button links to View Case at that anchor.
export function NextRequiredAction({
  pipeline,
  today,
  propertyId,
  address,
  onGo,
  onStart,
  lockedHint,
  compact = false,
}: {
  pipeline: Pipeline;
  today: string;
  propertyId: string;
  address?: string;
  onGo?: (anchor: string) => void;
  onStart?: () => void;
  // Set when the case can't be opened (e.g. no active subscription) — the
  // action still shows, with why it can't be done here yet.
  lockedHint?: string;
  compact?: boolean;
}) {
  const { next } = pipeline;
  const style = URGENCY_STYLE[next.urgency];
  const due = dueText(next, today);
  const target = next.target;

  const button =
    lockedHint && target.kind === "anchor" ? (
      <p className="text-sm font-medium text-muted-foreground">{lockedHint}</p>
    ) : target.kind === "anchor" ? (
      onGo ? (
        <button
          type="button"
          onClick={() => onGo(target.anchor)}
          className="btn-primary btn-primary-hover inline-flex items-center gap-1.5"
        >
          Go to this step <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : (
        <Link
          to="/dashboard/case"
          search={{ propertyId, anchor: target.anchor }}
          className="btn-primary btn-primary-hover inline-flex items-center gap-1.5"
        >
          Go to this step <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      )
    ) : target.kind === "start" && onStart ? (
      <button
        type="button"
        onClick={onStart}
        className="btn-primary btn-primary-hover inline-flex items-center gap-1.5"
      >
        Start my case <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </button>
    ) : null;

  return (
    <section
      aria-label="Next required action"
      className={`rounded-xl border-2 ${style.box} ${compact ? "p-4" : "p-5 md:p-6"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-black uppercase tracking-[0.18em] text-foreground">
          Next required action
        </span>
        {next.owner === "corvus" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-semibold text-violet-800 dark:text-violet-300">
            <Users className="h-3 w-3" aria-hidden="true" /> CorvusPT is handling this
          </span>
        )}
        {due && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.chip}`}
          >
            {next.urgency === "overdue" || next.urgency === "urgent" ? (
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            ) : (
              <Clock className="h-3 w-3" aria-hidden="true" />
            )}
            {due}
          </span>
        )}
      </div>
      <h2
        className={`mt-2 font-serif font-semibold ${compact ? "text-lg" : "text-2xl md:text-3xl"}`}
      >
        {next.title}
      </h2>
      {address && <p className="text-xs text-muted-foreground">{address}</p>}
      {button && <div className="mt-3">{button}</div>}
      {/* Kept to a small footnote — the title and button carry the action. */}
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">* {next.detail}</p>
    </section>
  );
}

// The nine-stage case road: Case Readiness → … → Close Case.
export function PipelineStepper({ pipeline }: { pipeline: Pipeline }) {
  return (
    <ol
      aria-label="Case pipeline"
      className="flex min-w-0 max-w-full items-start overflow-x-auto pb-1"
    >
      {pipeline.stages.flatMap((s, i) => {
        const last = i === pipeline.stages.length - 1;
        const circle =
          s.state === "done"
            ? "bg-success text-success-foreground"
            : s.state === "current"
              ? "bg-primary text-primary-foreground ring-4 ring-primary/20"
              : "bg-secondary text-muted-foreground";
        const item = (
          <li
            key={s.id}
            className="flex shrink-0 flex-col items-center gap-1 w-[78px]"
            aria-current={s.state === "current" ? "step" : undefined}
          >
            <span
              className={`grid h-8 w-8 place-items-center rounded-full text-xs font-semibold ${circle}`}
            >
              {s.state === "done" ? <Check className="h-4 w-4" aria-hidden="true" /> : i + 1}
            </span>
            <span
              className={`text-center text-[11px] leading-tight ${
                s.state === "current" ? "font-semibold text-foreground" : "text-muted-foreground"
              } ${s.state === "skipped" ? "line-through" : ""}`}
            >
              {s.label}
            </span>
            {s.state === "skipped" && (
              <span className="text-[10px] text-muted-foreground">not needed</span>
            )}
          </li>
        );
        if (last) return [item];
        return [
          item,
          <li
            key={`${s.id}-line`}
            aria-hidden="true"
            className="flex min-w-[8px] flex-1 items-center"
          >
            <span
              className={`mt-4 h-0.5 w-full ${s.state === "done" || s.state === "skipped" ? "bg-success/70" : "bg-border"}`}
            />
          </li>,
        ];
      })}
    </ol>
  );
}

export type UrgentTileItem = {
  key: string;
  title: string;
  address: string;
  dueDate: string | null;
  urgency: Urgency;
  onOpen: () => void;
};

const WEEK_DAYS = 7;

// The dashboard's next-action strip: the most urgent tasks due within a week
// (overdue first), as up to three bold tiles. With more than three, the third
// tile becomes "+N" and opens the full list. Falls back to the nearest tasks
// when nothing is due that soon, so the strip never goes blank.
export function UrgentActionTiles({ items, today }: { items: UrgentTileItem[]; today: string }) {
  const [showAll, setShowAll] = useState(false);
  if (items.length === 0) return null;
  const dueSoon = items.filter((i) => i.dueDate && daysBetween(today, i.dueDate) <= WEEK_DAYS);
  const pool = dueSoon.length > 0 ? dueSoon : items;
  const overflow = pool.length > 3;
  const shown = showAll ? pool : overflow ? pool.slice(0, 2) : pool;

  const dueShort = (d: string | null) => {
    if (!d) return null;
    const n = daysBetween(today, d);
    return n < 0
      ? `${-n}d overdue`
      : n === 0
        ? "Due today"
        : n === 1
          ? "Due tomorrow"
          : `Due in ${n}d`;
  };

  return (
    <section aria-label="Most urgent next actions" className="grid gap-2">
      <span className="text-xs font-black uppercase tracking-[0.18em] text-foreground">
        Next required actions
      </span>
      <div className="grid gap-3 sm:grid-cols-3">
        {shown.map((i) => (
          <button
            key={i.key}
            type="button"
            onClick={i.onOpen}
            className={`flex min-w-0 flex-col items-start gap-1 rounded-xl border-2 p-4 text-left transition-colors hover:bg-secondary/40 ${URGENCY_STYLE[i.urgency].box}`}
          >
            <span className="text-base font-bold leading-snug">{i.title}</span>
            <span className="w-full truncate text-[11px] text-muted-foreground">
              {i.address}
              {dueShort(i.dueDate) ? ` · ${dueShort(i.dueDate)}` : ""}
            </span>
          </button>
        ))}
        {overflow && !showAll && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="grid place-items-center rounded-xl border-2 border-dashed border-border p-4 text-2xl font-bold text-foreground hover:bg-secondary/40"
            aria-label={`Show ${pool.length - 2} more actions`}
          >
            +{pool.length - 2}
          </button>
        )}
      </div>
      {showAll && overflow && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="justify-self-start text-xs text-accent underline"
        >
          Show less
        </button>
      )}
    </section>
  );
}
