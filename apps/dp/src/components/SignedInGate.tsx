import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { appPath, isPublicPath } from "@/lib/public-paths";

// CorvusDP is sign-in only (Nov 2026): every page — the home page, pricing,
// the design / permitting wizards, the dashboard — needs a signed-in user. A
// signed-out visitor is sent to /sign-in (which hands off to the shared
// identity screen) and comes back to the page they asked for. The few pages
// open without signing in are in lib/public-paths.ts.

// Content stays in the page (the static build crawls it for links) but is
// hidden — never shown — until a signed-in user is confirmed. The prerendered
// HTML has no session, so it's hidden there too, and hydration matches.
export function SignedInGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.searchStr });
  const open = isPublicPath(pathname, import.meta.env.BASE_URL);
  const bounced = useRef(false);

  useEffect(() => {
    if (open || loading || user || bounced.current) return;
    bounced.current = true;
    const path = appPath(pathname, import.meta.env.BASE_URL);
    nav({ to: "/sign-in", search: { redirect: `${path}${search ?? ""}` }, replace: true });
  }, [open, loading, user, nav, pathname, search]);

  // Signed in again (or back on a gated page later) — allow the next bounce.
  useEffect(() => {
    if (user) bounced.current = false;
  }, [user]);

  const show = open || (!loading && !!user);
  return (
    <>
      {!show && (
        <div
          className="flex min-h-screen items-center justify-center bg-background"
          aria-live="polite"
        >
          <p className="text-sm text-muted-foreground">
            {loading ? "Loading CorvusDP…" : "Taking you to sign in…"}
          </p>
        </div>
      )}
      <div hidden={!show}>{children}</div>
    </>
  );
}
