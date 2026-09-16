import { test, expect } from "@playwright/test";
import { requireTestAccount, signIn, cleanupLatestProtest } from "./helpers";

// Cleans up whatever protest the test below created, even if an assertion in
// it failed partway through — so a flaky/failed run never leaves a row behind
// for the next run (or a real admin) to trip over. No-ops if requireTestAccount()
// skipped the test before credentials were ever set.
let credentials: { email: string; password: string } | null = null;
test.afterEach(async () => {
  if (credentials) await cleanupLatestProtest(credentials.email, credentials.password);
});

// Requires the seeded test account to already have a saved, ALREADY-
// SUBSCRIBED property (subscription_status/plan_tier/protest_deadline set
// directly in the DB, not via a real Stripe payment -- CI can't complete
// one) with total_value set, since "Request Protest Filing" only appears
// once a property is paid (an unsubscribed property's AI Report shows
// "Subscribe" buttons instead -- that path is checkout-redirect.spec.ts's
// job). Targeted by its distinct seeded address rather than ".first()" so
// this doesn't collide with checkout-redirect.spec.ts's own (deliberately
// unsubscribed) property when both specs run in parallel against the same
// account.
test("signing the authorization and requesting a protest creates a case", async ({ page }) => {
  // Default 30s isn't enough headroom for a real multi-step wizard plus a
  // possible first-time AI analysis on top of it (see the comment on
  // requestFilingButton below) -- matches view-case.spec.ts's own
  // test.setTimeout for the same reason.
  test.setTimeout(120_000);
  const { email, password } = requireTestAccount();
  credentials = { email, password };
  await signIn(page, email, password);

  await page.goto("/dashboard/properties");
  const firstProperty = page
    .locator(".card-elev", { hasText: "456 CI Subscribed Ave" })
    .first();
  await firstProperty.getByRole("button", { name: "Open AI Report" }).click();

  // The AI Report page swaps this button for "View Case" once its own
  // existingProtest fetch resolves — clicking before that settles is racing
  // a DOM swap, not a real interaction. waitForLoadState("networkidle") used
  // to cover this, but for a property with no cached AI analysis yet (a
  // freshly seeded account, e.g.) opening this page kicks off a real,
  // possibly slow Gemini call that can keep the network busy well past
  // networkidle's own patience, timing this out even though the page is
  // working correctly. Waiting directly for the actual button this test
  // needs (with a generous timeout for that first-time analysis) is both
  // more robust and closer to what this comment always actually meant.
  //
  // The button's own label is "File Protest" here (the AI Report page) --
  // "Request Protest Filing" is a *different* entry point into the same
  // flow, on the Properties list page's "Actions" dropdown, not this one.
  const requestFilingButton = page.getByRole("button", { name: "File Protest" });
  await requestFilingButton.waitFor({ state: "visible", timeout: 60_000 });
  await requestFilingButton.click();

  // The dialog (Radix Dialog, see ProtestAuthorizationFlow.tsx) briefly
  // re-renders its content as it finishes mounting/opening — interacting
  // with a field before that settles gets it detached mid-fill. Waiting for
  // the dialog's own heading avoids that race.
  //
  // Step 0: the Service Agreement — but it only shows ONCE per property.
  // The CI account's service_agreement_acceptances rows are never cleaned up
  // (immutable compliance record, no delete policy), so on any run after the
  // first the flow opens straight on "Property Owner Details". Handle both.
  const agreementHeading = page.getByRole("heading", { name: "CorvusPT Service Agreement" });
  const ownerHeading = page.getByRole("heading", { name: "Property Owner Details" });
  await expect(agreementHeading.or(ownerHeading).first()).toBeVisible();
  if (await agreementHeading.isVisible()) {
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Agree & Continue" }).click();
  }

  await ownerHeading.waitFor({ state: "visible" });

  // Step 1: owner details — only email is prefilled from the account; first/
  // last/phone start blank. Values are read into plain strings now since
  // these inputs unmount once we move to the next step.
  const firstNameField = page.getByLabel("First Name");
  if (!(await firstNameField.inputValue())) await firstNameField.fill("Test");
  const lastNameField = page.getByLabel("Last Name");
  if (!(await lastNameField.inputValue())) await lastNameField.fill("User");
  const phoneField = page.getByLabel("Phone Number");
  if (!(await phoneField.inputValue())) await phoneField.fill("5555555555");
  const fullName = `${await firstNameField.inputValue()} ${await lastNameField.inputValue()}`;
  await page.getByRole("button", { name: "Next" }).click();

  // Step 2: recent-purchase question.
  await page.getByRole("radio").last().check(); // "No"
  await page.getByRole("button", { name: "Next" }).click();

  // Step 3: "Review Before Proceeding" AI acknowledgement — check the box,
  // then "Confirm & Continue" (records the acknowledgement per property/case).
  await page
    .getByRole("heading", { name: "Review Before Proceeding" })
    .waitFor({ state: "visible" });
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Confirm & Continue" }).click();

  // Step 4: review + typed signature.
  await page.getByRole("heading", { name: "Review & Sign" }).waitFor({ state: "visible" });
  await page.getByRole("checkbox").check();
  await page.getByPlaceholder("Type your full legal name").fill(fullName);
  await page.getByRole("button", { name: "Sign & Submit" }).click();

  await expect(page.getByText(/Protest requested/i)).toBeVisible({ timeout: 15_000 });
});
