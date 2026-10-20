import { useEffect, useMemo, useState } from "react";
import { Check, Download, FileSpreadsheet, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { MarkdownLite } from "@/components/MarkdownLite";
import { confirmDialog } from "@/components/ConfirmHost";
import { getErrorMessage } from "@/lib/error-message";
import { downloadCsv, downloadXlsx, type Table } from "@/lib/export-file";
import {
  EXPENSE_CATEGORIES,
  SOURCES,
  SOURCE_LABEL,
  decideRecommendation,
  deleteExpense,
  ADMIN_ACTION_LABEL,
  loadAdminActivity,
  loadAudit,
  loadBetaFeedback,
  type AdminActivity,
  type BetaFeedback,
  money,
  pct,
  relDays,
  runAi,
  saveCampaign,
  saveExpense,
  saveFollowup,
  setCampaignStatus,
  updateLead,
  type AiRun,
  type AuditEntry,
  type Expense,
  type MarketingData,
  type Recommendation,
  type Report,
  type StaffRole,
} from "@/lib/marketing";
import { leadName, rankAll } from "@/lib/marketing-crm";
import {
  REPORT_COLUMNS,
  acvByLead,
  campaignRows,
  cleanSpec,
  delta,
  kpis,
  leadDimension,
  previousPeriod,
  runReport,
  suggestAssignments,
  teamWorkload,
  touchDimension,
  trend,
  inRange,
  type AFilters,
  type ReportSpec,
} from "@/lib/marketing-analytics";
import { AiBox, Bars, StatTile, inputCls, type Go } from "./shared";
import { getAdminFinancials, dollars, type AdminFinancials } from "@/lib/admin-financials";

type View =
  | "overview"
  | "spend"
  | "insights"
  | "financials"
  | "feedback"
  | "activity"
  | "recs"
  | "team"
  | "reports"
  | "audit";
const sel = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";
const isoDay = (d: Date) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const daysAgo = (n: number) => isoDay(new Date(Date.now() - n * 864e5));
const fmtDelta = (x: number | null, invert = false) =>
  x == null
    ? undefined
    : `${x > 0 ? "▲" : x < 0 ? "▼" : "•"} ${Math.abs(Math.round(x * 100))}% vs previous${invert ? " (lower is better)" : ""}`;
const usd = (n: number | null) => (n == null ? "—" : money(n));

// Analytics: performance with filters, spend and ROI, what works,
// recommendations to approve, the team, scheduled reports, the audit trail
// — every table exportable to CSV or Excel.
export function Analytics({
  data,
  role,
  reload,
  go,
  onAiRun,
}: {
  data: MarketingData;
  role?: StaffRole | null;
  reload?: () => Promise<void>;
  go?: Go;
  onAiRun: (r: AiRun) => void;
}) {
  const supervisor = !!role && (role.isSupervisor || role.isSuperAdmin);
  const [view, setView] = useState<View>("overview");
  const [f, setF] = useState<AFilters>({ from: daysAgo(29), to: isoDay(new Date()) });
  const acv = useMemo(() => acvByLead(data), [data]);
  const ranks = useMemo(() => rankAll(data), [data]);
  const refresh = reload ?? (async () => undefined);
  const pending = data.recommendations.filter(
    (r) => r.status === "pending" && (r.kind !== "reassign" || supervisor),
  ).length;
  const views: [View, string][] = [
    ["overview", "Overview"],
    ["spend", "Spend & ROI"],
    ["insights", "What works"],
    ["financials", "Financials"],
    ["feedback", "Beta feedback"],
    ["activity", "Activity log"],
    ["recs", `Recommendations${pending ? ` (${pending})` : ""}`],
    ["team", "Team"],
    ["reports", "Reports"],
    ...(supervisor ? ([["audit", "Audit"]] as [View, string][]) : []),
  ];
  return (
    <div className="grid gap-4">
      <div
        className="inline-flex flex-wrap gap-0.5 self-start rounded-md border border-border p-0.5 text-sm"
        role="tablist"
        aria-label="Analytics view"
      >
        {views.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={view === k}
            onClick={() => setView(k)}
            className={`rounded px-3 py-1 ${view === k ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {["overview", "spend", "insights"].includes(view) && (
        <Filters data={data} f={f} setF={setF} />
      )}
      {view === "overview" && <Overview data={data} f={f} acv={acv} onAiRun={onAiRun} />}
      {view === "spend" && <Spend data={data} f={f} acv={acv} reload={refresh} />}
      {view === "insights" && <Insights data={data} f={f} acv={acv} onAiRun={onAiRun} />}
      {view === "financials" && <Financials />}
      {view === "feedback" && <Feedback data={data} go={go} />}
      {view === "activity" && <ActivityLog data={data} go={go} />}
      {view === "recs" && (
        <Recommendations data={data} supervisor={supervisor} reload={refresh} go={go} />
      )}
      {view === "team" && (
        <Team data={data} ranks={ranks} supervisor={supervisor} reload={refresh} />
      )}
      {view === "reports" && <Reports data={data} ranks={ranks} f={f} onAiRun={onAiRun} />}
      {view === "audit" && supervisor && <Audit data={data} />}
    </div>
  );
}

function ExportButtons({ name, table }: { name: string; table: () => Table }) {
  return (
    <span className="inline-flex gap-1.5">
      <button
        type="button"
        className="btn-outline inline-flex items-center gap-1 py-1 text-xs"
        onClick={() => downloadCsv(name, table())}
      >
        <Download className="h-3.5 w-3.5" aria-hidden /> CSV
      </button>
      <button
        type="button"
        className="btn-outline inline-flex items-center gap-1 py-1 text-xs"
        onClick={() =>
          void downloadXlsx(name, table()).catch((e) =>
            toast.error(getErrorMessage(e, "Couldn't build the Excel file.")),
          )
        }
      >
        <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden /> Excel
      </button>
    </span>
  );
}

// ── Filters ─────────────────────────────────────────────────────────────────
function Filters({
  data,
  f,
  setF,
}: {
  data: MarketingData;
  f: AFilters;
  setF: (f: AFilters) => void;
}) {
  const counties = useMemo(
    () => [...new Set(data.leads.flatMap((l) => l.counties))].sort(),
    [data.leads],
  );
  const types = useMemo(
    () => [...new Set(data.leads.flatMap((l) => l.propertyTypes))].sort(),
    [data.leads],
  );
  const preset = (n: number) => setF({ ...f, from: daysAgo(n - 1), to: isoDay(new Date()) });
  return (
    <div className="card-elev flex flex-wrap items-end gap-2 p-3 text-sm">
      <label className="grid gap-1 text-xs text-muted-foreground">
        From
        <input
          type="date"
          className={sel}
          value={f.from}
          max={f.to}
          onChange={(e) => e.target.value && setF({ ...f, from: e.target.value })}
        />
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">
        To
        <input
          type="date"
          className={sel}
          value={f.to}
          min={f.from}
          onChange={(e) => e.target.value && setF({ ...f, to: e.target.value })}
        />
      </label>
      <span className="flex gap-1 pb-0.5">
        {[7, 30, 90, 365].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => preset(n)}
            className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {n === 365 ? "1y" : `${n}d`}
          </button>
        ))}
      </span>
      <label className="grid gap-1 text-xs text-muted-foreground">
        Campaign
        <select
          className={sel}
          value={f.campaignId ?? ""}
          onChange={(e) => setF({ ...f, campaignId: e.target.value || null })}
        >
          <option value="">All</option>
          {data.campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">
        County
        <select
          className={sel}
          value={f.county ?? ""}
          onChange={(e) => setF({ ...f, county: e.target.value || null })}
        >
          <option value="">All</option>
          {counties.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">
        Property type
        <select
          className={sel}
          value={f.propertyType ?? ""}
          onChange={(e) => setF({ ...f, propertyType: e.target.value || null })}
        >
          <option value="">All</option>
          {types.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">
        Lead source
        <select
          className={sel}
          value={f.source ?? ""}
          onChange={(e) => setF({ ...f, source: (e.target.value || null) as AFilters["source"] })}
        >
          <option value="">All</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────
function Overview({
  data,
  f,
  acv,
  onAiRun,
}: {
  data: MarketingData;
  f: AFilters;
  acv: Map<string, number>;
  onAiRun: (r: AiRun) => void;
}) {
  const k = useMemo(() => kpis(data, f, acv), [data, f, acv]);
  const p = useMemo(() => kpis(data, previousPeriod(f), acv), [data, f, acv]);
  const camps = useMemo(() => campaignRows(data, f, acv), [data, f, acv]);
  const tr = useMemo(() => trend(data, f), [data, f]);
  const max = Math.max(1, ...tr.map((t) => t.leads));
  const brief = data.aiRuns.find((r) => r.scope === "analytics") ?? null;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Leads generated"
          value={k.leads}
          hint={fmtDelta(delta(k.leads, p.leads))}
        />
        <StatTile
          label="Leads contacted"
          value={k.contacted}
          hint={fmtDelta(delta(k.contacted, p.contacted))}
        />
        <StatTile
          label="Interested"
          value={k.interested}
          hint={fmtDelta(delta(k.interested, p.interested))}
        />
        <StatTile
          label="Registrations"
          value={k.registrations}
          hint={fmtDelta(delta(k.registrations, p.registrations))}
        />
        <StatTile
          label="Paid subscriptions"
          value={k.subscriptions}
          hint={fmtDelta(delta(k.subscriptions, p.subscriptions))}
        />
        <StatTile
          label="Lead → registered"
          value={k.leadToRegistered == null ? "—" : pct(k.leadToRegistered)}
          hint={fmtDelta(delta(k.leadToRegistered, p.leadToRegistered))}
        />
        <StatTile
          label="Registered → paid"
          value={k.registeredToPaid == null ? "—" : pct(k.registeredToPaid)}
          hint={fmtDelta(delta(k.registeredToPaid, p.registeredToPaid))}
        />
        <StatTile
          label="New annual revenue"
          value={money(k.revenue)}
          hint={fmtDelta(delta(k.revenue, p.revenue))}
        />
      </div>
      <section className="card-elev p-4">
        <h2 className="text-sm font-semibold">Trend</h2>
        <ul className="mt-3 grid gap-1">
          {tr.map((t) => (
            <li
              key={t.start}
              className="grid grid-cols-[4.5rem_minmax(0,1fr)_9rem] items-center gap-3 text-xs"
              title={`${t.leads} leads · ${t.registrations} registrations · ${t.subscriptions} subscriptions · ${money(t.spend)} spend`}
            >
              <span className="text-muted-foreground">{t.label}</span>
              <span className="h-2.5 rounded-full bg-secondary">
                <span
                  className="block h-2.5 rounded-full bg-accent"
                  style={{ width: `${(t.leads / max) * 100}%` }}
                />
              </span>
              <span className="tabular-nums">
                {t.leads} leads · {t.registrations} reg · <b>{t.subscriptions}</b> paid
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="card-elev p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Campaign performance</h2>
          <ExportButtons
            name="campaign-results"
            table={() => runReport({ entity: "campaigns" }, data, new Map(), f)}
          />
        </div>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                {[
                  "Campaign",
                  "Recipients",
                  "Engaged",
                  "Registered",
                  "Customers",
                  "Spend",
                  "CAC",
                  "Revenue",
                  "ROMI",
                ].map((h, i) => (
                  <th key={h} className={`py-1.5 font-medium ${i ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {camps.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-4 text-center text-muted-foreground">
                    No campaigns in this period.
                  </td>
                </tr>
              )}
              {camps.map((r) => (
                <tr key={r.campaign.id} className="border-t border-border/60">
                  <td className="py-1.5">
                    <div className="font-medium">{r.campaign.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.campaign.status}
                      {r.campaign.sentAt && ` · ${relDays(r.campaign.sentAt)}`}
                    </div>
                  </td>
                  <td className="text-right tabular-nums">{r.recipients}</td>
                  <td className="text-right tabular-nums">
                    {r.engaged}{" "}
                    <span className="text-xs text-muted-foreground">
                      {r.engagement == null ? "" : pct(r.engagement)}
                    </span>
                  </td>
                  <td className="text-right tabular-nums">{r.registrations}</td>
                  <td className="text-right font-semibold tabular-nums">{r.customers}</td>
                  <td className="text-right tabular-nums">{usd(r.spend || null)}</td>
                  <td className="text-right tabular-nums">{usd(r.cac)}</td>
                  <td className="text-right tabular-nums">{usd(r.revenue || null)}</td>
                  <td
                    className={`text-right tabular-nums ${r.romi != null && r.romi < 0 ? "text-rose-700" : ""}`}
                  >
                    {r.romi == null ? "—" : pct(r.romi)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          * Engaged = replied, said interested or moved a step forward within 14 days of the send.
          Revenue = annual list value of the subscriptions they bought (before launch discounts).
        </p>
      </section>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Export:</span>
        <span>Leads</span>
        <ExportButtons
          name="leads"
          table={() =>
            runReport({ entity: "leads", filters: { from: f.from, to: f.to } }, data, new Map(), f)
          }
        />
        <span className="ml-2">Conversions</span>
        <ExportButtons
          name="conversions"
          table={() => runReport({ entity: "conversions" }, data, new Map(), f)}
        />
        <span className="ml-2">Follow-ups</span>
        <ExportButtons
          name="follow-ups"
          table={() => runReport({ entity: "followups" }, data, new Map(), f)}
        />
      </div>
      <AiBox
        title="Corvus AI — performance summary and trends"
        text={brief?.result ?? null}
        when={brief ? relDays(brief.createdAt) : null}
        runLabel="Summarise this period"
        run={async () =>
          onAiRun(
            await runAi({
              scope: "analytics",
              instruction:
                "Summarise marketing performance for this period vs the previous one in markdown: **Headline**, **Trends** (what's up/down and by how much), **Campaigns** (best and worst), **Watch out** — under 180 words. Use only these numbers; say when a number is zero.",
              context: JSON.stringify({
                period: f,
                current: k,
                previous: p,
                campaigns: camps.slice(0, 10).map((r) => ({
                  name: r.campaign.name,
                  recipients: r.recipients,
                  engaged: r.engaged,
                  customers: r.customers,
                  spend: r.spend,
                  revenue: r.revenue,
                })),
                trend: tr,
              }),
            }),
          )
        }
      />
    </>
  );
}

// ── Spend & ROI ─────────────────────────────────────────────────────────────
function Spend({
  data,
  f,
  acv,
  reload,
}: {
  data: MarketingData;
  f: AFilters;
  acv: Map<string, number>;
  reload: () => Promise<void>;
}) {
  const k = useMemo(() => kpis(data, f, acv), [data, f, acv]);
  const camps = useMemo(
    () => campaignRows(data, { ...f, from: "2000-01-01", to: "2100-01-01" }, acv),
    [data, f, acv],
  );
  const blank: Omit<Expense, "id"> = {
    spentOn: isoDay(new Date()),
    amount: 0,
    category: "ads",
    campaignId: null,
    vendor: "",
    description: "",
  };
  const [form, setForm] = useState<Omit<Expense, "id"> & { id?: string }>(blank);
  const [busy, setBusy] = useState(false);
  const list = data.expenses.filter(
    (e) =>
      e.spentOn >= f.from && e.spentOn <= f.to && (!f.campaignId || e.campaignId === f.campaignId),
  );
  async function save() {
    if (!(form.amount > 0)) return toast.error("Enter an amount.");
    setBusy(true);
    try {
      await saveExpense(form.id ?? null, form);
      setForm(blank);
      await reload();
      toast.success("Expense saved.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't save the expense."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatTile
          label="Marketing spend"
          value={money(k.spend)}
          hint={`${list.length} expense${list.length === 1 ? "" : "s"}`}
        />
        <StatTile
          label="Customer acquisition cost"
          value={usd(k.cac)}
          hint={`${k.subscriptions} new customer${k.subscriptions === 1 ? "" : "s"}`}
        />
        <StatTile
          label="Revenue per customer"
          value={usd(k.revenuePerCustomer)}
          hint="annual list value"
        />
        <StatTile
          label="Return on marketing"
          value={k.romi == null ? "—" : pct(k.romi)}
          hint="(revenue − spend) ÷ spend"
        />
        <StatTile label="Cost per lead" value={usd(k.costPerLead)} hint={`${k.leads} new leads`} />
      </div>
      <section className="card-elev p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Expenses</h2>
          <ExportButtons
            name="marketing-expenses"
            table={() => runReport({ entity: "expenses" }, data, new Map(), f)}
          />
        </div>
        <form
          className="mt-2 grid gap-2 rounded-md bg-secondary/40 p-3 sm:grid-cols-[8.5rem_7rem_8rem_minmax(0,1fr)_minmax(0,1fr)_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input
            type="date"
            className={sel}
            value={form.spentOn}
            onChange={(e) => setForm({ ...form, spentOn: e.target.value })}
            aria-label="Date"
          />
          <input
            className={sel}
            inputMode="decimal"
            placeholder="Amount $"
            value={form.amount || ""}
            onChange={(e) =>
              setForm({ ...form, amount: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 })
            }
            aria-label="Amount"
          />
          <select
            className={sel}
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value as Expense["category"] })}
            aria-label="Category"
          >
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            className={sel}
            value={form.campaignId ?? ""}
            onChange={(e) => setForm({ ...form, campaignId: e.target.value || null })}
            aria-label="Campaign"
          >
            <option value="">No campaign (general)</option>
            {data.campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            className={sel}
            placeholder="Vendor / description"
            value={form.description ?? ""}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            aria-label="Description"
          />
          <span className="flex gap-1.5">
            <button type="submit" disabled={busy} className="btn-primary btn-primary-hover text-xs">
              {form.id ? "Save" : "Add expense"}
            </button>
            {form.id && (
              <button type="button" onClick={() => setForm(blank)} className="btn-outline text-xs">
                Cancel
              </button>
            )}
          </span>
        </form>
        <ul className="mt-2 divide-y divide-border text-sm">
          {list.length === 0 && (
            <li className="py-3 text-muted-foreground">
              No expenses in this period. Add ad spend, tools, events or data purchases to see CAC
              and ROI.
            </li>
          )}
          {list.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span>
                <b className="tabular-nums">{money(e.amount)}</b> · {e.category} · {e.spentOn}
                <span className="text-muted-foreground">
                  {e.campaignId
                    ? ` · ${data.campaigns.find((c) => c.id === e.campaignId)?.name ?? "campaign"}`
                    : ""}
                  {e.description ? ` · ${e.description}` : ""}
                </span>
              </span>
              <span className="flex gap-2 text-xs">
                <button
                  type="button"
                  className="text-accent hover:underline"
                  onClick={() =>
                    setForm({ ...e, vendor: e.vendor ?? "", description: e.description ?? "" })
                  }
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={async () => {
                    if (!(await confirmDialog(`Delete the ${money(e.amount)} expense?`))) return;
                    await deleteExpense(e.id).catch((x) =>
                      toast.error(getErrorMessage(x, "Couldn't delete.")),
                    );
                    await reload();
                  }}
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="card-elev p-4">
        <h2 className="text-sm font-semibold">Campaign budgets and return (all time)</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                {["Campaign", "Budget", "Spent", "Customers", "CAC", "Revenue", "ROMI"].map(
                  (h, i) => (
                    <th key={h} className={`py-1.5 font-medium ${i ? "text-right" : ""}`}>
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {camps.map((r) => (
                <tr key={r.campaign.id} className="border-t border-border/60">
                  <td className="py-1.5">{r.campaign.name}</td>
                  <td className="text-right">
                    <input
                      className="w-24 rounded border border-input bg-background px-1.5 py-0.5 text-right text-xs"
                      defaultValue={r.campaign.budget ?? ""}
                      placeholder="—"
                      aria-label={`Budget for ${r.campaign.name}`}
                      onBlur={async (e) => {
                        const v = e.target.value
                          ? Number(e.target.value.replace(/[^0-9.]/g, ""))
                          : null;
                        if (v === r.campaign.budget) return;
                        await saveCampaign(r.campaign.id, { budget: v }).catch((x) =>
                          toast.error(getErrorMessage(x, "Couldn't save the budget.")),
                        );
                        await reload();
                      }}
                    />
                  </td>
                  <td
                    className={`text-right tabular-nums ${r.campaign.budget != null && r.spend > r.campaign.budget ? "font-semibold text-rose-700" : ""}`}
                  >
                    {usd(r.spend || null)}
                  </td>
                  <td className="text-right tabular-nums">{r.customers}</td>
                  <td className="text-right tabular-nums">{usd(r.cac)}</td>
                  <td className="text-right tabular-nums">{usd(r.revenue || null)}</td>
                  <td className="text-right tabular-nums">{r.romi == null ? "—" : pct(r.romi)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          * CAC = spend ÷ new paying customers. Revenue = annual list value of their subscriptions
          (before launch discounts). Spent over budget shows in red.
        </p>
      </section>
    </>
  );
}

// ── What works ──────────────────────────────────────────────────────────────
function DimTable({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; a: number; b: number; c: number; rate: number | null }[];
}) {
  return (
    <section className="card-elev p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No data for these filters.</p>
      ) : (
        <ul className="mt-2 grid gap-1 text-sm">
          {rows.slice(0, 8).map((r) => (
            <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <span className="truncate capitalize">{r.key}</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {r.a} · {r.b} engaged · <b className="text-foreground">{r.c} paid</b>
                {r.rate != null && ` · ${pct(r.rate)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
function Insights({
  data,
  f,
  acv,
  onAiRun,
}: {
  data: MarketingData;
  f: AFilters;
  acv: Map<string, number>;
  onAiRun: (r: AiRun) => void;
}) {
  const dims = useMemo(
    () => ({
      county: leadDimension(data, f, "county", acv),
      type: leadDimension(data, f, "propertyType", acv),
      source: leadDimension(data, f, "source", acv),
      channel: touchDimension(data, f, "channel"),
      template: touchDimension(data, f, "template"),
      audience: touchDimension(data, f, "audience"),
      weekday: touchDimension(data, f, "weekday"),
      hour: touchDimension(data, f, "hour"),
    }),
    [data, f, acv],
  );
  const lead = (rows: typeof dims.county) =>
    rows.map((r) => ({ key: r.key, a: r.leads, b: r.engaged, c: r.customers, rate: r.conversion }));
  const touch = (rows: typeof dims.channel) =>
    rows.map((r) => ({ key: r.key, a: r.sent, b: r.engaged, c: r.customers, rate: r.rate }));
  const brief = data.aiRuns.find((r) => r.scope === "marketing-insights") ?? null;
  return (
    <>
      <AiBox
        title="Corvus AI — where to focus targeting, content, timing and spend"
        text={brief?.result ?? null}
        when={brief ? relDays(brief.createdAt) : null}
        runLabel="Get recommendations"
        run={async () =>
          onAiRun(
            await runAi({
              scope: "marketing-insights",
              instruction:
                "From these results, name the counties, property types, audiences, messages (templates), channels and send days/hours that drive engagement and paid subscriptions. Then give clear recommendations under **Targeting**, **Content**, **Scheduling** and **Spending** (2 bullets each). Use only the numbers; flag small samples.",
              context: JSON.stringify({ filters: f, ...dims, spend: kpis(data, f, acv) }),
            }),
          )
        }
      />
      <p className="text-[11px] text-muted-foreground">
        * Lead tables: leads · engaged · paid · lead→paid %. Touch tables: messages sent · engaged
        within 7 days · became paid · engagement %.
      </p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <DimTable title="By county" rows={lead(dims.county)} />
        <DimTable title="By property type" rows={lead(dims.type)} />
        <DimTable title="By lead source" rows={lead(dims.source)} />
        <DimTable title="By audience" rows={touch(dims.audience)} />
        <DimTable title="By message (template)" rows={touch(dims.template)} />
        <DimTable title="By channel" rows={touch(dims.channel)} />
        <DimTable title="By send day" rows={touch(dims.weekday)} />
        <DimTable title="By send hour" rows={touch(dims.hour)} />
      </div>
    </>
  );
}

// ── Recommendations ─────────────────────────────────────────────────────────
const ACTION_LABEL: Record<Recommendation["action"], string> = {
  adjust: "Adjust",
  pause: "Pause",
  increase: "Increase investment",
  reassign: "Reassign work",
  review: "Review",
};
function Recommendations({
  data,
  supervisor,
  reload,
  go,
}: {
  data: MarketingData;
  supervisor: boolean;
  reload: () => Promise<void>;
  go?: Go;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const recs = data.recommendations.filter((r) =>
    showDone ? r.status !== "pending" : r.status === "pending",
  );
  const staffName = (id: string | null) => data.staff.find((s) => s.id === id)?.name ?? "someone";
  async function approve(r: Recommendation) {
    setBusy(r.id);
    try {
      const c = data.campaigns.find((x) => x.id === r.campaignId);
      let applied = false;
      if (r.action === "pause" && c && ["approved", "scheduled"].includes(c.status)) {
        await setCampaignStatus(c, "paused");
        applied = true;
      } else if (r.action === "increase" && c) {
        const base =
          c.budget ??
          data.expenses.filter((e) => e.campaignId === c.id).reduce((s, e) => s + e.amount, 0);
        if (base > 0) {
          await saveCampaign(c.id, { budget: Math.round(base * 1.25) });
          applied = true;
        }
      } else if (r.action === "reassign" && r.staffId && r.targetStaffId) {
        if (!supervisor) throw new Error("Only a supervisor can approve reassignments.");
        const moveF = data.followups
          .filter(
            (x) =>
              x.status === "pending" &&
              (x.assignedTo ?? data.leads.find((l) => l.id === x.leadId)?.assignedTo) ===
                r.staffId &&
              new Date(x.dueAt) < new Date(),
          )
          .slice(0, 10);
        for (const x of moveF) await saveFollowup(x.id, { assignedTo: r.targetStaffId });
        applied = true;
      }
      await decideRecommendation(r.id, applied ? "applied" : "approved");
      await reload();
      toast.success(
        applied
          ? r.action === "pause"
            ? "Campaign paused."
            : r.action === "increase"
              ? "Budget raised 25%."
              : "Overdue follow-ups moved."
          : "Approved — make the change in the campaign.",
      );
      if (!applied && r.action === "adjust" && c && go) go("campaigns", { campaignId: c.id });
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't apply it."));
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="card-elev p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Recommendations</h2>
          <p className="text-xs text-muted-foreground">
            Corvus AI checks campaigns, costs, conversion and the team every hour. Nothing changes
            until you approve.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
          />{" "}
          Show decided
        </label>
      </div>
      {recs.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {showDone ? "Nothing decided yet." : "Nothing needs a decision right now."}
        </p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {recs.map((r) => (
            <li
              key={r.id}
              className="grid gap-2 rounded-md border border-border p-3 text-sm md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${r.action === "pause" ? "bg-rose-100 text-rose-900" : r.action === "increase" ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}
                  >
                    {ACTION_LABEL[r.action]}
                  </span>
                  <b>{r.title}</b>
                </div>
                <p className="text-xs text-muted-foreground">{r.detail}</p>
                <p className="text-[11px] text-muted-foreground">
                  {relDays(r.createdAt)}
                  {r.status !== "pending" && ` · ${r.status} ${relDays(r.decidedAt)}`}
                  {r.action === "reassign" &&
                    ` · from ${staffName(r.staffId)} to ${staffName(r.targetStaffId)}`}
                </p>
              </div>
              {r.status === "pending" && (
                <span className="flex gap-1.5">
                  <button
                    type="button"
                    disabled={!!busy || (r.action === "reassign" && !supervisor)}
                    onClick={() => void approve(r)}
                    className="btn-primary btn-primary-hover inline-flex items-center gap-1 py-1 text-xs disabled:opacity-60"
                    title={
                      r.action === "reassign" && !supervisor
                        ? "Supervisors approve reassignments"
                        : undefined
                    }
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden /> Approve
                  </button>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => void decideRecommendation(r.id, "rejected").then(reload)}
                    className="btn-outline inline-flex items-center gap-1 py-1 text-xs"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden /> Reject
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Team ────────────────────────────────────────────────────────────────────
function Team({
  data,
  ranks,
  supervisor,
  reload,
}: {
  data: MarketingData;
  ranks: ReturnType<typeof rankAll>;
  supervisor: boolean;
  reload: () => Promise<void>;
}) {
  const work = useMemo(() => teamWorkload(data, ranks), [data, ranks]);
  const suggestions = useMemo(() => suggestAssignments(data, ranks, 15), [data, ranks]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const now = new Date();
  const overdue = data.followups.filter(
    (f) => f.status === "pending" && new Date(f.dueAt) < new Date(now.getTime() - 864e5),
  );
  const leadById = new Map(data.leads.map((l) => [l.id, l]));
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      await reload();
      toast.success(ok);
    } catch (err) {
      toast.error(getErrorMessage(err, "That didn't save."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <section className="card-elev overflow-x-auto p-4">
        <h2 className="text-sm font-semibold">Team workload</h2>
        <table className="mt-2 w-full min-w-[640px] text-left text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              {[
                "Team member",
                "Open leads",
                "Campaigns",
                "Pending",
                "Overdue",
                "Done (30d)",
                "High priority not contacted",
              ].map((h, i) => (
                <th key={h} className={`py-1.5 font-medium ${i ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {work.map((w) => (
              <tr key={w.staffId} className="border-t border-border/60">
                <td className="py-1.5 font-medium">{w.name}</td>
                <td className="text-right tabular-nums">{w.leads}</td>
                <td className="text-right tabular-nums">{w.campaigns}</td>
                <td className="text-right tabular-nums">{w.pending}</td>
                <td
                  className={`text-right tabular-nums ${w.overdue ? "font-semibold text-rose-700" : ""}`}
                >
                  {w.overdue}
                </td>
                <td className="text-right tabular-nums">{w.done30}</td>
                <td
                  className={`text-right tabular-nums ${w.uncontactedHigh ? "font-semibold text-amber-800" : ""}`}
                >
                  {w.uncontactedHigh}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {!supervisor && (
        <p className="text-xs text-muted-foreground">
          * Assigning work to teammates is for Marketing Supervisors and Super Admins.
        </p>
      )}
      {supervisor && (
        <>
          <section className="card-elev p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold">Suggested assignments</h2>
                <p className="text-xs text-muted-foreground">
                  Unassigned prospects, highest priority first, to whoever has the lightest load.
                </p>
              </div>
              <button
                type="button"
                disabled={busy || !picked.size}
                onClick={() =>
                  void run(
                    () =>
                      Promise.all(
                        suggestions
                          .filter((s) => picked.has(s.lead.id))
                          .map((s) => updateLead(s.lead.id, { assignedTo: s.to })),
                      ),
                    `${picked.size} assigned.`,
                  ).then(() => setPicked(new Set()))
                }
                className="btn-primary btn-primary-hover text-xs disabled:opacity-60"
              >
                Assign {picked.size || ""} selected
              </button>
            </div>
            {suggestions.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Every open prospect is assigned.</p>
            ) : (
              <ul className="mt-2 grid gap-1 text-sm">
                {suggestions.map((s) => (
                  <li key={s.lead.id}>
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={picked.has(s.lead.id)}
                        onChange={() =>
                          setPicked((x) => {
                            const n = new Set(x);
                            if (n.has(s.lead.id)) n.delete(s.lead.id);
                            else n.add(s.lead.id);
                            return n;
                          })
                        }
                      />
                      <span>
                        <b>{leadName(s.lead)}</b> → {s.toName}
                        <span className="block text-xs text-muted-foreground">{s.why}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card-elev p-4">
            <h2 className="text-sm font-semibold">Campaign owners</h2>
            <ul className="mt-2 grid gap-1.5 text-sm">
              {data.campaigns
                .filter((c) => c.status !== "sent")
                .map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {c.name} <span className="text-xs text-muted-foreground">({c.status})</span>
                    </span>
                    <select
                      className={sel}
                      value={c.ownerId ?? ""}
                      onChange={(e) =>
                        void run(
                          () => saveCampaign(c.id, { ownerId: e.target.value || null }),
                          "Owner saved.",
                        )
                      }
                      aria-label={`Owner of ${c.name}`}
                    >
                      <option value="">No owner</option>
                      {data.staff.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              {!data.campaigns.some((c) => c.status !== "sent") && (
                <li className="text-muted-foreground">No open campaigns.</li>
              )}
            </ul>
          </section>
          <section className="card-elev p-4">
            <h2 className="text-sm font-semibold">Delayed follow-ups ({overdue.length})</h2>
            <p className="text-xs text-muted-foreground">
              Overdue more than a day — move them to someone with capacity.
            </p>
            <ul className="mt-2 grid gap-1.5 text-sm">
              {overdue.slice(0, 30).map((x) => {
                const l = leadById.get(x.leadId);
                const owner = x.assignedTo ?? l?.assignedTo ?? null;
                return (
                  <li key={x.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">
                      <b>{l ? leadName(l) : "Lead"}</b> · {x.channel} · due {relDays(x.dueAt)}
                      <span className="text-xs text-muted-foreground">
                        {" "}
                        · {data.staff.find((s) => s.id === owner)?.name ?? "unassigned"}
                      </span>
                    </span>
                    <select
                      className={sel}
                      value={owner ?? ""}
                      onChange={(e) =>
                        void run(
                          () => saveFollowup(x.id, { assignedTo: e.target.value || null }),
                          "Reassigned.",
                        )
                      }
                      aria-label="Reassign follow-up"
                    >
                      <option value="">Unassigned</option>
                      {data.staff.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </li>
                );
              })}
              {overdue.length === 0 && <li className="text-muted-foreground">Nothing delayed.</li>}
            </ul>
          </section>
        </>
      )}
    </>
  );
}

// ── Reports ─────────────────────────────────────────────────────────────────
function Reports({
  data,
  ranks,
  f,
  onAiRun,
}: {
  data: MarketingData;
  ranks: ReturnType<typeof rankAll>;
  f: AFilters;
  onAiRun: (r: AiRun) => void;
}) {
  const [period, setPeriod] = useState<Report["period"]>("weekly");
  const list = data.reports.filter((r) => r.period === period);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = list.find((r) => r.id === openId) ?? list[0] ?? null;
  const [ask, setAsk] = useState("");
  const [spec, setSpec] = useState<ReportSpec | null>(null);
  const [busy, setBusy] = useState(false);
  const table = useMemo(
    () => (spec ? runReport(spec, data, ranks, f) : null),
    [spec, data, ranks, f],
  );
  async function build() {
    if (!ask.trim()) return;
    setBusy(true);
    try {
      const catalog = Object.fromEntries(
        Object.entries(REPORT_COLUMNS).map(([k, cols]) => [k, cols.map((c) => c.key)]),
      );
      const r = await runAi({
        scope: "report-builder",
        instruction:
          `Turn this request into a report spec. Reply with JSON only: {"title": string, "entity": one of ${Object.keys(catalog).join("|")}, "filters": {"from": "yyyy-mm-dd", "to": "yyyy-mm-dd", "county": string, "propertyType": string, "source": string, "campaignId": string, "stage": [..], "status": [..]}, "columns": [..], "sort": {"column": string, "dir": "asc|desc"}, "limit": number}. ` +
          `Only use these columns per entity: ${JSON.stringify(catalog)}. Omit filters you don't need. Today is ${isoDay(new Date())}. Request: ${ask}`,
        context: `Counties: ${[...new Set(data.leads.flatMap((l) => l.counties))].join(", ")}. Campaigns: ${data.campaigns.map((c) => `${c.id}=${c.name}`).join("; ")}. Sources: ${SOURCES.join(", ")}.`,
      });
      onAiRun(r);
      const s = cleanSpec(JSON.parse((r.result ?? "").match(/\{[\s\S]*\}/)?.[0] ?? "null"));
      if (!s) throw new Error("Corvus AI couldn't turn that into a report — try rephrasing.");
      setSpec(s);
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't build that report."));
    } finally {
      setBusy(false);
    }
  }
  const m = (open?.metrics ?? {}) as Record<string, number>;
  return (
    <>
      <section className="card-elev p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Performance reports</h2>
          <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
            {(["daily", "weekly", "monthly"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setPeriod(p);
                  setOpenId(null);
                }}
                className={`rounded px-2.5 py-1 capitalize ${period === p ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        {list.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            The first {period} report is prepared automatically within the hour.
          </p>
        ) : (
          <div className="mt-3 grid gap-4 md:grid-cols-[12rem_minmax(0,1fr)]">
            <ul className="grid content-start gap-1 text-sm">
              {list.slice(0, 20).map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(r.id)}
                    className={`w-full rounded px-2 py-1 text-left ${open?.id === r.id ? "bg-secondary font-medium" : "hover:bg-secondary/50"}`}
                  >
                    {r.periodStart === r.periodEnd
                      ? r.periodStart
                      : `${r.periodStart} – ${r.periodEnd}`}
                  </button>
                </li>
              ))}
            </ul>
            {open && (
              <div className="grid content-start gap-3">
                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  {(
                    [
                      ["Leads", m.leads],
                      ["Contacted", m.contacted],
                      ["Registrations", m.registrations],
                      ["Subscriptions", m.subscriptions],
                      ["New revenue", money(m.newRevenue ?? 0)],
                      ["Spend", money(m.spend ?? 0)],
                      ["CAC", m.subscriptions ? money((m.spend ?? 0) / m.subscriptions) : "—"],
                      ["Follow-ups done", m.followupsDone],
                    ] as [string, string | number | undefined][]
                  ).map(([k, v]) => (
                    <div key={k} className="rounded-md bg-secondary/40 p-2">
                      <div className="text-[11px] text-muted-foreground">{k}</div>
                      <div className="font-semibold tabular-nums">{v ?? 0}</div>
                    </div>
                  ))}
                </div>
                {open.summary ? (
                  <MarkdownLite text={open.summary} className="text-sm" />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Corvus AI is writing the summary — check back within the hour.
                  </p>
                )}
                <ExportButtons
                  name={`${open.period}-report-${open.periodStart}`}
                  table={() => ({
                    headers: ["Metric", "Value"],
                    rows: Object.entries(open.metrics).map(([k, v]) => [
                      k,
                      typeof v === "object" ? JSON.stringify(v) : (v as number),
                    ]),
                  })}
                />
              </div>
            )}
          </div>
        )}
      </section>
      <section className="card-elev p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-accent" aria-hidden /> Custom report
        </h2>
        <p className="text-xs text-muted-foreground">
          Ask for a report in plain words — Corvus AI builds it from the CRM, campaign and spend
          data.
        </p>
        <form
          className="mt-2 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void build();
          }}
        >
          <input
            className={`${inputCls} min-w-0 flex-1 basis-80`}
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            placeholder="e.g. Harris County leads with 3+ properties added this quarter, biggest first"
            aria-label="Describe the report"
          />
          <button type="submit" disabled={busy} className="btn-primary btn-primary-hover text-sm">
            {busy ? "Building…" : "Build report"}
          </button>
        </form>
        {spec && table && (
          <div className="mt-3 grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <b className="text-sm">
                {spec.title ?? "Report"} · {table.rows.length} row
                {table.rows.length === 1 ? "" : "s"}
              </b>
              <ExportButtons name={spec.title ?? "custom-report"} table={() => table} />
            </div>
            <div className="max-h-96 overflow-auto rounded-md border border-border">
              <table className="w-full min-w-[600px] text-left text-xs">
                <thead className="sticky top-0 bg-background text-muted-foreground">
                  <tr>
                    {table.headers.map((h) => (
                      <th key={h} className="px-2 py-1.5 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.slice(0, 100).map((r, i) => (
                    <tr key={i} className="border-t border-border/60">
                      {r.map((c, j) => (
                        <td key={j} className="px-2 py-1">
                          {typeof c === "number" ? c.toLocaleString("en-US") : (c ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {table.rows.length > 100 && (
              <p className="text-[11px] text-muted-foreground">
                Showing 100 — the export has all {table.rows.length}.
              </p>
            )}
          </div>
        )}
      </section>
    </>
  );
}

// ── Audit ───────────────────────────────────────────────────────────────────
function Audit({ data }: { data: MarketingData }) {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [entity, setEntity] = useState("");
  const [actor, setActor] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState(daysAgo(29));
  useEffect(() => {
    loadAudit(2000)
      .then(setRows)
      .catch((e) => toast.error(getErrorMessage(e, "Couldn't load the audit history.")));
  }, []);
  const list = (rows ?? []).filter(
    (r) =>
      (!entity || r.entity === entity) &&
      (!actor || r.actorLabel === actor) &&
      inRange(r.createdAt, { from, to: isoDay(new Date()) }) &&
      (!q || r.summary.toLowerCase().includes(q.toLowerCase())),
  );
  const entities = [...new Set((rows ?? []).map((r) => r.entity))].sort();
  const actors = [...new Set((rows ?? []).map((r) => r.actorLabel))].sort();
  return (
    <section className="card-elev p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Audit history</h2>
          <p className="text-xs text-muted-foreground">
            Imports, contact and consent changes, AI recommendations, campaign approvals and
            launches, status changes, communication and assignments — who and when.
          </p>
        </div>
        <ExportButtons
          name="marketing-audit"
          table={() => ({
            headers: ["When", "Who", "Area", "Action", "What"],
            rows: list.map((r) => [
              new Date(r.createdAt).toLocaleString(),
              r.actorLabel,
              r.entity,
              r.action,
              r.summary,
            ]),
          })}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-sm">
        <input
          type="date"
          className={sel}
          value={from}
          onChange={(e) => e.target.value && setFrom(e.target.value)}
          aria-label="Since"
        />
        <select
          className={sel}
          value={entity}
          onChange={(e) => setEntity(e.target.value)}
          aria-label="Area"
        >
          <option value="">Everything</option>
          {entities.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select
          className={sel}
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          aria-label="Who"
        >
          <option value="">Anyone</option>
          {actors.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <input
          className={`${sel} min-w-0 flex-1`}
          placeholder="Search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search the audit"
        />
      </div>
      {rows === null ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <ul className="mt-3 max-h-[60vh] divide-y divide-border overflow-y-auto text-sm">
          {list.slice(0, 500).map((r) => (
            <li
              key={r.id}
              className="grid gap-0.5 py-1.5 sm:grid-cols-[9.5rem_9rem_minmax(0,1fr)] sm:gap-3"
            >
              <span className="text-xs text-muted-foreground">
                {new Date(r.createdAt).toLocaleString([], {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
              <span className="truncate text-xs font-medium">{r.actorLabel}</span>
              <span className="min-w-0">
                <span className="mr-1.5 rounded bg-secondary px-1 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                  {r.entity}
                </span>
                {r.summary}
              </span>
            </li>
          ))}
          {list.length === 0 && (
            <li className="py-3 text-muted-foreground">Nothing for these filters.</li>
          )}
        </ul>
      )}
    </section>
  );
}

// ── From Admin, read-only ───────────────────────────────────────────────────
/** Revenue side of marketing: MRR, subscriptions, collections, plan mix (Stripe). */
function Financials() {
  const [f, setF] = useState<AdminFinancials | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    getAdminFinancials()
      .then(setF)
      .catch((e) => setErr(getErrorMessage(e, "Couldn't load financials.")));
  }, []);
  if (err) return <p className="text-sm text-rose-700">{err}</p>;
  if (!f) return <p className="text-sm text-muted-foreground">Loading financials…</p>;
  const plans: Table = {
    headers: ["Plan", "Subscriptions", "Monthly revenue"],
    rows: f.planMix.map((p) => [p.label, p.count, dollars(p.mrrCents)]),
  };
  return (
    <div className="grid gap-4">
      {f.mode === "test" && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Stripe is in test mode — these are test figures.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Monthly recurring revenue"
          value={dollars(f.mrrCents)}
          hint={`${dollars(f.mrrCents * 12)} a year`}
        />
        <StatTile
          label="Active subscriptions"
          value={f.activeSubscriptions}
          hint={`${f.subscriptionCustomers} customers`}
        />
        <StatTile
          label="Collected (last 12 months)"
          value={dollars(f.collectedRecentCents)}
          hint={f.refundedRecentCents ? `${dollars(f.refundedRecentCents)} refunded` : undefined}
        />
        <StatTile label="Sign-ups" value={f.signups} hint="All accounts" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card-elev p-4">
          <h2 className="text-sm font-semibold">Collected by month</h2>
          <div className="mt-3">
            <Bars
              rows={f.collectedByMonth.map((m) => ({ label: m.month, value: m.amountCents / 100 }))}
              format={(n) => money(n)}
            />
          </div>
        </section>
        <section className="card-elev p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Plan mix</h2>
            <button
              type="button"
              className="text-xs text-accent hover:underline"
              onClick={() => downloadCsv("plan-mix.csv", plans)}
            >
              CSV
            </button>
          </div>
          {plans.rows.length === 0 && (
            <p className="mt-2 text-sm text-muted-foreground">No active subscriptions.</p>
          )}
          <table className={`mt-2 w-full text-left text-sm ${plans.rows.length ? "" : "hidden"}`}>
            <thead className="text-xs text-muted-foreground">
              <tr>
                {plans.headers.map((h) => (
                  <th key={h} className="py-1 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {plans.rows.map((r) => (
                <tr key={String(r[0])} className="border-t border-border/60">
                  {r.map((c, i) => (
                    <td key={i} className="py-1 tabular-nums">
                      {String(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">
            Real estate: {f.byProductLine.property.count} (
            {dollars(f.byProductLine.property.mrrCents)}/mo) · Business personal property:{" "}
            {f.byProductLine.bpp.count} ({dollars(f.byProductLine.bpp.mrrCents)}/mo)
          </p>
        </section>
      </div>
      <p className="text-[11px] text-muted-foreground">
        * Live from Stripe, same figures as Admin → Financials. Read-only here.
      </p>
    </div>
  );
}

/** What beta users said — themes from the AI summary plus the responses, linked to leads. */
function Feedback({ data, go }: { data: MarketingData; go?: Go }) {
  const [fb, setFb] = useState<BetaFeedback | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    loadBetaFeedback()
      .then(setFb)
      .catch((e) => setErr(getErrorMessage(e, "Couldn't load beta feedback.")));
  }, []);
  if (err) return <p className="text-sm text-rose-700">{err}</p>;
  if (!fb) return <p className="text-sm text-muted-foreground">Loading feedback…</p>;
  const ins = fb.insights?.insights;
  const themes = (
    title: string,
    list: { theme: string; count: number; examples: string[] }[] | undefined,
  ) => (
    <section className="card-elev p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {list?.length ? (
        <ul className="mt-2 grid gap-2 text-sm">
          {list.slice(0, 8).map((t) => (
            <li key={t.theme}>
              <b>{t.theme}</b> <span className="text-xs text-muted-foreground">({t.count})</span>
              {t.examples[0] && (
                <span className="block text-xs text-muted-foreground">“{t.examples[0]}”</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">Nothing yet.</p>
      )}
    </section>
  );
  const leadIds = new Set(data.leads.map((l) => l.id));
  return (
    <div className="grid gap-4">
      <p className="text-xs text-muted-foreground">
        {fb.responses.length} completed response{fb.responses.length === 1 ? "" : "s"}
        {fb.insights
          ? ` · themes generated ${relDays(fb.insights.generated_at)} from ${fb.insights.response_count} responses`
          : ""}{" "}
        · use them for messaging and campaign angles.
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        {themes("Pain points", ins?.painPoints)}
        {themes("Feature requests", ins?.featureRequests)}
        {themes("What they'd miss", ins?.wouldMiss)}
      </div>
      <section className="card-elev p-4">
        <h2 className="text-sm font-semibold">Responses</h2>
        <ul className="mt-2 grid gap-1 text-sm">
          {fb.responses.slice(0, 50).map((r, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-2 border-b border-border/60 py-1.5 last:border-0"
            >
              <span className="min-w-0 truncate">{r.email ?? "Unknown user"}</span>
              <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                {relDays(r.completed_at)}
                {r.lead_id && leadIds.has(r.lead_id) && go && (
                  <button
                    type="button"
                    className="text-accent hover:underline"
                    onClick={() => go("leads", { leadId: r.lead_id! })}
                  >
                    Open lead
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** Admin Activity Log, marketing part only: invites, sign-ups, plan changes, removed accounts. */
function ActivityLog({ data, go }: { data: MarketingData; go?: Go }) {
  const [rows, setRows] = useState<AdminActivity[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [kind, setKind] = useState("");
  useEffect(() => {
    loadAdminActivity(500)
      .then(setRows)
      .catch((e) => setErr(getErrorMessage(e, "Couldn't load the activity log.")));
  }, []);
  if (err) return <p className="text-sm text-rose-700">{err}</p>;
  if (!rows) return <p className="text-sm text-muted-foreground">Loading activity…</p>;
  const leadByEmail = new Map(
    data.leads.filter((l) => l.email).map((l) => [l.email!.toLowerCase(), l]),
  );
  const shown = rows.filter((r) => !kind || r.action === kind);
  const table: Table = {
    headers: ["When", "What", "Who", "Account", "Detail"],
    rows: shown.map((r) => [
      new Date(r.createdAt).toLocaleString(),
      ADMIN_ACTION_LABEL[r.action] ?? r.action,
      r.actorEmail ?? "",
      r.targetEmail ?? "",
      r.detail ?? "",
    ]),
  };
  return (
    <section className="card-elev p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Activity log</h2>
        <select
          className={`${sel} ml-auto`}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          aria-label="Activity type"
        >
          <option value="">All marketing activity</option>
          {Object.entries(ADMIN_ACTION_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn-outline py-1 text-xs"
          onClick={() => downloadCsv("activity-log.csv", table)}
        >
          CSV
        </button>
        <button
          type="button"
          className="btn-outline py-1 text-xs"
          onClick={() => void downloadXlsx("activity-log.xlsx", table)}
        >
          Excel
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nothing logged.</p>
      ) : (
        <ul className="mt-2 grid gap-1 text-sm">
          {shown.slice(0, 200).map((r) => {
            const l = r.targetEmail ? leadByEmail.get(r.targetEmail.toLowerCase()) : undefined;
            return (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5 last:border-0"
              >
                <span className="min-w-0">
                  <b>{ADMIN_ACTION_LABEL[r.action] ?? r.action}</b>
                  {r.targetEmail && (
                    <>
                      {" — "}
                      {l && go ? (
                        <button
                          type="button"
                          className="text-accent hover:underline"
                          onClick={() => go("leads", { leadId: l.id })}
                        >
                          {r.targetEmail}
                        </button>
                      ) : (
                        r.targetEmail
                      )}
                    </>
                  )}
                  {r.detail && (
                    <span className="block truncate text-xs text-muted-foreground">{r.detail}</span>
                  )}
                </span>
                <span className="shrink-0 text-right text-xs text-muted-foreground">
                  {relDays(r.createdAt)}
                  {r.actorEmail && <span className="block">{r.actorEmail}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        * From Admin → Activity Log. Staff impersonation, Stripe settings and case changes
        aren&apos;t shown here.
      </p>
    </section>
  );
}
