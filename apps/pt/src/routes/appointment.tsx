import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarCheck, Video, Phone } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { getErrorMessage } from "@/lib/error-message";
import { slotLabel } from "@/lib/appointment-rules";
import {
  cancelMyAppointment,
  fetchOpenSlots,
  formatSlotDay,
  fromIsoLocal,
  getManagedAppointment,
  rescheduleMyAppointment,
  toIsoLocal,
  type ManagedAppointment,
  type OpenSlots,
} from "@/lib/appointments";

export const Route = createFileRoute("/appointment")({
  validateSearch: (search: Record<string, unknown>): { token?: string } => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
  head: () => ({ meta: [{ title: "Your appointment — CorvusPT" }] }),
  component: ManageAppointment,
});

// The "Reschedule or cancel" page linked from the confirmation email. The secret token
// in the link is the only credential — no sign-in. Changes follow the same rules as
// booking (2 days' notice, Mon–Fri 10 AM–2 PM Central, no holidays, no double booking).
function ManageAppointment() {
  const { token } = Route.useSearch();
  const [appt, setAppt] = useState<ManagedAppointment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "reschedule" | "cancel" | "done">("view");
  const [slots, setSlots] = useState<OpenSlots | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError(
        "This link is missing its appointment code. Use the button in your confirmation email.",
      );
      return;
    }
    getManagedAppointment(token)
      .then(setAppt)
      .catch((err) => setError(getErrorMessage(err, "We couldn't find that appointment.")));
  }, [token]);

  function startReschedule() {
    setMode("reschedule");
    setSlots(null);
    fetchOpenSlots(token)
      .then(setSlots)
      .catch((err) => toast.error(getErrorMessage(err, "Could not load available times.")));
  }

  const availableDates = useMemo(() => new Set(Object.keys(slots?.days ?? {})), [slots]);
  const times = date ? (slots?.days[date] ?? []) : [];

  async function confirmReschedule() {
    if (!token || !date || !slot) return;
    setBusy(true);
    try {
      await rescheduleMyAppointment(token, date, slot);
      setResult(`Rescheduled to ${formatSlotDay(date, slot)}. A new confirmation is on its way.`);
      setMode("done");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not reschedule."));
      setSlot(null);
      fetchOpenSlots(token)
        .then(setSlots)
        .catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  async function confirmCancel() {
    if (!token) return;
    setBusy(true);
    try {
      await cancelMyAppointment(token);
      setResult("Your appointment is cancelled. You can book a new time whenever you like.");
      setMode("done");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not cancel."));
    } finally {
      setBusy(false);
    }
  }

  const now = appt ? formatSlotDay(appt.date, appt.slot) : "";

  return (
    <div className="container-page max-w-2xl py-16">
      <span className="badge-soft">Your appointment</span>
      <h1 className="mt-3 text-3xl font-semibold md:text-4xl">Reschedule or cancel</h1>

      {error ? (
        <div className="card-elev mt-6 p-6">
          <p className="text-destructive">{error}</p>
          <Link to="/contact" className="btn-primary btn-primary-hover mt-4 inline-block">
            Book a new time
          </Link>
        </div>
      ) : !appt ? (
        <div className="mt-6 h-32 animate-pulse rounded-md bg-secondary/60" />
      ) : mode === "done" ? (
        <div className="card-elev mt-6 grid gap-3 p-6">
          <p className="font-semibold">{result}</p>
          <Link to="/contact" className="text-accent hover:underline">
            Back to Contact Us
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid gap-5">
          <div className="card-elev flex items-start gap-4 p-5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
              {appt.meetingType === "virtual" ? (
                <Video className="h-5 w-5" />
              ) : (
                <Phone className="h-5 w-5" />
              )}
            </span>
            <div>
              <div className="text-sm text-muted-foreground">
                {appt.meetingType === "virtual" ? "Google Meet" : "Phone call"} · 60 minutes
              </div>
              <div className="text-lg font-semibold">{now} CT</div>
              <div className="text-sm text-muted-foreground">for {appt.name}</div>
              {appt.status === "cancelled" && (
                <div className="mt-1 text-sm font-medium text-destructive">
                  This appointment was cancelled.
                </div>
              )}
              {appt.status === "booked" && !appt.canChange && (
                <div className="mt-1 text-sm text-muted-foreground">
                  This appointment has already happened.
                </div>
              )}
            </div>
          </div>

          {appt.canChange && mode === "view" && (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={startReschedule}
                className="btn-primary btn-primary-hover"
              >
                Reschedule
              </button>
              <button type="button" onClick={() => setMode("cancel")} className="btn-outline">
                Cancel appointment
              </button>
            </div>
          )}

          {mode === "cancel" && (
            <div className="card-elev grid gap-3 p-5">
              <p className="text-sm">Cancel your appointment on {now} CT?</p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void confirmCancel()}
                  className="btn-outline text-destructive disabled:opacity-60"
                >
                  {busy ? "Cancelling…" : "Yes, cancel it"}
                </button>
                <button
                  type="button"
                  onClick={() => setMode("view")}
                  className="text-sm hover:underline"
                >
                  Keep it
                </button>
              </div>
            </div>
          )}

          {mode === "reschedule" && (
            <div className="card-elev grid gap-4 p-5">
              <div className="grid gap-4 md:grid-cols-[auto_1fr]">
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">
                    1. Pick a new day
                  </div>
                  {slots ? (
                    <Calendar
                      mode="single"
                      selected={date ? fromIsoLocal(date) : undefined}
                      onSelect={(d) => {
                        setDate(d ? toIsoLocal(d) : null);
                        setSlot(null);
                      }}
                      disabled={(d) => !availableDates.has(toIsoLocal(d))}
                      defaultMonth={fromIsoLocal(slots.from)}
                      startMonth={fromIsoLocal(slots.from)}
                      endMonth={fromIsoLocal(slots.to)}
                      className="rounded-md border border-border"
                    />
                  ) : (
                    <div className="h-64 w-64 animate-pulse rounded-md bg-secondary/60" />
                  )}
                </div>
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">
                    2. Pick a time
                  </div>
                  {!date ? (
                    <p className="text-sm text-muted-foreground">Choose a highlighted day first.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {times.map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setSlot(t)}
                          aria-pressed={slot === t}
                          className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                            slot === t
                              ? "border-accent bg-accent/10 text-accent"
                              : "border-input hover:bg-secondary/60"
                          }`}
                        >
                          {slotLabel(t)}
                        </button>
                      ))}
                    </div>
                  )}
                  {date && slot && (
                    <p className="mt-3 text-sm font-medium">{formatSlotDay(date, slot)} CT</p>
                  )}
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    All times Central (Texas).
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={busy || !date || !slot}
                  onClick={() => void confirmReschedule()}
                  className="btn-primary btn-primary-hover disabled:opacity-60"
                >
                  {busy ? "Saving…" : "Confirm new time"}
                </button>
                <button
                  type="button"
                  onClick={() => setMode("view")}
                  className="text-sm hover:underline"
                >
                  Never mind
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      <CalendarCheck className="sr-only" aria-hidden />
    </div>
  );
}
