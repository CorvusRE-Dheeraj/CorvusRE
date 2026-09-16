import { createClient } from "@supabase/supabase-js";
import { type Page, test } from "@playwright/test";

// These specs need a real signed-in account with at least one saved
// permitting project. In CI (see .github/workflows/deploy.yml) they run
// against a dedicated, permanent test account (crf-ci-e2e-test@example.com,
// a DIFFERENT Supabase Auth user than PT's account of the same email — DP
// and PT are separate Supabase projects) with a real project seeded by
// actually driving the permitting analyze wizard once (3130 Heritage Trl,
// Denton, TX 76201). permit-advance.spec.ts reverts the one row it mutates
// each run (see revertPermitStatus below) so nothing drifts across runs.
//
// To run locally against your own seeded account instead:
//
//   DP_E2E_TEST_EMAIL=you@example.com DP_E2E_TEST_PASSWORD=... npx playwright test e2e/authenticated
//
// Each test calls requireTestAccount() first and skips itself (not fails)
// when the env vars aren't set, so `npm run test:e2e` (guest-only) is
// unaffected and a contributor without a seeded account isn't blocked.
export function requireTestAccount() {
  const email = process.env.DP_E2E_TEST_EMAIL;
  const password = process.env.DP_E2E_TEST_PASSWORD;
  test.skip(
    !email || !password,
    "DP_E2E_TEST_EMAIL / DP_E2E_TEST_PASSWORD not set — see e2e/authenticated/helpers.ts",
  );
  return { email: email!, password: password! };
}

export async function signIn(page: Page, email: string, password: string) {
  // A plain /sign-in visit full-page-redirects to the external /auth/
  // identity app (see sign-in.tsx's login-bridge effect) and never mounts
  // DP's own form. Going with mode=signup keeps that redirect from firing,
  // then the "Already have an account? Sign in." button flips the local
  // component state to sign-in mode without navigating — so the redirect
  // effect (which only watches the URL's search params) never re-triggers.
  await page.goto("/sign-in?mode=signup", { waitUntil: "networkidle" });
  await page.getByText("Already have an account? Sign in.").click();
  await page.locator('input[type="email"]').waitFor({ state: "visible" });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 15_000 });
  // No LegalGate-style blocking dialog exists in DP (PT-only concept) —
  // nothing else to dismiss before the app is interactive.
}

// Reverts project_permits.status (and the timestamp/round columns advance()
// sets alongside it) back to whatever it was before permit-advance.spec.ts
// ran, so the seeded project's permit list is identical run over run. Uses a
// separate Node-side Supabase client signed in as the same test account —
// the "project permits: all" RLS policy already lets an owner freely update
// their own project's permits, so no service-role key is needed here.
export async function revertPermitStatus(
  email: string,
  password: string,
  permitId: string,
  original: { status: string; submitted_at: string | null; approved_at: string | null; review_round: number },
) {
  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return;

  const client = createClient(url, anonKey);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) return;

  await client
    .from("project_permits")
    .update({
      status: original.status,
      submitted_at: original.submitted_at,
      approved_at: original.approved_at,
      review_round: original.review_round,
    })
    .eq("id", permitId);

  await client.auth.signOut();
}
