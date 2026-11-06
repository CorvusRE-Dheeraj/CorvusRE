import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarClock,
  ClipboardList,
  CreditCard,
  Inbox,
  ShieldAlert,
  TimerOff,
  UserX,
} from "lucide-react";
import { getErrorMessage } from "@/lib/error-message";
import { useLiveRefresh } from "@/lib/staff-records";
import { shortDate, supportDashboard } from "@/lib/support-console";

type Data = Awaited<ReturnType<typeof supportDashboard>>;

// Support's home: what needs attention now. Every card opens the records
// behind it.
export function SupportDashboard({
  onTickets,
  onCustomers,
  onCustomer,
  onTicket,
}: {
  onTickets: (filter: "open" | "overdue" | "urgent" | "escalated" | "unassigned") => void;
  onCustomers: (filter: "onboarding" | "payments") => void;
  onCustomer: (profileId: string) => void;
  onTicket: (ticketId: string) => void;
}) {
  const [d, setD] = useState<Data | null>(null);
  const load = useCallback(
    () =>
      supportDashboard()
        .then(setD)
        .catch((e) => toast.error(getErrorMessage(e, "Couldn't load the dashboard."))),
    [],
  );
  useEffect(() => void load(), [load]);
  useLiveRefresh(["support_tickets"], () => void load(), true);

  if (!d) return <p className="mt-6 text-sm text-muted-foreground">Loading…</p>;
  const cards: {
    label: string;
    value: number;
    hint: string;
    icon: typeof Inbox;
    tone?: string;
    onClick: () => void;
  }[] = [
    {
      label: "Open tickets",
      value: d.openTickets,
      hint: `${d.unassignedTickets} unassigned`,
      icon: Inbox,
      onClick: () => onTickets("open"),
    },
    {
      label: "Response overdue",
      value: d.overdueTickets,
      hint: "past the response deadline",
      icon: TimerOff,
      tone: d.overdueTickets ? "text-destructive" : undefined,
      onClick: () => onTickets("overdue"),
    },
    {
      label: "High / urgent",
      value: d.urgentTickets,
      hint: `${d.escalatedTickets} escalated`,
      icon: ShieldAlert,
      tone: d.urgentTickets ? "text-amber-700" : undefined,
      onClick: () => onTickets("urgent"),
    },
    {
      label: "Incomplete onboarding",
      value: d.incompleteOnboarding,
      hint: "customers with steps left",
      icon: ClipboardList,
      onClick: () => onCustomers("onboarding"),
    },
    {
      label: "Failed payments",
      value: d.failedPayments,
      hint: "customers past due",
      icon: CreditCard,
      tone: d.failedPayments ? "text-destructive" : undefined,
      onClick: () => onCustomers("payments"),
    },
    {
      label: "Deadlines in 14 days",
      value: d.upcomingDeadlines,
      hint: "protest, hearing, tax payment",
      icon: CalendarClock,
      onClick: () =>
        document.getElementById("support-deadlines")?.scrollIntoView({ behavior: "smooth" }),
    },
  ];
  return (
    <div className="mt-6 grid gap-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {cards.map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={c.onClick}
            className="card-elev p-4 text-left transition-colors hover:bg-secondary/40"
          >
            <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <c.icon className="h-3.5 w-3.5" aria-hidden /> {c.label}
            </div>
            <div className={`mt-1 text-3xl font-semibold ${c.tone ?? ""}`}>{c.value}</div>
            <div className="text-xs text-muted-foreground">{c.hint}</div>
          </button>
        ))}
      </div>

      <section className="card-elev p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden /> Priority actions
        </h2>
        {d.priorityActions.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nothing urgent right now.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border/60">
            {d.priorityActions.slice(0, 25).map((a) => (
              <li key={`${a.kind}-${a.id}`}>
                <button
                  type="button"
                  className="flex w-full flex-wrap items-center justify-between gap-2 py-2 text-left text-sm hover:bg-secondary/30"
                  onClick={() =>
                    a.kind === "ticket"
                      ? onTicket(a.id)
                      : a.profileId
                        ? onCustomer(a.profileId)
                        : undefined
                  }
                >
                  <span className="min-w-0 flex-1 truncate">{a.label}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      a.reason.startsWith("Response overdue") || a.reason === "Payment failed"
                        ? "bg-destructive/10 text-destructive"
                        : "bg-amber-100 text-amber-900"
                    }`}
                  >
                    {a.reason}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="support-deadlines" className="card-elev p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <CalendarClock className="h-4 w-4" aria-hidden /> Upcoming deadlines (14 days)
        </h2>
        {d.deadlines.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No deadlines in the next two weeks.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1.5">Date</th>
                  <th className="py-1.5">Deadline</th>
                  <th className="py-1.5">Customer</th>
                  <th className="py-1.5">Property</th>
                </tr>
              </thead>
              <tbody>
                {d.deadlines.map((x) => (
                  <tr
                    key={`${x.kind}-${x.propertyId}-${x.date}`}
                    className="cursor-pointer border-t border-border/60 hover:bg-secondary/30"
                    onClick={() => onCustomer(x.profileId)}
                  >
                    <td className="py-1.5 whitespace-nowrap">{shortDate(x.date)}</td>
                    <td className="py-1.5">{x.kind}</td>
                    <td className="py-1.5">{x.customer ?? "—"}</td>
                    <td className="py-1.5">{x.address}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {d.unassignedTickets > 0 && (
        <button
          type="button"
          onClick={() => onTickets("unassigned")}
          className="inline-flex items-center gap-1.5 text-sm text-accent underline"
        >
          <UserX className="h-4 w-4" aria-hidden /> {d.unassignedTickets} ticket
          {d.unassignedTickets === 1 ? " needs" : "s need"} an owner
        </button>
      )}
    </div>
  );
}
