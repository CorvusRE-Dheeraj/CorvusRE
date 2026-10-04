// Deploy via CLI: `supabase functions deploy resume-bpp-subscription`.
// Mirrors resume-subscription/index.ts exactly, swapping properties/
// propertyId for bpp_accounts/bppAccountId.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import { getStripeMode, stripeSecretKey } from "../_shared/stripe-mode.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { bppAccountId } = (await req.json()) as { bppAccountId?: string };
    if (typeof bppAccountId !== "string" || !bppAccountId) {
      return new Response(JSON.stringify({ error: "bppAccountId is required" }), {
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
    const { data: account } = await adminClient
      .from("bpp_accounts")
      .select("id, stripe_subscription_id")
      .eq("id", bppAccountId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!account?.stripe_subscription_id) {
      return new Response(JSON.stringify({ error: "No subscription found for this BPP account" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const stripe = new Stripe(secretKey, { apiVersion: "2024-06-20" });
    await stripe.subscriptions.update(account.stripe_subscription_id, {
      cancel_at_period_end: false,
    });

    await adminClient
      .from("bpp_accounts")
      .update({ cancel_at_period_end: false, cancel_at: null })
      .eq("id", bppAccountId);

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
