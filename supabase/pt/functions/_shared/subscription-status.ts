// Mirrors apps/pt/src/lib/subscription-status.ts and property_is_paid() in
// supabase/pt/subscription-status.sql — keep the three in step.

/** A subscription already exists in Stripe — never start a second checkout for it. */
export const LIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due", "incomplete", "unpaid"];

export function hasLiveSubscription(status: string | null | undefined): boolean {
  return !!status && LIVE_SUBSCRIPTION_STATUSES.includes(status);
}

/** The customer-facing reason checkout is refused for an existing subscription. */
export function existingSubscriptionMessage(status: string, what: string): string {
  return status === "past_due" || status === "unpaid"
    ? `This ${what} already has a subscription — its last payment didn't go through. Update your card under Billing instead of subscribing again.`
    : status === "incomplete"
      ? `This ${what}'s subscription payment is still being completed. Finish it under Billing instead of subscribing again.`
      : `This ${what} already has an active subscription.`;
}
