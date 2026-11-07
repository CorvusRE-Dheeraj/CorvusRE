import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { getErrorMessage } from "@/lib/error-message";
import {
  listSupportCustomers,
  nextOnboardingStep,
  onboardingPercent,
  shortDate,
  type SupportCustomer,
} from "@/lib/support-console";

export type CustomerFilter = "all" | "onboarding" | "payments" | "no_owner" | "mine" | "tickets";

const FILTERS: [CustomerFilter, string][] = [
  ["all", "All customers"],
  ["onboarding", "Onboarding incomplete"],
  ["payments", "Failed payment"],
  ["tickets", "Open tickets"],
  ["no_owner", "No onboarding owner"],
  ["mine", "My onboarding"],
];

// Every customer once — a Marketing lead who signed up is the same customer,
// never a second row (support_customers() joins them by account).
export function SupportCustomers({
  me,
  filter,
  setFilter,
  onOpen,
}: {
  me: string;
  filter: CustomerFilter;
  setFilter: (f: CustomerFilter) => void;
  onOpen: (profileId: string) => void;
}) {
  const [rows, setRows] = useState<SupportCustomer[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    listSupportCustomers()
      .then(setRows)
      .catch((e) => toast.error(getErrorMessage(e, "Couldn't load customers.")));
  }, []);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? [])
      .filter((c) =>
        filter === "onboarding"
          ? c.onboardingDone < c.onboardingTotal && (c.properties > 0 || !!c.handoffId)
          : filter === "payments"
            ? c.pastDue > 0
            : filter === "tickets"
              ? c.openTickets > 0
              : filter === "no_owner"
                ? !c.onboardingOwner && c.onboardingDone < c.onboardingTotal
                : filter === "mine"
                  ? c.onboardingOwner === me
                  : true,
      )
      .filter(
        (c) =>
          !needle ||
          [c.name, c.email, c.phone, c.company, ...c.ownerEntities]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(needle)),
      );
  }, [rows, q, filter, me]);

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
            aria-hidden
          />
          <input
            className="w-72 rounded-md border border-input bg-background py-2 pl-8 pr-3 text-sm"
            placeholder="Name, email, phone, company or owner entity"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search customers"
          />
        </label>
        <select
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={filter}
          onChange={(e) => setFilter(e.target.value as CustomerFilter)}
          aria-label="Filter customers"
        >
          {FILTERS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground">
          {rows ? `${list.length} of ${rows.length}` : "Loading…"}
        </span>
      </div>
      <div className="card-elev mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-secondary/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5">Customer</th>
              <th className="px-3 py-2.5">Owner entities</th>
              <th className="px-3 py-2.5">Properties</th>
              <th className="px-3 py-2.5">Subscription</th>
              <th className="px-3 py-2.5">Onboarding</th>
              <th className="px-3 py-2.5">Owner</th>
              <th className="px-3 py-2.5">Source</th>
              <th className="px-3 py-2.5">Next deadline</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => {
              const pct = onboardingPercent(c);
              const next = nextOnboardingStep(c.onboarding);
              return (
                <tr
                  key={c.profileId}
                  className="cursor-pointer border-t border-border/60 align-top hover:bg-secondary/30"
                  onClick={() => onOpen(c.profileId)}
                >
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{c.name ?? c.email ?? "Customer"}</div>
                    <div className="text-xs text-muted-foreground">
                      {[c.email, c.phone].filter(Boolean).join(" · ")}
                    </div>
                    {c.company && <div className="text-xs text-muted-foreground">{c.company}</div>}
                    {c.openTickets > 0 && (
                      <span className="mt-1 inline-block rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
                        {c.openTickets} open ticket{c.openTickets === 1 ? "" : "s"}
                      </span>
                    )}
                  </td>
                  <td className="max-w-[14rem] px-3 py-2.5 text-xs">
                    {c.ownerEntities.length ? c.ownerEntities.slice(0, 3).join(", ") : "—"}
                    {c.ownerEntities.length > 3 && ` +${c.ownerEntities.length - 3}`}
                  </td>
                  <td className="px-3 py-2.5">
                    {c.properties}
                    <div className="text-xs text-muted-foreground">{c.subscribed} subscribed</div>
                  </td>
                  <td className="px-3 py-2.5">
                    {c.pastDue > 0 ? (
                      <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
                        Payment failed
                      </span>
                    ) : c.subscribed > 0 ? (
                      <span className="text-success">Active</span>
                    ) : (
                      <span className="text-muted-foreground">Not subscribed</span>
                    )}
                  </td>
                  <td className="min-w-[10rem] px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-secondary">
                        <div
                          className={`h-full ${pct === 100 ? "bg-success" : "bg-accent"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs">
                        {c.onboardingDone}/{c.onboardingTotal}
                      </span>
                    </div>
                    {next && (
                      <div className="mt-0.5 text-xs text-muted-foreground">Next: {next.label}</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs">{c.onboardingOwnerLabel ?? "—"}</td>
                  <td className="px-3 py-2.5 text-xs">
                    {c.leadId ? `Marketing (${c.source})` : c.source}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs">
                    {shortDate(c.nextDeadline)}
                  </td>
                </tr>
              );
            })}
            {rows && list.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No customers match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
