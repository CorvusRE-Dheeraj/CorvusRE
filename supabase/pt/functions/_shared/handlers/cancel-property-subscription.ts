// Moved from functions/cancel-property-subscription/index.ts (merged into a router — see that file).
// Deploy via CLI: `supabase functions deploy cancel-property-subscription`.
// Requires STRIPE_SECRET_KEY.
//
// Replaces the old bracket-quantity-decrementing remove-property-from-plan —
// trivial now that every property has its own independent Stripe
// subscription (see create-checkout-session): cancels exactly this
// property's subscription, unambiguously, with no guessing about which
// property actually loses coverage. The real profiles.plan/properties.
// subscription_status sync happens via the existing customer.subscription.
// deleted webhook (stripe-webhook/index.ts), not duplicated here.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import { getStripeMode, stripeSecretKey } from "../stripe-mode.ts";
import { cancelDecision } from "../commitment.ts";
import { PRICING_VERSION } from "../pricing.ts";

const dateLabel = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { propertyId } = (await req.json()) as { propertyId?: string };
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

    // Test vs live Stripe — the global default, overridden per admin. Resolved
    // from the authenticated caller; see ../_shared/stripe-mode.ts.
    const secretKey = stripeSecretKey(await getStripeMode(user.id));

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Ownership check via .eq("user_id", user.id) — never trust propertyId
    // alone; a caller can only ever cancel their own property's subscription.
    const { data: property } = await adminClient
      .from("properties")
      .select("id, stripe_subscription_id")
      .eq("id", propertyId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!property?.stripe_subscription_id) {
      return new Response(
        JSON.stringify({ error: "This property has no active subscription to cancel." }),
        { status: 400, headers: corsHeaders },
      );
    }

    const stripe = new Stripe(secretKey, { apiVersion: "2024-06-20" });
    const sub = await stripe.subscriptions.retrieve(property.stripe_subscription_id);
    const interval = sub.items.data[0]?.price.recurring?.interval === "month" ? "month" : "year";
    // The 12-month commitment applies to monthly plans under the Nov 2026
    // pricing (../commitment.ts). Annual plans, and plans from before it,
    // stop renewing and run to the end of the period already paid.
    const committed = sub.metadata?.pricing === PRICING_VERSION && interval === "month";
    const decision = committed
      ? cancelDecision("month", new Date(sub.start_date * 1000))
      : ({ allowed: true, endsAt: null, atPeriodEnd: true } as const);

    if (!decision.allowed) {
      return new Response(
        JSON.stringify({
          error: `Your plan has a 12-month commitment. You can give notice to cancel from ${dateLabel(decision.windowOpens)} (until ${dateLabel(decision.windowCloses)}); the plan then ends 60 days later.`,
          windowOpens: decision.windowOpens.toISOString(),
          windowCloses: decision.windowCloses.toISOString(),
        }),
        { status: 400, headers: corsHeaders },
      );
    }
    const updated = decision.atPeriodEnd
      ? await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true })
      : await stripe.subscriptions.update(sub.id, {
          cancel_at: Math.floor(decision.endsAt!.getTime() / 1000),
        });
    const endsAt = updated.cancel_at ?? (updated.cancel_at_period_end ? updated.current_period_end : null);

    return new Response(
      JSON.stringify({ ok: true, endsAt: endsAt ? new Date(endsAt * 1000).toISOString() : null }),
      { status: 200, headers: corsHeaders },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
}
