import { createClient } from "@supabase/supabase-js";
import { test, expect } from "@playwright/test";
import { requireTestAccount, signIn, revertPermitStatus } from "./helpers";

// Advances the seeded project's first non-approved permit one step via the
// real "Advance ->" button, confirms the UI reflects the new status, then
// reverts that permit row back to its original values so the seeded
// project's permit list is identical run over run (see helpers.ts).
test("advancing a permit updates its status", async ({ page }) => {
  const { email, password } = requireTestAccount();

  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    test.skip(true, "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set.");
    return;
  }

  // Read the target permit's current values directly first, so cleanup can
  // restore exactly what was there regardless of which row the UI advances.
  const client = createClient(url, anonKey);
  const { data: signInData, error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !signInData.user) {
    test.skip(true, "Could not sign in the seeded test account directly.");
    return;
  }
  const { data: project } = await client
    .from("projects")
    .select("id")
    .eq("user_id", signInData.user.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!project) {
    test.skip(true, "Seeded account has no project — nothing to advance.");
    return;
  }
  const { data: permit } = await client
    .from("project_permits")
    .select("id, status, submitted_at, approved_at, review_round")
    .eq("project_id", project.id)
    .neq("status", "approved")
    .order("sort", { ascending: true })
    .limit(1)
    .maybeSingle();
  await client.auth.signOut();
  if (!permit) {
    test.skip(true, "Every seeded permit is already approved — nothing to advance.");
    return;
  }

  try {
    await signIn(page, email, password);
    await page.goto("/dashboard/permits", { waitUntil: "domcontentloaded" });

    const row = page.locator("tr", { has: page.getByRole("button", { name: "Advance →" }) }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    const statusBefore = await row.locator("td").nth(3).innerText();

    await row.getByRole("button", { name: "Advance →" }).click();

    await expect(async () => {
      const statusAfter = await row.locator("td").nth(3).innerText();
      expect(statusAfter).not.toBe(statusBefore);
    }).toPass({ timeout: 15_000 });
  } finally {
    await revertPermitStatus(email, password, permit.id, {
      status: permit.status,
      submitted_at: permit.submitted_at,
      approved_at: permit.approved_at,
      review_round: permit.review_round,
    });
  }
});
