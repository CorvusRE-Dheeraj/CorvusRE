import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset Password — CorvusPT" },
      { name: "description", content: "Choose a new password for your CorvusPT account." },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const nav = useNavigate();
  // Clicking the emailed link lands here with a recovery token in the URL —
  // supabase-js parses it automatically and fires a PASSWORD_RECOVERY auth
  // event once the session is established. Until that fires (or we find an
  // existing session already set up, in case it resolved before this
  // component mounted), the form stays hidden so a stale/invalid link can't
  // be used to submit a password change with no real session behind it.
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="container-page py-16 max-w-md">
        <span className="badge-soft">Password Updated</span>
        <h1 className="mt-3 font-serif text-3xl font-semibold">You're all set.</h1>
        <p className="mt-2 text-muted-foreground">Your password has been changed.</p>
        <button onClick={() => nav({ to: "/" })} className="btn-primary btn-primary-hover mt-6">
          Continue to CorvusPT
        </button>
      </div>
    );
  }

  return (
    <div className="container-page py-16 max-w-md">
      <span className="badge-soft">Reset Password</span>
      <h1 className="mt-3 font-serif text-3xl font-semibold">Choose a new password.</h1>
      {!ready ? (
        <p className="mt-2 text-muted-foreground">
          Verifying your reset link… If nothing happens, the link may have expired —{" "}
          <Link to="/forgot-password" className="text-accent hover:underline">
            request a new one
          </Link>
          .
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 card-elev p-6 grid gap-4">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">
              New Password<span className="text-destructive"> *</span>
            </span>
            <input
              required
              type="password"
              minLength={6}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">
              Confirm New Password<span className="text-destructive"> *</span>
            </span>
            <input
              required
              type="password"
              minLength={6}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button disabled={loading} className="btn-primary btn-primary-hover disabled:opacity-60">
            {loading ? "Saving…" : "Set New Password"}
          </button>
        </form>
      )}
    </div>
  );
}
