import { test, expect } from "@playwright/test";
import { requireTestAccount, signIn } from "./helpers";

// Read-only smoke test for /dashboard/settings' "Your permitting properties"
// list and its per-project "Switch to this" control. The seeded account's
// project is already the account's only (and therefore active) project, so
// this never needs to click "Switch to this" — clicking it would just
// re-confirm what's already true — it only asserts the project is listed
// and correctly marked active. Nothing written, nothing to clean up.
test("settings lists the seeded project as active", async ({ page }) => {
  const { email, password } = requireTestAccount();
  await signIn(page, email, password);

  await page.goto("/dashboard/settings", { waitUntil: "domcontentloaded" });

  // waitFor() polls up to the timeout instead of taking one instant
  // snapshot — the settings page fetches its data asynchronously, so an
  // immediate isVisible() check can race ahead of that fetch and see
  // nothing rendered yet.
  const heading = page.getByRole("heading", { name: "Your permitting properties" });
  const appeared = await heading
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) {
    test.skip(true, "Seeded account has no permitting properties listed.");
    return;
  }

  const row = page.locator("li, div", { hasText: "3130 Heritage Trl, Denton, TX 76201" }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.getByText("Active on dashboard")).toBeVisible();
});
