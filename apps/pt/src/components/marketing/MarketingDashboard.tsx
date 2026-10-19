import { useMemo } from "react";
import {
  PIPELINE,
  STAGE_LABEL,
  funnel,
  monitor,
  pct,
  relDays,
  runAi,
  summaryForAi,
  type AiRun,
  type MarketingData,
} from "@/lib/marketing";
import { AiBox, AlertRow, Bars, CampaignBadge, StatTile, type Go } from "./shared";

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
  const f = funnel(data.leads, now);
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
        <StatTile label="Total leads" value={f.total} onClick={() => go("leads")} />
        <StatTile
          label="New this week"
          value={f.newLeads}
          hint="Added in the last 7 days"
          onClick={() => go("leads")}
        />
        <StatTile
          label="Active prospects"
          value={f.activeProspects}
          hint={`${f.researching} researching · ${f.ready} ready for outreach`}
          onClick={() =>
            go("leads", { stages: ["new", "researching", "ready", "contacted", "interested"] })
          }
        />
        <StatTile
          label="Contacted"
          value={f.contacted}
          hint={f.noResponse ? `${f.noResponse} no response` : undefined}
          onClick={() => go("leads", { stages: ["contacted", "no_response"] })}
        />
        <StatTile
          label="Interested"
          value={f.interested}
          onClick={() => go("leads", { stages: ["interested"] })}
        />
        <StatTile
          label="Registered users"
          value={f.registered}
          onClick={() => go("leads", { stages: ["registered"] })}
        />
        <StatTile
          label="Subscribed"
          value={f.paying}
          hint="Paying customers"
          onClick={() => go("leads", { stages: ["subscribed"] })}
        />
        <StatTile
          label="Lead → paying"
          value={pct(f.leadToPaying)}
          hint={`Registered → paying ${pct(f.registeredToPaying)}`}
          onClick={() => go("analytics")}
        />
      </div>

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
          <h2 className="text-sm font-semibold">Pipeline</h2>
          <div className="mt-3">
            <Bars
              rows={PIPELINE.map((s) => ({
                label: STAGE_LABEL[s],
                value: data.leads.filter((l) => l.stage === s).length,
              }))}
            />
          </div>
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
