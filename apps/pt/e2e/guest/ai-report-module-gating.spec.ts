import { test, expect } from "@playwright/test";

// Regression test for the exact bug fixed this session: every module card
// showed "Free preview" regardless of subscription status, because
// ModuleCard only checked the generic `unlocked` boolean, not *why* it was
// unlocked. This covers the guest/free-tier half of that fix (deterministic,
// no sign-in needed); the "subscribed -> Included" half needs a real
// account with a subscription and belongs in e2e/authenticated.
//
// Seeds IntakeState directly into sessionStorage (the same key/shape
// src/lib/intake-store.ts reads) instead of driving the full address/upload
// flow, so this test is independent of live CAD/AI calls — accountNumber is
// deliberately omitted so estimateSavings() takes its network-free formula
// path instead of attempting a live comps lookup.
const SEEDED_STATE = {
  address: "123 Test Street, Denton, TX 76201",
  propertyKind: "residential",
  cad: "Denton Central Appraisal District",
  propertyType: "Residential",
  totalValue: 400000,
  landValue: 100000,
  improvementValue: 300000,
  taxYear: 2024,
  confirmed: true,
  previewsUsed: [],
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript((state) => {
    window.sessionStorage.setItem("crf_intake", JSON.stringify(state));
  }, SEEDED_STATE);
});

test("unsubscribed guest sees free preview on modules 1-3 and a subscription gate on 4-10", async ({
  page,
}) => {
  // The three free-preview modules each fire a real edge-function call on
  // load; comps (module 3) resolves right around the default 30s budget, so
  // the settle-wait below needs room.
  test.setTimeout(90_000);
  // Relative, no leading slash — see pricing-tiers.spec.ts for why.
  await page.goto("ai-report");

  // The modules section is a tab ("10 Premium AI Modules" | "Commercial
  // Valuation" — the latter only for non-residential properties).
  await expect(page.getByRole("tab", { name: "10 Premium AI Modules" })).toBeVisible();

  // Square tiles, highlights only: a free-preview tile opens with "View
  // Details"; a gated tile shows the Locked chip and "Subscribe to unlock".
  await expect(page.getByRole("button", { name: /^View Details/ })).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Subscribe to unlock" })).toHaveCount(7);
  await expect(page.getByText("Locked", { exact: true })).toHaveCount(7);

  // A subscribed-only label should never appear for a guest.
  await expect(page.getByText("Included in your plan", { exact: true })).toHaveCount(0);

  // …and View Details opens the module's preview modal. Wait for the eager
  // module loads to settle first — the cards re-render as each resolves, and
  // clicking mid-re-render detaches the node (flaky otherwise). "Analyzing"
  // is the per-card loading label; wait for every card to leave that state
  // rather than networkidle, which is too tight now that comps generates
  // right around the old 30s test budget.
  await expect(page.getByText("Analyzing")).toHaveCount(0, { timeout: 60_000 });
  await page
    .getByRole("button", { name: /^View Details/ })
    .first()
    .click();
  await expect(page.getByRole("button", { name: "Close" })).toBeVisible();
});
