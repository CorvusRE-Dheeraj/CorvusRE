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
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";

// Billing and Settings live in the profile dropdown (SiteChrome.tsx) instead
// of here — they're account-level, not a property-tax workflow section, so
// grouping them with Sign out reads more clearly than sitting in this row.
// `locked` here actually disables the tab (grayed out, not a real link, just
// a "Coming soon" toast on click) — the matching route file's own LOCKED
// flag (ComingSoonLock) is the real gate against reaching it any other way
// (a direct URL, a link from elsewhere in the app), so the two must be kept
// in sync by hand. BPP Accounts and Tax Bills re-locked 2026-09-20 — both
// still under active development.
const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, locked: false },
  { to: "/dashboard/properties", label: "Properties", icon: Building2, locked: false },
  { to: "/dashboard/bpp-accounts", label: "BPP Accounts", icon: Briefcase, locked: true },
  { to: "/dashboard/documents", label: "Documents", icon: FileText, locked: false },
  { to: "/dashboard/deadlines", label: "Deadlines", icon: CalendarClock, locked: false },
  { to: "/dashboard/calendar", label: "Calendar", icon: CalendarDays, locked: false },
  { to: "/dashboard/tax-bills", label: "Tax Bills", icon: Receipt, locked: true },
] as const;

// Each tab has its own colour: a tinted icon at rest, and a matching gradient pill when
// it's the open page (the same colours as the page's banner). Full class strings so
// Tailwind can see them.
const TAB_COLOR: Record<string, { icon: string; active: string }> = {
  "/dashboard": {
    icon: "text-emerald-600",
    active: "data-[status=active]:from-emerald-500 data-[status=active]:to-teal-600",
  },
  "/dashboard/properties": {
    icon: "text-emerald-600",
    active: "data-[status=active]:from-emerald-500 data-[status=active]:to-sky-600",
  },
  "/dashboard/bpp-accounts": {
    icon: "text-sky-600",
    active: "data-[status=active]:from-sky-500 data-[status=active]:to-indigo-600",
  },
  "/dashboard/documents": {
    icon: "text-sky-600",
    active: "data-[status=active]:from-sky-500 data-[status=active]:to-indigo-600",
  },
  "/dashboard/deadlines": {
    icon: "text-amber-600",
    active: "data-[status=active]:from-amber-500 data-[status=active]:to-rose-500",
  },
  "/dashboard/calendar": {
    icon: "text-violet-600",
    active: "data-[status=active]:from-violet-500 data-[status=active]:to-fuchsia-600",
  },
  "/dashboard/tax-bills": {
    icon: "text-teal-600",
    active: "data-[status=active]:from-teal-500 data-[status=active]:to-blue-600",
  },
};

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
        {/* Sticks just under SiteNav's own sticky header (top-16 matches its
            h-16) so this tab bar stays reachable on long pages (Properties,
            Documents) instead of scrolling away — bg-background keeps page
            content from showing through once it's actually stuck. */}
        <nav className="sticky top-16 z-30 flex min-w-0 justify-center gap-1 overflow-x-auto bg-background pb-2 pt-2">
          {NAV.map((item) => {
            const Icon = item.icon;
            if (item.locked) {
              return (
                <button
                  key={item.to}
                  type="button"
                  onClick={() =>
                    toast(`${item.label} is coming soon`, {
                      description: "This section is still under development — check back soon.",
                    })
                  }
                  className="flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-muted-foreground/50 cursor-not-allowed"
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                  <Lock className="h-3 w-3" />
                </button>
              );
            }
            const color = TAB_COLOR[item.to];
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`group flex items-center gap-2 whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-medium text-muted-foreground transition-all hover:-translate-y-0.5 hover:bg-nav-highlight hover:text-nav-highlight-foreground data-[status=active]:bg-gradient-to-r data-[status=active]:text-white data-[status=active]:shadow-md ${color?.active ?? ""}`}
                activeOptions={{ exact: item.to === "/dashboard" }}
              >
                <Icon
                  className={`h-4 w-4 transition-colors group-data-[status=active]:text-white ${color?.icon ?? ""}`}
                />
                {item.label}
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
