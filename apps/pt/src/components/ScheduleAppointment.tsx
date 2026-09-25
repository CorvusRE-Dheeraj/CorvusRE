import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarCheck, Video, Phone as PhoneIcon } from "lucide-react";
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
  toIsoLocal,
  type MeetingType,
  type OpenSlots,
} from "@/lib/appointments";

// The "Schedule a Call or Virtual Meeting" card on the Contact page and its booking
// dialog: pick a day on the calendar (only days with an open slot are selectable),
// pick a time, tell us who you are, done. What's open is decided server-side
// (appointment-slots) — 60-minute visits, Mon–Fri 10 AM–2 PM Central, 2 days' notice,
// no holidays, no double booking.
export function ScheduleAppointment() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [slots, setSlots] = useState<OpenSlots | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [meetingType, setMeetingType] = useState<MeetingType>("call");
  const [notes, setNotes] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
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
      <div className="card-elev mb-8 flex flex-wrap items-center justify-between gap-4 p-6">
        <div className="flex items-center gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
            <CalendarCheck className="h-5 w-5" />
          </span>
          <div>
            <h3 className="font-semibold">Schedule a Call or Virtual Meeting</h3>
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
                {meetingType === "virtual"
                  ? "We'll email you the meeting link before then."
                  : `We'll call you at ${phone}.`}
              </p>
              {booked.emailed && (
                <p className="text-muted-foreground">A confirmation is on its way to {email}.</p>
              )}
              <p className="text-muted-foreground">Need to change it? Call (469) 501-9362.</p>
              <button type="button" onClick={() => setOpen(false)} className="btn-primary w-fit">
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="grid gap-5">
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
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        ["call", "Phone call", PhoneIcon],
                        ["virtual", "Virtual meeting", Video],
                      ] as const
                    ).map(([value, label, Icon]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setMeetingType(value)}
                        aria-pressed={meetingType === value}
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                          meetingType === value
                            ? "border-accent bg-accent/10 text-accent"
                            : "border-input hover:bg-secondary/60"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1 text-sm">
                      <span className="font-medium">Name *</span>
                      <input
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className={input}
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span className="font-medium">Email *</span>
                      <input
                        required
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={input}
                      />
                    </label>
                  </div>
                  <label className="grid gap-1 text-sm">
                    <span className="font-medium">
                      Phone {meetingType === "call" ? "*" : "(optional)"}
                    </span>
                    <input
                      type="tel"
                      required={meetingType === "call"}
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
                  {error && <p className="text-sm text-destructive">{error}</p>}
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
