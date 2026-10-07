// The two CorvusPT pricing discounts, applied as real Stripe coupons (not
// baked into the unit amount) so Checkout shows the full $3,588/yr list price
// with the discount as its own line. Mirrors src/lib/billing.ts's
// LAUNCH_DISCOUNT_DEADLINE / checkoutDiscountFor, which the UI uses to
// display the same rule.
//
// They don't stack — a franchise owner gets the franchise discount (50%
// forever), which already covers what the launch offer (50% of the first
// year) would have given them.
import Stripe from "npm:stripe@17";

// Midnight Feb 1 2027, US Central (CST, UTC-6).
export const LAUNCH_DISCOUNT_DEADLINE = new Date("2027-02-01T06:00:00Z");

type CouponDef = {
  id: string;
  name: string;
  percent_off: number;
  duration: "once" | "forever";
  redeem_by?: number;
};

// "once" on an annual subscription = the first invoice = the first year.
// redeem_by makes Stripe itself refuse the coupon after the deadline, as a
// backstop to the date check in checkoutCouponFor.
const LAUNCH_COUPON: CouponDef = {
  id: "corvuspt_launch_first_year_50",
  name: "Launch offer — 50% off your first year",
  percent_off: 50,
  duration: "once",
  redeem_by: Math.floor(LAUNCH_DISCOUNT_DEADLINE.getTime() / 1000),
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
  now: Date = new Date(),
): CheckoutDiscountKind | null {
  if (isFranchiseOwner) return "franchise";
  if (now < LAUNCH_DISCOUNT_DEADLINE) return "launch";
  return null;
}

// The coupon id to attach to a new property subscription, or null for none.
export async function checkoutCouponFor(
  stripe: Stripe,
  isFranchiseOwner: boolean,
): Promise<{ kind: CheckoutDiscountKind; couponId: string } | null> {
  const kind = checkoutDiscountKind(isFranchiseOwner);
  if (!kind) return null;
  const couponId = await ensureCoupon(stripe, kind === "franchise" ? FRANCHISE_COUPON : LAUNCH_COUPON);
  return { kind, couponId };
}
