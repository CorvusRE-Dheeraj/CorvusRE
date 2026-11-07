import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, Sparkles } from "lucide-react";
import { getErrorMessage } from "@/lib/error-message";
import {
  bdAction,
  bdAnalytics,
  csv,
  usd0,
  PIPELINE,
  STAGE_LABEL,
  type BdAnalytics as Data,
  type Stage,
  type TeamMember,
} from "@/lib/bd-console";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const inp = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";

type Insights = {
  headline?: string;
  stalled?: { opportunity: string; why: string; suggestion: string }[];
  channels?: { channel: string; evidence: string }[];
  partners?: { partner: string; why: string }[];
};

// Forecast (estimated) and actual (subscriptions / payments) are separate
// sections and never added together; actual revenue counts each customer
// account once however many opportunities or partners touched it.
export function BdAnalytics({
  team,
  isSupervisor,
  onOwner,
}: {
  team: TeamMember[];
  isSupervisor: boolean;
  onOwner: (id: string) => void;
}) {
  const [from, setFrom] = useState(iso(new Date(Date.now() - 90 * 864e5)));
  const [to, setTo] = useState(iso(new Date()));
  const [staff, setStaff] = useState("");
  const [a, setA] = useState<Data | null>(null);
  const [ins, setIns] = useState<Insights | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    () =>
      bdAnalytics(from, to, staff || null)
        .then(setA)
        .catch((e) => toast.error(getErrorMessage(e, "Couldn't load analytics."))),
    [from, to, staff],
  );
  useEffect(() => void load(), [load]);
  function exportCsv() {
    if (!a) return;
    const rows: (string | number | null)[][] = [
      ["Forecast", "Open pipeline (estimated annual value)", a.forecast.openPipeline],
      ["Forecast", "Expected to close in range (estimated)", a.forecast.expectedInRange],
      ["Forecast", "Estimated properties", a.forecast.estimatedProperties],
      ["Actual", "Customers activated (payment verified)", a.actual.customersActivated],
      ["Actual", "Subscribed properties", a.actual.subscribedProperties],
      ["Actual", "Confirmed renewal revenue ($)", a.actual.confirmedRevenueCents / 100],
      [
        "Proposals",
        "Created / sent / accepted / declined",
        `${a.proposals.created} / ${a.proposals.sent} / ${a.proposals.accepted} / ${a.proposals.declined}`,
      ],
      ["Cycle", "Average sales cycle (days)", a.avgSalesCycleDays],
      ...Object.entries(a.byStage).map(
        ([s, n]) => ["Stage", STAGE_LABEL[s as Stage] ?? s, n] as (string | number)[],
      ),
      ...a.partners.map(
        (p) =>
          [
            "Partner",
            p.name,
            `${p.referred} referred, ${p.converted} converted, ${p.subscribedProperties} subscribed`,
          ] as (string | number)[],
      ),
    ];
    const blob = new Blob([csv(["Section", "Metric", "Value"], rows)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = `bd-report-${from}-to-${to}.csv`;
    el.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const card = (l: string, v: string | number | null, h?: string) => (
    <div className="card-elev p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{l}</div>
      <div className="mt-1 text-2xl font-semibold">{v ?? "—"}</div>
      {h && <div className="text-xs text-muted-foreground">{h}</div>}
    </div>
  );
  return (
    <div className="mt-6 grid gap-4">
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">From</span>
          <input
            type="date"
            className={inp}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">To</span>
          <input type="date" className={inp} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {isSupervisor && (
          <label className="grid gap-1">
            <span className="text-xs text-muted-foreground">Staff</span>
            <select className={inp} value={staff} onChange={(e) => setStaff(e.target.value)}>
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
              disabled={busy}
              onClick={() => {
                setBusy(true);
                bdAction<Insights>("ai_insights", { from, to })
                  .then(setIns)
                  .catch((e) =>
                    toast.error(getErrorMessage(e, "AI couldn't analyse the pipeline.")),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              <Sparkles className="h-4 w-4" aria-hidden /> {busy ? "Analysing…" : "AI insights"}
            </button>
          )}
          {isSupervisor && (
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
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Forecast — estimates, not revenue
          </h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {card("Open pipeline", usd0(a.forecast.openPipeline), "estimated annual value")}
            {card(
              "Expected to close in range",
              usd0(a.forecast.expectedInRange),
              "by expected close date",
            )}
            {card(
              "Estimated properties",
              a.forecast.estimatedProperties,
              "prospects' own estimates",
            )}
          </div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Actual — verified subscriptions and payments
          </h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {card("Customers activated", a.actual.customersActivated, "payment verified in range")}
            {card(
              "Subscribed properties",
              a.actual.subscribedProperties,
              `${a.actual.registeredProperties} registered`,
            )}
            {card(
              "Confirmed revenue",
              usd0(a.actual.confirmedRevenueCents / 100),
              "renewal payments in range",
            )}
            {card(
              "Sales cycle",
              a.avgSalesCycleDays != null ? `${a.avgSalesCycleDays} days` : "—",
              "created → paying",
            )}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card-elev p-5 text-sm">
              <h3 className="font-semibold">Opportunities by stage</h3>
              <ul className="mt-2 grid gap-1">
                {[...PIPELINE, "on_hold" as Stage, "lost" as Stage].map((s) => (
                  <li key={s} className="flex justify-between">
                    <span>{STAGE_LABEL[s]}</span>
                    <span className="font-medium">{a.byStage[s] ?? 0}</span>
                  </li>
                ))}
              </ul>
              <h4 className="mt-4 text-xs font-semibold uppercase text-muted-foreground">
                Proposals
              </h4>
              <p>
                {a.proposals.created} created · {a.proposals.sent} sent · {a.proposals.accepted}{" "}
                accepted · {a.proposals.declined} declined
                {a.proposals.sent > 0 &&
                  ` — ${Math.round((100 * a.proposals.accepted) / a.proposals.sent)}% acceptance`}
              </p>
              {a.lostReasons.length > 0 && (
                <>
                  <h4 className="mt-4 text-xs font-semibold uppercase text-muted-foreground">
                    Lost reasons
                  </h4>
                  <ul>
                    {a.lostReasons.map((r) => (
                      <li key={r.reason}>
                        {r.reason} — {r.n}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
            <section className="card-elev p-5 text-sm">
              <h3 className="font-semibold">Channels</h3>
              <ul className="mt-2 grid gap-1">
                {Object.entries(a.byChannel).map(([c, v]) => (
                  <li key={c} className="flex justify-between">
                    <span>{c}</span>
                    <span>
                      {v.opportunities} opportunities · {v.won} won
                    </span>
                  </li>
                ))}
              </ul>
              <h3 className="mt-4 font-semibold">Partners</h3>
              <ul className="mt-2 grid gap-1">
                {a.partners.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2">
                    <span>{p.name}</span>
                    <span className="text-xs">
                      {p.referred} referred · {p.converted} converted · {p.subscribedProperties}{" "}
                      subscribed · {usd0(p.revenueCents / 100)}
                    </span>
                  </li>
                ))}
                {a.partners.length === 0 && (
                  <li className="text-muted-foreground">No partners yet.</li>
                )}
              </ul>
            </section>
          </div>
          {isSupervisor && a.workload.length > 0 && (
            <section className="card-elev p-5 text-sm">
              <h3 className="font-semibold">Team</h3>
              <table className="mt-2 w-full text-left">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1">Staff</th>
                    <th className="py-1">Accounts</th>
                    <th className="py-1">Open opportunities</th>
                    <th className="py-1">Pipeline (est.)</th>
                    <th className="py-1">Overdue</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {a.workload.map((w) => (
                    <tr key={w.id} className="border-t border-border/60">
                      <td className="py-1">{w.name}</td>
                      <td className="py-1">{w.accounts}</td>
                      <td className="py-1">{w.open}</td>
                      <td className="py-1">{usd0(w.pipeline)}</td>
                      <td className={`py-1 ${w.overdue ? "text-destructive" : ""}`}>{w.overdue}</td>
                      <td className="py-1 text-right">
                        <button
                          type="button"
                          className="text-xs text-accent underline"
                          onClick={() => onOwner(w.id)}
                        >
                          Their pipeline
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {ins && (
            <section className="card-elev p-5 text-sm">
              <h3 className="flex items-center gap-2 font-semibold">
                <Sparkles className="h-4 w-4 text-accent" aria-hidden /> AI insights
              </h3>
              {ins.headline && <p className="mt-1">{ins.headline}</p>}
              <div className="mt-3 grid gap-4 md:grid-cols-3">
                <div>
                  <div className="text-xs font-semibold uppercase text-muted-foreground">
                    Stalled deals
                  </div>
                  <ul className="mt-1 list-disc pl-4">
                    {(ins.stalled ?? []).map((s) => (
                      <li key={s.opportunity}>
                        {s.opportunity} —{" "}
                        <span className="text-muted-foreground">
                          {s.why}. {s.suggestion}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase text-muted-foreground">
                    Channels that work
                  </div>
                  <ul className="mt-1 list-disc pl-4">
                    {(ins.channels ?? []).map((s) => (
                      <li key={s.channel}>
                        {s.channel} — <span className="text-muted-foreground">{s.evidence}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase text-muted-foreground">
                    Partners
                  </div>
                  <ul className="mt-1 list-disc pl-4">
                    {(ins.partners ?? []).map((s) => (
                      <li key={s.partner}>
                        {s.partner} — <span className="text-muted-foreground">{s.why}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
