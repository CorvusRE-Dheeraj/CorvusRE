import { test, expect } from "@playwright/test";

// Fully deterministic — a signed-out visitor's Pricing page never makes a
// live Stripe/Supabase billing call (getMyBilling only runs `if (user)`),
// so this just checks the three service lanes, prices, and Savings Protection.
test("pricing page renders the three lanes, and savings protection", async ({ page }) => {
  // "networkidle" (not just the default "load") so hydration has attached
  // event handlers before any assertions run — see
  // e2e/authenticated/helpers.ts's signIn() for the same gotcha.
  await page.goto("pricing", { waitUntil: "networkidle" });

  await expect(
    page.getByRole("heading", { name: "Three lanes. Pick the one that fits." }),
  ).toBeVisible();

  // Lane 1 — free review: screens the whole portfolio (same wording as every
  // other public page — lib/service-lanes.ts), not "one property".
  await expect(page.getByRole("heading", { name: "Free Property Review" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start Free Review" })).toBeVisible();
  await expect(page.getByText("No card required · screen your whole portfolio")).toBeVisible();
  await expect(page.getByText(/one property/)).toHaveCount(0);

  // Lane 2 — owner-managed, fixed annual price for $1M–$5M.
  await expect(page.getByRole("heading", { name: "Owner-Managed CorvusPT" })).toBeVisible();
  await expect(page.getByText("$1M–$5M property value").first()).toBeVisible();
  await expect(page.getByText("Billed annually — $3,588/year")).toBeVisible();
  await expect(page.getByText("Includes CorvusPT Savings Protection")).toBeVisible();
  await expect(page.getByRole("link", { name: "Add a Property to Subscribe" })).toBeVisible();

  // Lane 3 — expert/managed help: available (not "upcoming"), fixed and custom for $5M+.
  await expect(page.getByRole("heading", { name: "Expert/Managed Help" })).toBeVisible();
  await expect(page.getByText("Upcoming", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Success-based", { exact: false })).toHaveCount(0);
  await expect(
    page.getByText("Tailored based on property value, portfolio size, and requirements."),
  ).toBeVisible();
  await expect(page.getByRole("main").getByText("Coming soon")).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("link", { name: "Talk to Our Team" })).toBeVisible();

  await expect(page.getByRole("heading", { name: "Franchise owners: 50% off" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "CorvusPT Savings Protection" })).toBeVisible();
});
