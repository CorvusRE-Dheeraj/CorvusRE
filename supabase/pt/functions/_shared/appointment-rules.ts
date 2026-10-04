// Appointment scheduling rules for "Schedule a Call or Virtual Meeting". Pure — no
// I/O. KEEP IN SYNC BY HAND with apps/pt/src/lib/appointment-rules.ts (the browser
// copy, which the admin screen and the tests use; the edge functions here are the
// source of truth for what can actually be booked).
//
// The rules:
//  - Monday–Friday, 10:00 AM–2:00 PM Central; each appointment is 60 minutes.
//  - Bookable no sooner than 2 days ahead (same-day and next-day are closed).
//  - No slots on US federal holidays, nor on days/slots an admin blocked.
//  - At least 2 hours between appointments (end of one → start of the next).
//    With 60-minute visits inside a 10–2 window that means two a day at most:
//    10:00 AM and 1:00 PM (or any pair 3+ hours apart).
//  - Bookings open up to 60 days ahead.
export const APPT_ZONE = "America/Chicago";
export const APPT_MINUTES = 60;
export const APPT_GAP_MINUTES = 120;
export const MIN_DAYS_AHEAD = 2;
export const MAX_DAYS_AHEAD = 60;
// Slot start hours (Central). The last visit must END by 2:00 PM, so it starts at 1:00 PM.
export const SLOT_HOURS = [10, 11, 12, 13] as const;

export type SlotKey = "10:00" | "11:00" | "12:00" | "13:00";
export const slotKey = (hour: number): SlotKey => `${String(hour).padStart(2, "0")}:00` as SlotKey;

export function slotLabel(key: string): string {
  const h = Number(key.slice(0, 2));
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h % 12 === 0 ? 12 : h % 12}:00 ${suffix}`;
}

// ── US federal holidays (with the usual Saturday→Friday / Sunday→Monday observance) ──
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month, 1 + offset + (n - 1) * 7));
}
function lastWeekday(year: number, month: number, weekday: number): Date {
  const last = new Date(Date.UTC(year, month + 1, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return new Date(Date.UTC(year, month + 1, 0 - offset));
}
function observed(d: Date): Date {
  const day = d.getUTCDay();
  if (day === 6) return new Date(d.getTime() - 86_400_000);
  if (day === 0) return new Date(d.getTime() + 86_400_000);
  return d;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function federalHolidays(year: number): { date: string; name: string }[] {
  const fixed = (m: number, day: number) => observed(new Date(Date.UTC(year, m, day)));
  return [
    { date: iso(fixed(0, 1)), name: "New Year's Day" },
    { date: iso(nthWeekday(year, 0, 1, 3)), name: "Martin Luther King Jr. Day" },
    { date: iso(nthWeekday(year, 1, 1, 3)), name: "Presidents' Day" },
    { date: iso(lastWeekday(year, 4, 1)), name: "Memorial Day" },
    { date: iso(fixed(5, 19)), name: "Juneteenth" },
    { date: iso(fixed(6, 4)), name: "Independence Day" },
    { date: iso(nthWeekday(year, 8, 1, 1)), name: "Labor Day" },
    { date: iso(nthWeekday(year, 9, 1, 2)), name: "Columbus Day" },
    { date: iso(fixed(10, 11)), name: "Veterans Day" },
    { date: iso(nthWeekday(year, 10, 4, 4)), name: "Thanksgiving" },
    { date: iso(fixed(11, 25)), name: "Christmas Day" },
  ];
}

export function holidayName(date: string): string | null {
  const year = Number(date.slice(0, 4));
  // An observed date can land in the neighbouring year (New Year's Day on a Saturday).
  for (const y of [year, year + 1]) {
    const h = federalHolidays(y).find((x) => x.date === date);
    if (h) return h.name;
  }
  return null;
}

// ── Time helpers (America/Chicago) ──
function zoneOffsetMs(ms: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APPT_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** A wall-clock time in Texas → the real instant (ms). */
export function centralToUtcMs(date: string, hour: number, minute = 0): number {
  const [y, mo, d] = date.slice(0, 10).split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, d, hour, minute);
  const first = guess - zoneOffsetMs(guess);
  return guess - zoneOffsetMs(first);
}

/** Today's calendar date in Texas (YYYY-MM-DD). */
export function centralToday(nowMs = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APPT_ZONE }).format(new Date(nowMs));
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return iso(new Date(Date.UTC(y, m - 1, d + days)));
}

export function isWeekday(date: string): boolean {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5;
}

export const earliestBookableDate = (nowMs = Date.now()) => addDays(centralToday(nowMs), MIN_DAYS_AHEAD);
export const latestBookableDate = (nowMs = Date.now()) => addDays(centralToday(nowMs), MAX_DAYS_AHEAD);

// ── Availability ──
export type Booked = { startMs: number };
// An admin block: a whole day (start = null), or one slot on a day.
export type Block = { date: string; slot: string | null };

/** True if a new visit at `startMs` keeps 2 hours clear of every existing one. */
export function respectsGap(startMs: number, booked: Booked[]): boolean {
  const minStep = (APPT_MINUTES + APPT_GAP_MINUTES) * 60_000; // start-to-start distance
  return booked.every((b) => Math.abs(b.startMs - startMs) >= minStep);
}

/** Why a specific slot can't be booked, or null when it can. */
export function slotProblem(
  date: string,
  slot: string,
  booked: Booked[],
  blocks: Block[],
  nowMs = Date.now(),
): string | null {
  if (!SLOT_HOURS.some((h) => slotKey(h) === slot)) return "That time isn't one of our appointment slots.";
  if (!isWeekday(date)) return "Appointments are Monday to Friday.";
  if (date < earliestBookableDate(nowMs)) return "Appointments need at least 2 days' notice.";
  if (date > latestBookableDate(nowMs)) return "That date is too far ahead to book yet.";
  if (holidayName(date)) return "We're closed that day (holiday).";
  if (blocks.some((b) => b.date === date && (b.slot === null || b.slot === slot))) {
    return "That time isn't available.";
  }
  const startMs = centralToUtcMs(date, Number(slot.slice(0, 2)));
  if (!respectsGap(startMs, booked)) return "That time has just been taken.";
  return null;
}

/** Open slots for one day (empty when the day is closed or full). */
export function openSlotsForDate(
  date: string,
  booked: Booked[],
  blocks: Block[],
  nowMs = Date.now(),
): SlotKey[] {
  return SLOT_HOURS.map(slotKey).filter((s) => slotProblem(date, s, booked, blocks, nowMs) === null);
}

/** date → open slots, for every bookable day in [from, to] that has at least one. */
export function openSlotsInRange(
  from: string,
  to: string,
  booked: Booked[],
  blocks: Block[],
  nowMs = Date.now(),
): Record<string, SlotKey[]> {
  const out: Record<string, SlotKey[]> = {};
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const slots = openSlotsForDate(d, booked, blocks, nowMs);
    if (slots.length) out[d] = slots;
  }
  return out;
}
