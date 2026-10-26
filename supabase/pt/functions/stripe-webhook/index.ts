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
import { runReferralRewards } from "../_shared/referral-reward.ts";
import { syncProfilePlan } from "../_shared/profile-plan.ts";
import { PAID_SUBSCRIPTION_STATUSES, hasLiveSubscription } from "../_shared/subscription-status.ts";
import { sendPurchaseConfirmationEmail, sendCancellationEmail } from "../_shared/purchase-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, stripe-signature",
  "Content-Type": "application/json",
};

// supabase-js returns errors instead of throwing. A write that failed used to
// be acknowledged to Stripe with 200, so Stripe never retried and the plan
// change was silently lost; throwing lands in the handler's 500 below, which
// Stripe retries. Every write here is idempotent, so a retry is safe.
class StripeUnavailable extends Error {
  constructor(cause: unknown) {
    super("Stripe unavailable");
    this.cause = cause;
  }
}

function ok<T extends { error: unknown }>(res: T): T {
  if (res.error) throw res.error;
  return res;
}

// Referral rewards (one month free for the referrer) live in
// ../_shared/referral-reward.ts — atomic claim + idempotency key so a retried or
// concurrent webhook can't credit twice, and a reward whose referrer wasn't paying
// yet is paid once they are. Covered by apps/pt/src/lib/referral-reward.test.ts.

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // The webhook is mode-agnostic: with the endpoint registered in BOTH test
  // and live mode in Stripe, either can deliver here regardless of the admin
  // test/live toggle. Verify the signature against whichever signing secret
  // matches, then key the OUTBOUND Stripe client (runReferralRewards'
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

  // Live events need the live key — every subscription is re-read from Stripe
  // below, and the test key can't see live data. Until it's configured, 503 so
  // Stripe retries the event later instead of it being processed wrongly.
  if (event.livemode && !liveSecretKey) {
    console.error("Live Stripe event received but STRIPE_SECRET_KEY_LIVE is not set");
    return new Response(JSON.stringify({ error: "Live Stripe key not configured" }), {
      status: 503,
      headers: corsHeaders,
    });
  }
  const stripe = event.livemode
    ? new Stripe(liveSecretKey!, { apiVersion: "2024-06-20" })
    : verifier;

  // Events can arrive late or out of order, so the subscription inside an
  // event may already be stale (e.g. an old "active" landing after the
  // cancellation). Status and cancellation fields always come from the live
  // subscription; if Stripe can't be reached, 503 so the event is retried.
  async function liveSubscription(id: string): Promise<Stripe.Subscription> {
    try {
      return await stripe.subscriptions.retrieve(id);
    } catch (err) {
      throw new StripeUnavailable(err);
    }
  }
  const cancelFields = (sub: Stripe.Subscription) => ({
    cancel_at_period_end: sub.cancel_at_period_end,
    cancel_at: sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null,
  });

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded" ||
      event.type === "checkout.session.async_payment_failed"
    ) {
      // A bank (delayed) payment completes checkout before the money arrives
      // (payment_status "unpaid"), then sends async_payment_succeeded or
      // _failed. All three write the live subscription's real status; the
      // purchase email and referral reward only go out once it's paid.
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
        const sub = await liveSubscription(session.subscription);
        const paid =
          PAID_SUBSCRIPTION_STATUSES.includes(sub.status) && session.payment_status !== "unpaid";
        ok(await adminClient
          .from(table)
          .update({
            stripe_subscription_id: session.subscription,
            subscription_status: sub.status,
            plan_tier: tier,
            value_bracket: bracket,
            ...cancelFields(sub),
          })
          .eq("id", subjectId)
          .eq("user_id", userId));

        if (typeof session.customer === "string") {
          ok(await adminClient
            .from("profiles")
            .update({ stripe_customer_id: session.customer })
            .eq("id", userId));
        }

        const { data: subjectRow } = ok(await adminClient
          .from(table)
          .select(isBpp ? "business_name" : "address")
          .eq("id", subjectId)
          .maybeSingle());
        const subjectLabel = isBpp
          ? ((subjectRow?.business_name as string | null) ?? "")
          : ((subjectRow?.address as string | null) ?? "");

        await syncProfilePlan(adminClient, userId);
        if (!paid) {
          return new Response(JSON.stringify({ received: true }), { status: 200, headers: corsHeaders });
        }
        await runReferralRewards(stripe, adminClient, userId);
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
      const subscription = await liveSubscription((event.data.object as Stripe.Subscription).id);
      const propertyId = subscription.metadata?.propertyId;
      const tier =
        subscription.metadata?.tier === "corvusrf_managed" ? "corvusrf_managed" : "owner_managed";
      const bracket = subscription.metadata?.bracket ?? null;
      let query = adminClient.from("properties").select("id, user_id, stripe_subscription_id, subscription_status");
      query = propertyId
        ? query.eq("id", propertyId)
        : query.eq("stripe_subscription_id", subscription.id);
      const { data: property } = ok(await query.maybeSingle());
      // Never attach a subscription to a property someone else's subscription
      // already holds, or whose owner is a different Stripe customer — the
      // row must be unclaimed (no live subscription, or already this one), and
      // owned by this subscription's customer.
      let claimable = false;
      if (property) {
        const { data: owner } = ok(
          await adminClient
            .from("profiles")
            .select("stripe_customer_id")
            .eq("id", property.user_id as string)
            .maybeSingle(),
        );
        const unclaimed =
          !property.stripe_subscription_id ||
          property.stripe_subscription_id === subscription.id ||
          !hasLiveSubscription(property.subscription_status as string | null); // old one is over
        const sameCustomer = !owner?.stripe_customer_id || owner.stripe_customer_id === subscription.customer;
        claimable = unclaimed && sameCustomer;
        if (!claimable) {
          console.error("subscription.created: refusing to attach", subscription.id, "to property", property.id);
        }
      }
      if (property && claimable) {
        ok(await adminClient
          .from("properties")
          .update({
            stripe_subscription_id: subscription.id,
            subscription_status: subscription.status,
            plan_tier: tier,
            value_bracket: bracket,
            ...cancelFields(subscription),
          })
          .eq("id", property.id));
        await syncProfilePlan(adminClient, property.user_id as string);
        // Only for a subscription that's actually valid/paying — a
        // bulk-subscribe sub can be created 'incomplete' (payment pending or
        // failed), and the referrer must not be paid out for that. If it
        // later becomes active, the 'updated' handler below grants it then
        // (the referral_reward_granted_at guard keeps it one-time).
        if (subscription.status === "active" || subscription.status === "trialing") {
          await runReferralRewards(stripe, adminClient, property.user_id as string);
        }
      }
    } else if (event.type === "customer.subscription.updated") {
      const subscription = await liveSubscription((event.data.object as Stripe.Subscription).id);
      // Checked in order — properties first (the far more common case), then
      // bpp_accounts, since a subscription id only ever matches one table.
      const { data: property } = ok(await adminClient
        .from("properties")
        .select("id, user_id")
        .eq("stripe_subscription_id", subscription.id)
        .maybeSingle());
      const { data: bppAccount } = property
        ? { data: null }
        : ok(await adminClient
            .from("bpp_accounts")
            .select("id, user_id")
            .eq("stripe_subscription_id", subscription.id)
            .maybeSingle());
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
        ok(await adminClient
          .from(subject.table)
          .update({
            subscription_status: subscription.status,
            plan_tier: tier,
            value_bracket: bracket,
            ...cancelFields(subscription),
          })
          .eq("id", subject.id));
        await syncProfilePlan(adminClient, subject.userId);
        // Catches an API-created (bulk-subscribe) subscription that was
        // created 'incomplete' and has now cleared to active — the 'created'
        // handler skipped the referral grant then. One-time via the guard in
        // runReferralRewards.
        if (subscription.status === "active" || subscription.status === "trialing") {
          await runReferralRewards(stripe, adminClient, subject.userId);
        }
      }
    } else if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const { data: property } = ok(await adminClient
        .from("properties")
        .select("id, user_id, plan_tier, value_bracket, address")
        .eq("stripe_subscription_id", subscription.id)
        .maybeSingle());
      const { data: bppAccount } = property
        ? { data: null }
        : ok(await adminClient
            .from("bpp_accounts")
            .select("id, user_id, plan_tier, value_bracket, business_name")
            .eq("stripe_subscription_id", subscription.id)
            .maybeSingle());
      if (property) {
        ok(await adminClient
          .from("properties")
          .update({
            subscription_status: "canceled",
            cancel_at_period_end: false,
            cancel_at: null,
          })
          .eq("id", property.id));
        await syncProfilePlan(adminClient, property.user_id as string);
        await sendCancellationEmail(adminClient, {
          userId: property.user_id as string,
          subjectLabel: (property.address as string | null) ?? "",
          subjectLabelKind: "Property",
          tier: property.plan_tier as Tier | null,
          bracket: property.value_bracket as Bracket | null,
        });
      } else if (bppAccount) {
        ok(await adminClient
          .from("bpp_accounts")
          .update({
            subscription_status: "canceled",
            cancel_at_period_end: false,
            cancel_at: null,
          })
          .eq("id", bppAccount.id));
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
    if (err instanceof StripeUnavailable) {
      console.error("Could not re-read the subscription from Stripe", err.cause);
      return new Response(JSON.stringify({ error: "Stripe unavailable, retry" }), {
        status: 503,
        headers: corsHeaders,
      });
    }
    console.error("Webhook handler failed", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
