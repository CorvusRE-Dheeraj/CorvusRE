import { useEffect, useMemo, useState } from "react";
import { getAdminFinancials, type AdminFinancials, dollars } from "@/lib/admin-financials";
import {
  SOURCE_LABEL,
  STAGE_LABEL,
  funnel,
  pct,
  relDays,
  runAi,
  type AiRun,
  type Lead,
  type MarketingData,
} from "@/lib/marketing";
import { AiBox, Bars, StatTile } from "./shared";

// Detailed performance: where leads come from and which convert, by county
// and property type, campaign results, acquisition over time and revenue —
// plus Corvus AI's read on the trends.
type Row = { key: string; leads: number; paying: number };

function groupBy(leads: Lead[], key: (l: Lead) => string | null): Row[] {
  const m = new Map<string, Row>();
  for (const l of leads) {
    const k = key(l) || "Unknown";
    const r = m.get(k) ?? { key: k, leads: 0, paying: 0 };
    r.leads++;
    if (l.stage === "customer") r.paying++;
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.leads - a.leads);
}

function monthKey(iso: string) {
  return iso.slice(0, 7);
}

export function Analytics({ data, onAiRun }: { data: MarketingData; onAiRun: (r: AiRun) => void }) {
  const [fin, setFin] = useState<AdminFinancials | null>(null);
  const [finError, setFinError] = useState<string | null>(null);
  useEffect(() => {
    getAdminFinancials()
      .then(setFin)
      .catch(() => setFinError("Revenue is unavailable right now."));
  }, []);
  const f = funnel(data.leads);
  const bySource = useMemo(() => groupBy(data.leads, (l) => SOURCE_LABEL[l.source]), [data.leads]);
  const byCounty = useMemo(() => groupBy(data.leads, (l) => l.county).slice(0, 10), [data.leads]);
  const byType = useMemo(
    () => groupBy(data.leads, (l) => l.propertyType).slice(0, 10),
    [data.leads],
  );
  const months = useMemo(() => {
    const out: string[] = [];
    const d = new Date();
    for (let i = 5; i >= 0; i--)
      out.push(new Date(d.getFullYear(), d.getMonth() - i, 1).toISOString().slice(0, 7));
    return out;
  }, []);
  const monthLabel = (m: string) =>
    new Date(`${m}-01T00:00:00`).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  const newLeadsByMonth = months.map((m) => ({
    label: monthLabel(m),
    value: data.leads.filter((l) => monthKey(l.createdAt) === m).length,
  }));
  // When a lead became a customer: the history entry that moved it there, else
  // when it was synced as one.
  const becameCustomer = (l: Lead) =>
    data.activities.find(
      (a) => a.leadId === l.id && a.kind === "stage" && a.summary.endsWith(STAGE_LABEL.customer),
    )?.createdAt ?? l.updatedAt;
  const customersByMonth = months.map((m) => ({
    label: monthLabel(m),
    value: data.leads.filter((l) => l.stage === "customer" && monthKey(becameCustomer(l)) === m)
      .length,
  }));
  const sent = data.campaigns.filter((c) => c.status === "sent");
  const latest = data.aiRuns.find((r) => r.scope === "analytics") ?? null;
  const conv = (r: Row) => (r.leads ? r.paying / r.leads : 0);

  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Lead → registered"
          value={pct(f.leadToRegistered)}
          hint={`${f.registered} of ${f.total}`}
        />
        <StatTile
          label="Registered → paying"
          value={pct(f.registeredToPaying)}
          hint={`${f.paying} of ${f.registered}`}
        />
        <StatTile
          label="Monthly recurring revenue"
          value={fin ? dollars(fin.mrrCents) : "—"}
          hint={
            fin
              ? `${fin.activeSubscriptions} active subscriptions · ${fin.mode} mode`
              : (finError ?? "Loading…")
          }
        />
        <StatTile
          label="Emails sent"
          value={sent.reduce((n, c) => n + (c.stats.sent ?? 0), 0)}
          hint={`${sent.length} campaign${sent.length === 1 ? "" : "s"}`}
        />
      </div>

      <AiBox
        title="Corvus AI — trends & how to improve"
        text={latest?.result ?? null}
        when={latest ? relDays(latest.createdAt) : null}
        runLabel="Analyze performance"
        run={async () =>
          onAiRun(
            await runAi({
              scope: "analytics",
              instruction:
                "Analyze this marketing performance. Name the 2-3 most important trends (best/worst sources, counties, property types, campaigns) with the numbers, then give 3 specific recommendations to improve conversion. Be honest when there's too little data to conclude.",
              context: [
                `Funnel: ${JSON.stringify(f)}`,
                `By source: ${bySource.map((r) => `${r.key} ${r.leads} leads/${r.paying} paying`).join("; ")}`,
                `By county: ${byCounty.map((r) => `${r.key} ${r.leads}/${r.paying}`).join("; ")}`,
                `By property type: ${byType.map((r) => `${r.key} ${r.leads}/${r.paying}`).join("; ")}`,
                `Campaigns sent: ${sent.map((c) => `${c.name}: ${c.stats.sent}/${c.stats.targeted} (${c.stats.failed ?? 0} failed)`).join("; ") || "none"}`,
                `New leads by month: ${newLeadsByMonth.map((x) => `${x.label} ${x.value}`).join(", ")}; new customers: ${customersByMonth.map((x) => `${x.label} ${x.value}`).join(", ")}`,
                fin
                  ? `MRR ${dollars(fin.mrrCents)}, ${fin.activeSubscriptions} active subscriptions`
                  : "",
              ].join("\n"),
            }),
          )
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card-elev p-4">
          <h2 className="text-sm font-semibold">Lead sources</h2>
          <p className="text-xs text-muted-foreground">
            Leads per source · % that became paying customers
          </p>
          <div className="mt-3">
            <Bars
              rows={bySource.map((r) => ({ label: r.key, value: r.leads, note: pct(conv(r)) }))}
            />
          </div>
        </section>
        <section className="card-elev p-4">
          <h2 className="text-sm font-semibold">Pipeline stages</h2>
          <div className="mt-3">
            <Bars
              rows={(Object.keys(STAGE_LABEL) as (keyof typeof STAGE_LABEL)[]).map((s) => ({
                label: STAGE_LABEL[s],
                value: data.leads.filter((l) => l.stage === s).length,
              }))}
            />
          </div>
        </section>
        <section className="card-elev p-4">
          <h2 className="text-sm font-semibold">By county</h2>
          <p className="text-xs text-muted-foreground">Leads · conversion to paying</p>
          <div className="mt-3">
            <Bars
              rows={byCounty.map((r) => ({ label: r.key, value: r.leads, note: pct(conv(r)) }))}
            />
          </div>
        </section>
        <section className="card-elev p-4">
          <h2 className="text-sm font-semibold">By property type</h2>
          <p className="text-xs text-muted-foreground">Leads · conversion to paying</p>
          <div className="mt-3">
            <Bars
              rows={byType.map((r) => ({ label: r.key, value: r.leads, note: pct(conv(r)) }))}
            />
          </div>
        </section>
        <section className="card-elev p-4">
          <h2 className="text-sm font-semibold">New leads per month</h2>
          <div className="mt-3">
            <Bars rows={newLeadsByMonth} emptyText="No new leads in the last 6 months." />
          </div>
        </section>
        <section className="card-elev p-4">
          <h2 className="text-sm font-semibold">New paying customers per month</h2>
          <div className="mt-3">
            <Bars
              rows={customersByMonth}
              emptyText="No new paying customers in the last 6 months."
            />
          </div>
        </section>
      </div>

      <section className="card-elev overflow-x-auto p-4">
        <h2 className="text-sm font-semibold">Campaign engagement</h2>
        {sent.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No campaigns sent yet.</p>
        ) : (
          <table className="mt-3 w-full min-w-[520px] text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">Campaign</th>
                <th className="py-1 font-medium">Sent</th>
                <th className="py-1 font-medium">Targeted</th>
                <th className="py-1 font-medium">Failed</th>
                <th className="py-1 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {sent.map((c) => (
                <tr key={c.id} className="border-t border-border/60">
                  <td className="py-1.5">{c.name}</td>
                  <td className="py-1.5 tabular-nums">{c.stats.sent ?? 0}</td>
                  <td className="py-1.5 tabular-nums">{c.stats.targeted ?? 0}</td>
                  <td className="py-1.5 tabular-nums">{c.stats.failed ?? 0}</td>
                  <td className="py-1.5 text-muted-foreground">{relDays(c.sentAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          * Opens and clicks need email tracking turned on in Resend; until then engagement is
          sends, replies logged on leads, and conversions.
        </p>
      </section>

      {fin && fin.collectedByMonth.length > 0 && (
        <section className="card-elev p-4">
          <h2 className="text-sm font-semibold">Subscription revenue collected</h2>
          <div className="mt-3">
            <Bars
              rows={fin.collectedByMonth
                .slice(-6)
                .map((m) => ({ label: monthLabel(m.month), value: m.amountCents }))}
              format={dollars}
            />
          </div>
        </section>
      )}
    </div>
  );
}
