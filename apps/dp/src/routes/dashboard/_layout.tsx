import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/dashboard/_layout")({
  component: DashboardLayout,
});

function DashboardLayout() {
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const path = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    console.log("[bridge] dashboard guard check: loading=", loading, "user=", !!user);
    if (!loading && !user) {
      console.log("[bridge] dashboard guard REDIRECTING to sign-in");
      nav({ to: "/sign-in", search: { redirect: path } });
    }
  }, [loading, user, nav, path]);

  if (loading || !user) return null;
  return <Outlet />;
}
