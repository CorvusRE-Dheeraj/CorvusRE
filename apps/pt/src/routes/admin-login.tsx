import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { checkIsAdmin } from "@/lib/admin";

// Deliberately not linked from SiteChrome's nav — a separate login surface from the
// regular customer /sign-in flow. Admin accounts are provisioned manually (see the
// one-time SQL step in supabase/schema.sql), not through public self-serve signup.
export const Route = createFileRoute("/admin-login")({
  head: () => ({
    meta: [{ title: "Admin Sign In — CorvusPT" }],
  }),
  component: AdminLogin,
});

function AdminLogin() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isSupabaseConfigured) {
      setError("Accounts aren't set up in this deployment yet. Please check back soon.");
      return;
    }

    setLoading(true);
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) throw signInError;

      const admin = await checkIsAdmin(data.user.id);
      if (!admin) {
        await supabase.auth.signOut();
        setError("Not authorized.");
        return;
      }
      nav({ to: "/admin" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container-page py-16 max-w-md">
      <span className="badge-soft">Admin</span>
      <h1 className="mt-3 font-serif text-3xl font-semibold">Admin sign in.</h1>
      <p className="mt-2 text-muted-foreground">Restricted access.</p>
      <form onSubmit={onSubmit} className="mt-8 card-elev p-6 grid gap-4">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">
            Email<span className="text-destructive"> *</span>
          </span>
          <input
            required
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">
            Password<span className="text-destructive"> *</span>
          </span>
          <input
            required
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button disabled={loading} className="btn-primary btn-primary-hover disabled:opacity-60">
          {loading ? "Please wait…" : "Sign In"}
        </button>
      </form>
    </div>
  );
}
