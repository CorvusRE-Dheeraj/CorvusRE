// The cancellation rule for CorvusPT property subscriptions (Nov 2026
// pricing). Kept identical to supabase/pt/functions/_shared/commitment.ts —
// commitment.test.ts checks the two files match.
//
// Monthly plans: a 12-month commitment. Notice can be given once the 13th
// month is complete — during month 14 — and the plan ends 60 days after the
// notice. If no notice is given, the next commitment cycle starts at the
// beginning of month 15, so each cycle is 14 months long.
//
// Annual plans are paid upfront: cancelling stops the renewal, and the plan
// runs to the end of the year already paid.

export const COMMITMENT_MONTHS = 12;
export const CYCLE_MONTHS = 14; // 12 committed + month 13 + month 14 (notice window)
export const NOTICE_DAYS = 60;

/** Adds calendar months, clamping to the month's last day (Jan 31 + 1 → Feb 28/29). */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

export type CancelDecision =
  | { allowed: true; endsAt: Date | null; atPeriodEnd: boolean }
  | { allowed: false; windowOpens: Date; windowCloses: Date };

/**
 * May this subscription be cancelled now, and when would it end?
 * `endsAt` null + atPeriodEnd = at the end of the period already paid.
 */
export function cancelDecision(
  interval: "month" | "year",
  startedAt: Date,
  now: Date = new Date(),
): CancelDecision {
  if (interval === "year") return { allowed: true, endsAt: null, atPeriodEnd: true };
  let cycleStart = startedAt;
  while (addMonths(cycleStart, CYCLE_MONTHS) <= now)
    cycleStart = addMonths(cycleStart, CYCLE_MONTHS);
  const windowOpens = addMonths(cycleStart, COMMITMENT_MONTHS + 1);
  const windowCloses = addMonths(cycleStart, CYCLE_MONTHS);
  if (now < windowOpens) return { allowed: false, windowOpens, windowCloses };
  return {
    allowed: true,
    endsAt: new Date(now.getTime() + NOTICE_DAYS * 24 * 60 * 60 * 1000),
    atPeriodEnd: false,
  };
}
