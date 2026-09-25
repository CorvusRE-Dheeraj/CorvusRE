// "One hour before" alerts — the pure timing rules. KEEP IN SYNC BY HAND with
// supabase/pt/functions/_shared/alert-time.ts (the edge function copy; the browser and Deno can't share a file).
//
// Two kinds of moment:
//  - timed:        an ARB hearing or informal review that has a real start time
//                  (extracted from the county notice) — alert one hour before it starts.
//  - close_of_day: a date-only deadline (protest deadline, tax due, penalty date, BPP
//                  protest deadline). These have no time on file, so the "deadline" is
//                  taken as 5:00 PM Central — a typical county-office closing time — and
//                  the alert lands one hour before, at 4:00 PM. Counties differ (online
//                  filing often runs later), so the message says to confirm the cutoff.
// Everything is read in Texas time (America/Chicago), whatever the server's zone.
export const ALERT_ZONE = "America/Chicago";
export const CLOSE_HOUR_CENTRAL = 17;
export const LEAD_MS = 60 * 60 * 1000;

export type AlertKind = "timed" | "close_of_day";
export type AlertTarget = { dueMs: number; kind: AlertKind };

// "9:00 AM", "1:30 pm", "09:00", "14:05", "9 AM" → 24-hour clock, or null.
export function parseClockTime(raw: string | null | undefined): { h: number; m: number } | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?\.?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const mer = m[3]?.toLowerCase();
  if (min > 59) return null;
  if (mer) {
    if (h < 1 || h > 12) return null;
    if (mer === "p" && h < 12) h += 12;
    if (mer === "a" && h === 12) h = 0;
  } else if (h > 23) {
    return null;
  }
  return { h, m: min };
}

// The offset (local − UTC, in ms) that America/Chicago has at the given instant.
function zoneOffsetMs(ms: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ALERT_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(ms / 1000) * 1000;
}

// A wall-clock time in Texas (date "YYYY-MM-DD" + hour/minute) → the real instant.
export function centralToUtcMs(date: string, h: number, m: number): number {
  const [y, mo, d] = date.slice(0, 10).split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, m);
  const first = guess - zoneOffsetMs(guess);
  return guess - zoneOffsetMs(first);
}

const CLOSE_OF_DAY_PREFIXES = new Set([
  "protest-deadline",
  "bpp-protest-deadline",
  "tax-due",
  "tax-penalty",
]);

// `key` is the calendar event key/id ("hearing:<id>", "protest-deadline:<id>", …).
export function alertTarget(
  key: string,
  date: string,
  time: string | null | undefined,
): AlertTarget | null {
  const prefix = key.split(":")[0];
  if (prefix === "hearing" || prefix === "informal-review") {
    const t = parseClockTime(time);
    return t ? { dueMs: centralToUtcMs(date, t.h, t.m), kind: "timed" } : null;
  }
  if (CLOSE_OF_DAY_PREFIXES.has(prefix)) {
    return { dueMs: centralToUtcMs(date, CLOSE_HOUR_CENTRAL, 0), kind: "close_of_day" };
  }
  return null;
}

// True during the last hour before the moment (and not after it).
export function inAlertWindow(dueMs: number, nowMs: number): boolean {
  return nowMs >= dueMs - LEAD_MS && nowMs < dueMs;
}

export function minutesLeft(dueMs: number, nowMs: number): number {
  return Math.max(1, Math.round((dueMs - nowMs) / 60000));
}
