import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  LayoutDashboard,
  FileStack,
  Route as RouteIcon,
  ListChecks,
  Receipt,
  CalendarClock,
  MessagesSquare,
  FolderOpen,
  BadgeCheck,
  DraftingCompass,
  Layers,
  ClipboardCheck,
  Bell,
  Gift,
  ClipboardList,
  NotebookPen,
  HelpCircle,
} from "lucide-react";
import { useAuth } from "@/lib/auth";

const NAV = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { to: "/dashboard/permits", label: "Permits", icon: FileStack },
  { to: "/dashboard/roadmap", label: "Roadmap", icon: RouteIcon },
  { to: "/dashboard/constraints", label: "Site Data", icon: Layers },
  { to: "/dashboard/checklist", label: "Checklist", icon: ListChecks },
  { to: "/dashboard/prepare", label: "Prepare", icon: ClipboardCheck },
  { to: "/dashboard/fees", label: "Fees", icon: Receipt },
  { to: "/dashboard/timeline", label: "Timeline", icon: CalendarClock },
  { to: "/dashboard/reviews", label: "Reviews", icon: MessagesSquare },
  { to: "/dashboard/city", label: "City", icon: MessagesSquare },
  { to: "/dashboard/documents", label: "Documents", icon: FolderOpen },
  { to: "/dashboard/approvals", label: "Approvals", icon: BadgeCheck },
  { to: "/dashboard/inspections", label: "Inspections", icon: ClipboardList },
  { to: "/dashboard/daily-log", label: "Daily Log", icon: NotebookPen },
  { to: "/dashboard/rfis", label: "RFIs", icon: HelpCircle },
  { to: "/dashboard/notifications", label: "Alerts", icon: Bell },
  { to: "/dashboard/design", label: "Design", icon: DraftingCompass },
  { to: "/dashboard/referrals", label: "Referrals", icon: Gift },
] as const;

const NO_SHELL_PREFIXES = [
  "/admin",
  "/admin-login",
  "/sign-in",
  "/forgot-password",
  "/reset-password",
];

export function shouldShowShell(pathname: string): boolean {
  if (pathname === "/") return false;
  return !NO_SHELL_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const onDashboard = pathname === "/dashboard" || pathname.startsWith("/dashboard/");
  if (loading || !user || !onDashboard) {
    return <div className="page-enter">{children}</div>;
  }

  return (
    <div className="w-full px-4 py-8 sm:px-8 lg:px-14">
      <nav className="mb-4 flex min-w-0 gap-1 overflow-x-auto pb-2">
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
            </Link>
          );
        })}
      </nav>
      <div className="min-w-0 page-enter">{children}</div>
    </div>
  );
}
