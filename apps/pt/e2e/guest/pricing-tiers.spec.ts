import { test, expect } from "@playwright/test";

// Fully deterministic — a signed-out visitor's Pricing page never makes a
// live Stripe/Supabase billing call (getMyBilling only runs `if (user)`),
// so this just checks the plans, prices, and Savings Protection callout.
test("pricing page renders the fixed plan, custom, franchise, and savings protection", async ({
  page,
}) => {
  // "networkidle" (not just the default "load") so hydration has attached
  // event handlers before any assertions run — see
  // e2e/authenticated/helpers.ts's signIn() for the same gotcha.
  await page.goto("pricing", { waitUntil: "networkidle" });

  // The free tier is a plain inline callout below the cards, not its own card.
  await expect(page.getByRole("link", { name: "Start a free review" })).toBeVisible();

  // $1M–$5M fixed-price plan: monthly price and the full annual amount.
  await expect(page.getByRole("heading", { name: "$1M–$5M property value" })).toBeVisible();
  await expect(page.getByText("$299", { exact: true })).toBeVisible();
  await expect(page.getByText("Billed annually — $3,588/year")).toBeVisible();

  // $5M+ links out to Contact Us instead of Subscribing. Scoped to <main> —
  // nav and footer both also have a "Contact Us" link.
  await expect(page.getByRole("heading", { name: "$5M+ property value" })).toBeVisible();
  await expect(
    page.getByText("Tailored based on property value, portfolio size, and requirements."),
  ).toBeVisible();
  // Two Contact Us links in <main>: the $5M+ card and the success-based card.
  await expect(page.getByRole("main").getByRole("link", { name: "Contact Us" })).toHaveCount(2);

  await expect(page.getByRole("heading", { name: "Success-based", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Franchise owners: 50% off" })).toBeVisible();

  // Both fixed-price plans carry the Savings Protection marker.
  await expect(page.getByText("Includes CorvusPT Savings Protection")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "CorvusPT Savings Protection" })).toBeVisible();
});
