// The two CorvusPT pricing discounts, applied as real Stripe coupons (not
// baked into the unit amount) so Checkout shows the full list price with the
// discount as its own line. Mirrors src/lib/billing.ts's checkoutDiscountFor,
// which the UI uses to display the same rule.
//
// They don't stack — a franchise owner gets the franchise discount (50%
// forever), which already covers what the annual first-year offer (50% of
// the first year) would have given them.
import Stripe from "npm:stripe@17";

type CouponDef = {
  id: string;
  name: string;
  percent_off: number;
  duration: "once" | "forever" | "repeating";
  duration_in_months?: number;
  redeem_by?: number;
};

// "once" on an annual subscription = the first invoice = the first year.
// redeem_by makes Stripe itself refuse the coupon after the deadline, as a
// backstop to the date check in checkoutCouponFor.
// Nov 2026 pricing: paying the year upfront takes 50% off the first year —
// a standing offer (no deadline), annual subscriptions only. Replaces the
// launch coupon (corvuspt_launch_first_year_50), which had a Feb 2027
// deadline; a new id so the old coupon's redeem_by doesn't carry over.
const ANNUAL_FIRST_YEAR_COUPON: CouponDef = {
  id: "corvuspt_annual_first_year_50",
  name: "Paid annually — 50% off your first year",
  percent_off: 50,
  duration: "once",
};

const FRANCHISE_COUPON: CouponDef = {
  id: "corvuspt_franchise_50",
  name: "Franchise owner — 50% off",
  percent_off: 50,
  duration: "forever",
};

// Savings Protection carry-forward (see ./tax-carry-forward.ts): the proposed tax
// didn't change, so the year already paid covers the next one — the renewal
// invoice comes out at $0. "once" = just that one renewal.
export const CARRY_FORWARD_COUPON: CouponDef = {
  id: "corvuspt_carry_forward_year",
  name: "Savings Protection — prior year carried forward",
  percent_off: 100,
  duration: "once",
};

function stripeErrorCode(e: unknown): string | undefined {
  return e && typeof e === "object" ? (e as { code?: string }).code : undefined;
}

// Coupons live per Stripe account (test and live are separate), so rather
// than requiring someone to pre-create them in each dashboard, the first
// checkout in a mode creates the coupon under its fixed id. A concurrent
// first checkout racing this just hits resource_already_exists, which is fine.
export async function ensureCoupon(stripe: Stripe, def: CouponDef): Promise<string> {
  try {
    await stripe.coupons.retrieve(def.id);
    return def.id;
  } catch (e) {
    if (stripeErrorCode(e) !== "resource_missing") throw e;
  }
  try {
    await stripe.coupons.create(def);
  } catch (e) {
    if (stripeErrorCode(e) !== "resource_already_exists") throw e;
  }
  return def.id;
}

export type CheckoutDiscountKind = "franchise" | "launch";

export function checkoutDiscountKind(
  isFranchiseOwner: boolean,
  interval: "month" | "year" = "year",
): CheckoutDiscountKind | null {
  if (isFranchiseOwner) return "franchise";
  if (interval === "year") return "launch"; // the annual first-year 50%
  return null;
}

// The coupon id to attach to a new property subscription, or null for none.
export async function checkoutCouponFor(
  stripe: Stripe,
  isFranchiseOwner: boolean,
  interval: "month" | "year" = "year",
): Promise<{ kind: CheckoutDiscountKind; couponId: string } | null> {
  const kind = checkoutDiscountKind(isFranchiseOwner, interval);
  if (!kind) return null;
  const couponId = await ensureCoupon(
    stripe,
    kind === "franchise" ? FRANCHISE_COUPON : ANNUAL_FIRST_YEAR_COUPON,
  );
  return { kind, couponId };
}

// A Super-Admin-approved pricing exception (public.pricing_exceptions,
// executed by staff-approvals) as a Stripe coupon of its own.
export type PricingException = {
  id: string;
  percent_off: number;
  duration: "once" | "forever" | "repeating";
  duration_in_months: number | null;
};
export function exceptionCouponDef(x: PricingException): CouponDef {
  return {
    id: `corvuspt_exception_${x.id.replace(/-/g, "").slice(0, 20)}`,
    name: `Approved pricing exception — ${x.percent_off}% off`,
    percent_off: Number(x.percent_off),
    duration: x.duration,
    ...(x.duration === "repeating" ? { duration_in_months: x.duration_in_months ?? 12 } : {}),
  };
}

/** Standard discount vs an approved exception: Stripe takes one coupon, so the larger wins. */
export async function bestCheckoutCoupon(
  stripe: Stripe,
  isFranchiseOwner: boolean,
  exception: PricingException | null,
  interval: "month" | "year" = "year",
): Promise<{ kind: CheckoutDiscountKind | "exception"; couponId: string } | null> {
  const standard = checkoutDiscountKind(isFranchiseOwner, interval);
  if (exception && Number(exception.percent_off) >= (standard ? 50 : 0)) {
    return { kind: "exception", couponId: await ensureCoupon(stripe, exceptionCouponDef(exception)) };
  }
  return checkoutCouponFor(stripe, isFranchiseOwner, interval);
}
