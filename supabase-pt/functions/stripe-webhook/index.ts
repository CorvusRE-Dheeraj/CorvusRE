// Deploy via CLI: `supabase functions deploy stripe-webhook`.
// Secrets: STRIPE_SECRET_KEY_TEST (or the legacy STRIPE_SECRET_KEY),
// optionally STRIPE_SECRET_KEY_LIVE, and one or more of STRIPE_WEBHOOK_SECRET
// / STRIPE_WEBHOOK_SECRET_TEST / STRIPE_WEBHOOK_SECRET_LIVE (the incoming
// signature is checked against each). After deploying, register this
// function's URL as a webhook endpoint in the Stripe Dashboard — in BOTH test
// and live mode once you have a live account — subscribed to
// checkout.session.completed, customer.subscription.created,
// customer.subscription.updated, and customer.subscription.deleted.
//
// No Supabase auth here — Stripe calls this directly and authenticates via an HMAC
// signature (verified below) instead of a Supabase JWT. The service-role client is
// used to write to profiles/properties, bypassing RLS, since there is no end-user
// session.
//
// One real, independent Stripe subscription per PROPERTY or BPP ACCOUNT (not
// one shared subscription per customer with bracket quantities, as before) —
// every event here is keyed by which properties/bpp_accounts row a
// subscription belongs to (matched via metadata.subjectType at checkout, or
// by stripe_subscription_id thereafter, checking properties then
// bpp_accounts), not by customer alone, since one customer can now have many
// active subscriptions — of either kind — at once.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import type { Bracket, BppBracket, Tier } from "../_shared/pricing.ts";
import { sendPurchaseConfirmationEmail, sendCancellationEmail } from "../_shared/purchase-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, stripe-signature",
  "Content-Type": "application/json",
};

// profiles.plan is a coarse, account-level signal only now (see its own
// comment in src/lib/billing.ts) — "the tier of this customer's most
// recently created active subscription, property or BPP account,"
// recomputed here after every subscription change. Never touched for a
// 'beta' account: that's an unconditional, non-Stripe grant (see
// handle_new_user() in schema.sql) that must never be overwritten by
// ordinary subscription activity.
async function syncProfilePlan(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
): Promise<void> {
  const { data: profile } = await adminClient
    .from("profiles")
    .select("plan")
    .eq("id", userId)
    .maybeSingle();
  if (profile?.plan === "beta") return;

  const [{ data: activeProps }, { data: activeBpp }] = await Promise.all([
    adminClient
      .from("properties")
      .select("plan_tier, created_at")
      .eq("user_id", userId)
      .eq("subscription_status", "active")
      .order("created_at", { ascending: false })
      .limit(1),
    adminClient
      .from("bpp_accounts")
      .select("plan_tier, created_at")
      .eq("user_id", userId)
      .eq("subscription_status", "active")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  const candidates = [...(activeProps ?? []), ...(activeBpp ?? [])].sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at)),
  );
  const mostRecentTier = candidates[0]?.plan_tier as string | null | undefined;
  await adminClient
    .from("profiles")
    .update({ plan: mostRecentTier ?? "free_ai_review" })
    .eq("id", userId);
}

