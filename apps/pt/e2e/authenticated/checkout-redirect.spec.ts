import { test, expect } from "@playwright/test";
import { requireTestAccount, signIn } from "./helpers";

// Stops at "got a valid Stripe Checkout session" rather than completing a
// real payment — see playwright.config.ts's top comment. Requires the
// seeded test account to have Stripe test-mode price IDs configured on the
// create-checkout-session edge function (STRIPE_PRICE_ID_OWNER_MANAGED).
test("subscribing on Pricing redirects to a real Stripe Checkout session", async ({ page }) => {
  const { email, password } = requireTestAccount();
  await signIn(page, email, password);

  // The app does `window.location.href = url` the instant it gets a session
  // back (see billing.ts's startCheckout) — that real top-level navigation
  // tears down the page's response bodies, racing (and often winning
  // against) reading this same response after the fact. Reading the body
  // from inside the route handler itself, before it's even allowed to reach
  // the page, sidesteps that entirely: by the time startCheckout's own code
  // runs, this response is already captured. Aborting the follow-on
  // navigation to Stripe's hosted page also matches the test's intent: verify
  // a session was created, never actually land on Stripe's page.
  let capturedBody: { url?: string } | undefined;
  await page.route("**/create-checkout-session", async (route) => {
    // The browser sends a CORS preflight OPTIONS request to this same URL
    // before the real POST — only the POST has a JSON body to capture.
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    capturedBody = (await response.json()) as { url?: string };
    await route.fulfill({ response });
  });
  await page.route(
    (url) => url.hostname === "checkout.stripe.com",
    (route) => route.abort(),
  );

  await page.goto("/pricing");
  await page
    .getByRole("button", { name: /^Subscribe/ })
    .first()
    .click();
  // A generous timeout: this edge function calls out to Stripe's API, and a
  // cold Supabase Edge Function start (common right after a deploy, which is
  // exactly when CI runs this) can add several seconds on top of that.
  await expect.poll(() => capturedBody, { timeout: 30_000 }).toBeTruthy();

  expect(capturedBody?.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
});
