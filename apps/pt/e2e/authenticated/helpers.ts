import { createClient } from "@supabase/supabase-js";
import { type Page, test } from "@playwright/test";

// These specs need a real signed-in account with at least one saved property.
// In CI (see .github/workflows/deploy.yml) they run against a dedicated,
// permanent test account (crf-ci-e2e-test@example.com) that exists only for
// this — protest-authorization.spec.ts cleans up the protest row it creates
// each run (see cleanupLatestProtest below) so nothing piles up in the real
// admin queue; checkout-redirect.spec.ts only creates a Stripe Checkout
// *session* against test-mode price IDs, never a completed payment.
//
// To run locally against your own seeded account instead:
//
//   E2E_TEST_EMAIL=you@example.com E2E_TEST_PASSWORD=... npx playwright test e2e/authenticated
//
// Each test calls requireTestAccount() first and skips itself (not fails)
// when the env vars aren't set, so `npm run test:e2e` (guest-only) is
// unaffected and a contributor without a seeded account isn't blocked.
export function requireTestAccount() {
  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;
  test.skip(
    !email || !password,
    "E2E_TEST_EMAIL / E2E_TEST_PASSWORD not set — see e2e/authenticated/helpers.ts",
  );
  return { email: email!, password: password! };
}

// Every sign-in now happens on the shared cross-door identity screen
// (/auth/, apps/identity) — CorvusPT's own /sign-in just redirects there
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
  // the URL (e.g. "https://iotzuhuajbsxxuccuihn.supabase.co" ->
  // "sb-iotzuhuajbsxxuccuihn-auth-token") — stable, documented, and what
  // this app's own client (src/lib/supabase.ts, no storageKey override)
  // reads on getSession(). addInitScript runs before the target page's own
  // scripts on every future navigation in this page, so the app's client
  // finds a real session already in localStorage the moment it mounts.
  const storageKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  const sessionJson = JSON.stringify(data.session);
  // Also mark the first-visit welcome as seen: an account created in the last
  // day gets a full-screen welcome dialog that blocks every click, so the
  // suite would only work against an old account (see WelcomeScreen.tsx).
  const userId = data.session.user.id;
  await page.addInitScript(
    ({ storageKey, sessionJson, userId }) => {
      window.localStorage.setItem(storageKey, sessionJson);
      window.localStorage.setItem(`corvuspt.welcomeSeen.${userId}`, "1");
    },
    { storageKey, sessionJson, userId },
  );

  await page.goto("/dashboard", { waitUntil: "networkidle" });
  await skipEngagementPacketIfPresent(page);
}

// EngagementPacketHost.tsx opens a full-screen pop-up (fixed inset-0, every
// route) for any signed-in account without a current signed packet or with a
// Terms acceptance behind the current version — which a real, previously-used
// account (like a seeded test account) hits whenever those versions are bumped.
// Every authenticated spec needs it out of the way right after sign-in, or every
// later click times out against the overlay intercepting pointer events. Skipping
// (not signing) keeps the test account's packet state untouched; a spec that
// files a protest signs through the filing flow's own required pop-up instead.
async function skipEngagementPacketIfPresent(page: Page) {
  // isVisible() checks the DOM immediately and does NOT wait — the pop-up only
  // renders once its own fetches resolve, still in flight right after sign-in's
  // redirect. waitFor() actually polls for up to the timeout.
  const dialog = page.getByRole("dialog", { name: /agreements/i });
  const appeared = await dialog
    .waitFor({ state: "visible", timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return;
  const terms = dialog.getByRole("checkbox", { name: /Terms of Service/ });
  if (await terms.isVisible()) await terms.check();
  await dialog.getByRole("button", { name: "Skip for now" }).click();
  await dialog.waitFor({ state: "hidden", timeout: 10_000 });
}

// Deletes the most recently requested protest for this account — run after
// protest-authorization.spec.ts asserts success, so the row it just created
// doesn't linger in the real admin queue (see the "Users can delete their own
// protests" RLS policy in supabase/schema.sql, added specifically for this).
// Uses a separate Node-side Supabase client (not the Playwright page) since
// that's simpler than reaching into the app's own browser-side client.
//
// Guarded to only ever delete a row requested in the last 10 minutes — this
// account is dedicated to CI and should only ever hold rows a just-finished
// run created, but the time window means a slow/stuck run's cleanup can never
// reach back and delete an older, unrelated row.
export async function cleanupLatestProtest(email: string, password: string) {
  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return;

  const client = createClient(url, anonKey);
  const { data: signInData, error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !signInData.user) return;

  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: recent } = await client
    .from("protests")
    .select("id, requested_at")
    .eq("user_id", signInData.user.id)
    .gte("requested_at", tenMinutesAgo)
    .order("requested_at", { ascending: false })
    .limit(1);

  const latest = recent?.[0];
  if (latest) await client.from("protests").delete().eq("id", latest.id);

  // The authorization flow now also records a Service Agreement acceptance and
  // files a "Service Agreement" document copy. The acceptance row is an
  // immutable compliance record with no delete policy (fine — it's a
  // dedicated CI account, and real acceptances aren't deleted either), but
  // clear the recent document copy so the test account's Documents tab
  // doesn't fill up run over run.
  const { data: recentDocs } = await client
    .from("documents")
    .select("id, storage_path, uploaded_at")
    .eq("user_id", signInData.user.id)
    .eq("document_type", "Service Agreement")
    .gte("uploaded_at", tenMinutesAgo)
    .order("uploaded_at", { ascending: false })
    .limit(3);
  for (const d of recentDocs ?? []) {
    await client.storage.from("documents").remove([d.storage_path as string]);
    await client.from("documents").delete().eq("id", d.id);
  }

  await client.auth.signOut();
}
