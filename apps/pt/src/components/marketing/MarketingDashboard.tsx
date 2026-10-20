import { useMemo, useState } from "react";
import {
  monitor,
  pct,
  relDays,
  runAi,
  summaryForAi,
  type AiRun,
  type MarketingData,
} from "@/lib/marketing";
import {
  acvByLead,
  kpis,
  leadDimension,
  phaseFunnel,
  touchDimension,
  type AFilters,
  type DimRow,
  type TouchRow,
} from "@/lib/marketing-analytics";
import { rankAll, shownPriority } from "@/lib/marketing-crm";
import { AiBox, AlertRow, Bars, CampaignBadge, StatTile, type Go } from "./shared";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
type Dim = "county" | "propertyType" | "audience" | "channel";
const DIM_LABEL: Record<Dim, string> = {
  county: "County",
  propertyType: "Property type",
  audience: "Audience",
  channel: "Channel",
};

// The overall picture: the funnel in numbers, what needs attention now (the AI
// monitor), Corvus AI's recommended next actions, and quick links into the
// campaigns and follow-ups that are live — every item opens where it's handled.
export function MarketingDashboard({
  data,
  go,
  onAiRun,
}: {
  data: MarketingData;
  go: Go;
  onAiRun: (run: AiRun) => void;
}) {
  const now = new Date();
  const last30: AFilters = useMemo(() => {
    const t = new Date();
    return { from: isoDay(new Date(t.getTime() - 29 * 864e5)), to: isoDay(t) };
  }, []);
  const acv = useMemo(() => acvByLead(data), [data]);
  const k = useMemo(() => kpis(data, last30, acv), [data, last30, acv]);
  const phases = useMemo(() => phaseFunnel(data.leads), [data.leads]);
  const hot = useMemo(() => {
    const ranks = rankAll(data);
    return data.leads.filter(
      (l) =>
        !["subscribed", "not_interested", "do_not_contact"].includes(l.stage) &&
        shownPriority(l, ranks.get(l.id)!) === "high",
    ).length;
  }, [data]);
  const eng = useMemo(() => {
    let sent = 0,
      opened = 0,
      clicked = 0,
      replied = 0;
    for (const m of data.campaignMetrics.values()) {
      sent += m.sent;
      opened += m.opened;
      clicked += m.clicked;
      replied += m.replied;
    }
    return { sent, opened, clicked, replied };
  }, [data.campaignMetrics]);
  const [dim, setDim] = useState<Dim>("county");
  const dimRows = useMemo<(DimRow | TouchRow)[]>(
    () =>
      dim === "county" || dim === "propertyType"
        ? leadDimension(data, last30, dim, acv)
        : touchDimension(data, last30, dim),
    [data, last30, acv, dim],
  );
  const latestPerf = data.aiRuns.find((r) => r.scope === "dashboard-performance") ?? null;
  const perfContext = () =>
    (["county", "propertyType"] as const)
      .map(
        (d) =>
          `By ${DIM_LABEL[d]} (last 30 days): ` +
          leadDimension(data, last30, d, acv)
            .slice(0, 8)
            .map(
              (r) =>
                `${r.key}: ${r.leads} leads, ${r.engaged} engaged, ${r.registrations} registered, ${r.customers} paying, ${money(r.revenue)}`,
            )
            .join("; "),
      )
      .concat(
        (["audience", "channel"] as const).map(
          (d) =>
            `By ${DIM_LABEL[d]} (last 30 days): ` +
            touchDimension(data, last30, d)
              .slice(0, 8)
              .map((r) => `${r.key}: ${r.sent} sent, ${r.engaged} engaged, ${r.customers} paying`)
              .join("; "),
        ),
      )
      .concat(
        data.campaigns
          .filter((c) => data.campaignMetrics.get(c.id)?.sent)
          .slice(0, 10)
          .map((c) => {
            const m = data.campaignMetrics.get(c.id)!;
            return `Campaign "${c.name}" (${c.channel}): ${m.sent} sent, ${m.opened} opened, ${m.clicked} clicked, ${m.replied} replied, ${m.bounced} bounced, ${m.unsubscribed} unsubscribed`;
          }),
      )
      .join("\n");
  const alerts = useMemo(() => monitor(data, new Date()), [data]);
  const latestBrief = data.aiRuns.find((r) => r.scope === "dashboard") ?? null;
  const liveCampaigns = data.campaigns.filter((c) =>
    ["approved", "scheduled", "sending", "paused"].includes(c.status),
  );
  const leadName = new Map(data.leads.map((l) => [l.id, l.fullName || l.email || "Lead"]));
  const upcoming = data.followups.filter((x) => x.status === "pending").slice(0, 6);

  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Prospects identified"
          value={phases[0].reached}
          hint={`${phases[0].now} not yet qualified`}
          onClick={() => go("leads")}
        />
        <StatTile
          label="High-priority opportunities"
          value={hot}
          hint="Open leads ranked High"
          onClick={() => go("leads", { filters: { priority: "high" } })}
        />
        <StatTile
          label="Active campaigns"
          value={liveCampaigns.length}
          hint={`${data.campaigns.filter((c) => c.status === "draft").length} drafts`}
          onClick={() => go("campaigns")}
        />
        <StatTile
          label="Engagement"
          value={eng.sent ? pct((eng.clicked + eng.replied) / eng.sent) : "—"}
          hint={
            eng.sent
              ? `${eng.opened} opened · ${eng.clicked} clicked · ${eng.replied} replied of ${eng.sent}`
              : "Nothing sent yet"
          }
          onClick={() => go("campaigns")}
        />
        <StatTile
          label="Engaged now"
          value={phases[3].now}
          hint="Interested, or clicked/replied in 30 days"
          onClick={() => go("leads", { stages: ["interested"] })}
        />
        <StatTile
          label="Registrations"
          value={k.registrations}
          hint="Last 30 days"
          onClick={() =>
            go("leads", { stages: ["registered", "property_added", "subscription_started"] })
          }
        />
        <StatTile
          label="Subscriptions"
          value={k.subscriptions}
          hint={`Last 30 days · ${phases[5].now} paying in total`}
          onClick={() => go("leads", { stages: ["subscribed"] })}
        />
        <StatTile
          label="Revenue"
          value={money(k.revenue)}
          hint="New subscriptions, last 30 days*"
          onClick={() => go("analytics")}
        />
      </div>
      <p className="-mt-3 text-[11px] text-muted-foreground">
        * Annual plan value of customers who subscribed in the period.
      </p>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card-elev p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Needs attention</h2>
            <span className="text-xs text-muted-foreground">
              {alerts.length} item{alerts.length === 1 ? "" : "s"}
            </span>
          </div>
          {alerts.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Nothing urgent — every follow-up is on time.
            </p>
          ) : (
            <ul className="mt-2 grid gap-0.5">
              {alerts.slice(0, 8).map((a) => (
                <AlertRow key={a.id} alert={a} go={go} />
              ))}
            </ul>
          )}
          {alerts.length > 8 && (
            <p className="mt-2 text-xs text-muted-foreground">
              +{alerts.length - 8} more in Leads, Campaigns and Follow-ups.
            </p>
          )}
        </section>

        <AiBox
          title="Corvus AI — what to do next"
          text={latestBrief?.result ?? null}
          when={latestBrief ? relDays(latestBrief.createdAt) : null}
          runLabel="Get recommendations"
          run={async () =>
            onAiRun(
              await runAi({
                scope: "dashboard",
                instruction:
                  "Review this marketing snapshot and give the 3-5 most important next actions for the Marketing Admin, in priority order. " +
                  "Each as a numbered line: the action, who/what it's about, and why now (deadline, score, overdue, campaign issue). Finish with one line on the biggest risk to conversions.",
                context: summaryForAi(data, now),
              }),
            )
          }
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="card-elev p-4">
          <h2 className="text-sm font-semibold">Campaign funnel</h2>
          <div className="mt-3">
            <Bars
              rows={phases.map((x) => ({
                label: x.label,
                value: x.reached,
                note: `${x.now} here now`,
              }))}
            />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            * Bars = reached this step or beyond; updated from campaign opens, clicks and replies.
          </p>
        </section>

        <section className="card-elev p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Active campaigns</h2>
            <button
              type="button"
              onClick={() => go("campaigns")}
              className="text-xs text-accent hover:underline"
            >
              All campaigns →
            </button>
          </div>
          {liveCampaigns.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No live campaigns.</p>
          ) : (
            <ul className="mt-2 grid gap-1">
              {liveCampaigns.slice(0, 5).map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => go("campaigns", { campaignId: c.id })}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-secondary/50"
                  >
                    <span className="truncate">{c.name}</span>
                    <CampaignBadge status={c.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card-elev p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Pending follow-ups</h2>
            <button
              type="button"
              onClick={() => go("followups")}
              className="text-xs text-accent hover:underline"
            >
              All follow-ups →
            </button>
          </div>
          {upcoming.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No follow-ups scheduled.</p>
          ) : (
            <ul className="mt-2 grid gap-1">
              {upcoming.map((x) => {
                const late = new Date(x.dueAt) < now;
                return (
                  <li key={x.id}>
                    <button
                      type="button"
                      onClick={() => go("followups", { leadId: x.leadId })}
                      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-secondary/50"
                    >
                      <span className="truncate">
                        {leadName.get(x.leadId) ?? "Lead"} · {x.channel}
                      </span>
                      <span
                        className={`shrink-0 text-xs ${late ? "font-semibold text-rose-700" : "text-muted-foreground"}`}
                      >
                        {late ? "Overdue" : new Date(x.dueAt).toLocaleDateString()}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card-elev p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Where it&apos;s working (30 days)</h2>
            <div className="flex gap-1" role="tablist">
              {(Object.keys(DIM_LABEL) as Dim[]).map((x) => (
                <button
                  key={x}
                  type="button"
                  role="tab"
                  aria-selected={dim === x}
                  onClick={() => setDim(x)}
                  className={`rounded-md px-2 py-1 text-xs ${dim === x ? "bg-secondary font-semibold" : "text-muted-foreground hover:bg-secondary/50"}`}
                >
                  {DIM_LABEL[x]}
                </button>
              ))}
            </div>
          </div>
          {dimRows.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No activity in the last 30 days.</p>
          ) : (
            <table className="mt-2 w-full text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">{DIM_LABEL[dim]}</th>
                  <th className="py-1 text-right font-medium">
                    {"leads" in dimRows[0] ? "Leads" : "Sent"}
                  </th>
                  <th className="py-1 text-right font-medium">Engaged</th>
                  <th className="py-1 text-right font-medium">Paying</th>
                  {"leads" in dimRows[0] && (
                    <th className="py-1 text-right font-medium">Revenue</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {dimRows.slice(0, 8).map((r) => (
                  <tr key={r.key} className="border-t border-border/60">
                    <td className="max-w-[12rem] truncate py-1">{r.key}</td>
                    <td className="py-1 text-right tabular-nums">
                      {"leads" in r ? r.leads : r.sent}
                    </td>
                    <td className="py-1 text-right tabular-nums">{r.engaged}</td>
                    <td className="py-1 text-right tabular-nums">{r.customers}</td>
                    {"leads" in r && (
                      <td className="py-1 text-right tabular-nums">{money(r.revenue)}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <AiBox
          title="Corvus AI — performance analysis"
          text={latestPerf?.result ?? null}
          when={latestPerf ? relDays(latestPerf.createdAt) : null}
          runLabel="Analyze performance"
          run={async () =>
            onAiRun(
              await runAi({
                scope: "dashboard-performance",
                instruction:
                  "Analyze marketing performance by county, property type, audience and channel. In 4 short sections (County, Property type, Audience, Channel) say what is working and what is not, with the numbers. " +
                  "Finish with 3 numbered recommendations (which segment to target next, which channel/message to use, what to stop). Only use the figures given; say when a sample is too small to judge.",
                context: perfContext(),
              }),
            )
          }
        />
      </div>

      <section className="card-elev p-4">
        <h2 className="text-sm font-semibold">Recent marketing activity</h2>
        {data.activities.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No activity yet — it appears here as you contact leads and send campaigns.
          </p>
        ) : (
          <ul className="mt-2 grid gap-1 text-sm">
            {data.activities.slice(0, 8).map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5 last:border-0"
              >
                <button
                  type="button"
                  onClick={() =>
                    a.leadId
                      ? go("leads", { leadId: a.leadId })
                      : a.campaignId
                        ? go("campaigns", { campaignId: a.campaignId })
                        : undefined
                  }
                  className="min-w-0 truncate text-left hover:underline"
                >
                  {a.leadId ? `${leadName.get(a.leadId) ?? "Lead"}: ` : ""}
                  {a.summary}
                </button>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {relDays(a.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
