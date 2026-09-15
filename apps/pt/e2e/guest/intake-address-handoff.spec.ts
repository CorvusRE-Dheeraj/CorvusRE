import { test, expect } from "@playwright/test";

// Tests the app's own client-side handoff (homepage -> /intake with the
// address carried across in sessionStorage), not the live CAD lookup's
// outcome — that depends on external county sites/edge functions and can
// resolve at any speed, which would make asserting on a specific UI step
// (validating vs. not-found vs. address-retry-on-error) a source of pure
// timing flakiness unrelated to whether this app's own code is correct.
test("submitting an address on the homepage hands off to /intake", async ({ page }) => {
  // "./" resolves to baseURL itself (see pricing-tiers.spec.ts for why a
  // leading slash is wrong here). networkidle gives the route's JS bundle
  // time to hydrate — clicking before hydration attaches the real onSubmit
  // handler falls through to a native browser form GET instead.
  await page.goto("./", { waitUntil: "networkidle" });

  const address = "123 Test Street, Denton, TX 76201";
  const addressInput = page.getByPlaceholder(/property address in Texas/i);
  await addressInput.fill(address);
  await page.getByRole("button", { name: "Start Free AI Property Review" }).click();

  await expect(page).toHaveURL(/\/intake/);

  const storedAddress = await page.evaluate(() => {
    const raw = window.sessionStorage.getItem("crf_intake");
    return raw ? (JSON.parse(raw) as { address?: string }).address : null;
  });
  expect(storedAddress).toBe(address);
});
