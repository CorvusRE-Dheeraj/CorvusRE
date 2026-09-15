import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { checkIsAdmin } from "@/lib/admin";

export const Route = createFileRoute("/admin-login")({
  head: () => ({ meta: [{ title: "Admin — CorvusDP" }] }),
  component: AdminLogin,
});

function AdminLogin() {
  const { user, loading } = useAuth();
  const nav = useNavigate();

  useEffect(() => {
    if (loading || !user) return;
    checkIsAdmin(user.id).then((ok) => {
      if (ok) nav({ to: "/admin" });
    });
  }, [user, loading, nav]);

  return (
    <div className="container-page py-16 max-w-md">
      <span className="badge-soft">Admin</span>
      <h1 className="mt-3 font-serif text-2xl font-semibold">CorvusDP staff console</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {user
          ? "This account doesn't have admin access. Ask an existing admin to set profiles.is_admin = true for your user."
          : "Sign in with a staff account to continue."}
      </p>
      <div className="mt-5 flex gap-2">
        {!user && (
          <Link to="/sign-in" search={{ redirect: "/admin" }} className="btn-accent">
            Sign in
          </Link>
        )}
        <Link to="/" className="btn-outline">
          Home
        </Link>
      </div>
    </div>
  );
}
