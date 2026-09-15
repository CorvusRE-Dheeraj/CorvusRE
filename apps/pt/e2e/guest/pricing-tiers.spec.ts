import { test, expect } from "@playwright/test";

// Fully deterministic — a signed-out visitor's Pricing page never makes a
// live Stripe/Supabase billing call (getMyBilling only runs `if (user)`),
// so this just checks all 3 tiers and their real prices render correctly.
test("pricing page renders all 3 tiers side by side with the correct prices", async ({ page }) => {
  // "networkidle" (not just the default "load") so hydration has attached
  // event handlers before any assertions run — see
  // e2e/authenticated/helpers.ts's signIn() for the same gotcha.
  await page.goto("pricing", { waitUntil: "networkidle" });

  // The free tier is a plain inline callout above the cards, not its own
  // card — this checks the link text, not a heading role.
  await expect(page.getByRole("link", { name: "Start a free review" })).toBeVisible();

  // All three cards render together — no toggle to switch between them.
  // .first() since each price now legitimately appears twice on the page —
  // once in the "Pricing at a glance" comparison table, once in the picker
  // card's own per-bracket row below it — not a bug, both are real UI.
  await expect(page.getByRole("heading", { name: "Owner-Managed" })).toBeVisible();
  await expect(page.getByText("$99/mo", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "CorvusPT-Managed" })).toBeVisible();
  await expect(page.getByText("$199/mo", { exact: true }).first()).toBeVisible();

  // The $25M+ Custom card links out to Contact Us instead of Subscribing.
  // Scoped to <main> — nav and footer both also have a "Contact Us" link.
  await expect(page.getByRole("heading", { name: "$25M+" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Contact Us" })).toBeVisible();
});
