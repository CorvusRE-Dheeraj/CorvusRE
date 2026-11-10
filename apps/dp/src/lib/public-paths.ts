// Whether CorvusDP is sign-in only is an admin switch (Admin → Settings,
// stored in public.site_settings — see lib/site-settings.ts and
// components/SignedInGate.tsx). This is only the fallback used when that
// setting can't be read: the safe choice, sign-in required. The dashboard and
// admin keep their own sign-in checks regardless of the switch.
export const SIGN_IN_REQUIRED_FALLBACK = true;

// Open without signing in even when sign-in is required: the sign-in hand-off
// and its return trip, password reset, the staff admin sign-in, and the
// Terms / Privacy pages the sign-up screen links to.
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
