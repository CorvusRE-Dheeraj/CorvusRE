import { Link, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  Building2,
  Check,
  Trash2,
  Landmark,
  Menu,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { listProjects, setActiveProject, deleteProject } from "@/lib/projects";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

type NavLink = { to: string; label: string; icon: typeof LayoutDashboard };
type NavSubgroup = { heading: string; items: NavLink[] };

// A persistent left sidebar, not a horizontal bar of dropdowns — the old
// layout buried all 10 permitting pages and all 3 construction pages behind
// a click-to-open menu with no internal structure, which is exactly what
// "hard to navigate" reports. A sidebar keeps every destination visible at
// once, and workflow subgroups (below) give the eye something to scan
// instead of 10 flat rows in a dropdown.
const OVERVIEW: NavLink = { to: "/dashboard", label: "Overview", icon: LayoutDashboard };
const DESIGN: NavLink = { to: "/dashboard/design", label: "Design", icon: DraftingCompass };

const PERMITTING_SUBGROUPS: NavSubgroup[] = [
  {
    heading: "Plan & prepare",
    items: [
      { to: "/dashboard/constraints", label: "Site Data", icon: Layers },
      { to: "/dashboard/checklist", label: "Checklist", icon: ListChecks },
      { to: "/dashboard/prepare", label: "Prepare", icon: ClipboardCheck },
      { to: "/dashboard/fees", label: "Fees", icon: Receipt },
    ],
  },
  {
    heading: "File & track",
    items: [
      { to: "/dashboard/permits", label: "Permits", icon: FileStack },
      { to: "/dashboard/roadmap", label: "Roadmap", icon: RouteIcon },
      { to: "/dashboard/timeline", label: "Timeline", icon: CalendarClock },
      { to: "/dashboard/reviews", label: "Reviews", icon: MessagesSquare },
      { to: "/dashboard/city", label: "City", icon: Landmark },
      { to: "/dashboard/approvals", label: "Approvals", icon: BadgeCheck },
    ],
  },
];

const CONSTRUCTION_ITEMS: NavLink[] = [
  { to: "/dashboard/inspections", label: "Inspections", icon: ClipboardList },
  { to: "/dashboard/daily-log", label: "Daily Log", icon: NotebookPen },
  { to: "/dashboard/rfis", label: "Submittals & RFIs", icon: HelpCircle },
];

const ACCOUNT_ITEMS: NavLink[] = [
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
const activeCls = "bg-nav-highlight text-nav-highlight-foreground";
const sidebarLinkCls =
  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-nav-highlight hover:text-nav-highlight-foreground";

function SidebarLink({
  item,
  exact,
  onNavigate,
}: {
  item: NavLink;
  exact?: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      className={sidebarLinkCls}
      activeProps={{ className: activeCls }}
      activeOptions={{ exact }}
      onClick={onNavigate}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function SidebarSectionLabel({ icon: Icon, label }: { icon: typeof LayoutDashboard; label: string }) {
  return (
    <div className="mt-5 flex items-center gap-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground first:mt-0">
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </div>
  );
}

// The dashboard nav's full destination list, rendered identically in the
// persistent desktop sidebar and the mobile slide-over — everything is
// visible at once (no click-to-reveal dropdown), and the permitting
// workflow is broken into "Plan & prepare" vs "File & track" so 10 pages
// read as two short lists instead of one long undifferentiated one.
function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Dashboard" className="flex flex-col gap-1">
      <SidebarLink item={OVERVIEW} exact onNavigate={onNavigate} />
      <SidebarLink item={DESIGN} onNavigate={onNavigate} />

      <SidebarSectionLabel icon={FileStack} label="Permitting" />
      {PERMITTING_SUBGROUPS.map((group) => (
        <div key={group.heading} className="flex flex-col gap-1">
          <div className="px-3 pt-1.5 pb-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
            {group.heading}
          </div>
          {group.items.map((item) => (
            <SidebarLink key={item.to} item={item} onNavigate={onNavigate} />
          ))}
        </div>
      ))}

      <SidebarSectionLabel icon={HardHat} label="Construction" />
      {CONSTRUCTION_ITEMS.map((item) => (
        <SidebarLink key={item.to} item={item} onNavigate={onNavigate} />
      ))}

      <div className="mt-5 flex flex-col gap-1 border-t border-border pt-3">
        {ACCOUNT_ITEMS.map((item) => (
          <SidebarLink key={item.to} item={item} onNavigate={onNavigate} />
        ))}
      </div>
    </nav>
  );
}

// Every dashboard tab (Overview, Permits, Roadmap, Fees, …) is scoped to
// ONE active project (useActiveProjectBundle → getActiveProject, "most
// recently touched"). Settings has the full manage-properties list
// (switch/delete), but making someone go there just to switch which
// property the whole dashboard is showing was the actual friction — this
// puts the same switch action one click away from wherever they already
// are. Hidden entirely when there's 0 or 1 property, so it adds no clutter
// for the common case.
function ProjectSwitcher() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [switching, setSwitching] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const projects = useQuery({
    queryKey: ["all-projects", user?.id],
    queryFn: () => listProjects(user!.id),
    enabled: !!user?.id,
  });

  const rows = projects.data ?? [];
  if (rows.length < 2) return null;

  const active = rows[0]; // listProjects already orders by updated_at desc
  const busy = !!switching || !!deleting;

  function invalidateAll() {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ["active-project"] }),
      queryClient.invalidateQueries({ queryKey: ["project-bundle"] }),
      queryClient.invalidateQueries({ queryKey: ["all-projects"] }),
    ]);
  }

  async function switchTo(id: string) {
    if (id === active.id || busy) return;
    setSwitching(id);
    try {
      await setActiveProject(id);
      await invalidateAll();
    } finally {
      setSwitching(null);
    }
  }

  async function confirmDelete(id: string) {
    if (busy) return;
    setDeleting(id);
    try {
      await deleteProject(id);
      await invalidateAll();
    } finally {
      setDeleting(null);
      setConfirmingDeleteId(null);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
        aria-label="Switch or delete property"
      >
        <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-left">{active.name ?? active.address ?? "Property"}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[18rem]">
        <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Switch or delete a property
        </div>
        {rows.map((p) => {
          const label = p.name ?? p.address ?? "Property";
          const confirming = confirmingDeleteId === p.id;
          return (
            <DropdownMenuItem
              key={p.id}
              disabled={busy && switching !== p.id}
              onSelect={(e) => {
                // The delete button below is nested inside this item and
                // already stops its own click from bubbling here — this
                // guard is a second line of defense so a confirm click
                // can never also be read as "switch to this property".
                if (confirming) {
                  e.preventDefault();
                  return;
                }
                switchTo(p.id);
              }}
              className="cursor-pointer justify-between gap-2"
            >
              <span className="truncate">{label}</span>
              <span className="flex shrink-0 items-center gap-2">
                {switching === p.id && (
                  <span className="text-xs text-muted-foreground">Switching…</span>
                )}
                {switching !== p.id && p.id === active.id && (
                  <Check className="h-4 w-4 text-accent" aria-hidden />
                )}
                {confirming ? (
                  <button
                    type="button"
                    disabled={!!deleting}
                    onClick={(e) => {
                      e.stopPropagation();
                      confirmDelete(p.id);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="text-xs font-semibold text-destructive underline underline-offset-2 disabled:opacity-50"
                  >
                    {deleting === p.id ? "Deleting…" : "Confirm?"}
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label={`Delete ${label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmingDeleteId(p.id);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="rounded p-0.5 text-muted-foreground transition-colors hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
              </span>
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const onDashboard = pathname === "/dashboard" || pathname.startsWith("/dashboard/");
  if (loading || !user || !onDashboard) {
    return <div className="page-enter">{children}</div>;
  }

  return (
    <div className="flex w-full items-start">
      {/* Desktop: a persistent sidebar, sticky under the site header, that
          scrolls independently once the nav list is taller than the
          viewport. Every destination is visible at once — no click-to-open
          dropdown standing between the user and a page. */}
      <aside className="sticky top-16 hidden max-h-[calc(100vh-4rem)] w-64 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border px-4 py-6 md:flex">
        <ProjectSwitcher />
        <SidebarNav />
      </aside>

      <div className="min-w-0 flex-1 px-4 py-6 sm:px-8 lg:px-14 lg:py-8">
        {/* Mobile / tablet: the same nav in a slide-over, opened from a menu
            button, so narrow screens get one clear list instead of a
            cramped or wrapping horizontal bar. */}
        <div className="mb-4 md:hidden">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
              aria-label="Open dashboard navigation"
            >
              <Menu className="h-4 w-4" aria-hidden />
              Menu
            </SheetTrigger>
            <SheetContent side="left" className="flex w-72 flex-col gap-4 overflow-y-auto px-4 py-6">
              <SheetTitle className="px-1 text-base">Dashboard</SheetTitle>
              <SheetDescription className="sr-only">
                Jump to any section of your CorvusDP dashboard.
              </SheetDescription>
              <ProjectSwitcher />
              <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
            </SheetContent>
          </Sheet>
        </div>
        {/* Keyed by pathname so switching dashboard tabs actually remounts this
            wrapper and replays the page-enter animation each time — without
            the key, this div is the same DOM node across every tab switch
            (only <Outlet/>'s children swap inside it), so the CSS animation
            only ever played once, on the very first dashboard load. */}
        <div key={pathname} className="min-w-0 page-enter">
          {children}
        </div>
      </div>
    </div>
  );
}
