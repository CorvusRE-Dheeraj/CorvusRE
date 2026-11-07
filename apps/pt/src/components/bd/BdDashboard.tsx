import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlarmClock,
  Briefcase,
  CalendarDays,
  FileText,
  PauseCircle,
  TrendingUp,
} from "lucide-react";
import { getErrorMessage } from "@/lib/error-message";
import { useLiveRefresh } from "@/lib/staff-records";
import { bdDashboard, dateShort, usd0, STAGE_LABEL, PIPELINE, type Stage } from "@/lib/bd-console";

type Data = Awaited<ReturnType<typeof bdDashboard>>;

export function BdDashboard({
  onOpportunity,
  onAccount,
  onTab,
}: {
  onOpportunity: (id: string) => void;
  onAccount: (id: string) => void;
  onTab: (tab: "pipeline" | "followups" | "proposals") => void;
}) {
  const [d, setD] = useState<Data | null>(null);
  const load = useCallback(
    () =>
      bdDashboard()
        .then(setD)
        .catch((e) => toast.error(getErrorMessage(e, "Couldn't load the dashboard."))),
    [],
  );
  useEffect(() => void load(), [load]);
  useLiveRefresh(["bd_opportunities", "bd_activities"], () => void load(), true);
  if (!d) return <p className="mt-6 text-sm text-muted-foreground">Loading…</p>;
  const cards = [
    {
      label: "Active opportunities",
      value: String(d.activeOpportunities),
      hint: `${d.onHold} on hold`,
      icon: Briefcase,
      go: () => onTab("pipeline"),
    },
    {
      label: "Estimated pipeline",
      value: usd0(d.pipelineValue),
      hint: `${usd0(d.weightedValue)} weighted by stage — a forecast, not revenue`,
      icon: TrendingUp,
      go: () => onTab("pipeline"),
    },
    {
      label: "Pending proposals",
      value: String(d.pendingProposals),
      hint: `${d.awaitingApproval} awaiting approval`,
      icon: FileText,
      go: () => onTab("pipeline"),
    },
    {
      label: "Meetings in 14 days",
      value: String(d.upcomingMeetings.length),
      hint: "calls, meetings, demos",
      icon: CalendarDays,
      go: () => onTab("followups"),
    },
    {
      label: "Overdue actions",
      value: String(d.overdue.length),
      hint: "follow-ups and next actions",
      icon: AlarmClock,
      tone: d.overdue.length ? "text-destructive" : "",
      go: () => onTab("followups"),
    },
    {
      label: "Stalled (21+ days)",
      value: String(d.stalled.length),
      hint: "no stage change or activity",
      icon: PauseCircle,
      tone: d.stalled.length ? "text-amber-700" : "",
      go: () => onTab("pipeline"),
    },
  ];
  const open = (x: { opportunityId?: string | null; accountId?: string | null }) =>
    x.opportunityId
      ? onOpportunity(x.opportunityId)
      : x.accountId
        ? onAccount(x.accountId)
        : undefined;
  return (
    <div className="mt-6 grid gap-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {cards.map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={c.go}
            className="card-elev p-4 text-left hover:bg-secondary/40"
          >
            <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <c.icon className="h-3.5 w-3.5" aria-hidden /> {c.label}
            </div>
            <div className={`mt-1 text-2xl font-semibold ${c.tone ?? ""}`}>{c.value}</div>
            <div className="text-xs text-muted-foreground">{c.hint}</div>
          </button>
        ))}
      </div>

      <section className="card-elev p-5">
        <h2 className="font-semibold">Pipeline by stage</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4 lg:grid-cols-8">
          {PIPELINE.map((s: Stage) => (
            <div key={s} className="rounded-md bg-secondary/50 p-2">
              <div className="text-[11px] text-muted-foreground">{STAGE_LABEL[s]}</div>
              <div className="text-lg font-semibold">{d.byStage[s] ?? 0}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card-elev p-5">
          <h2 className="font-semibold">Overdue</h2>
          {d.overdue.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Nothing overdue.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border/60 text-sm">
              {d.overdue.map((x) => (
                <li key={x.kind + x.id}>
                  <button
                    type="button"
                    className="flex w-full justify-between gap-2 py-2 text-left hover:bg-secondary/30"
                    onClick={() => open(x)}
                  >
                    <span className="min-w-0 truncate">{x.label}</span>
                    <span className="shrink-0 text-xs text-destructive">
                      {dateShort(x.due)} · {x.owner ?? "—"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card-elev p-5">
          <h2 className="font-semibold">Upcoming meetings</h2>
          {d.upcomingMeetings.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Nothing scheduled in the next two weeks.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-border/60 text-sm">
              {d.upcomingMeetings.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className="flex w-full justify-between gap-2 py-2 text-left hover:bg-secondary/30"
                    onClick={() => open(m)}
                  >
                    <span className="min-w-0 truncate">
                      {m.subject}
                      {m.account && <span className="text-muted-foreground"> — {m.account}</span>}
                    </span>
                    <span className="shrink-0 text-xs">
                      {new Date(m.dueAt).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {d.stalled.length > 0 && (
        <section className="card-elev p-5">
          <h2 className="font-semibold">Stalled opportunities</h2>
          <ul className="mt-2 divide-y divide-border/60 text-sm">
            {d.stalled.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="flex w-full justify-between gap-2 py-2 text-left hover:bg-secondary/30"
                  onClick={() => onOpportunity(s.id)}
                >
                  <span>{s.title}</span>
                  <span className="text-xs text-amber-700">
                    {STAGE_LABEL[s.stage]} · {s.days} days
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
