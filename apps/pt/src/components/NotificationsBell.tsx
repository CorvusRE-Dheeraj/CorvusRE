import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/lib/auth";
import { listProperties } from "@/lib/properties";
import { listProtests } from "@/lib/protests";
import { listReminders } from "@/lib/reminders";

type Item = { key: string; text: string; when: string; to: string; days: number };

const DAY = 86_400_000;
const daysUntil = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / DAY);
const whenLabel = (d: number) =>
  d < 0 ? "Overdue" : d === 0 ? "Today" : d === 1 ? "Tomorrow" : `In ${d} days`;

// A bell that gathers what needs attention soon — protest deadlines, hearings and your
// reminders — from data the app already loads. Read-only; nothing is stored or sent.
export function NotificationsBell() {
  const { user } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [props, protests, reminders] = await Promise.all([
          listProperties(user.id),
          listProtests(user.id),
          listReminders(user.id),
        ]);
        if (cancelled) return;
        const out: Item[] = [];
        for (const p of props) {
          if (!p.protestDeadline) continue;
          const d = daysUntil(p.protestDeadline);
          if (d >= 0 && d <= 14)
            out.push({
              key: `dl-${p.id}`,
              text: `Protest deadline for ${p.address}`,
              when: whenLabel(d),
              to: "/dashboard/deadlines",
              days: d,
            });
        }
        for (const pr of protests) {
          if (pr.status !== "hearing_scheduled" || !pr.hearingDate) continue;
          const d = daysUntil(pr.hearingDate);
          const addr = props.find((p) => p.id === pr.propertyId)?.address ?? "your property";
          if (d >= 0 && d <= 14)
            out.push({
              key: `hr-${pr.id}`,
              text: `Hearing for ${addr}`,
              when: whenLabel(d),
              to: "/dashboard/deadlines",
              days: d,
            });
        }
        for (const r of reminders) {
          if (r.done) continue;
          const d = daysUntil(r.remindOn);
          if (d <= 7)
            out.push({
              key: `rm-${r.id}`,
              text: r.note,
              when: whenLabel(d),
              to: "/dashboard/calendar",
              days: d,
            });
        }
        setItems(out.sort((a, b) => a.days - b.days));
      } catch {
        // the bell is a convenience — stay quiet if data can't load
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            items.length ? `Notifications, ${items.length} need attention` : "Notifications"
          }
          title="Notifications"
          className="relative grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-all hover:bg-secondary hover:text-foreground"
        >
          <Bell className="h-[18px] w-[18px]" />
          {items.length > 0 && (
            <span className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-700 px-1 text-[10px] font-bold text-white">
              {items.length}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[80vh] w-80 overflow-y-auto p-0">
        <div className="border-b border-border p-3 font-serif text-base font-semibold">
          Coming up
        </div>
        {items.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            You're all caught up. Nothing is due in the next two weeks.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((it) => (
              <li key={it.key}>
                <Link
                  to={it.to}
                  onClick={() => setOpen(false)}
                  className="block p-3 text-sm hover:bg-secondary"
                >
                  <div className="font-medium">{it.text}</div>
                  <div
                    className={`text-xs ${it.days <= 3 ? "font-semibold text-destructive" : "text-muted-foreground"}`}
                  >
                    {it.when}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
