import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  formatAppointment,
  listMyUpcomingAppointments,
  type MyAppointment,
} from "@/lib/appointments";

// "Your appointments" — the call/meeting a signed-in customer booked from Contact Us, with
// a way to reschedule or cancel right here (the same page the confirmation email links to).
// Renders nothing when there are none.
export function MyAppointments() {
  const { user } = useAuth();
  const [items, setItems] = useState<MyAppointment[]>([]);

  useEffect(() => {
    if (!user) return;
    listMyUpcomingAppointments()
      .then(setItems)
      .catch(() => {});
  }, [user]);

  if (items.length === 0) return null;
  return (
    <section className="card-elev p-4">
      <h2 className="flex items-center gap-2 font-serif text-lg font-bold">
        <CalendarCheck className="h-5 w-5 text-accent" />
        Your appointments
      </h2>
      <ul className="mt-2 grid gap-2">
        {items.map((a) => (
          <li
            key={a.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
          >
            <span>
              <strong>{formatAppointment(a.startAt)}</strong>
              <span className="text-muted-foreground"> · Google Meet · 60 min</span>
              {a.meetLink && (
                <a
                  href={a.meetLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 text-accent hover:underline"
                >
                  Join
                </a>
              )}
            </span>
            <Link
              to="/appointment"
              search={{ token: a.manageToken }}
              className="btn-outline py-1 text-xs"
            >
              Reschedule or cancel
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
