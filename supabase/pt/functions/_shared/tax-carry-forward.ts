// The carry-forward rule behind CorvusPT Savings Protection: a property's year of
// annual subscription counts as one payment, and at renewal —
//
//   - if the proposed tax amount hasn't changed from the previous tax year, the
//     year already paid carries forward and the renewal is free;
//   - if it has changed, the renewal is charged the normal subscription fee;
//   - if either year's amount is missing, it's charged normally (business call:
//     treat "can't tell" as "changed").
//
// "Proposed tax amount" = the county bill's amount_due recorded in public.tax_bills
// for each tax year. Pure, no Deno/Stripe imports, so apps/pt's vitest can test it
// (see src/lib/tax-carry-forward.test.ts); apply-tax-carry-forward does the I/O.

export type TaxBillRow = {
  tax_year: number | null;
  amount_due: number | null;
  created_at: string;
};

export type CarryForwardDecision =
  | { result: "carry_forward"; latestYear: number; previousYear: number; amount: number }
  | {
      result: "charge";
      reason: "changed" | "missing_data";
      latestYear: number | null;
      previousYear: number | null;
    };

// Re-entered or AI-extracted bills can differ by cents of rounding — that isn't a
// real change in the proposed tax.
export const TAX_AMOUNT_TOLERANCE_DOLLARS = 1;

export function decideCarryForward(bills: TaxBillRow[]): CarryForwardDecision {
  // A year can have more than one row (a corrected bill re-uploaded) — the most
  // recently recorded one wins.
  const byYear = new Map<number, { amount: number; createdAt: string }>();
  for (const b of bills) {
    if (b.tax_year == null || b.amount_due == null) continue;
    const prev = byYear.get(b.tax_year);
    if (!prev || b.created_at > prev.createdAt) {
      byYear.set(b.tax_year, { amount: Number(b.amount_due), createdAt: b.created_at });
    }
  }
  if (byYear.size === 0) {
    return { result: "charge", reason: "missing_data", latestYear: null, previousYear: null };
  }

  const latestYear = Math.max(...byYear.keys());
  const previousYear = latestYear - 1;
  const latest = byYear.get(latestYear)!;
  const previous = byYear.get(previousYear);
  if (!previous) {
    return { result: "charge", reason: "missing_data", latestYear, previousYear: null };
  }

  if (Math.abs(latest.amount - previous.amount) <= TAX_AMOUNT_TOLERANCE_DOLLARS) {
    return { result: "carry_forward", latestYear, previousYear, amount: previous.amount };
  }
  return { result: "charge", reason: "changed", latestYear, previousYear };
}

// Renewals this close are decided now; further out, the bills may not be in yet.
export const RENEWAL_WINDOW_DAYS = 14;

export function isRenewalDue(currentPeriodEndUnix: number, now: Date = new Date()): boolean {
  const msLeft = currentPeriodEndUnix * 1000 - now.getTime();
  return msLeft > 0 && msLeft <= RENEWAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}
