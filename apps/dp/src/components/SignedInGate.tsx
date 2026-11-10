import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { appPath, isPublicPath } from "@/lib/public-paths";
import { getSignInRequired } from "@/lib/site-settings";

// When sign-in is required (the admin switch in Admin → Settings), every page —
// the home page, pricing, the design / permitting wizards, the dashboard —
// needs a signed-in user. A signed-out visitor is sent to /sign-in (which
// hands off to the shared identity screen) and comes back to the page they
// asked for. The few pages open even then are in lib/public-paths.ts. With
// the switch off, everything opens; the dashboard and admin still check
// sign-in themselves.

// Content stays in the page (the static build crawls it for links) but is
// hidden — never shown — until a signed-in user is confirmed. The prerendered
// HTML has no session, so it's hidden there too, and hydration matches.
export function SignedInGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.searchStr });
  // null until the admin switch has been read (the page stays hidden meanwhile)
  const [required, setRequired] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void getSignInRequired().then((r) => {
      if (live) setRequired(r);
    });
    return () => {
      live = false;
    };
  }, []);
  const open = required === false || isPublicPath(pathname, import.meta.env.BASE_URL);
  const bounced = useRef(false);
  const showing = useRef(false);

  useEffect(() => {
    if (open || required === null || loading || user || bounced.current) return;
    bounced.current = true;
    const path = appPath(pathname, import.meta.env.BASE_URL);
    nav({ to: "/sign-in", search: { redirect: `${path}${search ?? ""}` }, replace: true });
  }, [open, required, loading, user, nav, pathname, search]);

  // Back/forward can restore this page from the browser's back-forward cache
  // exactly as it was left — mid-hand-off, with the redirect already spent —
  // and nothing would run again, leaving "Loading CorvusDP…" on screen for good.
  // A restored page reloads instead, so the check (and the sign-in hand-off)
  // runs fresh.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted && !showing.current) window.location.reload();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  // Signed in again (or back on a gated page later) — allow the next bounce.
  useEffect(() => {
    if (user) bounced.current = false;
  }, [user]);

  const show = open || (!loading && !!user);
  showing.current = show;
  return (
    <>
      {!show && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background"
          aria-live="polite"
        >
          <p className="text-sm text-muted-foreground">
            {loading || required === null ? "Loading CorvusDP…" : "Taking you to sign in…"}
          </p>
        </div>
      )}
      <div hidden={!show}>{children}</div>
    </>
  );
}
