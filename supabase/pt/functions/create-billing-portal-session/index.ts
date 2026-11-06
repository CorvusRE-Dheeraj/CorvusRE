// Deploy via CLI: `supabase functions deploy create-billing-portal-session`.
// Uses its own portal configuration (see portalConfiguration below), so the
// Stripe Dashboard's default portal settings no longer apply here.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import { getStripeMode, stripeSecretKey } from "../_shared/stripe-mode.ts";

// The portal CorvusPT opens: cards, invoices and billing details only — no
// cancelling or plan changes there, because monthly plans carry a 12-month
// commitment that only the app enforces (cancel-property-subscription,
// ../_shared/commitment.ts). Created once per Stripe account (test and live
// are separate) and found again by its metadata tag.
const PORTAL_TAG = "corvuspt-no-cancel-v1";
async function portalConfiguration(stripe: Stripe): Promise<string> {
  const existing = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
  const found = existing.data.find((c) => c.metadata?.corvuspt === PORTAL_TAG);
  if (found) return found.id;
  const created = await stripe.billingPortal.configurations.create({
    business_profile: {
      headline: "CorvusPT billing",
      privacy_policy_url: "https://corvusre.com/corvuspt/privacy",
      terms_of_service_url: "https://corvusre.com/corvuspt/terms",
    },
    features: {
      customer_update: { enabled: true, allowed_updates: ["email", "address", "phone", "tax_id"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: false },
      subscription_update: { enabled: false },
    },
    metadata: { corvuspt: PORTAL_TAG },
  });
  return created.id;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  // Without this, supabase-js's functions.invoke() parses the body as plain text
  // (a JSON string) instead of a parsed object, based on the response Content-Type.
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { returnPath } = (await req.json().catch(() => ({}))) as { returnPath?: string };
    // Only ever appended to a server-validated origin below, never used as a whole
    // URL — but requiring a leading "/" (not "//", which a browser would treat as
    // protocol-relative) keeps this from being coaxed into pointing off-origin.
    const safePath =
      returnPath && returnPath.startsWith("/") && !returnPath.startsWith("//")
        ? returnPath
        : "/dashboard";

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
    const { data: profile } = await adminClient
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single();
    if (!profile?.stripe_customer_id) {
      return new Response(JSON.stringify({ error: "No billing account found for this user" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const stripe = new Stripe(secretKey, { apiVersion: "2024-06-20" });
    const origin = req.headers.get("origin") ?? new URL(req.url).origin;

    let session: Stripe.BillingPortal.Session;
    try {
      session = await stripe.billingPortal.sessions.create({
        customer: profile.stripe_customer_id,
        configuration: await portalConfiguration(stripe),
        return_url: `${origin}${safePath}`,
      });
    } catch (e) {
      if (e && typeof e === "object" && (e as { code?: string }).code === "resource_missing") {
        return new Response(
          JSON.stringify({
            error:
              "No billing account in this Stripe environment. If you switched your test/live override, switch it back.",
          }),
          { status: 400, headers: corsHeaders },
        );
      }
      throw e;
    }

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
