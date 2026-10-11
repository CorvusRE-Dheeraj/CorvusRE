// Deploy via CLI: `supabase functions deploy create-bpp-checkout-session`.
// Requires only STRIPE_SECRET_KEY — no per-bracket Stripe Price id secrets.
// Mirrors create-checkout-session/index.ts exactly, swapping properties/
// propertyId for bpp_accounts/bppAccountId and the BPP-specific bracket math
// in ../_shared/pricing.ts. One real, independent Stripe subscription per BPP
// ACCOUNT (see stripe-webhook's checkout.session.completed handler, which
// branches on metadata.subjectType to write to bpp_accounts here instead of
// properties).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import { getStripeMode, stripeSecretKey } from "../_shared/stripe-mode.ts";
import {
  bracketForBppValue,
  bppSubscriptionProductName,
  bppUnitAmountCents,
  isTier,
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
    const { bppAccountId, tier, successPath, cancelPath } = (await req.json()) as {
      bppAccountId?: string;
      tier?: Tier;
      successPath?: string;
      cancelPath?: string;
    };
    if (!isTier(tier)) {
      return new Response(
        JSON.stringify({ error: "tier must be owner_managed or corvusrf_managed" }),
        { status: 400, headers: corsHeaders },
      );
    }
    if (typeof bppAccountId !== "string" || !bppAccountId) {
      return new Response(JSON.stringify({ error: "bppAccountId is required" }), {
        status: 400,
        headers: corsHeaders,
      });
    }
    const safePath = (p: string | undefined, fallback: string) =>
      p && p.startsWith("/") && !p.startsWith("//") ? p : fallback;

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

    const { data: account } = await adminClient
      .from("bpp_accounts")
      .select("id, business_name, rendered_value, stripe_subscription_id, subscription_status")
      .eq("id", bppAccountId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!account) {
      return new Response(JSON.stringify({ error: "BPP account not found." }), {
        status: 404,
        headers: corsHeaders,
      });
    }
    if (account.subscription_status === "active") {
      return new Response(
        JSON.stringify({ error: "This BPP account already has an active subscription." }),
        { status: 400, headers: corsHeaders },
      );
    }

    const bracket = bracketForBppValue(account.rendered_value as number | null);
    const businessName = ((account.business_name as string | null) ?? "").trim();
    const unitAmount = bppUnitAmountCents(tier, bracket);
    const name = bppSubscriptionProductName(tier, bracket, businessName);

    const { data: profile } = await adminClient
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single();

    const stripe = new Stripe(secretKey, { apiVersion: "2024-06-20" });
    const origin = req.headers.get("origin") ?? new URL(req.url).origin;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: unitAmount,
            recurring: { interval: "month" },
            product_data: { name, metadata: { tier, bracket, subjectType: "bpp_account" } },
          },
        },
      ],
      client_reference_id: user.id,
      customer: profile?.stripe_customer_id ?? undefined,
      customer_email: profile?.stripe_customer_id ? undefined : (user.email ?? undefined),
      subscription_data: {
        ...(businessName ? { description: businessName } : {}),
        metadata: { tier, bracket, bppAccountId, subjectType: "bpp_account" },
      },
      metadata: { tier, bracket, bppAccountId, subjectType: "bpp_account" },
      success_url: `${origin}${safePath(successPath, "/dashboard/bpp-accounts?checkout=success")}`,
      cancel_url: `${origin}${safePath(cancelPath, "/dashboard/bpp-accounts")}`,
    });

    if (!session.url) throw new Error("Stripe did not return a Checkout URL");

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
