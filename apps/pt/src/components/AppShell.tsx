import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";
import {
  LayoutDashboard,
  Building2,
  Briefcase,
  FileText,
  CalendarClock,
  CalendarDays,
  Receipt,
  Lock,
} from "lucide-react";
import { useAuth } from "@/lib/auth";

// Billing and Settings live in the profile dropdown (SiteChrome.tsx) instead
// of here — they're account-level, not a property-tax workflow section, so
// grouping them with Sign out reads more clearly than sitting in this row.
// `locked` is purely a visual signal here (the link still navigates) — the
// actual gate is the ComingSoonLock render a still-locked page shows itself.
// Both BPP Accounts (2026-09-15) and Tax Bills (2026-09-15) have shipped for
// real and no longer have a LOCKED flag to keep in sync with this one.
const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, locked: false },
  { to: "/dashboard/properties", label: "Properties", icon: Building2, locked: false },
  { to: "/dashboard/bpp-accounts", label: "BPP Accounts", icon: Briefcase, locked: false },
  { to: "/dashboard/documents", label: "Documents", icon: FileText, locked: false },
  { to: "/dashboard/deadlines", label: "Deadlines", icon: CalendarClock, locked: false },
  { to: "/dashboard/calendar", label: "Calendar", icon: CalendarDays, locked: false },
  { to: "/dashboard/tax-bills", label: "Tax Bills", icon: Receipt, locked: false },
] as const;

// Pages that keep their own full-width marketing/tooling layout instead of the
// account sidebar: the home page (explicitly excluded), the admin workspace
// (a different persona than "my properties"), and sign-in (nothing to show a
// signed-out visitor a dashboard for).
const NO_SHELL_PREFIXES = ["/admin", "/admin-login", "/sign-in"];

// Exported so SiteNav (SiteChrome.tsx) can tell whether this tab bar's own
// "Dashboard" entry is about to render on the current page — its top nav
// injects a "Dashboard" link for signed-in users, which would otherwise sit
// right on top of this tab bar's first item once both are horizontal rows.
export function shouldShowShell(pathname: string): boolean {
  if (pathname === "/") return false;
  return !NO_SHELL_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// Replays the `.page-enter` fade+rise (see styles.css) on every route
// change by toggling the class rather than remounting via a `key` — a key
// would tear down and rebuild whatever's inside (losing state and re-firing
// data fetches in nested layout routes, e.g. the dashboard tabs), which a
// purely decorative transition shouldn't do.
function usePageTransitionReplay(pathname: string) {
  const ref = useRef<HTMLDivElement>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const el = ref.current;
    if (!el) return;
    el.classList.remove("page-enter");
    void el.offsetWidth; // force reflow so the animation restarts
    el.classList.add("page-enter");
  }, [pathname]);

  return ref;
}

// Puts the same account tab bar (Properties, BPP, Documents, Deadlines, Billing,
// Settings) above every signed-in page site-wide, not just /dashboard/* — so
// switching between, say, the AI report and Properties doesn't mean losing this
// navigation and going back through the top nav.
export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const transitionRef = usePageTransitionReplay(pathname);

  if (loading || !user || !shouldShowShell(pathname)) {
    return (
      <div ref={transitionRef} className="page-enter">
        {children}
      </div>
    );
  }

  return (
    <div className="w-full px-6 py-10 sm:px-10 lg:px-16">
      <div className="grid grid-cols-1 gap-2">
        <nav className="flex min-w-0 justify-center gap-1 overflow-x-auto pb-2">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className="flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-nav-highlight hover:text-nav-highlight-foreground"
                activeProps={{ className: "bg-nav-highlight text-nav-highlight-foreground" }}
                activeOptions={{ exact: item.to === "/dashboard" }}
              >
                <Icon className="h-4 w-4" />
                {item.label}
                {item.locked && <Lock className="h-3 w-3 text-muted-foreground" />}
              </Link>
            );
          })}
        </nav>
        <div ref={transitionRef} className="min-w-0 page-enter">
          {children}
        </div>
      </div>
    </div>
  );
}
