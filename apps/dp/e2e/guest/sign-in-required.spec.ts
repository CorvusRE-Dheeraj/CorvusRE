import { test, expect } from "@playwright/test";
import { SIGN_IN_REQUIRED } from "../../src/lib/public-paths";

// The site-wide sign-in gate (src/components/SignedInGate.tsx) follows the
// SIGN_IN_REQUIRED switch in src/lib/public-paths.ts. With it on, a signed-out
// visitor who opens any page is sent to sign-in (which hands off to the shared
// identity screen at /auth/, not part of this preview build) — carrying the
// page they asked for. With it off, the public pages open, but the dashboard
// and admin still require signing in through their own checks.
const PUBLIC_PAGES = [
  ["home", "./", "/"],
  ["pricing", "./pricing", "/pricing"],
  ["design wizard", "./design/analyze", "/design/analyze"],
  ["permitting wizard", "./permitting/analyze", "/permitting/analyze"],
] as const;
// the identity hand-off: /auth/?redirect=… (or /auth?redirect=… locally)
const HANDOFF = /\/auth\/?\?/;
// the dashboard's own guard goes to sign-in; admin's goes to admin sign-in
const SIGN_IN = /\/auth\/?\?|\/sign-in|\/admin-login/;

if (SIGN_IN_REQUIRED) {
  for (const [name, url, path] of [
    ...PUBLIC_PAGES,
    ["dashboard", "./dashboard/projects", "/dashboard/projects"],
    ["admin", "./admin", "/admin"],
  ] as const) {
    test(`signed out: ${name} goes to sign-in and shows nothing`, async ({ page }) => {
      const seen: string[] = [];
      page.on("framenavigated", (f) => {
        if (f === page.mainFrame()) seen.push(f.url());
      });
      await page.goto(url);
      // The page's own content is never visible, even before the hand-off.
      await expect(page.locator("#main-content")).toBeHidden();
      // Lands on the identity hand-off, which carries where to come back to.
      await expect
        .poll(() => seen.find((u) => HANDOFF.test(u)) ?? "", { timeout: 15_000 })
        .not.toBe("");
      const handoff = new URL(seen.find((u) => HANDOFF.test(u))!);
      const back = handoff.searchParams.get("redirect") ?? "";
      expect(back.replace(/\/$/, "").endsWith(path === "/" ? "" : path)).toBe(true);
    });
  }
} else {
  for (const [name, url] of PUBLIC_PAGES) {
    test(`signed out: ${name} opens (sign-in gate switched off)`, async ({ page }) => {
      await page.goto(url, { waitUntil: "networkidle" });
      await expect(page.locator("#main-content")).toBeVisible();
      expect(page.url()).not.toMatch(SIGN_IN);
    });
  }

  for (const [name, url] of [
    ["dashboard", "./dashboard/projects"],
    ["admin", "./admin"],
  ] as const) {
    test(`signed out: ${name} still requires signing in`, async ({ page }) => {
      const seen: string[] = [];
      page.on("framenavigated", (f) => {
        if (f === page.mainFrame()) seen.push(f.url());
      });
      await page.goto(url);
      await expect
        .poll(() => seen.find((u) => SIGN_IN.test(u)) ?? "", { timeout: 15_000 })
        .not.toBe("");
    });
  }
}

test("Terms and Privacy stay readable without signing in", async ({ page }) => {
  for (const url of ["./terms", "./privacy"]) {
    await page.goto(url, { waitUntil: "networkidle" });
    await expect(page.locator("#main-content")).toBeVisible();
    expect(page.url()).not.toMatch(/\/auth\b|\/sign-in/);
  }
});
