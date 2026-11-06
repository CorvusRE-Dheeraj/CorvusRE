// The CorvusPT billing-portal configuration: card, address and invoice history
// only — no cancel / plan change there, since the monthly plans carry a
// commitment the app enforces (commitment.ts). Shared by
// create-billing-portal-session and support-console (payment links).
import type Stripe from "npm:stripe@17";

const PORTAL_TAG = "corvuspt-no-cancel-v1";
export async function portalConfiguration(stripe: Stripe): Promise<string> {
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
