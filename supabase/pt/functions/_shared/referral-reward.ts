// One month free for whoever referred a new paying customer. Lives here (not
// inline in stripe-webhook) so the claim/retry logic can be tested with mocks —
// it deliberately imports nothing Deno- or Stripe-specific (structural types
// below), see referral-reward.test.mts.
//
// The credit is the REFERRER's own real current monthly total (their most
// recently created active subscription), applied through Stripe's customer
// balance (a negative balance transaction), which Stripe takes off their next
// invoice automatically — not a coupon, since this per-property pricing has no
// fixed Price id to attach one to.
//
// Two properties this file exists to guarantee:
//   1. NEVER credited twice for one referral. Stripe retries webhooks and can
//      deliver them concurrently, so "check the flag, credit, then set the
//      flag" let two deliveries both pass the check. Now the flag is CLAIMED
//      first with a single conditional update (only one caller gets a row
//      back), and the credit also carries an idempotency key, so even an
//      ambiguous failure-then-retry can't double-pay.
//   2. NEVER silently lost. If the referrer wasn't a paying customer yet when
//      the referred person subscribed, nothing is claimed — and
//      grantPendingRewardsForReferrer() runs whenever a referrer's own
//      subscription is active, paying out every referral still waiting.
//
// Never throws: a failure here must not fail the subscription sync that
// already succeeded.

// deno-lint-ignore no-explicit-any
type Query = any;
export type AdminLike = { from: (table: string) => Query };
export type StripeLike = {
  subscriptions: {
    retrieve: (
      id: string,
      opts?: unknown,
    ) => Promise<{ items: { data: { price: { unit_amount: number | null }; quantity?: number | null }[] } }>;
  };
  customers: {
    createBalanceTransaction: (
      customerId: string,
      params: { amount: number; currency: string; description: string },
      opts?: { idempotencyKey?: string },
    ) => Promise<unknown>;
  };
};

const MAX_PENDING_PER_PASS = 20;

async function hasActiveSubscription(admin: AdminLike, userId: string): Promise<boolean> {
  const [{ data: props }, { data: bpp }] = await Promise.all([
    admin
      .from("properties")
      .select("stripe_subscription_id")
      .eq("user_id", userId)
      .eq("subscription_status", "active")
      .not("stripe_subscription_id", "is", null)
      .limit(1),
    admin
      .from("bpp_accounts")
      .select("stripe_subscription_id")
      .eq("user_id", userId)
      .eq("subscription_status", "active")
      .not("stripe_subscription_id", "is", null)
      .limit(1),
  ]);
  return (props?.length ?? 0) + (bpp?.length ?? 0) > 0;
}

export async function grantReferralRewardIfDue(
  stripe: StripeLike,
  admin: AdminLike,
  referredUserId: string,
): Promise<void> {
  try {
    const { data: referred } = await admin
      .from("profiles")
      .select("referred_by, referral_reward_granted_at")
      .eq("id", referredUserId)
      .maybeSingle();
    const referrerId = referred?.referred_by as string | null | undefined;
    if (!referrerId || referred?.referral_reward_granted_at) return;

    const { data: referrer } = await admin
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", referrerId)
      .maybeSingle();
    const customerId = referrer?.stripe_customer_id as string | null | undefined;
    if (!customerId) return; // referrer isn't a paying customer yet — picked up later

    const [{ data: activeProps }, { data: activeBpp }] = await Promise.all([
      admin
        .from("properties")
        .select("stripe_subscription_id, created_at")
        .eq("user_id", referrerId)
        .eq("subscription_status", "active")
        .not("stripe_subscription_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1),
      admin
        .from("bpp_accounts")
        .select("stripe_subscription_id, created_at")
        .eq("user_id", referrerId)
        .eq("subscription_status", "active")
        .not("stripe_subscription_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    const candidates = [...(activeProps ?? []), ...(activeBpp ?? [])].sort(
      (a: { created_at: unknown }, b: { created_at: unknown }) =>
        String(b.created_at).localeCompare(String(a.created_at)),
    );
    const subscriptionId = candidates[0]?.stripe_subscription_id as string | undefined;
    if (!subscriptionId) return; // referrer has no active subscription — picked up later

    const referrerSub = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["items.data.price"],
    });
    const creditCents = referrerSub.items.data.reduce(
      (sum, item) => sum + (item.price.unit_amount ?? 0) * (item.quantity ?? 1),
      0,
    );
    if (creditCents <= 0) return;

    // Claim first. Only the caller whose conditional update actually flips
    // the flag gets a row back and goes on to credit.
    const { data: claimed, error: claimErr } = await admin
      .from("profiles")
      .update({ referral_reward_granted_at: new Date().toISOString() })
      .eq("id", referredUserId)
      .is("referral_reward_granted_at", null)
      .select("id");
    if (claimErr) throw claimErr;
    if (!claimed || claimed.length === 0) return; // another delivery already took it

    try {
      await stripe.customers.createBalanceTransaction(
        customerId,
        {
          amount: -creditCents,
          currency: "usd",
          description: "CorvusPT referral reward — one month free for referring a new customer",
        },
        { idempotencyKey: `referral-reward:${referredUserId}` },
      );
    } catch (err) {
      // The credit didn't land: give the claim back so a later event retries.
      // (If it DID land but the response was lost, the idempotency key makes
      // that retry return the same transaction instead of paying again.)
      await admin
        .from("profiles")
        .update({ referral_reward_granted_at: null })
        .eq("id", referredUserId);
      throw err;
    }
  } catch (err) {
    console.error("Referral reward grant failed (subscription sync above still succeeded):", err);
  }
}

// Called for a user whose own subscription is (now) active: pays out every
// referral of theirs that converted before they were a paying customer.
export async function grantPendingRewardsForReferrer(
  stripe: StripeLike,
  admin: AdminLike,
  referrerUserId: string,
): Promise<void> {
  try {
    const { data: pending } = await admin
      .from("profiles")
      .select("id")
      .eq("referred_by", referrerUserId)
      .is("referral_reward_granted_at", null)
      .limit(MAX_PENDING_PER_PASS);
    for (const row of pending ?? []) {
      // Only a referral that actually converted counts — a referred person
      // who signed up but never subscribed earns the referrer nothing.
      if (await hasActiveSubscription(admin, row.id as string)) {
        await grantReferralRewardIfDue(stripe, admin, row.id as string);
      }
    }
  } catch (err) {
    console.error("Pending referral rewards pass failed:", err);
  }
}

// The one call the webhook makes: as the referred customer (they just became
// paying) AND as a referrer (they just became able to be paid).
export async function runReferralRewards(
  stripe: StripeLike,
  admin: AdminLike,
  userId: string,
): Promise<void> {
  await grantReferralRewardIfDue(stripe, admin, userId);
  await grantPendingRewardsForReferrer(stripe, admin, userId);
}
