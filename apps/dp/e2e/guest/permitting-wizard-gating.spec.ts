import { test, expect } from "@playwright/test";

// Walks a signed-out visitor through all 5 steps of the permitting analysis
// wizard (Property -> Project -> Zoning & Jurisdiction -> Feasibility ->
// Report) and checks the Report step shows the locked-content gate for a
// guest, instead of the full unlocked report.
//
// Deliberately never clicks "Create account & unlock" / "Unlock full
// report": handleSaveOrSignup() calls captureLead() unconditionally before
// checking auth state, so clicking either button writes a real `leads` row
// even for a guest (see permitting.analyze.tsx). Stopping one step short of
// that keeps this test free of persistent Supabase rows, matching PT's
// e2e/guest convention.
test("permitting analyze wizard walks a guest to a locked report", async ({ page }) => {
  await page.goto("./permitting/analyze", { waitUntil: "networkidle" });

  // Step 1: Property
  await page.getByLabel("Property address").fill("123 Test Street, Denton, TX 76201");
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 2: Project
  await page.getByRole("button", { name: "New Construction" }).click();
  await page.getByRole("button", { name: "commercial" }).click();
  await page.getByRole("button", { name: "Analyze property" }).click();

  // Step 3: Zoning & Jurisdiction
  await page.getByRole("button", { name: "Check feasibility" }).click();

  // Step 4: Feasibility
  await page.getByRole("button", { name: "See required permits" }).click();

  // Step 5: Report — locked for a signed-out visitor.
  await expect(page.getByRole("heading", { name: "Unlock the full report" })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole("button", { name: "Create account & unlock" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Unlock full report" })).toBeVisible();
});
