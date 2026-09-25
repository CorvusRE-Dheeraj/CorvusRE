import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarCheck, Phone, Video } from "lucide-react";
import { getErrorMessage } from "@/lib/error-message";
import { useAuth } from "@/lib/auth";
import { getGoogleCalendarStatus, startGoogleCalendarConnect } from "@/lib/google-calendar-sync";
import {
  SLOT_HOURS,
  centralToday,
  federalHolidays,
  slotKey,
  slotLabel,
} from "@/lib/appointment-rules";
import {
  addBlock,
  cancelAppointment,
  formatAppointment,
  getMeetingHost,
  getMeetingLink,
  setMeetingLink,
  setMeetingHost,
  listAppointments,
  listBlocks,
  removeBlock,
  type AppointmentBlock,
  type AppointmentRecord,
} from "@/lib/appointments";

const field = "rounded-md border border-input bg-background px-2.5 py-1.5 text-sm";
const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

// Admin → Appointments: every booking (new ones appear here as soon as they are made),
// and the controls for closing days or single time slots. Federal holidays are always
// closed automatically; this is for everything else.
export function AdminAppointments() {
  const { user } = useAuth();
  const [hostId, setHostId] = useState<string | null>(null);
  const [iConnected, setIConnected] = useState(false);
  const [hostLoaded, setHostLoaded] = useState(false);
  const [linkInput, setLinkInput] = useState("");
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [blocks, setBlocks] = useState<AppointmentBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPast, setShowPast] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [dayDate, setDayDate] = useState("");
  const [dayNote, setDayNote] = useState("");
  const [slotDate, setSlotDate] = useState("");
  const [slotValue, setSlotValue] = useState<string>(slotKey(SLOT_HOURS[0]));
  const [slotNote, setSlotNote] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    return Promise.all([listAppointments(), listBlocks()])
      .then(([a, b]) => {
        setAppointments(a);
        setBlocks(b);
      })
      .catch((err) => toast.error(getErrorMessage(err, "Could not load appointments.")));
  }

  useEffect(() => {
    getMeetingHost()
      .then(setHostId)
      .catch(() => {})
      .finally(() => setHostLoaded(true));
    getMeetingLink()
      .then(setLinkInput)
      .catch(() => {});
    getGoogleCalendarStatus()
      .then((s) => setIConnected(s.connected))
      .catch(() => {});
  }, []);

  useEffect(() => {
    void load().finally(() => setLoading(false));
    // New bookings should show up without a manual refresh.
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, []);

  const now = Date.now();
  const { upcoming, past, cancelled } = useMemo(() => {
    const booked = appointments.filter((a) => a.status === "booked");
    return {
      upcoming: booked.filter((a) => new Date(a.endAt).getTime() >= now),
      past: booked.filter((a) => new Date(a.endAt).getTime() < now).reverse(),
      cancelled: appointments.filter((a) => a.status === "cancelled").reverse(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointments]);

  const holidays = useMemo(() => {
    const today = centralToday();
    const year = Number(today.slice(0, 4));
    return [...federalHolidays(year), ...federalHolidays(year + 1)]
      .filter((h) => h.date >= today)
      .slice(0, 8);
  }, []);

  async function run(action: () => Promise<void>, ok: string) {
    setBusy(true);
    try {
      await action();
      toast.success(ok);
      await load();
    } catch (err) {
      toast.error(getErrorMessage(err, "That didn't work."));
    } finally {
      setBusy(false);
    }
  }

  const row = (a: AppointmentRecord, actions: boolean) => (
    <li key={a.id} className="rounded-md border border-border p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 font-semibold">
            {a.meetingType === "virtual" ? (
              <Video className="h-4 w-4 text-accent" />
            ) : (
              <Phone className="h-4 w-4 text-accent" />
            )}
            {formatAppointment(a.startAt)}
            <span className="text-xs font-normal text-muted-foreground">
              · {a.meetingType === "virtual" ? "Google Meet" : "Phone call"} · 60 min
            </span>
          </div>
          <div className="mt-1">
            {a.name} ·{" "}
            <a href={`mailto:${a.email}`} className="text-accent hover:underline">
              {a.email}
            </a>
            {a.phone && (
              <>
                {" "}
                ·{" "}
                <a href={`tel:${a.phone}`} className="text-accent hover:underline">
                  {a.phone}
                </a>
              </>
            )}
          </div>
          {a.meetLink ? (
            <div className="mt-1">
              <a
                href={a.meetLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                Join: {a.meetLink}
              </a>
            </div>
          ) : (
            a.status === "booked" && (
              <div className="mt-1 text-xs text-warning-foreground">
                To do: send the meeting link to this visitor.
              </div>
            )
          )}
          {a.notes && <p className="mt-1 whitespace-pre-line text-muted-foreground">{a.notes}</p>}
          <div className="mt-1 text-[11px] text-muted-foreground">
            Booked {new Date(a.createdAt).toLocaleString()}
          </div>
        </div>
        {actions &&
          (confirmCancel === a.id ? (
            <div className="flex items-center gap-2 text-xs">
              <span>Cancel this appointment?</span>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await cancelAppointment(a.id);
                    setConfirmCancel(null);
                  }, "Appointment cancelled — the time is open again.")
                }
                className="btn-outline py-1 text-xs text-destructive"
              >
                Yes, cancel
              </button>
              <button
                type="button"
                onClick={() => setConfirmCancel(null)}
                className="hover:underline"
              >
                Keep
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmCancel(a.id)}
              className="text-xs text-muted-foreground hover:underline"
            >
              Cancel appointment
            </button>
          ))}
      </div>
    </li>
  );

  return (
    <div className="mt-6 grid gap-8">
      <section className="rounded-md border border-border p-4">
        <h2 className="text-sm font-semibold">Meeting link</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Every confirmation email and calendar invite includes this link (for example a Google Meet
          room made from properties@srclandbuilding.com). Leave it empty and the email just says the
          link will follow.
        </p>
        <form
          className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => setMeetingLink(linkInput), "Meeting link saved.");
          }}
        >
          <input
            type="url"
            value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)}
            placeholder="https://meet.google.com/abc-defg-hij"
            aria-label="Meeting link"
            className={`${field} min-w-[18rem] flex-1`}
          />
          <button disabled={busy} className="btn-outline text-xs disabled:opacity-60">
            Save link
          </button>
        </form>
        <h3 className="mt-5 text-sm font-semibold">Or: a fresh Google Meet link per booking</h3>
        {!hostLoaded ? (
          <p className="mt-1 text-xs text-muted-foreground">Loading…</p>
        ) : hostId && hostId === user?.id ? (
          <div className="mt-1 text-sm">
            <p>
              ✓ Every new appointment gets its own Google Meet link, created on{" "}
              <strong>your</strong> connected Google account. Google emails the invite to the
              visitor and the team.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await setMeetingHost(null);
                  setHostId(null);
                }, "Stopped creating Meet links.")
              }
              className="mt-2 text-xs text-muted-foreground hover:underline"
            >
              Stop using my Google account
            </button>
          </div>
        ) : hostId ? (
          <div className="mt-1 text-sm">
            <p>✓ Meet links are created on another admin&rsquo;s connected Google account.</p>
            {iConnected && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (!user) return;
                    await setMeetingHost(user.id);
                    setHostId(user.id);
                  }, "Meet links will now be created on your Google account.")
                }
                className="mt-2 text-xs text-accent hover:underline"
              >
                Use my Google account instead
              </button>
            )}
          </div>
        ) : (
          <div className="mt-1 text-sm">
            <p className="text-muted-foreground">
              No Google account is set up to create Meet links yet. Bookings still work, but the
              team has to create each meeting and email the link by hand.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {iConnected ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (!user) return;
                      await setMeetingHost(user.id);
                      setHostId(user.id);
                    }, "Done — every new appointment now gets a Meet link.")
                  }
                  className="btn-primary text-xs"
                >
                  Use my Google account for Meet links
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void startGoogleCalendarConnect()}
                  className="btn-primary text-xs"
                >
                  Connect Google (sign in as properties@srclandbuilding.com)
                </button>
              )}
              {!iConnected && (
                <span className="text-xs text-muted-foreground">
                  After connecting, come back to this tab and choose &ldquo;Use my Google
                  account&rdquo;.
                </span>
              )}
            </div>
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-serif text-lg font-semibold">
            <CalendarCheck className="h-5 w-5 text-accent" />
            Scheduled appointments
            <span className="rounded-full bg-secondary px-2 py-0.5 font-sans text-xs font-medium text-muted-foreground">
              {upcoming.length} upcoming
            </span>
          </h2>
          <button type="button" onClick={() => void load()} className="btn-outline text-xs">
            Refresh
          </button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Calls and Google Meet meetings booked from the Contact page. All times are Central. New
          bookings appear here automatically.
        </p>
        {loading ? (
          <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
        ) : upcoming.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
            No upcoming appointments.
          </p>
        ) : (
          <ul className="mt-3 grid gap-2">{upcoming.map((a) => row(a, true))}</ul>
        )}

        {(past.length > 0 || cancelled.length > 0) && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setShowPast((v) => !v)}
              className="text-xs text-accent hover:underline"
            >
              {showPast ? "Hide" : "Show"} past ({past.length}) and cancelled ({cancelled.length})
            </button>
            {showPast && (
              <ul className="mt-2 grid gap-2 opacity-80">
                {past.map((a) => row(a, false))}
                {cancelled.map((a) => (
                  <li
                    key={a.id}
                    className="rounded-md border border-dashed border-border p-3 text-sm"
                  >
                    <span className="line-through">{formatAppointment(a.startAt)}</span> — {a.name}{" "}
                    ({a.email}) · cancelled
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-serif text-lg font-semibold">Availability</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Visitors can book Monday–Friday, {slotLabel("10:00")}–2:00 PM Central, at least 2 days
          ahead, with 2 hours between appointments. Closed days and times are hidden from the
          booking calendar.
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <form
            className="grid gap-2 rounded-md border border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!dayDate) return;
              void run(async () => {
                await addBlock({ date: dayDate, slot: null, note: dayNote });
                setDayDate("");
                setDayNote("");
              }, "Day blocked.");
            }}
          >
            <div className="text-sm font-semibold">Block a whole day</div>
            <input
              type="date"
              min={centralToday()}
              value={dayDate}
              onChange={(e) => setDayDate(e.target.value)}
              aria-label="Day to block"
              className={field}
            />
            <input
              value={dayNote}
              onChange={(e) => setDayNote(e.target.value)}
              placeholder="Reason (optional), e.g. Office closed"
              aria-label="Reason"
              className={field}
            />
            <button
              disabled={busy || !dayDate}
              className="btn-outline w-fit text-xs disabled:opacity-60"
            >
              Block day
            </button>
          </form>

          <form
            className="grid gap-2 rounded-md border border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!slotDate) return;
              void run(async () => {
                await addBlock({ date: slotDate, slot: slotValue, note: slotNote });
                setSlotDate("");
                setSlotNote("");
              }, "Time blocked.");
            }}
          >
            <div className="text-sm font-semibold">Block a time slot</div>
            <div className="flex flex-wrap gap-2">
              <input
                type="date"
                min={centralToday()}
                value={slotDate}
                onChange={(e) => setSlotDate(e.target.value)}
                aria-label="Day"
                className={field}
              />
              <select
                value={slotValue}
                onChange={(e) => setSlotValue(e.target.value)}
                aria-label="Time slot"
                className={field}
              >
                {SLOT_HOURS.map((h) => (
                  <option key={h} value={slotKey(h)}>
                    {slotLabel(slotKey(h))}
                  </option>
                ))}
              </select>
            </div>
            <input
              value={slotNote}
              onChange={(e) => setSlotNote(e.target.value)}
              placeholder="Reason (optional)"
              aria-label="Reason"
              className={field}
            />
            <button
              disabled={busy || !slotDate}
              className="btn-outline w-fit text-xs disabled:opacity-60"
            >
              Block time
            </button>
          </form>
        </div>

        <h3 className="mt-5 text-sm font-semibold">Blocked by you</h3>
        {blocks.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">Nothing blocked.</p>
        ) : (
          <ul className="mt-2 grid gap-1.5">
            {blocks.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5 text-sm"
              >
                <span>
                  <strong>{dayLabel(b.date)}</strong> — {b.slot ? slotLabel(b.slot) : "all day"}
                  {b.note && <span className="text-muted-foreground"> · {b.note}</span>}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => removeBlock(b.id), "Unblocked.")}
                  className="text-xs text-muted-foreground hover:underline"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <h3 className="mt-5 text-sm font-semibold">Holidays (closed automatically)</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {holidays.map((h) => (
            <span key={h.date} className="rounded-full bg-secondary px-3 py-1 text-xs">
              {h.name} · {dayLabel(h.date)}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
