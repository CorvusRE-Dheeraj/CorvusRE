// Deploy via CLI: `supabase functions deploy apply-tax-carry-forward`
// (JWT-verified — only pg_cron, calling with the service-role key as Bearer
// auth, is meant to trigger this; same pattern as auto-refile-cases).
//
// Daily: for every active ANNUAL property subscription renewing within the next
// RENEWAL_WINDOW_DAYS, decide the Savings Protection carry-forward (see
// ../_shared/tax-carry-forward.ts) from the property's own tax_bills:
//
//   proposed tax unchanged from the previous tax year -> attach the one-time
//     100%-off carry-forward coupon, so the renewal invoice is $0;
//   changed, or a year's amount missing -> leave it, and Stripe charges the
//     normal subscription fee.
//
// Each renewal is decided exactly once: the result is stamped on the
// subscription's own metadata against its current_period_end, so a later run (or
// a tax bill added after the decision) never flips it. Existing discounts (a
// franchise owner's 50%) are kept alongside the carry-forward coupon.
// Grandfathered monthly subscriptions are skipped — the rule is for the annual plan.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import { isServiceRoleRequest, serviceRoleOnlyResponse } from "../_shared/service-role-only.ts";
import { getStripeMode, stripeSecretKey, type StripeMode } from "../_shared/stripe-mode.ts";
import { CARRY_FORWARD_COUPON, ensureCoupon } from "../_shared/discounts.ts";
import {
  decideCarryForward,
  isRenewalDue,
  type TaxBillRow,
} from "../_shared/tax-carry-forward.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

type Outcome = {
  propertyId: string;
  subscriptionId: string;
  result: "carry_forward" | "charge";
  reason?: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Scheduled job: only pg_cron (service-role key as Bearer auth) may run this —
  // see ../_shared/service-role-only.ts.
  if (!isServiceRoleRequest(req)) return serviceRoleOnlyResponse(corsHeaders);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // One client per Stripe mode — a staff account in test mode has its
  // subscriptions in the test account, everyone else in live.
  const clients = new Map<StripeMode, Stripe>();
  const stripeFor = async (userId: string): Promise<Stripe> => {
    const mode = await getStripeMode(userId);
    let s = clients.get(mode);
    if (!s) {
      s = new Stripe(stripeSecretKey(mode), { apiVersion: "2024-06-20" });
      clients.set(mode, s);
    }
    return s;
  };

  const decided: Outcome[] = [];
  const failures: { propertyId: string; message: string }[] = [];

  try {
    const { data: properties, error } = await admin
      .from("properties")
      .select("id, user_id, stripe_subscription_id")
      .eq("subscription_status", "active")
      .not("stripe_subscription_id", "is", null);
    if (error) throw error;

    for (const property of properties ?? []) {
      const subscriptionId = property.stripe_subscription_id as string;
      try {
        const stripe = await stripeFor(property.user_id as string);
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        const interval = sub.items.data[0]?.price.recurring?.interval;
        if (interval !== "year" || sub.status !== "active" || sub.cancel_at_period_end) continue;
        if (!isRenewalDue(sub.current_period_end)) continue;

        const period = String(sub.current_period_end);
        if (sub.metadata?.carry_forward_period === period) continue; // already decided

        const { data: bills, error: billsErr } = await admin
          .from("tax_bills")
          .select("tax_year, amount_due, created_at")
          .eq("property_id", property.id);
        if (billsErr) throw billsErr;

        const decision = decideCarryForward((bills ?? []) as TaxBillRow[]);
        const stamp = {
          ...sub.metadata,
          carry_forward_period: period,
          carry_forward_result: decision.result,
          carry_forward_years:
            decision.latestYear != null && decision.previousYear != null
              ? `${decision.previousYear}->${decision.latestYear}`
              : "",
        };

        if (decision.result === "carry_forward") {
          const couponId = await ensureCoupon(stripe, CARRY_FORWARD_COUPON);
          // Keep whatever's already on the subscription (franchise 50%) — passing
          // `discounts` replaces the whole list.
          const existing = (sub.discounts ?? []).map((d) => ({
            discount: typeof d === "string" ? d : d.id,
          }));
          await stripe.subscriptions.update(subscriptionId, {
            discounts: [...existing, { coupon: couponId }],
            metadata: stamp,
            proration_behavior: "none",
          });
        } else {
          await stripe.subscriptions.update(subscriptionId, { metadata: stamp });
        }

        decided.push({
          propertyId: property.id as string,
          subscriptionId,
          result: decision.result,
          ...(decision.result === "charge" ? { reason: decision.reason } : {}),
        });
      } catch (err) {
        failures.push({
          propertyId: property.id as string,
          message: err instanceof Error ? err.message : "unknown error",
        });
      }
    }

    console.log(
      `apply-tax-carry-forward: ${decided.length} decided ` +
        `(${decided.filter((d) => d.result === "carry_forward").length} carried forward), ` +
        `${failures.length} failed`,
    );
    return new Response(JSON.stringify({ decided, failures }), {
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
