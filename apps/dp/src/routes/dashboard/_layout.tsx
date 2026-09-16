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
  // This layout stays mounted for a beat while the router transitions to
  // /sign-in, and `path` flips to "/sign-in" during that window — without
  // this latch the effect re-ran and re-navigated with redirect=/sign-in,
  // clobbering the real destination on the still-pending navigation (so a
  // deep link like /dashboard/permits silently became /dashboard after
  // signing in). Fire the bounce exactly once, with the path we were
  // actually asked for.
  const bouncedRef = useRef(false);

  useEffect(() => {
    if (loading || user || bouncedRef.current) return;
    bouncedRef.current = true;
    nav({ to: "/sign-in", search: { redirect: path } });
  }, [loading, user, nav, path]);

  if (loading || !user) return null;
  return <Outlet />;
}
