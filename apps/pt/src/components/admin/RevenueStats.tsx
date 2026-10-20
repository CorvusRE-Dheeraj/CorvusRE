import { CHART_COLORS, Kpi } from "@/components/AdminKpi";
import { LoadingLine } from "@/components/LoadingLine";
import { dollars, type AdminFinancials } from "@/lib/admin-financials";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";

// Live Stripe revenue statistics for the Super Admin dashboard.
export function FinancialsTab({
  data,
  loading,
  error,
  userCount,
}: {
  data: AdminFinancials | null;
  loading: boolean;
  error: string | null;
  userCount: number | null;
}) {
  if (loading) {
    return (
      <section className="mt-8">
        <LoadingLine text="Pulling live numbers from Stripe…" className="text-sm" />
      </section>
    );
  }
  if (error || !data) {
    return (
      <section className="mt-8">
        <h2 className="font-serif text-xl font-semibold">Revenue</h2>
        <p className="mt-2 text-sm text-destructive">{error ?? "No data."}</p>
      </section>
    );
  }

  const monthLabel = (m: string) =>
    new Date(`${m}-01T00:00:00`).toLocaleDateString("en-US", { month: "short" });
  const collectedData = data.collectedByMonth.map((m) => ({
    name: monthLabel(m.month),
    value: Math.round(m.amountCents / 100),
  }));
  const planData = data.planMix.map((p) => ({ name: p.label, value: p.count }));
  const statusRows = Object.entries(data.subscriptionsByStatus).sort((a, b) => b[1] - a[1]);
  const propRows = Object.entries(data.propertiesByStatus).sort((a, b) => b[1] - a[1]);
  const bppRows = Object.entries(data.bppAccountsByStatus).sort((a, b) => b[1] - a[1]);

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-xl font-semibold">Revenue</h2>
        <span className="badge-soft text-xs">
          {data.mode === "live" ? "Live Stripe data" : "Test-mode Stripe data"}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        MRR and subscription counts are from Stripe; "collected" covers the last ~12 months of
        successful charges, net of refunds.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Customers"
          value={String(userCount ?? data.signups)}
          sub={`${data.subscriptionCustomers} with a paid subscription`}
        />
        <Kpi label="Active subscriptions" value={String(data.activeSubscriptions)} />
        <Kpi
          label="MRR"
          value={dollars(data.mrrCents)}
          sub={`${dollars(data.mrrCents * 12)}/yr run-rate`}
        />
        <Kpi
          label="Collected (12 mo)"
          value={dollars(data.collectedRecentCents)}
          sub={
            data.refundedRecentCents > 0
              ? `${dollars(data.refundedRecentCents)} refunded`
              : undefined
          }
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="card-elev p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Collected per month
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={collectedData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={48} tickFormatter={(v) => `$${v}`} />
              <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
              <Bar dataKey="value" fill="var(--accent)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card-elev p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Active subscriptions by plan
          </div>
          {planData.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active subscriptions yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={planData}
                layout="vertical"
                margin={{ top: 4, right: 24, bottom: 4, left: 4 }}
              >
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                  {planData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <div className="card-elev p-4 text-sm">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Stripe subscriptions by status
          </div>
          {statusRows.map(([k, v]) => (
            <div
              key={k}
              className="flex justify-between border-t border-border/60 py-1.5 first:border-0"
            >
              <span className="capitalize text-muted-foreground">{k.replace(/_/g, " ")}</span>
              <span className="font-medium">{v}</span>
            </div>
          ))}
        </div>
        <div className="card-elev p-4 text-sm">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Properties by subscription status
          </div>
          {propRows.map(([k, v]) => (
            <div
              key={k}
              className="flex justify-between border-t border-border/60 py-1.5 first:border-0"
            >
              <span className="capitalize text-muted-foreground">{k.replace(/_/g, " ")}</span>
              <span className="font-medium">{v}</span>
            </div>
          ))}
          <p className="mt-2 text-xs text-muted-foreground">
            From our database, independent of Stripe mode — this can include subscriptions created
            by an admin with a personal test-mode override, so it won't always match the{" "}
            {data.mode === "live" ? "live" : "test-mode"} Stripe numbers above.
          </p>
        </div>
        <div className="card-elev p-4 text-sm">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            BPP accounts by subscription status
          </div>
          {bppRows.length === 0 ? (
            <p className="text-muted-foreground">No BPP accounts yet.</p>
          ) : (
            bppRows.map(([k, v]) => (
              <div
                key={k}
                className="flex justify-between border-t border-border/60 py-1.5 first:border-0"
              >
                <span className="capitalize text-muted-foreground">{k.replace(/_/g, " ")}</span>
                <span className="font-medium">{v}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {data.planMix.length > 0 && (
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div className="card-elev p-4 text-sm">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              MRR by plan
            </div>
            {data.planMix.map((p) => (
              <div
                key={p.label}
                className="flex justify-between border-t border-border/60 py-1.5 first:border-0"
              >
                <span className="text-muted-foreground">
                  {p.label} <span className="text-xs">× {p.count}</span>
                </span>
                <span className="font-medium">{dollars(p.mrrCents)}/mo</span>
              </div>
            ))}
          </div>
          <div className="card-elev p-4 text-sm">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              MRR by product line
            </div>
            {(
              [
                ["Real Estate", data.byProductLine.property],
                ["BPP", data.byProductLine.bpp],
              ] as const
            ).map(([label, line]) => (
              <div
                key={label}
                className="flex justify-between border-t border-border/60 py-1.5 first:border-0"
              >
                <span className="text-muted-foreground">
                  {label} <span className="text-xs">× {line.count}</span>
                </span>
                <span className="font-medium">{dollars(line.mrrCents)}/mo</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
