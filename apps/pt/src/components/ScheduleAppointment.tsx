import { FieldError, emailError, requiredError, useTouched } from "@/components/FieldError";
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { CalendarCheck, Video } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { getMyProfile } from "@/lib/profile";
import { getErrorMessage } from "@/lib/error-message";
import { slotLabel } from "@/lib/appointment-rules";
import {
  bookAppointment,
  fetchOpenSlots,
  formatSlotDay,
  fromIsoLocal,
  formatAppointment,
  listMyUpcomingAppointments,
  type MyAppointment,
  toIsoLocal,
  type MeetingType,
  type OpenSlots,
} from "@/lib/appointments";

// The "Schedule a Call or Virtual Meeting" card on the Contact page and its booking
// dialog: pick a day on the calendar (only days with an open slot are selectable),
// pick a time, tell us who you are, done. What's open is decided server-side
// (appointment-slots) — 60-minute visits, Mon–Fri 10 AM–2 PM Central, 2 days' notice,
// no holidays, no double booking.
export function ScheduleAppointment({
  trigger = "card",
  buttonLabel = "Schedule",
}: {
  // "card": the Contact page's full card. "button": just a button, for use inside
  // another section (e.g. the Texas Tax Updates call to action).
  trigger?: "card" | "button";
  buttonLabel?: string;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [slots, setSlots] = useState<OpenSlots | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const nameT = useTouched();
  const emailT = useTouched();
  const [slot, setSlot] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  // Every appointment is a Google Meet (a link is created for each booking).
  const meetingType: MeetingType = "virtual";
  const [meetLink, setMeetLink] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  // One appointment at a time: a signed-in customer who already has one coming up sees it
  // (with Reschedule) instead of the booking button. It frees up once the appointment is over.
  const [mine, setMine] = useState<MyAppointment | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<{ when: string; emailed: boolean } | null>(null);

  function loadSlots() {
    setLoadError(null);
    fetchOpenSlots()
      .then(setSlots)
      .catch((err) => setLoadError(getErrorMessage(err, "Could not load available times.")));
  }

  // Load when the dialog opens (fresh every time, so taken slots don't linger).
  useEffect(() => {
    if (!open) return;
    setSlots(null);
    loadSlots();
  }, [open]);

  useEffect(() => {
    if (!user) {
      setMine(null);
      return;
    }
    listMyUpcomingAppointments()
      .then((list) => setMine(list[0] ?? null))
      .catch(() => {});
  }, [user, booked]);

  // Signed-in visitors: pre-fill what we already know.
  useEffect(() => {
    if (!user) return;
    getMyProfile(user.id)
      .then((p) => {
        setName((n) => n || [p.firstName, p.lastName].filter(Boolean).join(" ").trim());
        setEmail((e) => e || p.email || user.email || "");
        setPhone((ph) => ph || p.phone || "");
      })
      .catch(() => {});
  }, [user]);

  const availableDates = useMemo(() => new Set(Object.keys(slots?.days ?? {})), [slots]);
  const times = date ? (slots?.days[date] ?? []) : [];

  function reset() {
    setDate(null);
    setSlot(null);
    setNotes("");
    setError(null);
    setBooked(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!date || !slot) return;
    setError(null);
    setSaving(true);
    try {
      const res = await bookAppointment({
        name,
        email,
        phone,
        meetingType,
        notes,
        date,
        slot,
        website,
      });
      setBooked({ when: formatSlotDay(date, slot), emailed: !!res.emailed });
      setMeetLink(res.meetLink ?? null);
      toast.success("Appointment booked.");
    } catch (err) {
      const message = getErrorMessage(err, "Could not book that time. Please try again.");
      setError(message);
      // A taken slot changed the picture — refresh what's open.
      setSlot(null);
      loadSlots();
    } finally {
      setSaving(false);
    }
  }

  const input = "rounded-md border border-input bg-background px-3 py-2 text-sm";

  return (
    <>
      {mine ? (
        trigger === "button" ? (
          <div className="flex flex-wrap items-center gap-3 text-sm text-white">
            <span>
              Your appointment: <strong>{formatAppointment(mine.startAt)}</strong>
            </span>
            <Link
              to="/appointment"
              search={{ token: mine.manageToken }}
              className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-emerald-800"
            >
              Reschedule or cancel
            </Link>
          </div>
        ) : (
          <div className="card-elev mb-8 flex flex-wrap items-center justify-between gap-4 p-6">
            <div className="flex items-center gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                <CalendarCheck className="h-5 w-5" />
              </span>
              <div>
                <h2 className="font-semibold">You have an appointment coming up</h2>
                <p className="text-sm text-muted-foreground">
                  {formatAppointment(mine.startAt)} · Google Meet. You can book another once this
                  one is finished.
                </p>
              </div>
            </div>
            <Link
              to="/appointment"
              search={{ token: mine.manageToken }}
              className="btn-primary btn-primary-hover shrink-0"
            >
              Reschedule or cancel
            </Link>
          </div>
        )
      ) : trigger === "button" ? (
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(true);
          }}
          className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-emerald-800 shadow-sm transition-transform hover:scale-[1.03]"
        >
          <Video className="h-4 w-4" />
          {buttonLabel}
        </button>
      ) : (
        <div className="card-elev mb-8 flex flex-wrap items-center justify-between gap-4 p-6">
          <div className="flex items-center gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
              <CalendarCheck className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-semibold">Schedule a Call or Virtual Meeting</h2>
              <p className="text-sm text-muted-foreground">
                Want to know more? Pick a convenient time to speak with us.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              reset();
              setOpen(true);
            }}
            className="btn-primary btn-primary-hover shrink-0"
          >
            Schedule
          </button>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Schedule a Call or Virtual Meeting</DialogTitle>
            <DialogDescription>
              60 minutes · Monday–Friday, 10:00 AM–2:00 PM Central · booked at least 2 days ahead.
            </DialogDescription>
          </DialogHeader>

          {booked ? (
            <div className="grid gap-3 text-sm">
              <p className="text-base font-semibold">You&apos;re booked.</p>
              <p>
                We&apos;ll talk on <strong>{booked.when}</strong>.{" "}
                {meetLink
                  ? "Your Google Meet link:"
                  : "We'll email you the Google Meet link before then."}
              </p>
              {meetLink && (
                <a
                  href={meetLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-accent hover:underline"
                >
                  {meetLink}
                </a>
              )}
              {booked.emailed && (
                <p className="text-muted-foreground">
                  A confirmation and calendar invite are on their way to {email}.
                </p>
              )}
              <p className="text-muted-foreground">
                Need to change it? Use the Reschedule or cancel button in your confirmation email.
              </p>
              <button type="button" onClick={() => setOpen(false)} className="btn-primary w-fit">
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="grid gap-5">
              {error && (
                <p
                  role="alert"
                  className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {error}
                </p>
              )}
              <div className="grid gap-4 md:grid-cols-[auto_1fr]">
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">
                    1. Pick a day
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
                      defaultMonth={slots.from ? fromIsoLocal(slots.from) : undefined}
                      startMonth={slots.from ? fromIsoLocal(slots.from) : undefined}
                      endMonth={slots.to ? fromIsoLocal(slots.to) : undefined}
                      className="rounded-md border border-border"
                    />
                  ) : loadError ? (
                    <div className="text-sm text-destructive">
                      {loadError}{" "}
                      <button type="button" onClick={loadSlots} className="underline">
                        Try again
                      </button>
                    </div>
                  ) : (
                    <div className="h-64 w-64 animate-pulse rounded-md bg-secondary/60" />
                  )}
                  {slots && availableDates.size === 0 && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      No times are open right now — please call (469) 501-9362.
                    </p>
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
                    <p className="mt-3 text-sm font-medium">{formatSlotDay(date, slot)}</p>
                  )}
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    All times Central (Texas).
                  </p>
                </div>
              </div>

              {date && slot && (
                <div className="grid gap-3">
                  <div className="text-xs font-medium text-muted-foreground">3. Your details</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1 text-sm">
                      <span className="font-medium">Name *</span>
                      <input
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onBlur={nameT.onBlur}
                        aria-invalid={nameT.touched && !!requiredError(name, "your name")}
                        aria-describedby="appt-name-err"
                        className={input}
                      />
                      <FieldError
                        id="appt-name-err"
                        message={nameT.touched ? requiredError(name, "your name") : null}
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span className="font-medium">Email *</span>
                      <input
                        required
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onBlur={emailT.onBlur}
                        aria-invalid={emailT.touched && !!emailError(email)}
                        aria-describedby="appt-email-err"
                        className={input}
                      />
                      <FieldError
                        id="appt-email-err"
                        message={emailT.touched ? emailError(email) : null}
                      />
                    </label>
                  </div>
                  <label className="grid gap-1 text-sm">
                    <span className="font-medium">Phone (optional)</span>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className={input}
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span className="font-medium">
                      What would you like to talk about? (optional)
                    </span>
                    <textarea
                      rows={3}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className={input}
                    />
                  </label>
                  {/* Honeypot: hidden from people, tempting to bots. */}
                  <input
                    tabIndex={-1}
                    autoComplete="off"
                    aria-hidden
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    className="hidden"
                  />
                  <button
                    disabled={saving}
                    className="btn-primary btn-primary-hover w-fit disabled:opacity-60"
                  >
                    {saving ? "Booking…" : "Confirm appointment"}
                  </button>
                </div>
              )}
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
