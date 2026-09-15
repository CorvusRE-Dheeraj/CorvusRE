import { defineConfig, devices } from "@playwright/test";

// Both e2e/guest and e2e/authenticated are wired into CI (see deploy.yml).
// e2e/guest needs no sign-in and writes no persistent Supabase rows (intake
// state lives in browser state until a user actually saves a property), so
// it's safe to run against the real Supabase project on every push.
// e2e/authenticated runs against a dedicated, permanent test account and
// cleans up after itself — see e2e/authenticated/helpers.ts.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:8080/",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:8080/",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
