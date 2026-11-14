// Deadlines, due dates and hearing dates are stored as plain dates
// ("2027-05-15"). `new Date("2027-05-15")` reads that as midnight UTC — which
// in Texas (UTC-6/-5) is the evening of May 14 — so the dashboard listed a
// May 15 protest deadline as 5/14/2027, and "is it past?" checks flipped to
// past from 6 pm the evening before the deadline day. These read a plain date
// as that calendar day where the customer is; full timestamps are unchanged.

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A plain "YYYY-MM-DD" as local midnight of that day; anything else as `new Date(s)`. */
export function parseDateOnly(s: string): Date {
  const m = DATE_ONLY.exec(s.trim());
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
}

/**
 * True once the date is behind us. A plain date stays current for its whole
 * day — a deadline is not "past" on the deadline day itself.
 */
export function isDatePast(s: string, now: Date = new Date()): boolean {
  const d = parseDateOnly(s);
  if (!DATE_ONLY.test(s.trim())) return d.getTime() < now.getTime();
  const nextDay = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return nextDay.getTime() <= now.getTime();
}
