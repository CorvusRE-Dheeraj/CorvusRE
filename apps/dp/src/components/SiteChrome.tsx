import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Phone } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { checkIsAdmin } from "@/lib/admin";
import { shouldShowShell } from "@/components/AppShell";
import { CONTACT_PHONES } from "@/lib/contact-info";

const NAV = [
  { to: "/", label: "Home" },
  { to: "/how-it-works", label: "How It Works" },
  { to: "/permitting", label: "Permitting" },
  { to: "/design", label: "Design" },
  { to: "/construction", label: "Construction" },
  { to: "/pricing", label: "Pricing" },
  { to: "/contact", label: "Contact" },
] as const;

function isNavActive(pathname: string, to: string) {
  return to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);
}

export function SiteNav() {
  const nav = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const signedIn = !!user;
  const [isAdmin, setIsAdmin] = useState(false);

  const navItems = signedIn
    ? shouldShowShell(pathname)
      ? NAV
      : [NAV[0], { to: "/dashboard", label: "Dashboard" } as const, ...NAV.slice(1)]
    : NAV;

  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      return;
    }
    checkIsAdmin(user.id).then(setIsAdmin);
  }, [user]);

  useEffect(() => {
    if (!profileOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node))
        setProfileOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setProfileOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [profileOpen]);

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="container-page flex h-16 items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-2">
          <LogoMark />
          <span className="font-serif text-lg font-semibold tracking-tight">
            Corvus<span className="text-accent">DP</span>
          </span>
        </Link>

        <nav className="relative hidden lg:flex items-center gap-1">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="relative rounded-md px-3 py-2 text-sm font-medium text-foreground/80 transition-colors hover:bg-nav-highlight hover:text-nav-highlight-foreground"
              activeProps={{ className: "bg-nav-highlight text-nav-highlight-foreground" }}
              activeOptions={{ exact: item.to === "/" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {signedIn ? (
            <div className="relative" ref={profileRef}>
              <button
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
                  {[
                    { to: "/dashboard", label: "Dashboard" },
                    { to: "/dashboard/referrals", label: "Referrals" },
                    { to: "/dashboard/settings", label: "Settings" },
                    { to: "/pricing", label: "Plans" },
                  ].map((l) => (
                    <Link
                      key={l.to}
                      to={l.to}
                      onClick={() => setProfileOpen(false)}
                      className="block rounded-md px-3 py-2 transition-colors hover:bg-secondary"
                    >
                      {l.label}
                    </Link>
                  ))}
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
                    onClick={async () => {
                      await supabase.auth.signOut();
                      setProfileOpen(false);
                      nav({ to: "/" });
                    }}
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
                onClick={() => setOpen(false)}
                className={`rounded-md px-3 py-3 text-sm font-medium transition-colors hover:bg-secondary ${
                  isNavActive(pathname, item.to)
                    ? "bg-nav-highlight text-nav-highlight-foreground"
                    : ""
                }`}
              >
                {item.label}
              </Link>
            ))}
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
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border/70 bg-secondary/40">
      <div className="container-page py-5 text-xs text-muted-foreground flex flex-wrap justify-between gap-2">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>© {new Date().getFullYear()} CorvusDP — AI-assisted permitting & design.</span>
          <Link to="/terms" className="underline underline-offset-2 hover:text-foreground">
            Terms
          </Link>
          <Link to="/privacy" className="underline underline-offset-2 hover:text-foreground">
            Privacy
          </Link>
          <a href="/" className="underline underline-offset-2 hover:text-foreground">
            CorvusRE
          </a>
          {CONTACT_PHONES.map((p) => (
            <a
              key={p.href}
              href={p.href}
              className="flex items-center gap-1 underline-offset-2 hover:text-foreground hover:underline"
            >
              <Phone className="h-3 w-3" aria-hidden />
              {p.display}
            </a>
          ))}
        </span>
        <span>Estimates only — always confirm requirements with the governing authority.</span>
      </div>
    </footer>
  );
}

function LogoMark() {
  return (
    <span
      className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-accent text-accent-foreground"
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
