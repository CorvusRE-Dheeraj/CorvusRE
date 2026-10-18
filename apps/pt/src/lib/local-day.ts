// Calendar days ("2026-10-19") as local-midnight Dates, safely.
//
// Dates reach the app both as plain days and as full timestamps
// ("2026-10-19T00:00:00+00:00" from timestamptz columns). Appending
// "T00:00:00" to a timestamp makes an Invalid Date, and toISOString() /
// date-fns format() then throw — which once blanked the whole case page.
// Everything here takes the first 10 characters and returns null (never
// throws) when the input isn't a real day.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local midnight of the day `iso` names, or null when it isn't a valid day. */
export function localDay(iso: string | null | undefined): Date | null {
  if (!iso || typeof iso !== "string") return null;
  const day = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const d = new Date(`${day}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "YYYY-MM-DD" of a local Date (not via toISOString, which shifts to UTC). */
export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The day `days` after `iso`, or null when `iso` isn't a valid day. */
export function addDaysIso(iso: string | null | undefined, days: number): string | null {
  const d = localDay(iso);
  if (!d) return null;
  d.setDate(d.getDate() + days);
  return isoDay(d);
}

/** Whole days from today (local) until `iso`; negative when past; null when invalid. */
export function daysUntilIso(
  iso: string | null | undefined,
  now: Date = new Date(),
): number | null {
  const d = localDay(iso);
  if (!d) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d.getTime() - today.getTime()) / DAY_MS);
}

/** A day for display, e.g. "Oct 19, 2026"; `fallback` when invalid. */
export function formatDay(
  iso: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" },
  fallback = "—",
): string {
  const d = localDay(iso);
  return d ? d.toLocaleDateString("en-US", opts) : fallback;
}
