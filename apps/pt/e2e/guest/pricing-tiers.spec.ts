import { test, expect } from "@playwright/test";

// Fully deterministic — a signed-out visitor's Pricing page never makes a
// live Stripe/Supabase billing call (getMyBilling only runs `if (user)`),
// so this just checks the two plans, the monthly/yearly switch, the plan
// explainer, Savings Protection and the free review.
test("pricing page shows both plans monthly and yearly, with the commitment explained", async ({
  page,
}) => {
  // "networkidle" (not just the default "load") so hydration has attached
  // event handlers before any assertions run — see
  // e2e/authenticated/helpers.ts's signIn() for the same gotcha.
  await page.goto("pricing", { waitUntil: "networkidle" });

  await expect(
    page.getByRole("heading", { name: "Simple pricing. You stay in control." }),
  ).toBeVisible();
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Owner-Managed", exact: true })).toBeVisible();
  await expect(main.getByRole("heading", { name: "Corvus-Managed", exact: true })).toBeVisible();

  // Monthly is shown first.
  await expect(main.getByText("$199", { exact: true })).toBeVisible();
  await expect(main.getByText("$299", { exact: true })).toBeVisible();
  await expect(main.getByText("12-Month Subscription Commitment").first()).toBeVisible();
  // The commitment terms are on the page, unfolded, before anyone pays.
  await expect(main.getByText(/mandatory 12-month commitment/)).toBeVisible();
  await expect(main.getByText(/Early cancellation is not permitted/)).toBeVisible();

  // Yearly: 50% off the first year, then the full year price.
  await page.getByRole("radio", { name: /Pay yearly/ }).click();
  await expect(main.getByText("$1,194", { exact: true })).toBeVisible();
  await expect(main.getByText("$1,794", { exact: true })).toBeVisible();
  await expect(main.getByText("Save 50% by paying upfront · then $2,388/year")).toBeVisible();
  await expect(main.getByText("Save 50% by paying upfront · then $3,588/year")).toBeVisible();

  // The commitment is one click away, in plain words.
  await page.getByText("How your plan works").click();
  await expect(
    main.getByText(/Once 13 months are complete, you can cancel with 60 days/),
  ).toBeVisible();

  await expect(main.getByRole("link", { name: "Choose Owner-Managed" })).toBeVisible();
  await expect(main.getByRole("link", { name: "Choose Corvus-Managed" })).toBeVisible();
  await expect(main.getByText(/Savings Protection, included with both plans/)).toBeVisible();
  await expect(main.getByRole("link", { name: "Start Free Review" })).toBeVisible();
  await expect(main.getByRole("link", { name: "Talk to us" })).toBeVisible();
  await expect(main.getByText(/February 1, 2027/)).toHaveCount(0);
});
