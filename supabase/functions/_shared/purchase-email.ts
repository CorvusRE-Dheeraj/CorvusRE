// Shared by stripe-webhook (new subscription via checkout.session.completed,
// and cancellation via customer.subscription.deleted) and switch-property-plan
// (an in-place tier change) — the formal emails a customer gets right after a
// real card charge/credit or a cancellation, so they never have to guess what
// was deducted, wonder if a charge on their statement is legitimate, or
// wonder whether a cancellation actually went through. Requires the
// RESEND_API_KEY secret (shared with the other transactional emails).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import { TIER_LABEL, BRACKET_LABEL, type Tier, type Bracket } from "./pricing.ts";

export function formatUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "usd",
    minimumFractionDigits: 2,
  });
}

// Never throws — same "the real work already succeeded, don't let a receipt
// email fail it" posture as grantReferralRewardIfDue in stripe-webhook.
export async function sendPurchaseConfirmationEmail(
  stripe: Stripe,
  adminClient: ReturnType<typeof createClient>,
  opts: {
    userId: string;
    propertyId: string;
    subscriptionId: string;
    tier: Tier;
    bracket: Bracket | null;
    amountCents: number; // what was actually charged (or, if negative, credited) today
    kind: "new_subscription" | "plan_switch";
  },
): Promise<void> {
  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) throw new Error("Missing RESEND_API_KEY");

    const { data: profile } = await adminClient
      .from("profiles")
      .select("email, first_name")
      .eq("id", opts.userId)
      .maybeSingle();
    const toEmail = profile?.email as string | undefined;
    if (!toEmail) throw new Error("No email on file for this user");
    const firstName = ((profile?.first_name as string | null) ?? "").trim();

    const { data: property } = await adminClient
      .from("properties")
      .select("address")
      .eq("id", opts.propertyId)
      .maybeSingle();
    const address = ((property?.address as string | null) ?? "this property").trim();

    const subscription = await stripe.subscriptions.retrieve(opts.subscriptionId, {
      expand: ["items.data.price"],
    });
    const monthlyCents = subscription.items.data.reduce(
      (sum, it) => sum + (it.price.unit_amount ?? 0) * (it.quantity ?? 1),
      0,
    );
    const nextBillingDate = new Date(subscription.current_period_end * 1000).toLocaleDateString(
      "en-US",
      { year: "numeric", month: "long", day: "numeric" },
    );
    const planLabel = `${TIER_LABEL[opts.tier]}${opts.bracket ? ` (${BRACKET_LABEL[opts.bracket]})` : ""}`;
    const isCredit = opts.amountCents < 0;
    const todayLineLabel = isCredit ? "Credited to your account today" : "Charged today";
    const todayLineAmount = formatUsd(Math.abs(opts.amountCents));
    const headline =
      opts.kind === "new_subscription" ? "You're subscribed to CorvusPT" : "Your plan was switched";
    const intro =
      opts.kind === "new_subscription"
        ? `Thanks for subscribing${firstName ? `, ${firstName}` : ""} — here's your receipt.`
        : `Your subscription for ${address} was switched to ${planLabel}${firstName ? `, ${firstName}` : ""} — here's what changed.`;

    const html = `<!doctype html>
<html>
  <body style="margin:0; padding:0; background-color:#eef2f4; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef2f4; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 2px 12px rgba(22,35,58,0.08);">
            <tr>
              <td style="background-color:#16233a; background-image:linear-gradient(135deg,#16233a 0%,#1d3b5c 55%,#0f9e6e 100%); padding:32px;">
                <span style="font-size:20px; font-weight:700; color:#ffffff; letter-spacing:-0.3px;">Corvus<span style="color:#5eead4;">PT</span></span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 32px 8px 32px;">
                <p style="margin:0 0 4px 0; font-size:13px; font-weight:700; letter-spacing:1px; text-transform:uppercase; color:#0f9e6e;">Payment receipt</p>
                <h1 style="margin:0 0 12px 0; font-size:24px; line-height:1.3; color:#16233a;">${headline}</h1>
                <p style="margin:0 0 20px 0; font-size:15px; line-height:1.6; color:#42506a;">${intro}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 8px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f8fa; border-radius:12px;">
                  <tr><td style="padding:20px 24px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px; color:#16233a;">
                      <tr><td style="padding:6px 0; color:#67788f;">Property</td><td style="padding:6px 0; text-align:right; font-weight:600;">${address}</td></tr>
                      <tr><td style="padding:6px 0; color:#67788f;">Plan</td><td style="padding:6px 0; text-align:right; font-weight:600;">${planLabel}</td></tr>
                      <tr><td style="padding:6px 0; color:#67788f; border-top:1px solid #e2e8ef;">${todayLineLabel}</td><td style="padding:6px 0; text-align:right; font-weight:700; border-top:1px solid #e2e8ef; color:${isCredit ? "#0f9e6e" : "#16233a"};">${isCredit ? "-" : ""}${todayLineAmount}</td></tr>
                      <tr><td style="padding:6px 0; color:#67788f;">Your monthly rate going forward</td><td style="padding:6px 0; text-align:right; font-weight:600;">${formatUsd(monthlyCents)}/mo</td></tr>
                      <tr><td style="padding:6px 0; color:#67788f;">Next billing date</td><td style="padding:6px 0; text-align:right; font-weight:600;">${nextBillingDate}</td></tr>
                    </table>
                  </td></tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 32px 32px;">
                <p style="margin:0; font-size:12.5px; line-height:1.6; color:#8592a6;">
                  ${isCredit ? "This credit is applied to your account and will reduce the amount due on your next invoice — it is not a direct refund to your card." : "This charge will appear on your card statement from CorvusPT."}
                  You can review or cancel this subscription any time from your CorvusPT dashboard's Billing page.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px; background-color:#f6f8fa; border-top:1px solid #e7ecf1;">
                <p style="margin:0; font-size:12px; line-height:1.6; color:#8592a6;">
                  CorvusPT — AI-Powered Texas Property Tax. If you didn't expect this email, please contact support.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "CorvusPT <info@corvusre.com>",
        to: toEmail,
        subject:
          opts.kind === "new_subscription"
            ? `Your CorvusPT receipt — ${planLabel}`
            : `Your CorvusPT plan change — ${planLabel}`,
        html,
      }),
    });
    if (!res.ok) {
      console.error(`Resend error ${res.status} sending purchase confirmation:`, await res.text());
    }
  } catch (err) {
    console.error("Purchase confirmation email failed (billing itself already succeeded):", err);
  }
}

// Sent from customer.subscription.deleted — cancel-property-subscription
// cancels immediately (not at period end, see that function's own comment),
// so this always describes a cancellation that has already taken effect, not
// one scheduled for later. Never throws, same posture as the function above:
// the cancellation itself already succeeded in Stripe/the DB by the time this
// runs, and a failed email must never re-surface as if the cancellation
// failed.
export async function sendCancellationEmail(
  adminClient: ReturnType<typeof createClient>,
  opts: {
    userId: string;
    propertyId: string;
    tier: Tier | null;
    bracket: Bracket | null;
  },
): Promise<void> {
  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) throw new Error("Missing RESEND_API_KEY");

    const { data: profile } = await adminClient
      .from("profiles")
      .select("email, first_name")
      .eq("id", opts.userId)
      .maybeSingle();
    const toEmail = profile?.email as string | undefined;
    if (!toEmail) throw new Error("No email on file for this user");
    const firstName = ((profile?.first_name as string | null) ?? "").trim();

    const { data: property } = await adminClient
      .from("properties")
      .select("address")
      .eq("id", opts.propertyId)
      .maybeSingle();
    const address = ((property?.address as string | null) ?? "this property").trim();
    const planLabel = opts.tier
      ? `${TIER_LABEL[opts.tier]}${opts.bracket ? ` (${BRACKET_LABEL[opts.bracket]})` : ""}`
      : null;
    const effectiveDate = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const html = `<!doctype html>
