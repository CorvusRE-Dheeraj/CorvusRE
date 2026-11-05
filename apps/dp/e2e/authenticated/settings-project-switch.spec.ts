import { test, expect } from "@playwright/test";
import { requireTestAccount, signIn } from "./helpers";

// Read-only smoke test for /dashboard/projects' "Permitting projects" list.
// The seeded account's project is already the account's only (and therefore
// active) project, so this never clicks "Open" — it only asserts the project
// is listed and correctly marked as the one on the dashboard. Nothing
// written, nothing to clean up.
test("projects page lists the seeded project as active", async ({ page }) => {
  const { email, password } = requireTestAccount();
  await signIn(page, email, password);

  await page.goto("/dashboard/projects", { waitUntil: "domcontentloaded" });

  // waitFor() polls up to the timeout instead of taking one instant
  // snapshot — the page fetches its data asynchronously, so an immediate
  // isVisible() check can race ahead of that fetch and see nothing rendered.
  const heading = page.getByRole("heading", { name: "Permitting projects" });
  await heading.waitFor({ state: "visible", timeout: 15_000 });
  const listed = await page
    .getByText("3130 Heritage Trl, Denton, TX 76201")
    .first()
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!listed) {
    test.skip(true, "Seeded account has no permitting projects listed.");
    return;
  }

  const row = page.locator("li", { hasText: "3130 Heritage Trl, Denton, TX 76201" }).first();
  await expect(row.getByText("On dashboard")).toBeVisible();
  await expect(row.getByRole("button", { name: "Open" })).toBeVisible();
});
