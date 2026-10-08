import { confirmDialog } from "@/components/ConfirmHost";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type DragEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  addDays,
  subDays,
  isSameMonth,
  isSameDay,
  isToday,
  format,
} from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  RefreshCw,
  Copy,
  Plus,
  Pencil,
  Trash2,
  CircleX,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { markPropertyPaid, listProperties, type PropertyRecord } from "@/lib/properties";
import { listProtests, type ProtestRecord } from "@/lib/protests";
import { updateIntake } from "@/lib/intake-store";
import {
  getCalendarEvents,
  googleCalendarAddUrl,
  type CalendarEvent,
  type CalendarEventType,
} from "@/lib/tax-calendar";
import {
  addReminder,
  updateReminder,
  setReminderDone,
  setReminderMissed,
  deleteReminder,
} from "@/lib/reminders";
import { findHearingConflicts, type HearingConflictGroup } from "@/lib/hearing-conflicts";
import { downloadIcs } from "@/lib/ics";
import {
  getOrCreateFeedToken,
  regenerateFeedToken,
  getFeedHttpsUrl,
  googleCalendarSubscribeUrl,
} from "@/lib/calendar-feed";
import {
  getGoogleCalendarStatus,
  startGoogleCalendarConnect,
  disconnectGoogleCalendar,
  type GoogleCalendarStatus,
} from "@/lib/google-calendar-sync";
import { Skeleton } from "@/components/ui/skeleton";
import { Modal } from "@/components/Modal";
import { PageHero, heroButton, heroButtonGhost } from "@/components/PageHero";
import { CalendarDays as HeroCalendarIcon } from "lucide-react";

// google_connected/google_error round-trip from google-calendar-oauth-
// callback's redirect back here after the user finishes (or abandons) the
// Google consent screen — read once on mount to show the right toast, then
// cleared from the URL so refreshing the page doesn't re-show it.
export const Route = createFileRoute("/dashboard/_layout/calendar")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { google_connected?: string; google_error?: string } => ({
    google_connected:
      typeof search.google_connected === "string" ? search.google_connected : undefined,
    google_error: typeof search.google_error === "string" ? search.google_error : undefined,
  }),
  component: CalendarPage,
});

type ViewMode = "month" | "week" | "day" | "list";
const VIEW_STORAGE_KEY = "corvuspt.calendarView";
const VIEWS: { id: ViewMode; label: string }[] = [
  { id: "month", label: "Month" },
  { id: "week", label: "Week" },
  { id: "day", label: "Day" },
  { id: "list", label: "List" },
];

