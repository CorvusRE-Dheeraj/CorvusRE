// Where emails link to. APP_URL is not set as a secret today, so default to the
// real production address (the app is served under /corvuspt/, and sign-in for
// every door happens on the shared /auth/ page at the same origin).
export const appBaseUrl = () =>
  (Deno.env.get("APP_URL") ?? "https://corvusre.com/corvuspt").replace(/\/$/, "");

// A login link that lands on `path` inside CorvusPT once signed in — the shared
// /auth/ page only accepts a same-origin absolute path as its redirect target.
export function loginUrl(path = "/dashboard"): string {
  const base = new URL(appBaseUrl());
  const target = `${base.pathname.replace(/\/$/, "")}${path}`;
  return `${base.origin}/auth/?redirect=${encodeURIComponent(target)}`;
}