<html>
  <body style="margin:0; padding:0; background-color:#eef2f4; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef2f4; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 2px 12px rgba(22,35,58,0.08);">
            <tr>
              <td style="background-color:#16233a; background-image:linear-gradient(135deg,#16233a 0%,#1d3b5c 55%,#0f9e6e 100%); padding:32px;">
                <span style="font-size:20px; font-weight:700; color:#ffffff; letter-spacing:-0.3px;">Corvus<span style="color:#5eead4;">PT</span></span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 32px 8px 32px;">
                <p style="margin:0 0 4px 0; font-size:13px; font-weight:700; letter-spacing:1px; text-transform:uppercase; color:#0f9e6e;">Cancellation confirmed</p>
                <h1 style="margin:0 0 12px 0; font-size:24px; line-height:1.3; color:#16233a;">Your subscription was canceled</h1>
                <p style="margin:0 0 20px 0; font-size:15px; line-height:1.6; color:#42506a;">${firstName ? `${firstName}, y` : "Y"}our CorvusPT subscription for this property has been canceled, effective today. You won't be charged again for it.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 8px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f8fa; border-radius:12px;">
                  <tr><td style="padding:20px 24px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px; color:#16233a;">
                      <tr><td style="padding:6px 0; color:#67788f;">Property</td><td style="padding:6px 0; text-align:right; font-weight:600;">${address}</td></tr>
                      ${planLabel ? `<tr><td style="padding:6px 0; color:#67788f;">Plan canceled</td><td style="padding:6px 0; text-align:right; font-weight:600;">${planLabel}</td></tr>` : ""}
                      <tr><td style="padding:6px 0; color:#67788f;">Effective date</td><td style="padding:6px 0; text-align:right; font-weight:600;">${effectiveDate}</td></tr>
                    </table>
                  </td></tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 32px 32px;">
                <p style="margin:0; font-size:12.5px; line-height:1.6; color:#8592a6;">
                  This property will no longer be actively worked by CorvusPT, and you'll lose access to its AI reports and case tools. If this was a mistake, you can start a new subscription for this property any time from your Properties page.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px; background-color:#f6f8fa; border-top:1px solid #e7ecf1;">
                <p style="margin:0; font-size:12px; line-height:1.6; color:#8592a6;">
                  CorvusPT — AI-Powered Texas Property Tax. If you didn't expect this email, please contact support.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "CorvusPT <info@corvusre.com>",
        to: toEmail,
        subject: `Your CorvusPT subscription was canceled — ${address}`,
        html,
      }),
    });
    if (!res.ok) {
      console.error(
        `Resend error ${res.status} sending cancellation confirmation:`,
        await res.text(),
      );
    }
  } catch (err) {
    console.error(
      "Cancellation confirmation email failed (cancellation itself already succeeded):",
      err,
    );
  }
}
