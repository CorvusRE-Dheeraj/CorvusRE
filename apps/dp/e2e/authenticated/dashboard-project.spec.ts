import { test, expect } from "@playwright/test";
import { requireTestAccount, signIn } from "./helpers";

// Read-only smoke test: the seeded test account's active project (3130
// Heritage Trl, Denton, TX 76201) renders correctly on the dashboard
// overview and its child pages. Never writes anything, so nothing to clean
// up. Skips itself (does not fail) when the account has no active project —
// see helpers.ts on how that account's project got seeded.
test("dashboard renders the seeded permitting project", async ({ page }) => {
  const { email, password } = requireTestAccount();
  await signIn(page, email, password);

  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

  // Race the two possible post-load states directly rather than taking an
  // instant isVisible() snapshot — the dashboard fetches its active project
  // asynchronously, so an immediate check can run before either heading has
  // rendered yet.
  const projectHeading = page.getByText("3130 Heritage Trl, Denton, TX 76201").first();
  const emptyHeading = page.getByRole("heading", { name: "No project yet" });
  await Promise.race([
    projectHeading.waitFor({ state: "visible", timeout: 15_000 }),
    emptyHeading.waitFor({ state: "visible", timeout: 15_000 }),
  ]).catch(() => {});
  if (await emptyHeading.isVisible().catch(() => false)) {
    test.skip(true, "Seeded account has no active project — nothing to verify.");
    return;
  }

  await expect(projectHeading).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Permitting", { exact: true }).first()).toBeVisible();

  // Permits page renders the same project's required-permits table.
  await page.goto("/dashboard/permits", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Required permits & reviewing agencies" })).toBeVisible({
    timeout: 15_000,
  });
});
