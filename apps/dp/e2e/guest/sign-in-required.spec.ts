import { test, expect } from "@playwright/test";

// CorvusDP is sign-in only: a signed-out visitor who opens any page is sent to
// sign-in (which hands off to the shared identity screen at /auth/, not part
// of this preview build) — carrying the page they asked for — and never sees
// the page itself. See src/components/SignedInGate.tsx.
const GATED = [
  ["home", "./", "/"],
  ["pricing", "./pricing", "/pricing"],
  ["design wizard", "./design/analyze", "/design/analyze"],
  ["permitting wizard", "./permitting/analyze", "/permitting/analyze"],
  ["dashboard", "./dashboard/projects", "/dashboard/projects"],
  ["admin", "./admin", "/admin"],
] as const;
// the identity hand-off: /auth/?redirect=… (or /auth?redirect=… locally)
const HANDOFF = /\/auth\/?\?/;

for (const [name, url, path] of GATED) {
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

test("Terms and Privacy stay readable without signing in", async ({ page }) => {
  for (const url of ["./terms", "./privacy"]) {
    await page.goto(url, { waitUntil: "networkidle" });
    await expect(page.locator("#main-content")).toBeVisible();
    expect(page.url()).not.toMatch(/\/auth\b|\/sign-in/);
  }
});
