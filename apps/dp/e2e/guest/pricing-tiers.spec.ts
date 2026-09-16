import { test, expect } from "@playwright/test";

// Fully deterministic — DP has no billing lib and no live Stripe checkout
// wired up yet, so the Pricing page never makes a network call gated on
// sign-in state. Just checks all 3 tiers render with their real CTAs.
test("pricing page renders all 3 tiers with the correct CTAs", async ({ page }) => {
  // "networkidle" (not just the default "load") so hydration has attached
  // event handlers before any assertions run.
  await page.goto("./pricing", { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "Explore" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start free" })).toBeVisible();

  await expect(page.getByRole("heading", { name: "Project" })).toBeVisible();
  await expect(page.getByText("Most popular")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Managed", exact: true })).toBeVisible();

  // Both the "Project" and "Managed" tiers link out to Contact instead of a
  // checkout — DP has no live Stripe integration yet.
  await expect(page.getByRole("link", { name: "Talk to us" }).first()).toBeVisible();
});
