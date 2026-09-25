import { NotificationsBell } from "@/components/NotificationsBell";
import { ConfirmHost } from "@/components/ConfirmHost";
import { WelcomeTour } from "@/components/WelcomeTour";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { checkIsAdmin } from "@/lib/admin";
import { shouldShowShell } from "@/components/AppShell";
import { getMyFeedbackResponse, isFormV2Complete } from "@/lib/beta-feedback";
import { openFeedbackWidget } from "@/lib/feedback-widget-events";
import { getMyBilling } from "@/lib/billing";
import { ThemeToggle } from "@/components/ThemeToggle";
import { HelpMenu } from "@/components/HelpMenu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

const NAV = [
  { to: "/", label: "Home" },
  { to: "/how-it-works", label: "How It Works" },
  { to: "/property-protest", label: "Protest" },
  { to: "/bpp-rendition", label: "Personal Property" },
  { to: "/tax-payment", label: "Pay Taxes" },
  { to: "/dashboard/tax-updates", label: "Texas Tax Updates" },
  { to: "/pricing", label: "Pricing" },
  { to: "/contact", label: "Contact Us" },
] as const;

function isNavActive(pathname: string, to: string) {
  return to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);
}

export function SiteNav() {
  const nav = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const { user, session } = useAuth();
  const signedIn = !!user;
  const [isAdmin, setIsAdmin] = useState(false);
  // null = not checked yet (never prompts). Only ever gates a soft nudge
  // (the sign-out prompt, the follow-up email), never blocks anything itself, so a
  // failed check just leaves it null and nothing fires — same "fail open"
  // treatment as isAdmin above.
  const [feedbackDone, setFeedbackDone] = useState<boolean | null>(null);
  // The feedback form is for BETA TESTERS specifically (plan === "beta",
  // the same free/full-access grant Billing.tsx's own isBeta check reads) —
  // a real paying customer isn't part of that cohort and shouldn't get
  // interrupted at sign-out for a survey that isn't about them.
  const [isBetaUser, setIsBetaUser] = useState<boolean | null>(null);
  const promptEligible = isBetaUser === true && feedbackDone === false;
  const [showSignOutPrompt, setShowSignOutPrompt] = useState(false);
  // The Feedback nav tab opens the floating feedback widget in place instead of
  // navigating anywhere.
  const feedbackItemClick = (to: string) => (e: { preventDefault: () => void }) => {
    if (to !== "/dashboard/feedback") return;
    e.preventDefault();
    openFeedbackWidget();
  };
  // AppShell renders its own "Dashboard"-first tab bar directly under this
  // nav on every signed-in page except "/" and a few auth/admin routes (see
  // shouldShowShell) — skip injecting a second "Dashboard" link here on those
  // pages so the two rows don't repeat the same entry right on top of each other.
  const baseNavItems = signedIn
    ? shouldShowShell(pathname)
      ? NAV
      : [NAV[0], { to: "/dashboard", label: "Dashboard" } as const, ...NAV.slice(1)]
    : NAV;
  // Beta testers only — same "beta" plan gate as the profile dropdown's
  // "Beta Feedback" link, just surfaced in the main nav too, right next to
  // Contact Us, since NAV's last entry is Contact Us.
  const navItems = isBetaUser
    ? [...baseNavItems, { to: "/dashboard/feedback", label: "Feedback" } as const]
    : baseNavItems;

  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      return;
    }
    // Swallow failures instead of leaving an unhandled rejection — this runs
    // on every page for every signed-in user, so any transient hiccup (a
    // fresh JWT's clock-skew check tripping right after sign-up, a dropped
    // request) would otherwise throw site-wide. Non-critical either way:
    // it only gates showing the Admin nav link, so falling back to "not
    // admin" is always the safe default.
    checkIsAdmin(user.id)
      .then(setIsAdmin)
      .catch((err) => {
        console.error("Could not check admin status:", err);
        setIsAdmin(false);
      });
  }, [user]);

  useEffect(() => {
    if (!user) {
      setFeedbackDone(null);
      setIsBetaUser(null);
      return;
    }
    getMyFeedbackResponse(user.id)
      .then((r) => setFeedbackDone(isFormV2Complete(r)))
      .catch(() => setFeedbackDone(null));
    getMyBilling(user.id)
      .then((b) => setIsBetaUser(b.plan === "beta"))
      .catch(() => setIsBetaUser(null));
  }, [user]);

  // Catches a tab close of any kind, including a keyboard-triggered one
  // (Ctrl+W and friends) — browsers reserve those shortcuts entirely, no
  // page JS ever sees them in time to show its own UI, so there's no way to
  // put a branded modal in front of that specific exit. `pagehide`, unlike
  // `beforeunload`, fires reliably for every way of leaving a page
  // (including a keyboard close) without needing any user interaction with
  // a dialog — so instead of trying to interrupt in the moment, this fires
  // a `sendBeacon` (the one API designed to survive the page tearing down
  // mid-call) telling beacon-feedback-nudge to follow up by email shortly
  // after — that function itself caps it at 3 sends, 2 days apart, so
  // firing this beacon on every single close attempt is safe; it's a no-op
  // most of the time. The access token travels in the beacon body because
  // sendBeacon cannot set an Authorization header at all.
  useEffect(() => {
    if (!promptEligible || !session?.access_token) return;
    const token = session.access_token;
    function onPageHide() {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const url = `${supabaseUrl}/functions/v1/beacon-feedback-nudge`;
      const body = new Blob([JSON.stringify({ accessToken: token })], { type: "application/json" });
      navigator.sendBeacon(url, body);
    }
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [promptEligible, session?.access_token]);

  function handleSignOutClick() {
    if (promptEligible) {
      setProfileOpen(false);
      setShowSignOutPrompt(true);
      return;
    }
    void doSignOut();
  }

  async function doSignOut() {
    // Navigate away from /dashboard/* and WAIT for it to finish before
    // signing out — otherwise the dashboard layout's own "no user ->
    // /sign-in" guard, still mounted while this promise is in flight,
    // reacts to the auth state change first and wins the race to
    // /sign-in (which hands off to /auth/) instead of landing on "/".
    // Same fix as handleDeleteAccount in _layout.settings.tsx; this button
    // had the same pre-existing race (signOut-then-navigate), just newly
    // visible once testing actually followed the sign-out through.
    setProfileOpen(false);
    await nav({ to: "/" });
    await supabase.auth.signOut();
  }

  useEffect(() => {
    if (!profileOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    }
    // Escape closes the menu and returns focus to its trigger — without
    // this, a keyboard user who opens the menu has no way to dismiss it
    // except tabbing all the way through its items, and closing it any
    // other way silently drops focus into the page with no visible ring.
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setProfileOpen(false);
        profileButtonRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [profileOpen]);

  // Same Escape-to-close-and-return-focus pattern for the mobile nav sheet.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        menuButtonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Sticky nav gains a bit of depth once content has actually scrolled under
  // it, instead of always casting the same flat shadow.
  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 8);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const navContainerRef = useRef<HTMLDivElement>(null);
  const linkRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const [indicator, setIndicator] = useState({ left: 0, width: 0, visible: false });

  // A single pill slides between nav links on route change instead of each
  // link toggling its own static background — deps are primitives (pathname,
  // signedIn), not the `navItems` array literal, since that's a fresh
  // reference every render and would otherwise re-fire this effect forever.
  useLayoutEffect(() => {
    function recompute() {
      const container = navContainerRef.current;
      const activeItem = navItems.find((item) => isNavActive(pathname, item.to));
      const link = activeItem ? linkRefs.current[activeItem.to] : null;
      if (!container || !link) {
        setIndicator((s) => (s.visible ? { left: s.left, width: s.width, visible: false } : s));
        return;
      }
      const containerRect = container.getBoundingClientRect();
      const linkRect = link.getBoundingClientRect();
      setIndicator({
        left: linkRect.left - containerRect.left,
        width: linkRect.width,
        visible: true,
      });
    }
    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, signedIn]);

  return (
    <header
      className={`sticky top-0 z-40 print:hidden border-b border-border/70 bg-background/85 backdrop-blur transition-shadow duration-300 ${
        scrolled ? "shadow-[0_8px_24px_-16px_oklch(0.18_0.06_250_/_0.35)]" : ""
      }`}
    >
      <div className="container-page flex h-16 items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-2">
          <LogoMark />
          <span className="font-serif text-lg font-semibold tracking-tight">
            Corvus<span className="text-emerald-700 dark:text-emerald-400">PT</span>
          </span>
        </Link>

        <nav
          aria-label="Main"
          ref={navContainerRef}
          className="relative hidden lg:flex items-center gap-1"
        >
          <span
            aria-hidden
            className="absolute inset-y-1 rounded-md bg-nav-highlight transition-[left,width] duration-300 ease-out"
            style={{
              left: indicator.left,
              width: indicator.width,
              opacity: indicator.visible ? 1 : 0,
            }}
          />
          {navItems.map((item) => (
            <Link
              key={item.to}
              ref={(el) => {
                linkRefs.current[item.to] = el;
              }}
              to={item.to}
              onClick={feedbackItemClick(item.to)}
              className="relative rounded-md px-3 py-2 text-sm font-medium text-foreground/80 transition-colors hover:bg-nav-highlight hover:text-nav-highlight-foreground"
              activeProps={{ className: "text-nav-highlight-foreground" }}
              activeOptions={{ exact: item.to === "/" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-1 sm:gap-2">
          <NotificationsBell />
          <div className="hidden sm:block">
            <HelpMenu />
          </div>
          <WelcomeTour />
          <ConfirmHost />
          <ThemeToggle />
          {signedIn ? (
            <div className="relative" ref={profileRef}>
              <button
                ref={profileButtonRef}
                onClick={() => setProfileOpen((v) => !v)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold transition-transform hover:scale-105 active:scale-95"
                aria-label="Profile menu"
                aria-haspopup="menu"
                aria-expanded={profileOpen}
              >
                {(user?.email?.[0] ?? "U").toUpperCase()}
              </button>
              {profileOpen && (
                <div className="absolute right-0 mt-2 w-52 card-elev p-1 text-sm">
                  <Link
                    to="/dashboard"
                    onClick={() => setProfileOpen(false)}
                    className="block rounded-md px-3 py-2 transition-colors hover:bg-secondary"
                  >
                    Dashboard
                  </Link>
                  <Link
                    to="/pricing"
                    onClick={() => setProfileOpen(false)}
                    className="block rounded-md px-3 py-2 transition-colors hover:bg-secondary"
                  >
                    Subscription
                  </Link>
                  <Link
                    to="/dashboard/billing"
                    onClick={() => setProfileOpen(false)}
                    className="block rounded-md px-3 py-2 transition-colors hover:bg-secondary"
                  >
                    Billing
                  </Link>
                  <Link
                    to="/dashboard/referrals"
                    onClick={() => setProfileOpen(false)}
                    className="block rounded-md px-3 py-2 transition-colors hover:bg-secondary"
                  >
                    Referrals
                  </Link>
                  <Link
                    to="/dashboard/settings"
                    onClick={() => setProfileOpen(false)}
                    className="block rounded-md px-3 py-2 transition-colors hover:bg-secondary"
                  >
                    Settings
                  </Link>
                  {isBetaUser && (
                    <Link
                      to="/dashboard/feedback"
                      onClick={(e) => {
                        e.preventDefault();
                        setProfileOpen(false);
                        openFeedbackWidget();
                      }}
                      className="block rounded-md px-3 py-2 transition-colors hover:bg-secondary"
                    >
                      Beta Feedback
                    </Link>
                  )}
                  {isAdmin && (
                    <Link
                      to="/admin"
                      onClick={() => setProfileOpen(false)}
                      className="block rounded-md px-3 py-2 transition-colors hover:bg-secondary"
                    >
                      Admin
                    </Link>
                  )}
                  <button
                    onClick={handleSignOutClick}
                    className="block w-full rounded-md px-3 py-2 text-left transition-colors hover:bg-secondary"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link
              to="/sign-in"
              search={{ redirect: pathname }}
              className="btn-outline hidden sm:inline-flex text-sm"
            >
              Sign In
            </Link>
          )}
          <button
            ref={menuButtonRef}
            className="lg:hidden btn-outline text-sm"
            onClick={() => setOpen((v) => !v)}
            aria-label="Menu"
            aria-expanded={open}
          >
            Menu
          </button>
        </div>
      </div>
      {open && (
        <div className="lg:hidden border-t border-border/70 bg-background">
          <div className="container-page grid gap-1 py-3">
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={(e) => {
                  setOpen(false);
                  feedbackItemClick(item.to)(e);
                }}
                className="rounded-md px-3 py-3 text-sm font-medium transition-colors hover:bg-secondary"
              >
                {item.label}
              </Link>
            ))}
            <div className="sm:hidden">
              <HelpMenu inline />
            </div>
            {!signedIn && (
              <Link
                to="/sign-in"
                search={{ redirect: pathname }}
                onClick={() => setOpen(false)}
                className="btn-outline mt-2"
              >
                Sign In
              </Link>
            )}
          </div>
        </div>
      )}
      <Dialog open={showSignOutPrompt} onOpenChange={setShowSignOutPrompt}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Got a couple minutes before you go?</DialogTitle>
            <DialogDescription>
              You're one of our beta testers, and we haven't heard from you yet. Help us make Corvus
              better — it's 7-10 minutes, and it really helps.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <button
              onClick={() => {
                setShowSignOutPrompt(false);
                void doSignOut();
              }}
              className="btn-outline"
            >
              Just sign out
            </button>
            <button
              onClick={() => {
                setShowSignOutPrompt(false);
                openFeedbackWidget();
              }}
              className="btn-primary btn-primary-hover"
            >
              Give feedback
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}

// Trimmed down to just the copyright/coverage line — the full multi-column
// footer (logo blurb + Platform/Services/Company link columns) was removed
// site-wide as redundant with the top nav, but this bottom line stays as the
// one place stating real county coverage.
export function SiteFooter() {
  return (
    <footer className="border-t border-border/70 bg-secondary/40">
      <div className="container-page py-5 text-xs text-muted-foreground flex flex-wrap justify-between gap-2">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            © {new Date().getFullYear()} CorvusPT — Texas Property Tax AI. All rights reserved.
          </span>
          <Link to="/terms" className="underline underline-offset-2 hover:text-foreground">
            Terms of Service
          </Link>
          <Link to="/privacy" className="underline underline-offset-2 hover:text-foreground">
            Privacy Policy
          </Link>
        </span>
        {/* Matches supabase/functions/cad-lookup/index.ts's countyQueriesInOrder
            (Collin, Montgomery, Denton, Harris, Tarrant, Fort Bend, Williamson,
            Grayson, Travis, Bexar, Dallas, Kaufman) — the real counties with a
            live data source, not an aspirational "all 254" claim. Update both
            this list and the count if that array ever changes. */}
        <span>
          Serving 12 Texas counties for Beta phase — Collin, Montgomery, Denton, Harris, Tarrant,
          Fort Bend, Williamson, Grayson, Travis, Bexar, Dallas, and Kaufman.
        </span>
      </div>
    </footer>
  );
}

function LogoMark() {
  return (
    <span
      className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-brand text-brand-foreground"
      aria-hidden
    >
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M4 20c3-6 5-9 8-9s5 3 8 9" strokeLinecap="round" />
        <circle cx="16" cy="7" r="2" fill="currentColor" />
      </svg>
    </span>
  );
}

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteNav />
      <main className="min-h-[70vh]">{children}</main>
      <SiteFooter />
    </>
  );
}
