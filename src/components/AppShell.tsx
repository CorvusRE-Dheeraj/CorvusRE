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
  ClipboardList,
  NotebookPen,
  HelpCircle,
  HardHat,
  ChevronDown,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type NavLink = { to: string; label: string; icon: typeof LayoutDashboard };

// Grouped rather than one flat 18-item row — that many top-level tabs was a
// real usability problem (forced horizontal scrolling, nothing to orient a
// first-time visitor). Grouped by the same three doors the marketing site
// already uses (Permitting / Design / Construction) plus Overview and two
// account-wide items, so the mental model matches everywhere in the app.
const OVERVIEW: NavLink = { to: "/dashboard", label: "Overview", icon: LayoutDashboard };

const PERMITTING_GROUP: NavLink[] = [
  { to: "/dashboard/permits", label: "Permits", icon: FileStack },
  { to: "/dashboard/roadmap", label: "Roadmap", icon: RouteIcon },
  { to: "/dashboard/constraints", label: "Site Data", icon: Layers },
  { to: "/dashboard/checklist", label: "Checklist", icon: ListChecks },
  { to: "/dashboard/prepare", label: "Prepare", icon: ClipboardCheck },
  { to: "/dashboard/fees", label: "Fees", icon: Receipt },
  { to: "/dashboard/timeline", label: "Timeline", icon: CalendarClock },
  { to: "/dashboard/reviews", label: "Reviews", icon: MessagesSquare },
  { to: "/dashboard/city", label: "City", icon: MessagesSquare },
  { to: "/dashboard/approvals", label: "Approvals", icon: BadgeCheck },
];

const CONSTRUCTION_GROUP: NavLink[] = [
  { to: "/dashboard/inspections", label: "Inspections", icon: ClipboardList },
  { to: "/dashboard/daily-log", label: "Daily Log", icon: NotebookPen },
  { to: "/dashboard/rfis", label: "Submittals & RFIs", icon: HelpCircle },
];

const TRAILING: NavLink[] = [
  { to: "/dashboard/design", label: "Design", icon: DraftingCompass },
  { to: "/dashboard/documents", label: "Documents", icon: FolderOpen },
  { to: "/dashboard/notifications", label: "Alerts", icon: Bell },
];

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

// Focus-visible ring comes for free from the sitewide a/button rule in
// styles.css — no need to redeclare it per component.
const linkCls =
  "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-nav-highlight hover:text-nav-highlight-foreground";
const activeCls = "bg-nav-highlight text-nav-highlight-foreground";

function NavItem({ item, exact }: { item: NavLink; exact?: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      className={linkCls}
      activeProps={{ className: activeCls }}
      activeOptions={{ exact }}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {item.label}
    </Link>
  );
}

function NavGroup({
  label,
  icon: Icon,
  items,
  pathname,
}: {
  label: string;
  icon: typeof LayoutDashboard;
  items: NavLink[];
  pathname: string;
}) {
  const isActive = items.some((i) => pathname === i.to || pathname.startsWith(`${i.to}/`));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(linkCls, isActive && activeCls)}
        aria-label={`${label} menu`}
      >
        <Icon className="h-4 w-4" aria-hidden />
        {label}
        <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[12rem]">
        {items.map((item) => {
          const ItemIcon = item.icon;
          const itemActive = pathname === item.to || pathname.startsWith(`${item.to}/`);
          return (
            <DropdownMenuItem key={item.to} asChild>
              <Link
                to={item.to}
                className={cn("cursor-pointer", itemActive && "bg-secondary font-medium")}
              >
                <ItemIcon className="h-4 w-4" aria-hidden />
                {item.label}
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
      <nav aria-label="Dashboard" className="mb-4 flex flex-wrap items-center gap-1 pb-2">
        <NavItem item={OVERVIEW} exact />
        <NavGroup label="Permitting" icon={FileStack} items={PERMITTING_GROUP} pathname={pathname} />
        <NavItem item={TRAILING[0]} />
        <NavGroup label="Construction" icon={HardHat} items={CONSTRUCTION_GROUP} pathname={pathname} />
        <NavItem item={TRAILING[1]} />
        <NavItem item={TRAILING[2]} />
      </nav>
      <div className="min-w-0 page-enter">{children}</div>
    </div>
  );
}
