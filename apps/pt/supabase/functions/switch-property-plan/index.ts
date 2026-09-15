// Deploy via CLI: `supabase functions deploy switch-property-plan`.
// Requires STRIPE_SECRET_KEY (or _TEST/_LIVE per stripe-mode.ts).
//
// Changes an already-active property subscription from one tier to the
// other (Owner-Managed <-> CorvusPT-Managed) in place — same subscription
// id, same value bracket, no cancel-and-recheckout. Prices here are ad hoc
// price_data (see create-checkout-session's own comment on why — no
// pre-created Stripe Price per tier+bracket), so the switch itself is done
// the same way: a new price_data on the existing subscription item.
//
// Settles immediately, not deferred to the next regular invoice:
// proration_behavior 'always_invoice' finalizes (and, via the subscription's
// default charge_automatically collection method, attempts to charge) the
// prorated difference as its own invoice right now — an upgrade charges the
// card today; a downgrade's negative proration becomes an immediate credit
// balance rather than sitting unapplied until the next cycle. It still is
// NOT a real refund transaction back to the original payment method on a
// downgrade — Stripe applies it as account credit, auto-consumed by the
// next invoice; only a literal stripe.refunds.create() against a past
// charge does that, which this deliberately doesn't attempt (no specific
// past charge to safely attribute a partial refund to here). payment_
// behavior 'error_if_incomplete' makes an upgrade whose charge is declined
// fail the whole switch instead of silently leaving the subscription bumped
// to the pricier tier with an unpaid invoice.
//
// The properties row is updated directly here for immediate UI feedback —
// customer.subscription.updated (stripe-webhook) also re-derives plan_tier/
// value_bracket from the subscription's own metadata as a belt-and-
// suspenders sync, so a dropped response here still self-heals once that
// event arrives.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import { getStripeMode, stripeSecretKey } from "../_shared/stripe-mode.ts";
import { sendPurchaseConfirmationEmail } from "../_shared/purchase-email.ts";
import {
  bracketForValue,
  isTier,
  subscriptionProductName,
  unitAmountCents,
  type Tier,
} from "../_shared/pricing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { propertyId, tier } = (await req.json()) as {
      propertyId?: string;
      tier?: Tier;
    };
    if (!isTier(tier)) {
      return new Response(
        JSON.stringify({ error: "tier must be owner_managed or corvusrf_managed" }),
        { status: 400, headers: corsHeaders },
      );
    }
    if (typeof propertyId !== "string" || !propertyId) {
      return new Response(JSON.stringify({ error: "propertyId is required" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );
    const {
      data: { user },
      error: userErr,
    } = await callerClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "unauthenticated" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const secretKey = stripeSecretKey(await getStripeMode(user.id));

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Ownership check via .eq("user_id", user.id) — a caller can only ever
    // switch their own property's own subscription.
    const { data: property } = await adminClient
      .from("properties")
      .select("id, address, total_value, stripe_subscription_id, subscription_status, plan_tier")
      .eq("id", propertyId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!property?.stripe_subscription_id || property.subscription_status !== "active") {
      return new Response(
        JSON.stringify({ error: "This property has no active subscription to switch." }),
        { status: 400, headers: corsHeaders },
      );
    }
    if (property.plan_tier === tier) {
      return new Response(JSON.stringify({ error: "This property is already on that plan." }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const stripe = new Stripe(secretKey, { apiVersion: "2024-06-20" });
    const subscription = await stripe.subscriptions.retrieve(property.stripe_subscription_id);
    const item = subscription.items.data[0];
    if (!item) throw new Error("This subscription has no billable item to switch.");

    const bracket = bracketForValue(property.total_value as number | null);

    // Same real "already have another active sub in this tier+bracket"
    // discount check create-checkout-session uses — a switch shouldn't lose
    // (or wrongly gain) the 2nd-property discount relative to what a fresh
    // checkout into the new tier would have charged.
    const { count } = await adminClient
      .from("properties")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("plan_tier", tier)
      .eq("value_bracket", bracket)
      .eq("subscription_status", "active")
      .neq("id", propertyId);
    const isAdditionalInBracket = (count ?? 0) > 0;

    const address = ((property.address as string | null) ?? "").trim();
    const unitAmount = unitAmountCents(tier, bracket, isAdditionalInBracket);
    const name = subscriptionProductName(tier, bracket, address, isAdditionalInBracket);

    // Unlike Checkout Sessions' line_items[].price_data (which accepts an
    // inline product_data), subscriptions.update()'s items[].price_data does
    // NOT — Stripe rejects it ("Received unknown parameter:
    // items[0][price_data][product_data]"). It needs a real Price id, so
    // create one (prices.create() DOES accept inline product_data) and
    // reference that instead. Same ad hoc-per-subscription approach as
    // checkout, just via one extra real API object.
    const newPrice = await stripe.prices.create({
      currency: "usd",
      unit_amount: unitAmount,
      recurring: { interval: "month" },
      product_data: { name, metadata: { tier, bracket } },
    });

    const updated = await stripe.subscriptions.update(property.stripe_subscription_id, {
      items: [{ id: item.id, price: newPrice.id }],
      metadata: { ...subscription.metadata, tier, bracket, propertyId },
      ...(address ? { description: address } : {}),
      proration_behavior: "always_invoice",
      payment_behavior: "error_if_incomplete",
      expand: ["latest_invoice"],
    });

    // Immediate write for the UI — see the file comment on why this doesn't
    // just wait for the webhook.
    await adminClient
      .from("properties")
      .update({ plan_tier: tier, value_bracket: bracket })
      .eq("id", propertyId);

    // The real, precise amount 'always_invoice' just settled — its own
    // finalized invoice total, not the plain sticker-price difference (which
    // would ignore however many days are actually left in the billing
    // period). Positive = charged today; a downgrade's negative proration
    // floors this invoice's amount_due at $0 while the credit itself lands
    // on the customer's balance, which is exactly why this reads .total
    // (the real, possibly-negative settled figure) rather than amount_due.
    const latestInvoice =
      typeof updated.latest_invoice === "object" ? updated.latest_invoice : null;
    const settledCents = latestInvoice?.total ?? unitAmount;
    await sendPurchaseConfirmationEmail(stripe, adminClient, {
      userId: user.id,
      subjectLabel: (property.address as string | null) ?? "",
      subscriptionId: property.stripe_subscription_id,
      tier,
      bracket,
      amountCents: settledCents,
      kind: "plan_switch",
    });

    return new Response(
      JSON.stringify({ ok: true, tier, bracket, amountCents: unitAmount, status: updated.status }),
      { status: 200, headers: corsHeaders },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
