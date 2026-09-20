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

// Every sign-in now happens on the shared cross-door identity screen
// (/auth/, apps/identity) — CorvusDP's own /sign-in just redirects there
// full-page and never mounts a form any more (see routes/sign-in.tsx), and
// /auth/ isn't part of this app's own build/preview, so there's no local UI
// this suite could drive to sign in. Instead: sign in directly against
// Supabase (a plain node-side client, the exact same project this app's own
// client points at) and seed the resulting session into localStorage under
// the key/shape supabase-js itself would have written, before the app's own
// client ever reads it on mount — functionally identical to a real
// interactive sign-in, without depending on whatever the sign-in UI (here,
// or on /auth/) currently looks like.
export async function signIn(page: Page, email: string, password: string) {
  const url = process.env.VITE_SUPABASE_URL!;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY!;
  const client = createClient(url, anonKey);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw error ?? new Error("Sign-in returned no session");

  // supabase-js's own default storage key, derived from the project ref in
  // the URL — stable, documented, and what this app's own client
  // (src/lib/supabase.ts, no storageKey override) reads on getSession().
  // addInitScript runs before the target page's own scripts on every future
  // navigation in this page, so the app's client finds a real session
  // already in localStorage the moment it mounts.
  const storageKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  const sessionJson = JSON.stringify(data.session);
  await page.addInitScript(
    ({ storageKey, sessionJson }) => window.localStorage.setItem(storageKey, sessionJson),
    { storageKey, sessionJson },
  );

  await page.goto("/dashboard", { waitUntil: "networkidle" });
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
