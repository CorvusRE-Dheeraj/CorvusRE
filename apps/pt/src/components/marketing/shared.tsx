import { useState, type ReactNode } from "react";
import { Ban, Sparkles, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { MarkdownLite } from "@/components/MarkdownLite";
import { getErrorMessage } from "@/lib/error-message";
import type { Alert, CampaignStatus, FieldSource, Stage } from "@/lib/marketing";
import { STAGE_LABEL } from "@/lib/marketing";

export type MarketingTab = "dashboard" | "leads" | "campaigns" | "ai" | "followups" | "analytics";
export type Focus = {
  leadId?: string;
  campaignId?: string;
  stages?: Stage[];
  filters?: import("@/lib/marketing-crm").LeadFilters;
  /** start a new campaign for these leads */
  newCampaign?: { leadIds: string[]; name: string; segmentId?: string };
};
export type Go = (tab: MarketingTab, focus?: Focus) => void;

export function StatTile({
  label,
  value,
  hint,
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-serif text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </>
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className="card-elev p-4 text-left transition-colors hover:bg-secondary/40"
    >
      {body}
    </button>
  ) : (
    <div className="card-elev p-4">{body}</div>
  );
}

/** One-series horizontal bars: label, bar, value. Hover shows the exact figure. */
export function Bars({
  rows,
  format = (n) => n.toLocaleString("en-US"),
  emptyText = "No data yet.",
}: {
  rows: { label: string; value: number; note?: string }[];
  format?: (n: number) => string;
  emptyText?: string;
}) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (rows.length === 0 || max === 0)
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <ul className="grid gap-2">
      {rows.map((r) => (
        <li
          key={r.label}
          className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm"
          title={`${r.label}: ${format(r.value)}${r.note ? ` — ${r.note}` : ""}`}
        >
          <span className="truncate text-muted-foreground">{r.label}</span>
          <span className="h-2.5 rounded-full bg-secondary">
            <span
              className="block h-2.5 rounded-full bg-accent"
              style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }}
            />
          </span>
          <span className="tabular-nums font-medium">
            {format(r.value)}
            {r.note && (
              <span className="ml-1 text-xs font-normal text-muted-foreground">{r.note}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

const STAGE_TONE: Record<Stage, string> = {
  new: "bg-sky-100 text-sky-900",
  researching: "bg-slate-100 text-slate-800",
  ready: "bg-cyan-100 text-cyan-900",
  contacted: "bg-indigo-100 text-indigo-900",
  interested: "bg-amber-100 text-amber-900",
  registered: "bg-teal-100 text-teal-900",
  subscribed: "bg-emerald-100 text-emerald-900",
  no_response: "bg-orange-50 text-orange-900",
  not_interested: "bg-secondary text-muted-foreground",
  do_not_contact: "bg-rose-100 text-rose-900",
};
export function StageBadge({ stage }: { stage: Stage }) {
  return (
    <span
      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${STAGE_TONE[stage]}`}
    >
      {stage === "do_not_contact" && <Ban className="-mt-0.5 mr-1 inline h-3 w-3" aria-hidden />}
      {STAGE_LABEL[stage]}
    </span>
  );
}

const PRIORITY_TONE = {
  high: "bg-rose-600 text-white",
  medium: "bg-amber-100 text-amber-900",
  low: "bg-secondary text-muted-foreground",
} as const;
export function PriorityBadge({ priority }: { priority: "high" | "medium" | "low" | null }) {
  if (!priority) return null;
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${PRIORITY_TONE[priority]}`}
    >
      {priority}
    </span>
  );
}

/** Where a detail came from; amber when it still needs a person to verify it. */
export function SourceChip({ src, onVerify }: { src?: FieldSource; onVerify?: () => void }) {
  if (!src) return null;
  const unsure = !src.verified && (src.confidence ?? 1) < 0.9;
  return (
    <span
      className={`ml-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${unsure ? "bg-amber-50 text-amber-900" : "bg-secondary text-muted-foreground"}`}
      title={[
        src.source,
        src.detail,
        src.confidence != null && `confidence ${Math.round(src.confidence * 100)}%`,
      ]
        .filter(Boolean)
        .join(" · ")}
    >
      {src.verified ? "✓ " : ""}
      {src.source}
      {unsure && onVerify && (
        <button type="button" onClick={onVerify} className="font-semibold underline">
          verify
        </button>
      )}
    </span>
  );
}

const CAMPAIGN_TONE: Record<CampaignStatus, string> = {
  draft: "bg-secondary text-muted-foreground",
  approved: "bg-sky-100 text-sky-900",
  scheduled: "bg-indigo-100 text-indigo-900",
  sending: "bg-amber-100 text-amber-900",
  sent: "bg-emerald-100 text-emerald-900",
  paused: "bg-rose-100 text-rose-900",
};
export function CampaignBadge({ status }: { status: CampaignStatus }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${CAMPAIGN_TONE[status]}`}
    >
      {status}
    </span>
  );
}

export function ScoreBadge({ score }: { score: number }) {
  const tone =
    score >= 60
      ? "bg-emerald-600 text-white"
      : score >= 35
        ? "bg-amber-100 text-amber-900"
        : "bg-secondary text-muted-foreground";
  return (
    <span
      className={`inline-grid h-7 w-9 place-items-center rounded-md text-xs font-bold tabular-nums ${tone}`}
      title="Lead score (0–100)"
    >
      {score}
    </span>
  );
}

const SEVERITY: Record<Alert["severity"], { dot: string; label: string }> = {
  critical: { dot: "bg-rose-600", label: "Urgent" },
  warning: { dot: "bg-amber-500", label: "Soon" },
  info: { dot: "bg-sky-500", label: "Opportunity" },
};
export function AlertRow({ alert, go }: { alert: Alert; go: Go }) {
  const s = SEVERITY[alert.severity];
  return (
    <li>
      <button
        type="button"
        onClick={() => go(alert.tab, { leadId: alert.leadId, campaignId: alert.campaignId })}
        className="flex w-full items-start gap-3 rounded-md px-2 py-2 text-left hover:bg-secondary/50"
      >
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${s.dot}`} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{alert.title}</span>
          <span className="block text-xs text-muted-foreground">{alert.detail}</span>
        </span>
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {s.label}
        </span>
      </button>
    </li>
  );
}

/** An AI result with a run/re-run button. The result is shown for review — nothing is applied automatically. */
export function AiBox({
  title,
  text,
  when,
  run,
  runLabel = "Ask Corvus AI",
  children,
}: {
  title: string;
  text: string | null;
  when?: string | null;
  run: () => Promise<void>;
  runLabel?: string;
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      await run();
    } catch (err) {
      toast.error(getErrorMessage(err, "Corvus AI couldn't finish that. Try again."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card-elev p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-accent" aria-hidden /> {title}
        </h3>
        <button
          type="button"
          onClick={() => void go()}
          disabled={busy}
          className="btn-outline inline-flex items-center gap-1.5 py-1 text-xs disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} aria-hidden />
          {busy ? "Thinking…" : text ? "Refresh" : runLabel}
        </button>
      </div>
      {text ? (
        <>
          <MarkdownLite text={text} className="mt-3 text-sm" />
          {when && <p className="mt-2 text-[11px] text-muted-foreground">Generated {when}</p>}
          {children}
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          {busy ? "Reading your marketing data…" : "No AI suggestions yet."}
        </p>
      )}
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40";
