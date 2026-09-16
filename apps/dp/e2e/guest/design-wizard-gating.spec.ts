import { test, expect } from "@playwright/test";

// Walks a signed-out visitor through all 4 steps of the design brief wizard
// (Property -> Project type -> Requirements -> Brief) and checks the Brief
// step shows the locked-content gate for a guest.
//
// Deliberately never clicks "Create account & save": handlePrimary() calls
// captureLead() unconditionally before checking auth state (same pattern as
// the permitting wizard), so clicking it writes a real `leads` row even for
// a guest. Stopping one step short keeps this test free of persistent
// Supabase rows, matching PT's e2e/guest convention.
test("design brief wizard walks a guest to a locked brief", async ({ page }) => {
  await page.goto("./design/analyze", { waitUntil: "networkidle" });

  // Step 1: Property
  await page.getByLabel("Property address").fill("123 Test Street, Denton, TX 76201");
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 2: Type of project
  await page.getByRole("button", { name: "commercial" }).click();
  await page.getByRole("button", { name: "New Construction" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 3: Design requirements & preferences
  await page.getByLabel("Desired building area (sf)").fill("5000");
  await page.getByLabel("Number of floors").fill("2");
  await page.getByRole("button", { name: "Generate brief" }).click();

  // Step 4: Brief — locked for a signed-out visitor.
  await expect(page.getByRole("heading", { name: "Save your design brief" })).toBeVisible({
    timeout: 15_000,
  });
  // Two buttons share this label: the locked-overlay CTA and the bottom
  // primary action button (both call handlePrimary) — just confirm the
  // overlay's copy is present, already asserted above via its heading.
  await expect(page.getByRole("button", { name: "Create account & save" }).first()).toBeVisible();
});
