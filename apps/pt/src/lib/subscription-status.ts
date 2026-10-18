// One rule for "is this property / BPP account paid?", used everywhere in
// the app (and mirrored by property_is_paid() / bpp_is_paid() in the database
// and the checkout functions — keep them in step).
//
// Stripe's status is stored as-is by stripe-webhook. A subscription keeps its
// access while Stripe retries a failed renewal ("past_due") and during a trial;
// treating those as unpaid used to send paying customers back to checkout.

/** Statuses that unlock the property's paid features. */
export const PAID_STATUSES = ["active", "trialing", "past_due"] as const;

/** Statuses meaning a subscription already exists — never sell a second one. */
export const LIVE_SUBSCRIPTION_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "incomplete",
  "unpaid",
] as const;

export function isPaidStatus(status: string | null | undefined): boolean {
  return !!status && (PAID_STATUSES as readonly string[]).includes(status);
}

export function hasLiveSubscription(status: string | null | undefined): boolean {
  return !!status && (LIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);
}

/** A renewal payment failed and Stripe is retrying — still paid, but the card needs updating. */
export function isPaymentPastDue(status: string | null | undefined): boolean {
  return status === "past_due" || status === "unpaid";
}