// One month free for whoever referred this NEW paying customer — real
// business rule ("each referral gives one month free"), so the credit
// amount is the REFERRER's own real current monthly total, never a guessed
// flat dollar figure. Granted via Stripe's customer balance (a negative
// balance transaction), which Stripe applies to the referrer's own next
// invoice(s) automatically — not a coupon/promo code, which would need
// per-price setup this ad hoc per-property pricing doesn't have a fixed
// Price id for (see create-checkout-session's own comment).
//
// A customer can now have MANY active property subscriptions at once (one
// per property) rather than a single shared one — there's no longer one
// canonical "their subscription" to read. Uses the referrer's most
// recently created active property subscription's own real monthly total
// as the credit amount, a reasonable real-money proxy for "their current
// spend" without summing every subscription they have.
//
// referral_reward_granted_at (on the REFERRED user's own row, set here)
// is the one-time guard — if this specific referred user's checkout ever
// fires checkout.session.completed again (e.g. they cancel and
// re-subscribe), the referrer is never paid out twice for the same
// referral. Never throws: a failure here must not roll back or fail the
// primary subscription sync above, which already succeeded.
async function grantReferralRewardIfDue(
  stripe: Stripe,
  adminClient: ReturnType<typeof createClient>,
  referredUserId: string,
): Promise<void> {
  try {
    const { data: referred } = await adminClient
      .from("profiles")
      .select("referred_by, referral_reward_granted_at")
      .eq("id", referredUserId)
      .maybeSingle();
    const referrerId = referred?.referred_by as string | null | undefined;
    if (!referrerId || referred?.referral_reward_granted_at) return;

    const { data: referrer } = await adminClient
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", referrerId)
      .maybeSingle();
    const customerId = referrer?.stripe_customer_id as string | null | undefined;
    if (!customerId) return; // referrer isn't a paying customer themselves yet

    const [{ data: activeProps }, { data: activeBpp }] = await Promise.all([
      adminClient
        .from("properties")
        .select("stripe_subscription_id, created_at")
        .eq("user_id", referrerId)
        .eq("subscription_status", "active")
        .not("stripe_subscription_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1),
      adminClient
        .from("bpp_accounts")
        .select("stripe_subscription_id, created_at")
        .eq("user_id", referrerId)
        .eq("subscription_status", "active")
        .not("stripe_subscription_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    const candidates = [...(activeProps ?? []), ...(activeBpp ?? [])].sort((a, b) =>
      String(b.created_at).localeCompare(String(a.created_at)),
    );
    const subscriptionId = candidates[0]?.stripe_subscription_id as string | undefined;
    if (!subscriptionId) return; // referrer has no active subscription of their own

    const referrerSub = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["items.data.price"],
    });
    const creditCents = referrerSub.items.data.reduce(
      (sum, item) => sum + (item.price.unit_amount ?? 0) * (item.quantity ?? 1),
      0,
    );
    if (creditCents <= 0) return;

    await stripe.customers.createBalanceTransaction(customerId, {
      amount: -creditCents,
      currency: "usd",
      description: "CorvusPT referral reward — one month free for referring a new customer",
    });

    await adminClient
      .from("profiles")
      .update({ referral_reward_granted_at: new Date().toISOString() })
      .eq("id", referredUserId);
  } catch (err) {
    console.error("Referral reward grant failed (subscription sync above still succeeded):", err);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // The webhook is mode-agnostic: with the endpoint registered in BOTH test
  // and live mode in Stripe, either can deliver here regardless of the admin
  // test/live toggle. Verify the signature against whichever signing secret
  // matches, then key the OUTBOUND Stripe client (grantReferralRewardIfDue's
  // retrieve/createBalanceTransaction) off the event's own livemode flag.
  const testSecretKey = Deno.env.get("STRIPE_SECRET_KEY_TEST") ?? Deno.env.get("STRIPE_SECRET_KEY");
  const liveSecretKey = Deno.env.get("STRIPE_SECRET_KEY_LIVE");
  const webhookSecrets = [
    Deno.env.get("STRIPE_WEBHOOK_SECRET"),
    Deno.env.get("STRIPE_WEBHOOK_SECRET_TEST"),
    Deno.env.get("STRIPE_WEBHOOK_SECRET_LIVE"),
  ].filter((s): s is string => !!s);
  if (!testSecretKey || webhookSecrets.length === 0) {
    return new Response(JSON.stringify({ error: "Missing Stripe secrets" }), {
      status: 500,
      headers: corsHeaders,
    });
  }
  // Any key works for constructEventAsync (it only uses the signing secret +
  // crypto, not the API key); the real per-mode client is built below.
  const verifier = new Stripe(testSecretKey, { apiVersion: "2024-06-20" });

  // Signature verification needs the raw, unparsed body — read as text first.
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response(JSON.stringify({ error: "Missing stripe-signature header" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  let event: Stripe.Event | null = null;
  for (const ws of webhookSecrets) {
    try {
      event = await verifier.webhooks.constructEventAsync(rawBody, signature, ws);
      break;
    } catch {
      // try the next configured signing secret
    }
  }
  if (!event) {
    console.error("Webhook signature verification failed against all configured secrets");
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  // Live events need the live key for any outbound call; test events the test
  // key. If a live event arrives before STRIPE_SECRET_KEY_LIVE is set, fall
  // back to the test key — the DB writes below still work; only outbound
  // Stripe calls in that one handler would fail, and are already best-effort.
  const stripe =
    event.livemode && liveSecretKey
      ? new Stripe(liveSecretKey, { apiVersion: "2024-06-20" })
      : verifier;

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id;
      const propertyId = session.metadata?.propertyId;
      const bppAccountId = session.metadata?.bppAccountId;
      const isBpp = session.metadata?.subjectType === "bpp_account";
      const tier =
        session.metadata?.tier === "corvusrf_managed" ? "corvusrf_managed" : "owner_managed";
      const bracket = session.metadata?.bracket ?? null;
      const subjectId = isBpp ? bppAccountId : propertyId;
      const table = isBpp ? "bpp_accounts" : "properties";
      if (userId && subjectId && typeof session.subscription === "string") {
        await adminClient
          .from(table)
          .update({
            stripe_subscription_id: session.subscription,
            subscription_status: "active",
            plan_tier: tier,
            value_bracket: bracket,
            cancel_at_period_end: false,
            cancel_at: null,
          })
          .eq("id", subjectId)
          .eq("user_id", userId);

        if (typeof session.customer === "string") {
          await adminClient
            .from("profiles")
            .update({ stripe_customer_id: session.customer })
            .eq("id", userId);
        }

        const { data: subjectRow } = await adminClient
          .from(table)
          .select(isBpp ? "business_name" : "address")
          .eq("id", subjectId)
          .maybeSingle();
        const subjectLabel = isBpp
          ? ((subjectRow?.business_name as string | null) ?? "")
          : ((subjectRow?.address as string | null) ?? "");

        await syncProfilePlan(adminClient, userId);
        await grantReferralRewardIfDue(stripe, adminClient, userId);
        await sendPurchaseConfirmationEmail(stripe, adminClient, {
          userId,
          subjectLabel,
          subjectLabelKind: isBpp ? "Business" : "Property",
          subscriptionId: session.subscription,
          tier,
          bracket: bracket as Bracket | BppBracket | null,
          amountCents: session.amount_total ?? 0,
          kind: "new_subscription",
        });
      }
    } else if (event.type === "customer.subscription.created") {
      // bulk-subscribe creates subscriptions via the API (no Checkout, so no
      // checkout.session.completed) — this is where a referral reward gets
      // granted for that path, and a belt-and-suspenders row write in case
      // bulk-subscribe's own direct write was lost. Matched by
      // metadata.propertyId (bulk-subscribe and create-checkout-session both
      // set it), falling back to the subscription id.
      const subscription = event.data.object as Stripe.Subscription;
      const propertyId = subscription.metadata?.propertyId;
      const tier =
        subscription.metadata?.tier === "corvusrf_managed" ? "corvusrf_managed" : "owner_managed";
      const bracket = subscription.metadata?.bracket ?? null;
      let query = adminClient.from("properties").select("id, user_id");
      query = propertyId
        ? query.eq("id", propertyId)
        : query.eq("stripe_subscription_id", subscription.id);
      const { data: property } = await query.maybeSingle();
      if (property) {
        await adminClient
          .from("properties")
          .update({
            stripe_subscription_id: subscription.id,
            subscription_status: subscription.status,
            plan_tier: tier,
            value_bracket: bracket,
            cancel_at_period_end: subscription.cancel_at_period_end,
            cancel_at: subscription.cancel_at
              ? new Date(subscription.cancel_at * 1000).toISOString()
              : null,
          })
          .eq("id", property.id);
        await syncProfilePlan(adminClient, property.user_id as string);
        // Only for a subscription that's actually valid/paying — a
        // bulk-subscribe sub can be created 'incomplete' (payment pending or
        // failed), and the referrer must not be paid out for that. If it
        // later becomes active, the 'updated' handler below grants it then
        // (the referral_reward_granted_at guard keeps it one-time).
        if (subscription.status === "active" || subscription.status === "trialing") {
          await grantReferralRewardIfDue(stripe, adminClient, property.user_id as string);
        }
      }
    } else if (event.type === "customer.subscription.updated") {
      const subscription = event.data.object as Stripe.Subscription;
      // Checked in order — properties first (the far more common case), then
      // bpp_accounts, since a subscription id only ever matches one table.
      const { data: property } = await adminClient
        .from("properties")
        .select("id, user_id")
        .eq("stripe_subscription_id", subscription.id)
        .maybeSingle();
      const { data: bppAccount } = property
        ? { data: null }
        : await adminClient
            .from("bpp_accounts")
            .select("id, user_id")
            .eq("stripe_subscription_id", subscription.id)
            .maybeSingle();
      const subject = property
        ? { table: "properties" as const, id: property.id as string, userId: property.user_id as string }
        : bppAccount
          ? { table: "bpp_accounts" as const, id: bppAccount.id as string, userId: bppAccount.user_id as string }
          : null;
      if (subject) {
        // tier/bracket re-derived from metadata on every update, not just at
        // creation — switch-property-plan changes a subscription's price and
        // metadata.tier in place (same subscription id, no new checkout/
        // 'created' event), so this is what actually lands the new tier on
        // the row. A harmless no-op re-write of the same values for every
        // other kind of update (cancel/resume/payment retry, none of which
        // touch metadata.tier).
        const tier =
          subscription.metadata?.tier === "corvusrf_managed" ? "corvusrf_managed" : "owner_managed";
        const bracket = subscription.metadata?.bracket ?? null;
        await adminClient
          .from(subject.table)
          .update({
            subscription_status: subscription.status,
            plan_tier: tier,
            value_bracket: bracket,
            cancel_at_period_end: subscription.cancel_at_period_end,
            cancel_at: subscription.cancel_at
              ? new Date(subscription.cancel_at * 1000).toISOString()
              : null,
          })
          .eq("id", subject.id);
        await syncProfilePlan(adminClient, subject.userId);
        // Catches an API-created (bulk-subscribe) subscription that was
        // created 'incomplete' and has now cleared to active — the 'created'
        // handler skipped the referral grant then. One-time via the guard in
        // grantReferralRewardIfDue.
        if (subscription.status === "active" || subscription.status === "trialing") {
          await grantReferralRewardIfDue(stripe, adminClient, subject.userId);
        }
      }
    } else if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const { data: property } = await adminClient
        .from("properties")
        .select("id, user_id, plan_tier, value_bracket, address")
        .eq("stripe_subscription_id", subscription.id)
        .maybeSingle();
      const { data: bppAccount } = property
        ? { data: null }
        : await adminClient
            .from("bpp_accounts")
            .select("id, user_id, plan_tier, value_bracket, business_name")
            .eq("stripe_subscription_id", subscription.id)
            .maybeSingle();
      if (property) {
        await adminClient
          .from("properties")
          .update({
            subscription_status: "canceled",
            cancel_at_period_end: false,
            cancel_at: null,
          })
          .eq("id", property.id);
        await syncProfilePlan(adminClient, property.user_id as string);
        await sendCancellationEmail(adminClient, {
          userId: property.user_id as string,
          subjectLabel: (property.address as string | null) ?? "",
          subjectLabelKind: "Property",
          tier: property.plan_tier as Tier | null,
          bracket: property.value_bracket as Bracket | null,
        });
      } else if (bppAccount) {
        await adminClient
          .from("bpp_accounts")
          .update({
            subscription_status: "canceled",
            cancel_at_period_end: false,
            cancel_at: null,
          })
          .eq("id", bppAccount.id);
        await syncProfilePlan(adminClient, bppAccount.user_id as string);
        await sendCancellationEmail(adminClient, {
          userId: bppAccount.user_id as string,
          subjectLabel: (bppAccount.business_name as string | null) ?? "",
          subjectLabelKind: "Business",
          tier: bppAccount.plan_tier as Tier | null,
          bracket: bppAccount.value_bracket as BppBracket | null,
        });
      }
    }
    // All other event types are intentionally ignored but still return 200 below so
    // Stripe doesn't keep retrying events we don't act on.

    return new Response(JSON.stringify({ received: true }), { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("Webhook handler failed", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