// A reminder's real id, out of the "reminder-<id>" composite CalendarEvent id — the only
// event kind this page ever writes back (see tax-calendar.ts's fromReminder). Every other
// kind (a protest deadline, an ARB hearing, a tax bill) is a real fact set by the county or
// your own case, not something to drag around here, so those stay read-only.
function reminderIdOf(event: CalendarEvent): string | null {
  return event.type === "reminder" ? event.id.slice("reminder-".length) : null;
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function DaysLeftBadge({ event }: { event: CalendarEvent }) {
  if (event.resolved)
    return <span className="badge-soft text-success">{event.resolvedLabel ?? "Done"}</span>;
  if (event.missed) return <span className="badge-soft text-destructive">Missed</span>;
  const daysLeft = daysUntil(event.date);
  return (
    <span className={`badge-soft ${daysLeft <= 7 ? "text-destructive" : ""}`}>
      {daysLeft < 0
        ? "Past due"
        : daysLeft === 0
          ? "Today"
          : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
    </span>
  );
}

function EventRow({
  event,
  onMarkPaid,
  markingPaid,
  onEditReminder,
  onDeleteReminder,
  onToggleReminderDone,
  onToggleReminderMissed,
  onOpenProperty,
}: {
  event: CalendarEvent;
  onMarkPaid?: (propertyId: string) => void;
  markingPaid: boolean;
  onEditReminder?: (event: CalendarEvent) => void;
  onDeleteReminder?: (event: CalendarEvent) => void;
  onToggleReminderDone?: (event: CalendarEvent) => void;
  onToggleReminderMissed?: (event: CalendarEvent) => void;
  // Every real county/case fact (a deadline, a hearing, a tax bill — never a personal
  // reminder, which has its own edit/delete controls) opens straight to that property's case,
  // resuming wherever it's really at, or starts one if none exists yet.
  onOpenProperty?: (propertyId: string) => void;
}) {
  const isPropertySnapshotBill = event.id.startsWith("tax-due:property:");
  const isReminder = event.type === "reminder";
  const clickable = !isReminder && !!event.propertyId && !!onOpenProperty;
  return (
    <div
      {...(clickable
        ? {
            role: "button" as const,
            tabIndex: 0,
            onClick: () => onOpenProperty?.(event.propertyId as string),
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") onOpenProperty?.(event.propertyId as string);
            },
          }
        : {})}
      className={`card-elev p-4 flex items-center justify-between flex-wrap gap-3 ${
        clickable ? "cursor-pointer transition-colors hover:bg-secondary/40" : ""
      }`}
    >
      <div className="flex items-start gap-2">
        {isReminder && onToggleReminderDone && (
          <input
            type="checkbox"
            checked={event.resolved}
            onChange={() => onToggleReminderDone(event)}
            aria-label={event.resolved ? "Mark reminder not done" : "Mark reminder done"}
            className="mt-1 h-4 w-4"
          />
        )}
        <div>
          <div
            className={`font-medium ${isReminder && event.resolved ? "line-through" : ""} ${
              isReminder && event.missed ? "text-destructive" : ""
            }`}
          >
            {event.title}
          </div>
          <div className="text-xs text-muted-foreground">
            {format(new Date(event.date + "T00:00:00"), "MMM d, yyyy")}
            {event.amount != null ? ` • $${event.amount.toLocaleString()}` : ""}
            {isReminder && event.missed && !event.resolved && (
              <span className="ml-1 font-medium text-destructive">
                {daysUntil(event.date) < 0
                  ? "— passed without being marked done"
                  : "— marked missed"}
              </span>
            )}
            {!isReminder && event.resolved && event.resolvedNote && (
              <span className="ml-1 font-medium text-success">— {event.resolvedNote}</span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <DaysLeftBadge event={event} />
        {isPropertySnapshotBill && !event.resolved && event.propertyId && onMarkPaid && (
          <button
            disabled={markingPaid}
            onClick={(e) => {
              e.stopPropagation();
              onMarkPaid(event.propertyId as string);
            }}
            className="btn-outline text-sm disabled:opacity-60"
          >
            {markingPaid ? "Saving…" : "Mark as Paid"}
          </button>
        )}
        {isReminder ? (
          <>
            {onToggleReminderMissed && !event.resolved && (
              <button
                type="button"
                onClick={() => onToggleReminderMissed(event)}
                aria-label={event.missed ? "Undo missed" : "Mark missed"}
                title={event.missed ? "Undo missed" : "Mark missed"}
                className={`grid h-8 w-8 place-items-center rounded-md hover:bg-destructive/10 hover:text-destructive ${
                  event.missed ? "text-destructive" : "text-muted-foreground"
                }`}
              >
                <CircleX className="h-3.5 w-3.5" />
              </button>
            )}
            {onEditReminder && (
              <button
                type="button"
                onClick={() => onEditReminder(event)}
                aria-label="Edit reminder"
                title="Edit"
                className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
            {onDeleteReminder && (
              <button
                type="button"
                onClick={() => onDeleteReminder(event)}
                aria-label="Delete reminder"
                title="Delete"
                className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </>
        ) : (
          <>
            <a
              href={googleCalendarAddUrl(event)}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="btn-outline text-sm inline-flex items-center gap-1"
              title="Add to Google Calendar"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Google
            </a>
            {clickable ? (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            ) : (
              <Link
                to={event.linkTo}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                View
              </Link>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Real, same-day hearing conflicts across the user's whole portfolio — see
// findHearingConflicts() in hearing-conflicts.ts for what's actually
// deterministic vs. honestly absent here (no fabricated travel time).
function HearingConflictBanner({ group }: { group: HearingConflictGroup }) {
  return (
    <div className="card-elev border-amber-500/30 bg-amber-500/5 p-4">
      <h2 className="font-semibold text-amber-800">
        {group.hearings.length} hearings on{" "}
        {format(new Date(`${group.date}T00:00:00`), "MMMM d, yyyy")}
      </h2>
      <ul className="mt-2 grid gap-1 text-sm">
        {group.hearings.map((h) => (
          <li key={h.protestId} className="text-muted-foreground">
            <span className="font-medium text-foreground">{h.address}</span>
            {h.time ? ` — ${h.time}` : ""}
            {h.location ? ` (${h.location})` : ""}
            {h.mode ? ` — ${h.mode}` : ""}
          </li>
        ))}
      </ul>
      <ul className="mt-2 grid gap-1 text-xs text-muted-foreground">
        {group.guidance.map((g, i) => (
          <li key={i}>• {g}</li>
        ))}
      </ul>
      {group.directionsUrl && (
        <a
          href={group.directionsUrl}
          target="_blank"
          rel="noreferrer"
          className="btn-outline mt-3 inline-flex items-center gap-1.5 text-sm"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Check real driving time between them
        </a>
      )}
    </div>
  );
}

// The real, continuous option — OAuth to the user's own Google account,
// then a ~5-minute cron pushes their deadlines directly via the Calendar
// API (see google-calendar-sync). A new deadline shows up within minutes,
// not on Google's own (often much slower) subscribe-link refresh timing —
// that link-based option is still available below as a lighter-weight
// alternative that needs no Google sign-in permission grant.
function GoogleConnectSection({ userId }: { userId: string }) {
  const [status, setStatus] = useState<GoogleCalendarStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  function loadStatus() {
    setLoading(true);
    getGoogleCalendarStatus()
      .then(setStatus)
      .catch((err) => toast.error(err instanceof Error ? err.message : "Could not check status."))
      .finally(() => setLoading(false));
  }

  useEffect(loadStatus, [userId]);

  async function handleConnect() {
    setConnecting(true);
    try {
      await startGoogleCalendarConnect(); // navigates away on success
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start Google sign-in.");
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (
      !(await confirmDialog(
        "Stop syncing to Google Calendar? Events already there won't be removed.",
      ))
    ) {
      return;
    }
    setDisconnecting(true);
    try {
      await disconnectGoogleCalendar();
      toast.success("Disconnected.");
      loadStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not disconnect.");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="card-elev p-4">
      <h2 className="font-semibold">Connect Google Calendar</h2>
      <p className="text-sm text-muted-foreground mt-1">
        Real, continuous sync to your own Google account — every deadline pushed directly, kept
        current automatically every few minutes as things change. Nothing to re-add later.
      </p>
      {loading ? (
        <Skeleton className="h-9 w-40 mt-3" />
      ) : status?.connected ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="badge-soft text-success">Connected</span>
          <span className="text-xs text-muted-foreground">
            {status.lastSyncedAt
              ? `Last synced ${new Date(status.lastSyncedAt).toLocaleString()}`
              : "First sync in progress…"}
          </span>
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-60"
          >
            {disconnecting ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleConnect}
          disabled={connecting}
          className="btn-primary btn-primary-hover text-sm mt-3 inline-flex items-center gap-1.5 disabled:opacity-60"
        >
          <RefreshCw className="h-3.5 w-3.5" />{" "}
          {connecting ? "Redirecting…" : "Connect Google Calendar"}
        </button>
      )}
    </div>
  );
}

// Lighter-weight alternative to GoogleConnectSection above — a subscribe
// link for the WHOLE calendar (every property, every event type), no
// Google sign-in permission grant needed, works with Outlook/Apple
// Calendar too. Still real ongoing sync (new deadlines appear on their
// own), just on Google's own refresh schedule instead of our 5-minute
// cron — see GoogleConnectSection's own comment for that tradeoff.
function LinkSyncSection({ userId }: { userId: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getOrCreateFeedToken(userId)
      .then(setToken)
      .catch((err) => toast.error(err instanceof Error ? err.message : "Could not set up sync."))
      .finally(() => setLoading(false));
  }, [userId]);

  async function handleRegenerate() {
    if (
      !(await confirmDialog(
        "Get a new sync link? Any calendar already subscribed with the old one will stop updating.",
      ))
    ) {
      return;
    }
    setRegenerating(true);
    try {
      setToken(await regenerateFeedToken(userId));
      toast.success("New sync link generated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not generate a new link.");
    } finally {
      setRegenerating(false);
    }
  }

  async function handleCopy() {
    if (!token) return;
    await navigator.clipboard.writeText(getFeedHttpsUrl(token));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="card-elev p-4">
      <h2 className="font-semibold">Or Use a Subscribe Link</h2>
      <p className="text-sm text-muted-foreground mt-1">
        One link for your whole tax calendar — every property's deadlines, hearings, tax bills, and
        BPP renditions. Subscribe once and new dates keep showing up on their own; Google typically
        checks for updates every 12–24 hours, not instantly.
      </p>
      {loading ? (
        <Skeleton className="h-9 w-40 mt-3" />
      ) : token ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a
            href={googleCalendarSubscribeUrl(token)}
            target="_blank"
            rel="noreferrer"
            className="btn-primary btn-primary-hover text-sm inline-flex items-center gap-1.5"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Add to Google Calendar
          </a>
          <button
            type="button"
            onClick={handleCopy}
            className="btn-outline text-sm inline-flex items-center gap-1.5"
          >
            <Copy className="h-3.5 w-3.5" /> {copied ? "Copied!" : "Copy Link"}
          </button>
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={regenerating}
            className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-60"
          >
            {regenerating ? "Generating…" : "Get a new link"}
          </button>
        </div>
      ) : (
        <p className="mt-3 text-sm text-destructive">Could not set up your sync link.</p>
      )}
    </div>
  );
}

const GOOGLE_ERROR_MESSAGES: Record<string, string> = {
  missing_state: "That connection link expired — please try again.",
  invalid_state: "That connection link expired — please try again.",
  missing_code: "Google didn't return a valid response — please try again.",
  token_exchange_failed: "Could not complete sign-in with Google — please try again.",
  no_refresh_token:
    "Google didn't grant lasting access — try disconnecting any prior CorvusPT access in your Google Account settings, then reconnect.",
  calendar_create_failed: "Could not create your CorvusPT calendar on Google — please try again.",
  access_denied: "Google sign-in was cancelled.",
  unexpected: "Something went wrong connecting to Google — please try again.",
};

// A day cell / column that a reminder can be dropped onto — only ever fires for a real
// reminder id (see reminderIdOf), never for a county/case fact, which this page never lets
// anyone drag.
function useReminderDrop(onDrop: (reminderId: string, iso: string) => void) {
  const [dragOverIso, setDragOverIso] = useState<string | null>(null);
  return {
    dragOverIso,
    dropProps: (iso: string) => ({
      onDragOver: (e: DragEvent) => {
        if (e.dataTransfer.types.includes("text/corvuspt-reminder-id")) {
          e.preventDefault();
          setDragOverIso(iso);
        }
      },
      onDragLeave: () => setDragOverIso((cur) => (cur === iso ? null : cur)),
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        setDragOverIso(null);
        const id = e.dataTransfer.getData("text/corvuspt-reminder-id");
        if (id) onDrop(id, iso);
      },
    }),
  };
}

function dragProps(event: CalendarEvent) {
  const id = reminderIdOf(event);
  if (!id) return {};
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData("text/corvuspt-reminder-id", id);
      e.dataTransfer.effectAllowed = "move";
    },
  };
}

// One compact chip inside a Month/Week cell — a coloured dot, the property/title, and (for a
// reminder only) draggable so it can be moved to another day.
function EventChip({ event, onClick }: { event: CalendarEvent; onClick: () => void }) {
  const isReminder = event.type === "reminder";
  return (
    <button
      type="button"
      onClick={onClick}
      {...dragProps(event)}
      className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[10px] leading-tight hover:bg-secondary/70 ${
        isReminder ? "cursor-grab active:cursor-grabbing" : ""
      } ${event.resolved ? "opacity-50 line-through" : ""} ${
        isReminder && event.missed ? "text-destructive" : ""
      }`}
      title={isReminder && event.missed ? `${event.title} — Missed` : event.title}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          isReminder && event.missed
            ? "bg-destructive"
            : isReminder
              ? "bg-fuchsia-500"
              : "bg-accent"
        }`}
      />
      <span className="truncate">{event.propertyLabel || event.title}</span>
    </button>
  );
}

type ReminderDraft = {
  id: string | null;
  remindOn: string;
  note: string;
  propertyId: string | null;
};

function ReminderFormModal({
  draft,
  properties,
  onClose,
  onSaved,
  onDeleted,
}: {
  draft: ReminderDraft;
  properties: PropertyRecord[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const { user } = useAuth();
  const [remindOn, setRemindOn] = useState(draft.remindOn);
  const [note, setNote] = useState(draft.note);
  const [propertyId, setPropertyId] = useState(draft.propertyId ?? "");
  const [saving, setSaving] = useState(false);
  const isEditing = !!draft.id;

  async function handleSave() {
    if (!user || !remindOn || !note.trim()) return;
    setSaving(true);
    try {
      if (isEditing && draft.id) {
        await updateReminder(draft.id, { remindOn, note, propertyId: propertyId || null });
      } else {
        await addReminder(user.id, { remindOn, note, propertyId: propertyId || null });
      }
      toast.success(isEditing ? "Reminder updated." : "Reminder added.");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save this reminder.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!draft.id) return;
    if (!(await confirmDialog("Delete this reminder?"))) return;
    setSaving(true);
    try {
      await deleteReminder(draft.id);
      toast.success("Reminder deleted.");
      onDeleted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete this reminder.");
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="font-serif text-lg font-semibold">
        {isEditing ? "Edit reminder" : "Add a reminder"}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Your own note — nothing to do with your county or case record. Drag it to a different day on
        the calendar any time, or edit it here.
      </p>
      <div className="mt-4 grid gap-3">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Date</span>
          <input
            type="date"
            value={remindOn}
            onChange={(e) => setRemindOn(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Property (optional)</span>
          <select
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2"
          >
            <option value="">No specific property</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.address}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">
            What's this about?<span className="text-destructive"> *</span>
          </span>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Call the appraiser to confirm the informal review time"
            className="rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        {isEditing ? (
          <button
            type="button"
            onClick={handleDelete}
            disabled={saving}
            className="btn-outline text-destructive text-sm disabled:opacity-60"
          >
            Delete
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="btn-outline text-sm">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !remindOn || !note.trim()}
            className="btn-primary btn-primary-hover text-sm disabled:opacity-60"
          >
            {saving ? "Saving…" : isEditing ? "Save changes" : "Add reminder"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function CalendarPage() {
  const { user } = useAuth();
  const nav = useNavigate();
  const search = Route.useSearch();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [protests, setProtests] = useState<ProtestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(() => new Date());
  const [view, setView] = useState<ViewMode>(() => {
    try {
      const saved = localStorage.getItem(VIEW_STORAGE_KEY);
      return saved === "month" || saved === "week" || saved === "day" || saved === "list"
        ? saved
        : "list";
    } catch {
      return "list";
    }
  });
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null);
  const [syncOpen, setSyncOpen] = useState(!!(search.google_connected || search.google_error));
  const [hearingConflicts, setHearingConflicts] = useState<HearingConflictGroup[]>([]);
  const [dayDetail, setDayDetail] = useState<string | null>(null);
  const [reminderDraft, setReminderDraft] = useState<ReminderDraft | null>(null);

  function setViewMode(v: ViewMode) {
    setView(v);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, v);
    } catch {
      // storage blocked — the choice just won't be remembered next visit
    }
  }

  function reload() {
    if (!user) return;
    getCalendarEvents(user.id)
      .then(setEvents)
      .catch((err) => console.error(err));
  }

  useEffect(() => {
    if (!user) return;
    Promise.all([getCalendarEvents(user.id), listProperties(user.id)])
      .then(([evs, props]) => {
        setEvents(evs);
        setProperties(props);
      })
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, [user]);

  // Real cross-property hearing-conflict check — only meaningful once a
  // user has more than one hearing on file, so this loads independently of
  // the calendar-event list above (which doesn't carry per-hearing
  // location/mode, just a folded title string). Also the one real source of
  // "does this property already have a case" for openProperty below.
  useEffect(() => {
    if (!user) return;
    Promise.all([listProtests(user.id), listProperties(user.id)])
      .then(([prot, props]) => {
        setProtests(prot);
        setHearingConflicts(findHearingConflicts(prot, props));
      })
      .catch((err) => console.error("Could not check for hearing conflicts:", err));
  }, [user]);

  // Same property, whichever real step it's actually on: a case already exists for it, so
  // open View Case (which itself resumes on whatever phase the case is really at); otherwise
  // this property has never had a protest started, so head to the AI report to start one —
  // the same entry point Quick Actions and the property list use. Every clickable calendar
  // item that names a real property (a deadline, a hearing, a tax bill — never a personal
  // reminder, which has its own edit/delete controls instead) goes through this.
  function openProperty(propertyId: string) {
    const protest = protests.find((pr) => pr.propertyId === propertyId);
    if (protest) {
      nav({ to: "/dashboard/case", search: { propertyId } });
      return;
    }
    const p = properties.find((row) => row.id === propertyId);
    if (!p) return;
    updateIntake({
      address: p.address,
      cad: p.cad ?? undefined,
      accountNumber: p.accountNumber ?? undefined,
      ownerName: p.ownerName ?? undefined,
      propertyType: p.propertyType ?? undefined,
      landValue: p.landValue ?? undefined,
      improvementValue: p.improvementValue ?? undefined,
      totalValue: p.totalValue ?? undefined,
      taxYear: p.taxYear ?? undefined,
      valueHistory: p.valueHistory ?? undefined,
      confirmed: true,
    });
    nav({ to: "/ai-report" });
  }

  // One-time: show the result of a just-completed (or abandoned) Google
  // connect attempt, then strip these params so refreshing doesn't re-show
  // the toast.
  useEffect(() => {
    if (search.google_connected) {
      toast.success("Google Calendar connected — your deadlines will start appearing shortly.");
      nav({ to: "/dashboard/calendar", search: {}, replace: true });
    } else if (search.google_error) {
      toast.error(
        GOOGLE_ERROR_MESSAGES[search.google_error] ?? "Could not connect Google Calendar.",
      );
      nav({ to: "/dashboard/calendar", search: {}, replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleMarkPaid(propertyId: string) {
    setMarkingPaidId(propertyId);
    try {
      await markPropertyPaid(propertyId);
      setEvents((prev) =>
        prev.map((e) =>
          e.propertyId === propertyId && e.type === "tax_due" ? { ...e, resolved: true } : e,
        ),
      );
      toast.success("Marked as paid.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update this bill.");
    } finally {
      setMarkingPaidId(null);
    }
  }

  async function handleReminderDrop(reminderId: string, iso: string) {
    try {
      await updateReminder(reminderId, { remindOn: iso });
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not move this reminder.");
    }
  }

  async function handleToggleReminderDone(event: CalendarEvent) {
    const id = reminderIdOf(event);
    if (!id) return;
    try {
      await setReminderDone(id, !event.resolved);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update this reminder.");
    }
  }

  // Explicitly marks a reminder missed (or un-marks it, back to a plain
  // pending state) — separate from the done toggle above, so "Completed" and
  // "Missed" are two distinct actions rather than one done/not-done checkbox
  // standing in for both.
  async function handleToggleReminderMissed(event: CalendarEvent) {
    const id = reminderIdOf(event);
    if (!id) return;
    try {
      await setReminderMissed(id, !event.missed);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update this reminder.");
    }
  }

  function openEditReminder(event: CalendarEvent) {
    const id = reminderIdOf(event);
    if (!id) return;
    setReminderDraft({
      id,
      remindOn: event.date,
      note: event.title.replace(/^Reminder — /, ""),
      propertyId: event.propertyId,
    });
  }

  async function handleDeleteReminder(event: CalendarEvent) {
    const id = reminderIdOf(event);
    if (!id) return;
    if (!(await confirmDialog("Delete this reminder?"))) return;
    try {
      await deleteReminder(id);
      toast.success("Reminder deleted.");
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete this reminder.");
    }
  }

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const list = map.get(e.date) ?? [];
      list.push(e);
      map.set(e.date, list);
    }
    return map;
  }, [events]);

  const { dragOverIso, dropProps } = useReminderDrop(handleReminderDrop);

  const upcomingCount = events.filter((e) => !e.resolved && daysUntil(e.date) >= 0).length;

  function goPrev() {
    if (view === "month" || view === "list") setCursor((d) => subMonths(d, 1));
    else if (view === "week") setCursor((d) => subWeeks(d, 1));
    else setCursor((d) => subDays(d, 1));
  }
  function goNext() {
    if (view === "month" || view === "list") setCursor((d) => addMonths(d, 1));
    else if (view === "week") setCursor((d) => addWeeks(d, 1));
    else setCursor((d) => addDays(d, 1));
  }
  function goToday() {
    setCursor(new Date());
  }

  const rangeLabel =
    view === "day"
      ? format(cursor, "EEEE, MMMM d, yyyy")
      : view === "week"
        ? `${format(startOfWeek(cursor), "MMM d")} – ${format(endOfWeek(cursor), "MMM d, yyyy")}`
        : format(cursor, "MMMM yyyy");

  if (loading) {
    return (
      <div className="grid gap-8">
        <PageHero
          icon={HeroCalendarIcon}
          title="Calendar"
          tone="violet"
          subtitle="All your important dates in one calendar. Click a date to see what is due."
        />
        <div className="grid gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="card-elev p-4 flex items-center justify-between gap-2">
              <div className="grid gap-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="h-6 w-24 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-8">
      <PageHero
        icon={HeroCalendarIcon}
        title="Calendar"
        tone="violet"
        subtitle={
          upcomingCount > 0
            ? `${upcomingCount} upcoming item${upcomingCount === 1 ? "" : "s"} across protests, hearings, tax bills, and your own reminders.`
            : "All your important dates in one calendar. Click a date to see what is due."
        }
      >
        <button
          onClick={() =>
            setReminderDraft({
              id: null,
              remindOn: format(new Date(), "yyyy-MM-dd"),
              note: "",
              propertyId: null,
            })
          }
          className={heroButton}
        >
          <Plus className="h-3.5 w-3.5" /> Add reminder
        </button>
        <button onClick={() => setSyncOpen((o) => !o)} className={heroButtonGhost}>
          <RefreshCw className="h-3.5 w-3.5" /> Sync with Google Calendar
        </button>
        {events.length > 0 && (
          <button
            onClick={() => downloadIcs("corvuspt-tax-calendar.ics", events)}
            className={heroButtonGhost}
          >
            <Download className="h-3.5 w-3.5" /> Export all (.ics)
          </button>
        )}
      </PageHero>

      {hearingConflicts.length > 0 && (
        <div className="grid gap-3">
          {hearingConflicts.map((group) => (
            <HearingConflictBanner key={group.date} group={group} />
          ))}
        </div>
      )}

      {syncOpen && user && (
        <div className="grid gap-4 sm:grid-cols-2">
          <GoogleConnectSection userId={user.id} />
          <LinkSyncSection userId={user.id} />
        </div>
      )}

      <div className="card-elev p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <button
              onClick={goPrev}
              className="rounded-md p-2.5 hover:bg-secondary"
              aria-label={`Previous ${view === "list" ? "month" : view}`}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <h2 className="text-center font-semibold sm:min-w-56">{rangeLabel}</h2>
            <button
              onClick={goNext}
              className="rounded-md p-2.5 hover:bg-secondary"
              aria-label={`Next ${view === "list" ? "month" : view}`}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button onClick={goToday} className="btn-outline ml-1 text-xs">
              Today
            </button>
          </div>
          <div
            role="tablist"
            aria-label="Calendar view"
            className="inline-flex rounded-lg border border-border bg-secondary/40 p-0.5"
          >
            {VIEWS.map((v) => (
              <button
                key={v.id}
                role="tab"
                aria-selected={view === v.id}
                onClick={() => setViewMode(v.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  view === v.id
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          {view === "month" && (
            <MonthView
              cursor={cursor}
              eventsByDate={eventsByDate}
              dayDetail={dayDetail}
              onSelectDay={(iso) => setDayDetail((cur) => (cur === iso ? null : iso))}
              onEditReminder={openEditReminder}
              onAddReminder={(iso) =>
                setReminderDraft({ id: null, remindOn: iso, note: "", propertyId: null })
              }
              onOpenProperty={openProperty}
              dragOverIso={dragOverIso}
              dropProps={dropProps}
            />
          )}
          {view === "week" && (
            <WeekView
              cursor={cursor}
              eventsByDate={eventsByDate}
              onEditReminder={openEditReminder}
              onAddReminder={(iso) =>
                setReminderDraft({ id: null, remindOn: iso, note: "", propertyId: null })
              }
              onOpenProperty={openProperty}
              dragOverIso={dragOverIso}
              dropProps={dropProps}
            />
          )}
          {view === "day" && (
            <DayView
              cursor={cursor}
              eventsByDate={eventsByDate}
              onMarkPaid={handleMarkPaid}
              markingPaidId={markingPaidId}
              onEditReminder={openEditReminder}
              onDeleteReminder={handleDeleteReminder}
              onToggleReminderDone={handleToggleReminderDone}
              onToggleReminderMissed={handleToggleReminderMissed}
              onAddReminder={(iso) =>
                setReminderDraft({ id: null, remindOn: iso, note: "", propertyId: null })
              }
              onOpenProperty={openProperty}
            />
          )}
          {view === "list" && (
            <ListView
              cursor={cursor}
              eventsByDate={eventsByDate}
              onMarkPaid={handleMarkPaid}
              markingPaidId={markingPaidId}
              onEditReminder={openEditReminder}
              onDeleteReminder={handleDeleteReminder}
              onToggleReminderDone={handleToggleReminderDone}
              onToggleReminderMissed={handleToggleReminderMissed}
              onOpenProperty={openProperty}
            />
          )}
        </div>

        {view === "month" && dayDetail && (
          <div className="mt-5 border-t border-border pt-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">
                {format(new Date(dayDetail + "T00:00:00"), "EEEE, MMMM d")}
              </h3>
              <button
                type="button"
                onClick={() =>
                  setReminderDraft({ id: null, remindOn: dayDetail, note: "", propertyId: null })
                }
                className="btn-outline text-xs inline-flex items-center gap-1"
              >
                <Plus className="h-3 w-3" /> Add reminder
              </button>
            </div>
            <div className="mt-3 grid gap-3">
              {(eventsByDate.get(dayDetail) ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing on this day.</p>
              ) : (
                (eventsByDate.get(dayDetail) ?? []).map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    onMarkPaid={handleMarkPaid}
                    markingPaid={markingPaidId === event.propertyId}
                    onEditReminder={openEditReminder}
                    onDeleteReminder={handleDeleteReminder}
                    onToggleReminderDone={handleToggleReminderDone}
                    onToggleReminderMissed={handleToggleReminderMissed}
                    onOpenProperty={openProperty}
                  />
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {reminderDraft && (
        <ReminderFormModal
          draft={reminderDraft}
          properties={properties}
          onClose={() => setReminderDraft(null)}
          onSaved={() => {
            setReminderDraft(null);
            reload();
          }}
          onDeleted={() => {
            setReminderDraft(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

// ── Month view: a real calendar grid, one cell per day, every day of the month shown
// (blank leading/trailing days from neighbouring months included so the grid always reads as
// whole weeks) — up to 3 items per cell, "+N more" beyond that. Clicking a day opens its full
// agenda below the grid; a reminder can be dragged onto any cell to reschedule it.
function MonthView({
  cursor,
  eventsByDate,
  dayDetail,
  onSelectDay,
  onEditReminder,
  onAddReminder,
  onOpenProperty,
  dragOverIso,
  dropProps,
}: {
  cursor: Date;
  eventsByDate: Map<string, CalendarEvent[]>;
  dayDetail: string | null;
  onSelectDay: (iso: string) => void;
  onEditReminder: (event: CalendarEvent) => void;
  onAddReminder: (iso: string) => void;
  onOpenProperty: (propertyId: string) => void;
  dragOverIso: string | null;
  dropProps: (iso: string) => Record<string, unknown>;
}) {
  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor));
    const end = endOfWeek(endOfMonth(cursor));
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const iso = format(day, "yyyy-MM-dd");
          const dayEvents = eventsByDate.get(iso) ?? [];
          const inMonth = isSameMonth(day, cursor);
          const selected = dayDetail === iso;
          const VISIBLE = 3;
          const shown = dayEvents.slice(0, VISIBLE);
          const overflow = dayEvents.length - shown.length;
          return (
            <div
              key={iso}
              {...dropProps(iso)}
              className={`group relative min-h-24 rounded-md p-1 text-left text-sm transition-colors ${
                selected
                  ? "bg-accent/20 ring-1 ring-accent"
                  : dragOverIso === iso
                    ? "bg-accent/10 ring-1 ring-dashed ring-accent"
                    : "hover:bg-secondary/40"
              } ${!inMonth ? "text-muted-foreground/60" : ""}`}
            >
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => onSelectDay(iso)}
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                    isToday(day) ? "bg-primary text-primary-foreground" : ""
                  }`}
                >
                  {format(day, "d")}
                </button>
                <button
                  type="button"
                  onClick={() => onAddReminder(iso)}
                  aria-label="Add reminder on this day"
                  title="Add reminder"
                  className="hidden h-5 w-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground group-hover:grid"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
              {shown.length > 0 && (
                <div className="mt-0.5 grid gap-0.5">
                  {shown.map((e) => (
                    <EventChip
                      key={e.id}
                      event={e}
                      onClick={() =>
                        e.type === "reminder"
                          ? onEditReminder(e)
                          : e.propertyId
                            ? onOpenProperty(e.propertyId)
                            : onSelectDay(iso)
                      }
                    />
                  ))}
                  {overflow > 0 && (
                    <button
                      type="button"
                      onClick={() => onSelectDay(iso)}
                      className="pl-1 text-left text-[10px] leading-tight text-muted-foreground hover:text-foreground"
                    >
                      +{overflow} more
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Week view: 7 day-columns for the selected week. Real event data here is date-only for
// almost everything (see tax-calendar.ts) — an hour-by-hour grid would just be empty scaffolding
// with nothing real to place in it, so each column is a compact vertical list instead, same
// items as Month/List, just scoped to one week and easier to scan side by side.
function WeekView({
  cursor,
  eventsByDate,
  onEditReminder,
  onAddReminder,
  onOpenProperty,
  dragOverIso,
  dropProps,
}: {
  cursor: Date;
  eventsByDate: Map<string, CalendarEvent[]>;
  onEditReminder: (event: CalendarEvent) => void;
  onAddReminder: (iso: string) => void;
  onOpenProperty: (propertyId: string) => void;
  dragOverIso: string | null;
  dropProps: (iso: string) => Record<string, unknown>;
}) {
  const days = useMemo(
    () => eachDayOfInterval({ start: startOfWeek(cursor), end: endOfWeek(cursor) }),
    [cursor],
  );
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-7 sm:gap-2">
      {days.map((day) => {
        const iso = format(day, "yyyy-MM-dd");
        const dayEvents = eventsByDate.get(iso) ?? [];
        return (
          <div
            key={iso}
            {...dropProps(iso)}
            className={`group min-h-32 rounded-md border p-2 ${
              dragOverIso === iso
                ? "border-accent bg-accent/10"
                : isToday(day)
                  ? "border-primary/40 bg-primary/5"
                  : "border-border"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {format(day, "EEE d")}
              </div>
              <button
                type="button"
                onClick={() => onAddReminder(iso)}
                aria-label="Add reminder on this day"
                title="Add reminder"
                className="hidden h-5 w-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground group-hover:grid"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
            <div className="mt-1 grid gap-0.5">
              {dayEvents.length === 0 ? (
                <p className="text-[11px] text-muted-foreground/70">—</p>
              ) : (
                dayEvents.map((e) => (
                  <EventChip
                    key={e.id}
                    event={e}
                    onClick={() =>
                      e.type === "reminder"
                        ? onEditReminder(e)
                        : e.propertyId
                          ? onOpenProperty(e.propertyId)
                          : undefined
                    }
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Day view: one date's full agenda, same rich rows as List (Mark as Paid, Google, edit/
// delete a reminder), with its own prev/next day already handled by the page's own nav arrows.
function DayView({
  cursor,
  eventsByDate,
  onMarkPaid,
  markingPaidId,
  onEditReminder,
  onDeleteReminder,
  onToggleReminderDone,
  onToggleReminderMissed,
  onAddReminder,
  onOpenProperty,
}: {
  cursor: Date;
  eventsByDate: Map<string, CalendarEvent[]>;
  onMarkPaid: (propertyId: string) => void;
  markingPaidId: string | null;
  onEditReminder: (event: CalendarEvent) => void;
  onDeleteReminder: (event: CalendarEvent) => void;
  onToggleReminderDone: (event: CalendarEvent) => void;
  onToggleReminderMissed: (event: CalendarEvent) => void;
  onAddReminder: (iso: string) => void;
  onOpenProperty: (propertyId: string) => void;
}) {
  const iso = format(cursor, "yyyy-MM-dd");
  const dayEvents = eventsByDate.get(iso) ?? [];
  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {dayEvents.length} item{dayEvents.length === 1 ? "" : "s"}
        </p>
        <button
          type="button"
          onClick={() => onAddReminder(iso)}
          className="btn-outline text-xs inline-flex items-center gap-1"
        >
          <Plus className="h-3 w-3" /> Add reminder
        </button>
      </div>
      <div className="mt-3 grid gap-3">
        {dayEvents.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Nothing scheduled {isSameDay(cursor, new Date()) ? "today" : "this day"}.
          </div>
        ) : (
          dayEvents.map((event) => (
            <EventRow
              key={event.id}
              event={event}
              onMarkPaid={onMarkPaid}
              markingPaid={markingPaidId === event.propertyId}
              onEditReminder={onEditReminder}
              onDeleteReminder={onDeleteReminder}
              onToggleReminderDone={onToggleReminderDone}
              onToggleReminderMissed={onToggleReminderMissed}
              onOpenProperty={onOpenProperty}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── List view: only the dates in this month that actually have something on them, each with
// its full agenda — the original "concise, no dead days" view, kept as its own mode.
function ListView({
  cursor,
  eventsByDate,
  onMarkPaid,
  markingPaidId,
  onEditReminder,
  onDeleteReminder,
  onToggleReminderDone,
  onToggleReminderMissed,
  onOpenProperty,
}: {
  cursor: Date;
  eventsByDate: Map<string, CalendarEvent[]>;
  onMarkPaid: (propertyId: string) => void;
  markingPaidId: string | null;
  onEditReminder: (event: CalendarEvent) => void;
  onDeleteReminder: (event: CalendarEvent) => void;
  onToggleReminderDone: (event: CalendarEvent) => void;
  onToggleReminderMissed: (event: CalendarEvent) => void;
  onOpenProperty: (propertyId: string) => void;
}) {
  const key = format(cursor, "yyyy-MM");
  const monthDays = [...eventsByDate.entries()]
    .filter(([iso]) => iso.startsWith(key))
    .sort(([a], [b]) => a.localeCompare(b));

  if (monthDays.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Nothing scheduled in {format(cursor, "MMMM yyyy")}.
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      {monthDays.map(([iso, dayEvents]) => {
        const day = new Date(iso + "T00:00:00");
        const days = daysUntil(iso);
        return (
          <section key={iso} aria-label={format(day, "EEEE, MMMM d")}>
            <div className="flex items-baseline gap-3 border-b border-border pb-1.5">
              <div
                className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl text-center leading-none ${
                  isToday(day)
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-foreground"
                }`}
              >
                <span>
                  <span className="block text-lg font-semibold">{format(day, "d")}</span>
                  <span className="block text-[10px] uppercase tracking-wide opacity-80">
                    {format(day, "EEE")}
                  </span>
                </span>
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold">{format(day, "EEEE, MMMM d")}</h3>
                <p className="text-xs text-muted-foreground">
                  {days < 0
                    ? `${-days} day${days === -1 ? "" : "s"} ago`
                    : days === 0
                      ? "Today"
                      : days === 1
                        ? "Tomorrow"
                        : `In ${days} days`}
                  {" · "}
                  {dayEvents.length} item{dayEvents.length === 1 ? "" : "s"}
                </p>
              </div>
            </div>
            <div className="mt-3 grid gap-3">
              {dayEvents.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  onMarkPaid={onMarkPaid}
                  markingPaid={markingPaidId === event.propertyId}
                  onEditReminder={onEditReminder}
                  onDeleteReminder={onDeleteReminder}
                  onToggleReminderDone={onToggleReminderDone}
                  onToggleReminderMissed={onToggleReminderMissed}
                  onOpenProperty={onOpenProperty}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
