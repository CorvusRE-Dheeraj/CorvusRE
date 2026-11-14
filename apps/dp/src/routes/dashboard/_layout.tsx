import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/dashboard/_layout")({
  component: DashboardLayout,
});

function DashboardLayout() {
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.searchStr });
  // This layout stays mounted for a beat while the router transitions to
  // /sign-in, and `path` flips to "/sign-in" during that window — without
  // this latch the effect re-ran and re-navigated with redirect=/sign-in,
  // clobbering the real destination on the still-pending navigation (so a
  // deep link like /dashboard/permits silently became /dashboard after
  // signing in). Fire the bounce exactly once, with the path we were
  // actually asked for.
  const bouncedRef = useRef(false);

  // The latch alone isn't enough for a bare popup page (Track station): the
  // root swaps from its bare tree to the full one when the path becomes
  // /sign-in, which remounts this layout with a fresh ref — and it bounced
  // again with redirect=/sign-in, so signing in landed back on sign-in. Only
  // a dashboard path is ever a destination; the query string comes along so
  // a deep link like track-station?n=3 opens the same station afterwards.
  useEffect(() => {
    if (loading || user || bouncedRef.current || !path.startsWith("/dashboard")) return;
    bouncedRef.current = true;
    nav({ to: "/sign-in", search: { redirect: `${path}${search}` } });
  }, [loading, user, nav, path, search]);

  if (loading || !user) return null;
  return <Outlet />;
}
