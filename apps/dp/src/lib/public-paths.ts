// CorvusDP is sign-in only (Nov 2026) — see components/SignedInGate.tsx.
// Open without signing in: the sign-in hand-off and its return trip, password
// reset, the staff admin sign-in, and the Terms / Privacy pages the sign-up
// screen links to.
export const PUBLIC_PATHS = new Set([
  "/sign-in",
  "/auth/callback",
  "/forgot-password",
  "/reset-password",
  "/admin-login",
  "/terms",
  "/privacy",
]);

// The router's pathname, without the site base (e.g. "/corvusdp") or a
// trailing slash.
export function appPath(pathname: string, base: string): string {
  const b = base.replace(/\/$/, "");
  let p =
    b && (pathname === b || pathname.startsWith(`${b}/`)) ? pathname.slice(b.length) : pathname;
  p = p.replace(/\/+$/, "");
  return p || "/";
}

export function isPublicPath(pathname: string, base: string): boolean {
  const p = appPath(pathname, base);
  // /auth/… is the shared identity app (a separate build). If a request for
  // it ever lands here (local dev without the identity server), show the
  // not-found page rather than bouncing back to sign-in in a loop.
  return PUBLIC_PATHS.has(p) || p === "/auth" || p.startsWith("/auth/");
}
