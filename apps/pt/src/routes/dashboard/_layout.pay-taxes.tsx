import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  BadgeCheck,
  CalendarClock,
  ExternalLink,
  FileText,
  Landmark,
  Receipt,
  SplitSquareHorizontal,
  Upload,
} from "lucide-react";
import { currency } from "@/lib/intake-store";
import { useAuth } from "@/lib/auth";
import { listProperties, type PropertyRecord } from "@/lib/properties";
import { listProtests, type ProtestRecord } from "@/lib/protests";
import { addTaxBill } from "@/lib/tax-bills";
import { getDocumentById, getDocumentUrl, uploadDocument } from "@/lib/documents";
import { getCadRecordUrl } from "@/lib/cad-record-url";
import { getErrorMessage } from "@/lib/error-message";
import {
  PAY_STATUS_LABEL,
  TO_CONFIRM,
  buildPayTaxesRow,
  daysBetween,
  enrollInPlan,
  listCountyTaxSettings,
  listPayTaxBills,
  listPaymentPlans,
  penaltyAndInterestPct,
  portfolioSummary,
  reportPayment,
  saveInstallments,
  type CountyTaxSettings,
  type Installment,
  type PayStatus,
  type PayTaxBill,
  type PayTaxesRow,
  type PaymentPlan,
  type PlanEligibility,
} from "@/lib/pay-taxes";
import { Skeleton } from "@/components/ui/skeleton";
import { Modal } from "@/components/Modal";
import { PageHero, heroButton } from "@/components/PageHero";

export const Route = createFileRoute("/dashboard/_layout/pay-taxes")({
  // property: the property whose details are open — in the URL so Back
  // returns to it.
  validateSearch: (search: Record<string, unknown>): { property?: string } => ({
    property: typeof search.property === "string" ? search.property : undefined,
  }),
  component: PayTaxes,
});

const todayIso = () => new Date().toISOString().slice(0, 10);

const fmtDate = (d: string | null | undefined) =>
  d
    ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

const money = (n: number | null | undefined) => (n == null ? "—" : currency(n));

const STATUS_TONE: Record<PayStatus, string> = {
  unpaid: "bg-secondary text-foreground",
  initiated: "bg-sky-100 text-sky-800",
  partial: "bg-amber-100 text-amber-900",
  paid: "bg-success/15 text-success",
  overdue: "bg-destructive/15 text-destructive",
  verifying: "bg-violet-100 text-violet-800",
};

const PROTEST_LABEL: Record<string, string> = {
  requested: "Protest requested",
  filed: "Protest filed",
  under_review: "Under review",
  offer_received: "Settlement offer received",
  hearing_scheduled: "Hearing scheduled",
  decision_received: "Decision received",
  appealing: "Appealing",
  arbitrating: "In arbitration",
  resolved: "Resolved",
};

