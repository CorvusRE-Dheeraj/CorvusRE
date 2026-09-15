import type { CalendarEvent } from "./tax-calendar";
import { EVENT_TYPE_LABEL } from "./tax-calendar";

// Minimal hand-rolled ICS (RFC 5545) generator — no npm dependency needed, the
// format is plain text. Covers only what we need: all-day VEVENTs with a stable UID
// so re-downloading/re-importing the same event updates it in place instead of
// duplicating.
function escapeIcsText(text: string): string {
  return text.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
}

function dateStamp(iso: string): string {
  return iso.replace(/-/g, "");
}

function buildIcsEvent(event: CalendarEvent): string {
  const start = dateStamp(event.date);
  const end = new Date(event.date + "T00:00:00Z");
  end.setUTCDate(end.getUTCDate() + 1);
  const endStamp = dateStamp(end.toISOString().slice(0, 10));
  const details = `${EVENT_TYPE_LABEL[event.type]}${
    event.amount != null ? ` — $${event.amount.toLocaleString()}` : ""
  } — via CorvusPT.ai`;

  return [
    "BEGIN:VEVENT",
    `UID:corvusrf-${event.id}@corvusre.com`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z`,
    `DTSTART;VALUE=DATE:${start}`,
    `DTEND;VALUE=DATE:${endStamp}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(details)}`,
    "END:VEVENT",
  ].join("\r\n");
}

export function buildIcsCalendar(events: CalendarEvent[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CorvusPT.ai//Tax Calendar//EN",
    "CALSCALE:GREGORIAN",
    ...events.map(buildIcsEvent),
    "END:VCALENDAR",
  ].join("\r\n");
}

export function downloadIcs(filename: string, events: CalendarEvent[]): void {
  const blob = new Blob([buildIcsCalendar(events)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
