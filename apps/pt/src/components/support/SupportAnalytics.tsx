import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, Sparkles } from "lucide-react";
import { getErrorMessage } from "@/lib/error-message";
import {
  listPermissions,
  supportAction,
  supportAnalytics,
  toCsv,
  CATEGORY_LABEL,
  type Analytics,
  type TeamMember,
  type TicketCategory,
} from "@/lib/support-console";

type Insights = {
  headline?: string;
  recurring?: { problem: string; count: number; suggestion: string }[];
  overloaded?: { staff: string; why: string }[];
  attention?: { customer: string; why: string }[];
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function SupportAnalytics({
  team,
  isSupervisor,
  isSuper,
  onAssign,
}: {
  team: TeamMember[];
  isSupervisor: boolean;
  isSuper: boolean;
  onAssign: (staffId: string) => void;
}) {
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 864e5)));
  const [to, setTo] = useState(iso(new Date()));
  const [staff, setStaff] = useState("");
  const [a, setA] = useState<Analytics | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [busy, setBusy] = useState(false);
  const [canExport, setCanExport] = useState(false);
  const load = useCallback(
    () =>
      supportAnalytics(from, to, staff || null)
        .then(setA)
        .catch((e) => toast.error(getErrorMessage(e, "Couldn't load analytics."))),
    [from, to, staff],
  );
  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (isSuper) return setCanExport(true);
    if (!isSupervisor) return setCanExport(false);
    listPermissions()
      .then((p) => setCanExport(!!p.find((x) => x.key === "export_reports")?.enabled))
      .catch(() => setCanExport(false));
  }, [isSuper, isSupervisor]);

  async function aiInsights() {
    setBusy(true);
    try {
      setInsights(await supportAction<Insights>("ai_insights", { from, to }));
    } catch (e) {
      toast.error(getErrorMessage(e, "AI couldn't analyse the period."));
    } finally {
      setBusy(false);
    }
  }
  function exportCsv() {
    if (!a) return;
    const rows: (string | number | null)[][] = [
      ["Tickets opened", a.ticketsOpened],
      ["Tickets resolved", a.ticketsResolved],
      ["Open now", a.openNow],
      ["Overdue now", a.overdueNow],
      ["Avg first response (h)", a.avgFirstResponseHours],
      ["Avg resolution (h)", a.avgResolutionHours],
      ["Within response deadline (%)", a.withinSla],
      ["Reopened", a.reopened],
      ["Avg rating", a.avgRating],
      ["Onboarding completed", a.onboardingCompleted],
      ["Onboarding in progress", a.onboardingInProgress],
      ["Renewals", a.renewals],
      ["Cancellations", a.cancellations],
      ["Failed payments", a.failedPayments],
      ...a.workload.map((w) => [
        `Workload: ${w.name} (open / overdue / resolved / onboarding)`,
        `${w.openTickets} / ${w.overdue} / ${w.resolvedInRange} / ${w.onboarding}`,
      ]),
    ];
    const blob = new Blob([toCsv(["Metric", "Value"], rows)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = `support-report-${from}-to-${to}.csv`;
    el.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const stat = (label: string, value: string | number | null | undefined, hint?: string) => (
    <div className="card-elev p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold">{value ?? "—"}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
  const maxCat = a ? Math.max(1, ...Object.values(a.byCategory)) : 1;
  return (
    <div className="mt-6 grid gap-4">
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">From</span>
          <input
            type="date"
            className="rounded-md border border-input bg-background px-2 py-1.5"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">To</span>
          <input
            type="date"
            className="rounded-md border border-input bg-background px-2 py-1.5"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        {isSupervisor && (
          <label className="grid gap-1">
            <span className="text-xs text-muted-foreground">Staff</span>
            <select
              className="rounded-md border border-input bg-background px-2 py-1.5"
              value={staff}
              onChange={(e) => setStaff(e.target.value)}
            >
              <option value="">Whole team</option>
              {team.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="ml-auto flex gap-2">
          {isSupervisor && (
            <button
              type="button"
              className="btn-outline inline-flex items-center gap-1.5 text-sm"
              onClick={aiInsights}
              disabled={busy}
            >
              <Sparkles className="h-4 w-4" aria-hidden /> {busy ? "Analysing…" : "AI insights"}
            </button>
          )}
          {canExport && (
            <button
              type="button"
              className="btn-outline inline-flex items-center gap-1.5 text-sm"
              onClick={exportCsv}
              disabled={!a}
            >
              <Download className="h-4 w-4" aria-hidden /> Export CSV
            </button>
          )}
        </div>
      </div>
      {!isSupervisor && (
        <p className="text-xs text-muted-foreground">
          Showing your own numbers. Supervisors see the whole team.
        </p>
      )}
      {a && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {stat("Tickets opened", a.ticketsOpened, `${a.ticketsResolved} resolved`)}
            {stat("Open now", a.openNow, `${a.overdueNow} overdue`)}
            {stat(
              "First response",
              a.avgFirstResponseHours != null ? `${a.avgFirstResponseHours}h` : null,
              a.withinSla != null ? `${a.withinSla}% within deadline` : undefined,
            )}
            {stat(
              "Resolution time",
              a.avgResolutionHours != null ? `${a.avgResolutionHours}h` : null,
              `${a.reopened} reopened`,
            )}
            {stat(
              "Customer rating",
              a.avgRating != null ? `${a.avgRating}/5` : null,
              `${a.ratings} ratings · ${a.feedbackResponses} survey responses`,
            )}
            {stat(
              "Onboarding",
              `${a.onboardingCompleted} done`,
              `${a.onboardingInProgress} in progress`,
            )}
            {stat("Renewals", a.renewals, `${a.cancelScheduled} cancellations scheduled`)}
            {stat("Cancellations", a.cancellations, `${a.failedPayments} failed payments`)}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card-elev p-5">
              <h3 className="font-semibold">Tickets by category</h3>
              <ul className="mt-3 grid gap-2 text-sm">
                {Object.entries(a.byCategory)
                  .sort((x, y) => y[1] - x[1])
                  .map(([k, n]) => (
                    <li key={k} className="grid grid-cols-[8rem_1fr_2rem] items-center gap-2">
                      <span>{CATEGORY_LABEL[k as TicketCategory] ?? "Uncategorized"}</span>
                      <div className="h-2 rounded-full bg-secondary">
                        <div
                          className="h-2 rounded-full bg-accent"
                          style={{ width: `${(100 * n) / maxCat}%` }}
                        />
                      </div>
                      <span className="text-right">{n}</span>
                    </li>
                  ))}
                {Object.keys(a.byCategory).length === 0 && (
                  <li className="text-muted-foreground">No tickets in this period.</li>
                )}
              </ul>
              {a.recurring.length > 0 && (
                <>
                  <h4 className="mt-4 text-xs font-semibold uppercase text-muted-foreground">
                    Recurring subjects
                  </h4>
                  <ul className="mt-1 text-sm">
                    {a.recurring.map((r) => (
                      <li key={r.subject}>
                        {r.subject} — {r.count}×
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
            {isSupervisor && (
              <section className="card-elev p-5">
                <h3 className="font-semibold">Team workload</h3>
                <table className="mt-2 w-full text-left text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1.5">Staff</th>
                      <th className="py-1.5">Open</th>
                      <th className="py-1.5">Overdue</th>
                      <th className="py-1.5">Resolved</th>
                      <th className="py-1.5">Onboarding</th>
                      <th className="py-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {a.workload.map((w) => (
                      <tr key={w.id} className="border-t border-border/60">
                        <td className="py-1.5">
                          {w.name}
                          {w.supervisor && (
                            <span className="ml-1 text-[11px] text-muted-foreground">
                              supervisor
                            </span>
                          )}
                        </td>
                        <td className="py-1.5">{w.openTickets}</td>
                        <td className={`py-1.5 ${w.overdue ? "text-destructive" : ""}`}>
                          {w.overdue}
                        </td>
                        <td className="py-1.5">{w.resolvedInRange}</td>
                        <td className="py-1.5">{w.onboarding}</td>
                        <td className="py-1.5 text-right">
                          <button
                            type="button"
                            className="text-xs text-accent underline"
                            onClick={() => onAssign(w.id)}
                          >
                            Their tickets
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </div>
          {insights && (
            <section className="card-elev p-5 text-sm">
              <h3 className="flex items-center gap-2 font-semibold">
                <Sparkles className="h-4 w-4 text-accent" aria-hidden /> AI insights
              </h3>
              {insights.headline && <p className="mt-1">{insights.headline}</p>}
              <div className="mt-3 grid gap-4 md:grid-cols-3">
                <div>
                  <div className="text-xs font-semibold uppercase text-muted-foreground">
                    Recurring problems
                  </div>
                  <ul className="mt-1 list-disc pl-4">
                    {(insights.recurring ?? []).map((r) => (
                      <li key={r.problem}>
                        {r.problem} ({r.count}) —{" "}
                        <span className="text-muted-foreground">{r.suggestion}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase text-muted-foreground">
                    Overloaded staff
                  </div>
                  <ul className="mt-1 list-disc pl-4">
                    {(insights.overloaded ?? []).map((r) => (
                      <li key={r.staff}>
                        {r.staff} — <span className="text-muted-foreground">{r.why}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase text-muted-foreground">
                    Customers needing attention
                  </div>
                  <ul className="mt-1 list-disc pl-4">
                    {(insights.attention ?? []).map((r) => (
                      <li key={r.customer}>
                        {r.customer} — <span className="text-muted-foreground">{r.why}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          )}
          <p className="text-xs text-muted-foreground">
            Supervisors and Super Admins get a summary of these numbers by email every Monday, and
            an alert when a ticket passes its response deadline with nobody assigned.
          </p>
        </>
      )}
    </div>
  );
}