function PayTaxes() {
  const { user } = useAuth();
  const nav = useNavigate();
  const { property: openId } = Route.useSearch();
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [bills, setBills] = useState<PayTaxBill[]>([]);
  const [plans, setPlans] = useState<PaymentPlan[]>([]);
  const [settings, setSettings] = useState<CountyTaxSettings[]>([]);
  const [protests, setProtests] = useState<ProtestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [payRow, setPayRow] = useState<PayTaxesRow | null>(null);
  const [filters, setFilters] = useState({ county: "", status: "", plan: "", year: "" });

  async function reload() {
    if (!user) return;
    const [props, b, p, s, pr] = await Promise.all([
      listProperties(user.id),
      listPayTaxBills(user.id),
      listPaymentPlans(),
      listCountyTaxSettings(),
      listProtests(user.id).catch(() => [] as ProtestRecord[]),
    ]);
    setProperties(props);
    setBills(b);
    setPlans(p);
    setSettings(s);
    setProtests(pr);
  }

  useEffect(() => {
    if (!user) return;
    reload()
      .catch((err) => toast.error(getErrorMessage(err, "Could not load your tax information.")))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const today = todayIso();
  const allRows = useMemo(
    () =>
      properties.map((property) =>
        buildPayTaxesRow({
          property,
          bills,
          plans,
          settings,
          protests,
          todayIso: today,
          taxYear: filters.year ? Number(filters.year) : undefined,
        }),
      ),
    [properties, bills, plans, settings, protests, today, filters.year],
  );
  const rows = allRows
    .filter((r) => !filters.county || r.county === filters.county)
    .filter((r) => !filters.status || r.status === filters.status)
    .filter(
      (r) =>
        !filters.plan ||
        (filters.plan === "half" && r.flags.halfPayEligible) ||
        (filters.plan === "enrolled" && r.flags.enrolled) ||
        (filters.plan === "none" && !r.flags.halfPayEligible && !r.flags.enrolled),
    )
    // what needs attention first: overdue, then by next deadline
    .sort(
      (a, b) =>
        Number(b.flags.overdue) - Number(a.flags.overdue) ||
        Number(a.status === "paid") - Number(b.status === "paid") ||
        a.dueDate.localeCompare(b.dueDate),
    );
  const summary = portfolioSummary(rows);
  const counties = [...new Set(allRows.map((r) => r.county).filter(Boolean))].sort() as string[];
  const years = [
    ...new Set([
      ...allRows.map((r) => r.taxYear),
      ...bills.map((b) => b.taxYear).filter((y): y is number => y != null),
    ]),
  ].sort((a, b) => b - a);
  const openRow = openId ? (allRows.find((r) => r.property.id === openId) ?? null) : null;

  const setOpen = (id: string | null) =>
    nav({ to: ".", search: id ? { property: id } : {}, resetScroll: false });

  return (
    <div>
      <PageHero
        icon={Landmark}
        title="Pay Taxes"
        tone="teal"
        subtitle="Every property's tax bill, deadline, payment plan and the county's own payment page — in one place."
      >
        <Link to="/intake" className={heroButton}>
          <Upload className="h-4 w-4" /> Upload Tax Bill
        </Link>
      </PageHero>

      {loading ? (
        <div className="mt-6 grid gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : properties.length === 0 ? (
        <div className="card-elev mt-6 p-8 text-center">
          <h3 className="font-serif text-xl font-semibold">No properties yet.</h3>
          <p className="mt-1 text-muted-foreground">
            Add a property and its tax bills, deadlines and payment options show up here.
          </p>
        </div>
      ) : (
        <>
          <PortfolioTiles summary={summary} />
          <HalfPayPanel summary={summary} today={today} onOpen={setOpen} />
          <Filters filters={filters} setFilters={setFilters} counties={counties} years={years} />
          <PropertyTable rows={rows} today={today} onOpen={setOpen} onPay={setPayRow} />
          <p className="mt-3 text-xs text-muted-foreground">
            CorvusPT doesn&apos;t collect tax payments. Pay Taxes opens the county&apos;s own
            payment page; nothing is marked paid until you update the status (or the county confirms
            it). Amounts marked <em>Estimate</em> are value × the county&apos;s typical tax rate —
            upload the tax statement for the official amount.
          </p>
        </>
      )}

      {payRow && <PayConfirm row={payRow} onClose={() => setPayRow(null)} />}
      {openRow && user && (
        <PropertyTaxDetail
          row={openRow}
          userId={user.id}
          today={today}
          onClose={() => setOpen(null)}
          onPay={() => setPayRow(openRow)}
          onChanged={() =>
            reload().catch((err) => toast.error(getErrorMessage(err, "Could not refresh.")))
          }
        />
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="card-elev p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-bold ${tone ?? ""}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function PortfolioTiles({ summary }: { summary: ReturnType<typeof portfolioSummary> }) {
  return (
    <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
      <Tile label="Properties" value={summary.properties} />
      <Tile
        label="Total tax"
        value={money(summary.totalTax)}
        hint={
          summary.estimatedCount > 0 ? `${summary.estimatedCount} estimated` : "From tax statements"
        }
      />
      <Tile label="Paid" value={money(summary.totalPaid)} tone="text-success" />
      <Tile label="Outstanding" value={money(summary.outstanding)} />
      <Tile
        label="Due in 30 days"
        value={summary.upcoming}
        tone={summary.upcoming > 0 ? "text-amber-700" : undefined}
      />
      <Tile
        label="Overdue"
        value={summary.overdue}
        tone={summary.overdue > 0 ? "text-destructive" : undefined}
      />
      <Tile label="New tax notices" value={summary.newNotices} hint="Last 30 days" />
      <Tile label="Half-payment eligible" value={summary.halfPayEligible} />
      <Tile label="On an installment plan" value={summary.enrolled} />
    </div>
  );
}

// "Due November 30": every property that can split its bill this year, with
// its first-half amount, and the total across them.
function HalfPayPanel({
  summary,
  today,
  onOpen,
}: {
  summary: ReturnType<typeof portfolioSummary>;
  today: string;
  onOpen: (id: string) => void;
}) {
  const { items, total, dueDates } = summary.halfPay;
  if (items.length === 0) return null;
  const due = dueDates[0];
  const days = due ? daysBetween(today, due) : null;
  return (
    <div className="card-elev mt-6 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-teal-50 px-5 py-4 dark:bg-teal-950/40">
        <div className="flex items-center gap-3">
          <SplitSquareHorizontal className="h-6 w-6 text-teal-700" />
          <div>
            <div className="font-semibold">
              Half-payment option — first half due {fmtDate(due)}
              {days != null && days >= 0 && (
                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                  {days === 0 ? "today" : `${days} days left`}
                </span>
              )}
            </div>
            <div className="text-sm text-muted-foreground">
              {items.length} propert{items.length === 1 ? "y" : "ies"} can pay 50% now and the rest
              by June 30 without penalty or interest.
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Combined first half still to pay
          </div>
          <div className="text-2xl font-bold text-teal-800 dark:text-teal-300">{money(total)}</div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-secondary/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-semibold">Property</th>
              <th className="px-4 py-2 font-semibold">County</th>
              <th className="px-4 py-2 font-semibold">Base tax</th>
              <th className="px-4 py-2 font-semibold">First half (50%)</th>
              <th className="px-4 py-2 font-semibold">Second half</th>
              <th className="px-4 py-2 font-semibold">First half status</th>
            </tr>
          </thead>
          <tbody>
            {items.map(({ row, firstHalf, paid }) => (
              <tr
                key={row.property.id}
                onClick={() => onOpen(row.property.id)}
                className="cursor-pointer border-t border-border/60 hover:bg-secondary/40"
              >
                <td className="max-w-[18rem] truncate px-4 py-2 font-medium">
                  {row.property.address}
                </td>
                <td className="px-4 py-2">{row.county}</td>
                <td className="px-4 py-2">
                  {money(row.totalTax)}
                  {row.totalTaxIsEstimate && <EstimateChip />}
                </td>
                <td className="px-4 py-2 font-semibold">{money(firstHalf.amount)}</td>
                <td className="px-4 py-2 text-muted-foreground">
                  {money(row.halfPay?.installments[1]?.amount)} by{" "}
                  {fmtDate(row.halfPay?.installments[1]?.dueDate)}
                </td>
                <td className="px-4 py-2">
                  {paid ? (
                    <span className="text-success">Paid</span>
                  ) : (
                    <span className="text-amber-800">Not paid yet</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Filters({
  filters,
  setFilters,
  counties,
  years,
}: {
  filters: { county: string; status: string; plan: string; year: string };
  setFilters: (f: { county: string; status: string; plan: string; year: string }) => void;
  counties: string[];
  years: number[];
}) {
  const sel = "rounded-md border border-input bg-background px-3 py-2 text-sm";
  return (
    <div className="mt-6 flex flex-wrap items-center gap-2">
      <select
        aria-label="County"
        className={sel}
        value={filters.county}
        onChange={(e) => setFilters({ ...filters, county: e.target.value })}
      >
        <option value="">All counties</option>
        {counties.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
      <select
        aria-label="Tax year"
        className={sel}
        value={filters.year}
        onChange={(e) => setFilters({ ...filters, year: e.target.value })}
      >
        <option value="">Current tax year</option>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
      <select
        aria-label="Payment status"
        className={sel}
        value={filters.status}
        onChange={(e) => setFilters({ ...filters, status: e.target.value })}
      >
        <option value="">Any status</option>
        {(Object.keys(PAY_STATUS_LABEL) as PayStatus[]).map((s) => (
          <option key={s} value={s}>
            {PAY_STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      <select
        aria-label="Payment plan"
        className={sel}
        value={filters.plan}
        onChange={(e) => setFilters({ ...filters, plan: e.target.value })}
      >
        <option value="">Any payment plan</option>
        <option value="half">Half-payment eligible</option>
        <option value="enrolled">On an installment plan</option>
        <option value="none">No plan</option>
      </select>
      {(filters.county || filters.status || filters.plan || filters.year) && (
        <button
          type="button"
          className="text-sm text-accent underline underline-offset-2"
          onClick={() => setFilters({ county: "", status: "", plan: "", year: "" })}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

function EstimateChip() {
  return (
    <span
      className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900"
      title="No tax statement on file — value × the county's typical rate"
    >
      Estimate
    </span>
  );
}

function StatusChip({ row }: { row: PayTaxesRow }) {
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span
        className={`w-fit whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[row.status]}`}
      >
        {PAY_STATUS_LABEL[row.status]}
      </span>
      {row.bill?.status && (
        <span className="text-[11px] text-muted-foreground">
          {row.verified ? "Verified with county" : "Reported by you"}
        </span>
      )}
    </span>
  );
}

function DeadlineCell({ row, today }: { row: PayTaxesRow; today: string }) {
  const days = daysBetween(today, row.dueDate);
  return (
    <div>
      <div className="whitespace-nowrap">{fmtDate(row.dueDate)}</div>
      <div
        className={`text-xs ${
          row.status === "paid"
            ? "text-muted-foreground"
            : days < 0
              ? "text-destructive"
              : days <= 30
                ? "font-semibold text-amber-800"
                : "text-muted-foreground"
        }`}
      >
        {row.status === "paid"
          ? row.nextInstallment
            ? row.nextInstallment.label
            : "—"
          : days < 0
            ? `${-days} days late`
            : days === 0
              ? "Due today"
              : `${days} days left`}
        {row.nextInstallment && row.status !== "paid" ? ` · ${row.nextInstallment.label}` : ""}
        {row.dueDateIsStandard ? " · standard deadline" : ""}
      </div>
    </div>
  );
}

function PlanCell({ row }: { row: PayTaxesRow }) {
  // short labels — the full plan details are in View Details
  const short = (p: PlanEligibility) => p.plan.name.replace(/ Plan\b.*$/, "");
  if (row.enrolledPlan)
    return (
      <span className="text-sm font-medium text-teal-800">Using {short(row.enrolledPlan)}</span>
    );
  const eligible = row.plans.filter((p) => p.status === "eligible");
  const toConfirm = row.plans.filter((p) => p.status === "to_confirm");
  if (eligible.length > 0)
    return (
      <span className="text-sm font-medium text-success">✓ {eligible.map(short).join(", ")}</span>
    );
  if (toConfirm.length > 0)
    return (
      <span className="text-xs text-muted-foreground" title={TO_CONFIRM}>
        To confirm with county
      </span>
    );
  return <span className="text-xs text-muted-foreground">None on file</span>;
}

function HistoryBars({ row }: { row: PayTaxesRow }) {
  const pts = [...row.history]
    .filter((b) => b.taxYear != null && b.amountDue != null)
    .sort((a, b) => (a.taxYear ?? 0) - (b.taxYear ?? 0));
  if (pts.length === 0) return <span className="text-xs text-muted-foreground">No bills yet</span>;
  const max = Math.max(...pts.map((b) => b.amountDue as number));
  return (
    <div
      className="flex h-8 items-end gap-1"
      title={pts.map((b) => `${b.taxYear}: ${currency(b.amountDue as number)}`).join("\n")}
    >
      {pts.map((b) => (
        <div key={b.id} className="flex flex-col items-center">
          <div
            className="w-3 rounded-t bg-teal-600"
            style={{ height: `${Math.max(3, ((b.amountDue as number) / max) * 24)}px` }}
          />
          <div className="text-[10px] leading-none text-muted-foreground">
            {String(b.taxYear).slice(2)}
          </div>
        </div>
      ))}
    </div>
  );
}

function Flags({ row }: { row: PayTaxesRow }) {
  const f: { label: string; tone: string }[] = [];
  if (row.flags.overdue) f.push({ label: "Overdue", tone: "bg-destructive/15 text-destructive" });
  else if (row.flags.upcoming) f.push({ label: "Due soon", tone: "bg-amber-100 text-amber-900" });
  if (row.flags.newNotice) f.push({ label: "New notice", tone: "bg-sky-100 text-sky-800" });
  if (row.flags.halfPayEligible && !row.flags.enrolled)
    f.push({ label: "Half-pay eligible", tone: "bg-teal-100 text-teal-800" });
  if (f.length === 0) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {f.map((x) => (
        <span
          key={x.label}
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${x.tone}`}
        >
          {x.label}
        </span>
      ))}
    </span>
  );
}

function PropertyTable({
  rows,
  today,
  onOpen,
  onPay,
}: {
  rows: PayTaxesRow[];
  today: string;
  onOpen: (id: string) => void;
  onPay: (row: PayTaxesRow) => void;
}) {
  if (rows.length === 0)
    return (
      <div className="card-elev mt-4 p-6 text-center text-muted-foreground">
        No properties match these filters.
      </div>
    );
  return (
    <div className="card-elev mt-4 overflow-x-auto">
      <table className="w-full min-w-[1000px] text-left text-sm">
        <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2.5 font-semibold">Property</th>
            <th className="px-3 py-2.5 font-semibold">County / Account</th>
            <th className="px-3 py-2.5 font-semibold">Tax year</th>
            <th className="px-3 py-2.5 font-semibold">5-yr history</th>
            <th className="px-3 py-2.5 font-semibold">Total tax</th>
            <th className="px-3 py-2.5 font-semibold">Deadline</th>
            <th className="px-3 py-2.5 font-semibold">Status</th>
            <th className="px-3 py-2.5 font-semibold">Tax notice</th>
            <th className="px-3 py-2.5 font-semibold">Payment plan</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.property.id} className="border-t border-border/60 align-top">
              <td className="max-w-[14rem] px-3 py-3">
                <div className="truncate font-medium">{row.property.address}</div>
                <Flags row={row} />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => onPay(row)}
                    disabled={!row.link}
                    className="btn-accent whitespace-nowrap text-xs disabled:opacity-50"
                  >
                    Pay Taxes
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpen(row.property.id)}
                    className="btn-outline whitespace-nowrap text-xs"
                  >
                    View Details
                  </button>
                </div>
              </td>
              <td className="px-3 py-3">
                <div>{row.county ?? "—"}</div>
                <div className="text-xs text-muted-foreground">
                  {row.property.accountNumber ?? "No account #"}
                </div>
              </td>
              <td className="px-3 py-3">{row.taxYear}</td>
              <td className="px-3 py-3">
                <HistoryBars row={row} />
              </td>
              <td className="whitespace-nowrap px-3 py-3 font-semibold">
                {money(row.totalTax)}
                {row.totalTaxIsEstimate && row.totalTax != null && <EstimateChip />}
                {row.amountPaid > 0 && row.status !== "paid" && (
                  <div className="text-xs font-normal text-muted-foreground">
                    {money(row.outstanding)} left
                  </div>
                )}
              </td>
              <td className="px-3 py-3">
                <DeadlineCell row={row} today={today} />
              </td>
              <td className="px-3 py-3">
                <StatusChip row={row} />
              </td>
              <td className="px-3 py-3 text-xs">
                {row.noticeAvailable ? (
                  <span className="font-medium text-success">
                    Available{row.noticeIsNew ? " · new" : ""}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Not on file</span>
                )}
              </td>
              <td className="max-w-[10rem] px-3 py-3">
                <PlanCell row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Shows what's owed and by when before leaving for the county's site. The
// click is never recorded as a payment.
function PayConfirm({ row, onClose }: { row: PayTaxesRow; onClose: () => void }) {
  const link = row.link;
  const amount = row.nextInstallment?.amount ?? row.outstanding;
  return (
    <Modal onClose={onClose}>
      <h3 className="font-serif text-xl font-semibold">Pay at the county tax office</h3>
      <p className="mt-1 text-sm text-muted-foreground">{row.property.address}</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {row.nextInstallment ? row.nextInstallment.label : "Amount outstanding"}
          </div>
          <div className="text-xl font-bold">
            {money(amount)}
            {row.totalTaxIsEstimate && <EstimateChip />}
          </div>
        </div>
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Pay by</div>
          <div className="text-xl font-bold">{fmtDate(row.dueDate)}</div>
        </div>
      </div>
      {row.halfPay?.status === "eligible" && !row.enrolledPlan && (
        <p className="mt-3 rounded-lg bg-teal-50 p-3 text-sm text-teal-900 dark:bg-teal-950/40 dark:text-teal-200">
          {row.county} offers a half-payment plan: pay{" "}
          <strong>{money(row.halfPay.installments[0]?.amount)}</strong> by{" "}
          {fmtDate(row.halfPay.installments[0]?.dueDate)} and the rest by{" "}
          {fmtDate(row.halfPay.installments[1]?.dueDate)}.
        </p>
      )}
      <p className="mt-3 text-sm text-muted-foreground">
        {link?.kind === "account"
          ? "This opens your own tax account on the county's site."
          : `This opens the county's payment page — search for account ${
              row.property.accountNumber ?? "(your account number)"
            } there.`}{" "}
        CorvusPT doesn&apos;t take the payment or mark it paid — update the status here once
        you&apos;ve paid.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="btn-outline text-sm">
          Cancel
        </button>
        {link && (
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
            className="btn-accent inline-flex items-center gap-1.5 text-sm"
          >
            Open {link.label} <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </div>
    </Modal>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-5">
      <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </h4>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg bg-secondary/40 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-semibold">{children}</div>
    </div>
  );
}

function PropertyTaxDetail({
  row,
  userId,
  today,
  onClose,
  onPay,
  onChanged,
}: {
  row: PayTaxesRow;
  userId: string;
  today: string;
  onClose: () => void;
  onPay: () => void;
  onChanged: () => void;
}) {
  const { property, bill } = row;
  const cadUrl = property.cad
    ? getCadRecordUrl({ cad: property.cad, accountNumber: property.accountNumber ?? "" })
    : null;
  const [busy, setBusy] = useState(false);

  async function openDocument(id: string | null | undefined) {
    if (!id) return;
    try {
      const doc = await getDocumentById(userId, id);
      if (!doc) throw new Error("Document not found.");
      window.open(await getDocumentUrl(doc.storagePath), "_blank", "noopener");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not open the document."));
    }
  }

  async function enroll(p: PlanEligibility | null) {
    if (!bill) return;
    setBusy(true);
    try {
      await enrollInPlan(bill.id, p);
      toast.success(p ? `Tracking ${p.plan.name} installments.` : "Plan removed.");
      onChanged();
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save."));
    } finally {
      setBusy(false);
    }
  }

  const unpaid = row.status !== "paid" && (row.outstanding ?? 0) > 0;
  const lateMonths = Math.max(0, Math.ceil(daysBetween(row.delinquency, today) / 30.4));

  return (
    <Modal onClose={onClose} wide>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-xl font-semibold">{property.address}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {row.county ?? "Unknown county"} County · Account {property.accountNumber ?? "—"} · Tax
            year {row.taxYear}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onPay} disabled={!row.link} className="btn-accent text-sm">
            Pay Taxes
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {cadUrl && (
          <a
            href={cadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-accent underline underline-offset-2"
          >
            CAD property record <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        {row.link && (
          <a
            href={row.link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-accent underline underline-offset-2"
          >
            {row.link.label} <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Fact label="Total tax">
          {money(row.totalTax)}
          {row.totalTaxIsEstimate && row.totalTax != null && <EstimateChip />}
        </Fact>
        <Fact label="Paid">{money(row.amountPaid)}</Fact>
        <Fact label="Outstanding">{row.status === "paid" ? money(0) : money(row.outstanding)}</Fact>
        <Fact label="Status">
          <StatusChip row={row} />
        </Fact>
        <Fact label="Taxable value">{money(bill?.taxableValue ?? null)}</Fact>
        <Fact
          label={row.nextInstallment ? `Next: ${row.nextInstallment.label}` : "Payment deadline"}
        >
          {fmtDate(row.dueDate)}
        </Fact>
        <Fact label="Delinquent from">{fmtDate(row.delinquency)}</Fact>
        <Fact label="Tax notice">{row.noticeAvailable ? "On file" : "Not on file"}</Fact>
      </div>

      <Section title="Latest tax statement (the bill)" icon={<Receipt className="h-4 w-4" />}>
        {bill ? (
          <div className="rounded-lg border border-border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-semibold">
                  {bill.billKind === "revised" ? "Revised tax statement" : "Tax statement"}{" "}
                  {bill.taxYear ?? ""}
                </span>
                <span className="text-muted-foreground">
                  {" "}
                  · {money(bill.amountDue)} · due {fmtDate(bill.dueDate)}
                  {bill.noticeIssuedAt ? ` · issued ${fmtDate(bill.noticeIssuedAt)}` : ""}
                </span>
              </div>
              {bill.sourceDocumentId && (
                <button
                  type="button"
                  onClick={() => openDocument(bill.sourceDocumentId)}
                  className="inline-flex items-center gap-1 text-accent underline underline-offset-2"
                >
                  <FileText className="h-4 w-4" /> View / download
                </button>
              )}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Source:{" "}
              {bill.source === "county" && bill.sourceUrl ? (
                <a
                  href={bill.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  county tax office
                </a>
              ) : bill.sourceDocumentId ? (
                "tax statement you uploaded"
              ) : (
                "entered by you"
              )}
              {` · last updated ${fmtDate((bill.retrievedAt ?? bill.updatedAt ?? bill.createdAt) as string)}`}
            </div>
            {(bill.authorityBreakdown ?? []).length > 0 && (
              <table className="mt-3 w-full text-left text-sm">
                <thead className="text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-1">Taxing authority</th>
                    <th className="py-1">Rate</th>
                    <th className="py-1 text-right">Tax</th>
                  </tr>
                </thead>
                <tbody>
                  {bill.authorityBreakdown!.map((a) => (
                    <tr key={a.name} className="border-t border-border/60">
                      <td className="py-1">{a.name}</td>
                      <td className="py-1">{a.rate != null ? `${a.rate}` : "—"}</td>
                      <td className="py-1 text-right">{money(a.amount ?? null)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <AddBillForm
            propertyId={property.id}
            userId={userId}
            taxYear={row.taxYear}
            onSaved={onChanged}
          />
        )}
      </Section>

      <Section title="CAD appraisal notice (not a bill)" icon={<Landmark className="h-4 w-4" />}>
        <p className="text-sm text-muted-foreground">
          The appraisal district sets the value; the county tax office sends the bill.{" "}
          {property.totalValue != null && (
            <>
              Appraised value on file:{" "}
              <strong className="text-foreground">{money(property.totalValue)}</strong>
              {property.valueYear ? ` (${property.valueYear})` : ""}.{" "}
            </>
          )}
          {cadUrl && (
            <a
              href={cadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline underline-offset-2"
            >
              See the appraisal notice on the CAD site
            </a>
          )}
        </p>
      </Section>

      <Section title="Payment plans" icon={<SplitSquareHorizontal className="h-4 w-4" />}>
        {row.plans.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No payment plans on file for {row.county ?? "this county"}. {TO_CONFIRM}.
          </p>
        ) : (
          <div className="grid gap-2">
            {row.plans.map((p) => (
              <PlanCard
                key={p.plan.planKey + p.plan.county}
                p={p}
                enrolled={row.enrolledPlan?.plan.planKey === p.plan.planKey}
                canEnroll={!!bill && !busy}
                onEnroll={() => enroll(p)}
                onUnenroll={() => enroll(null)}
              />
            ))}
          </div>
        )}
        {row.enrolledPlan && bill && (
          <InstallmentTracker
            bill={bill}
            installments={row.enrolledPlan.installments}
            today={today}
            onChanged={onChanged}
          />
        )}
      </Section>

      {unpaid && (
        <Section title="If it isn't paid on time" icon={<AlertTriangle className="h-4 w-4" />}>
          <p className="text-sm text-muted-foreground">
            Unpaid tax becomes delinquent on {fmtDate(row.delinquency)}. Penalty and interest (Tax
            Code §33.01) on {money(row.outstanding)}:
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {[1, 2, 3, 4, 5, 6].map((m) => (
              <div
                key={m}
                className={`rounded-lg p-2 text-center text-xs ${m === lateMonths ? "bg-destructive/15" : "bg-secondary/40"}`}
              >
                <div className="text-muted-foreground">
                  {["Feb", "Mar", "Apr", "May", "Jun", "Jul"][m - 1]}
                </div>
                <div className="font-semibold">{penaltyAndInterestPct(m)}%</div>
                <div>
                  {money(Math.round(((row.outstanding ?? 0) * penaltyAndInterestPct(m)) / 100))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            From July 1 a collection-attorney fee of up to 20% may also be added.
          </p>
        </Section>
      )}

      {bill && (
        <Section title="Update payment status" icon={<BadgeCheck className="h-4 w-4" />}>
          <StatusForm bill={bill} propertyId={property.id} userId={userId} onSaved={onChanged} />
        </Section>
      )}

      <Section title="Protest" icon={<CalendarClock className="h-4 w-4" />}>
        {row.protest ? (
          <div className="text-sm">
            <span className="font-medium">
              {PROTEST_LABEL[row.protest.status] ?? row.protest.status}
            </span>
            {row.protest.originalValue != null && (
              <span className="text-muted-foreground">
                {" "}
                · value protested {money(row.protest.originalValue)}
              </span>
            )}
            {row.protest.finalValue != null && (
              <span className="text-muted-foreground">
                {" "}
                · final value {money(row.protest.finalValue)}
              </span>
            )}
            <p className="mt-1 text-muted-foreground">
              {row.bill?.billKind === "revised"
                ? "A revised tax statement is on file and replaces the original amount."
                : "The amount here changes only when the county issues a revised tax statement — not on a proposed settlement."}{" "}
              A pending protest doesn&apos;t change or suspend the payment deadline; confirm any
              special arrangement with the county tax office.
            </p>
            <Link
              to="/dashboard/case"
              search={{ propertyId: property.id }}
              className="mt-1 inline-block text-accent underline underline-offset-2"
            >
              View case
            </Link>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No protest filed for this property.</p>
        )}
      </Section>

      <Section title="Payment history" icon={<Receipt className="h-4 w-4" />}>
        {row.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tax bills on file yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-1.5">Tax year</th>
                  <th className="py-1.5">Tax</th>
                  <th className="py-1.5">Paid</th>
                  <th className="py-1.5">Outstanding</th>
                  <th className="py-1.5">Payment date</th>
                  <th className="py-1.5">Plan</th>
                  <th className="py-1.5">Status</th>
                  <th className="py-1.5">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {row.history.map((b) => {
                  const st =
                    b.status === "paid" || b.paidAt
                      ? "Paid"
                      : b.status
                        ? PAY_STATUS_LABEL[b.status]
                        : "Unpaid";
                  return (
                    <tr key={b.id} className="border-t border-border/60">
                      <td className="py-1.5">{b.taxYear ?? "—"}</td>
                      <td className="py-1.5">{money(b.amountDue)}</td>
                      <td className="py-1.5">{money(b.amountPaid)}</td>
                      <td className="py-1.5">
                        {b.amountDue != null
                          ? money(Math.max(0, b.amountDue - (b.amountPaid ?? 0)))
                          : "—"}
                      </td>
                      <td className="py-1.5">{fmtDate(b.paidAt)}</td>
                      <td className="py-1.5">{b.planKey ? b.planKey.replace(/_/g, " ") : "—"}</td>
                      <td className="py-1.5">
                        {st}
                        {b.status && (
                          <span className="block text-[11px] text-muted-foreground">
                            {b.statusSource === "county" && b.verifiedAt ? "verified" : "reported"}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5">
                        {b.receiptDocumentId ? (
                          <button
                            type="button"
                            onClick={() => openDocument(b.receiptDocumentId)}
                            className="text-accent underline underline-offset-2"
                          >
                            View
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </Modal>
  );
}

function PlanCard({
  p,
  enrolled,
  canEnroll,
  onEnroll,
  onUnenroll,
}: {
  p: PlanEligibility;
  enrolled: boolean;
  canEnroll: boolean;
  onEnroll: () => void;
  onUnenroll: () => void;
}) {
  const tone =
    p.status === "eligible"
      ? "bg-success/15 text-success"
      : p.status === "to_confirm"
        ? "bg-amber-100 text-amber-900"
        : "bg-secondary text-muted-foreground";
  const label =
    p.status === "eligible"
      ? "Eligible"
      : p.status === "to_confirm"
        ? "To be confirmed"
        : "Not eligible";
  return (
    <div className="rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{p.plan.name}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{label}</span>
          {enrolled && (
            <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-800">
              Using this plan
            </span>
          )}
        </div>
        {p.status === "eligible" &&
          (enrolled ? (
            <button
              type="button"
              onClick={onUnenroll}
              className="text-xs text-muted-foreground underline"
            >
              Stop tracking this plan
            </button>
          ) : (
            <button
              type="button"
              onClick={onEnroll}
              disabled={!canEnroll}
              title={canEnroll ? undefined : "Add the tax statement first"}
              className="btn-outline text-xs disabled:opacity-50"
            >
              I&apos;m using this plan
            </button>
          ))}
      </div>
      <p className="mt-1 text-muted-foreground">{p.reason}</p>
      {p.status !== "not_eligible" && p.installments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {p.installments.map((i) => (
            <span key={i.label} className="rounded-md bg-secondary/50 px-2 py-1 text-xs">
              {i.label}: <strong>{money(i.amount)}</strong> by {fmtDate(i.dueDate)}
            </span>
          ))}
        </div>
      )}
      {p.plan.sourceUrl && (
        <a
          href={p.plan.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-xs text-accent underline underline-offset-2"
        >
          Source
        </a>
      )}
    </div>
  );
}

function InstallmentTracker({
  bill,
  installments,
  today,
  onChanged,
}: {
  bill: PayTaxBill;
  installments: Installment[];
  today: string;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  // shown ticked straight away; the reload after the save confirms it
  const [shown, setShown] = useState(installments);
  const saved = JSON.stringify(installments);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setShown(installments), [saved]);
  async function toggle(idx: number, paid: boolean) {
    const next = shown.map((i, j) =>
      j === idx ? { ...i, paidAt: paid ? today : null, amountPaid: paid ? i.amount : null } : i,
    );
    setShown(next);
    setSaving(true);
    try {
      await saveInstallments(bill.id, next);
      onChanged();
    } catch (err) {
      setShown(installments);
      toast.error(getErrorMessage(err, "Could not save."));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-secondary/50 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Installment</th>
            <th className="px-3 py-2">Due</th>
            <th className="px-3 py-2">Amount</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Paid</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((i, idx) => {
            const late = !i.paidAt && i.dueDate < today;
            return (
              <tr key={i.label} className="border-t border-border/60">
                <td className="px-3 py-2 font-medium">{i.label}</td>
                <td className="px-3 py-2">{fmtDate(i.dueDate)}</td>
                <td className="px-3 py-2">{money(i.amount)}</td>
                <td className="px-3 py-2">
                  {i.paidAt ? (
                    <span className="text-success">Paid {fmtDate(i.paidAt)} (reported)</span>
                  ) : late ? (
                    <span className="text-destructive">Overdue</span>
                  ) : (
                    <span className="text-muted-foreground">
                      {daysBetween(today, i.dueDate)} days left
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={!!i.paidAt}
                    disabled={saving}
                    onChange={(e) => toggle(idx, e.target.checked)}
                    aria-label={`${i.label} paid`}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatusForm({
  bill,
  propertyId,
  userId,
  onSaved,
}: {
  bill: PayTaxBill;
  propertyId: string;
  userId: string;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<PayStatus>(bill.status ?? "unpaid");
  const [amount, setAmount] = useState(bill.amountPaid != null ? String(bill.amountPaid) : "");
  const [date, setDate] = useState(bill.paidAt ? bill.paidAt.slice(0, 10) : "");
  const [confirmation, setConfirmation] = useState(bill.paymentConfirmation ?? "");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      let receiptDocumentId: string | undefined;
      const file = fileRef.current?.files?.[0];
      if (file) {
        const doc = await uploadDocument(userId, propertyId, file, "Tax Payment Receipt");
        receiptDocumentId = doc.id;
      }
      await reportPayment(bill.id, {
        status,
        amountPaid: amount ? Number(amount) : null,
        paidAt:
          status === "paid"
            ? new Date(date || todayIso()).toISOString()
            : date
              ? new Date(date).toISOString()
              : null,
        confirmation: confirmation.trim() || null,
        ...(receiptDocumentId ? { receiptDocumentId } : {}),
      });
      toast.success("Payment status saved.");
      onSaved();
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save the payment status."));
    } finally {
      setSaving(false);
    }
  }

  const input = "rounded-md border border-input bg-background px-3 py-2 text-sm";
  return (
    <form
      onSubmit={submit}
      className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2"
    >
      <label className="grid gap-1 text-sm">
        Status
        <select
          className={input}
          value={status}
          onChange={(e) => setStatus(e.target.value as PayStatus)}
        >
          {(["unpaid", "initiated", "partial", "paid", "verifying"] as PayStatus[]).map((s) => (
            <option key={s} value={s}>
              {PAY_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        Amount paid
        <input
          className={input}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm">
        Payment date
        <input
          className={input}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm">
        Confirmation number
        <input
          className={input}
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm sm:col-span-2">
        Upload Payment Receipt (optional)
        <input ref={fileRef} type="file" accept=".pdf,image/*" className="text-sm" />
      </label>
      <p className="text-xs text-muted-foreground sm:col-span-2">
        This is recorded as reported by you. &quot;Overdue&quot; is set automatically from the
        deadline; a payment shows as verified only once the county confirms it.
      </p>
      <button
        type="submit"
        disabled={saving}
        className="btn-accent w-fit text-sm disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save status"}
      </button>
    </form>
  );
}

function AddBillForm({
  propertyId,
  userId,
  taxYear,
  onSaved,
}: {
  propertyId: string;
  userId: string;
  taxYear: number;
  onSaved: () => void;
}) {
  const [year, setYear] = useState(String(taxYear));
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await addTaxBill(userId, propertyId, {
        taxYear: Number(year),
        amountDue: amount ? Number(amount) : undefined,
        dueDate: due || undefined,
      });
      toast.success("Tax bill added.");
      onSaved();
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not add the tax bill."));
    } finally {
      setSaving(false);
    }
  }
  const input = "rounded-md border border-input bg-background px-3 py-2 text-sm";
  return (
    <div className="rounded-lg border border-dashed border-border p-3 text-sm">
      <p className="text-muted-foreground">
        No tax statement on file for {taxYear} yet — the amount shown is an estimate.{" "}
        <Link to="/intake" className="text-accent underline underline-offset-2">
          Upload the tax bill
        </Link>{" "}
        (AI reads the amount and deadline; you review it before it&apos;s saved), or enter it:
      </p>
      <form onSubmit={submit} className="mt-2 flex flex-wrap items-end gap-2">
        <input
          className={`${input} w-24`}
          value={year}
          onChange={(e) => setYear(e.target.value)}
          aria-label="Tax year"
          inputMode="numeric"
        />
        <input
          className={`${input} w-40`}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Total tax"
          aria-label="Total tax"
          inputMode="decimal"
          required
        />
        <input
          className={input}
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          aria-label="Due date"
        />
        <button type="submit" disabled={saving} className="btn-outline text-sm">
          {saving ? "Saving…" : "Add tax bill"}
        </button>
      </form>
    </div>
  );
}
