import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Forgot Password — CorvusPT" },
      { name: "description", content: "Reset your CorvusPT account password." },
    ],
  }),
  component: ForgotPassword,
});

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isSupabaseConfigured) {
      setError("Accounts aren't set up in this deployment yet. Please check back soon.");
      return;
    }
    setLoading(true);
    try {
      // Supabase emails a signed reset link (not a code) to this address — the
      // link itself is the token, so there's no OTP to generate or verify here.
      const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}reset-password`;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      });
      if (resetError) throw resetError;
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="container-page py-16 max-w-md">
        <span className="badge-soft">Check your email</span>
        <h1 className="mt-3 font-serif text-3xl font-semibold">Reset link sent.</h1>
        <p className="mt-2 text-muted-foreground">
          If an account exists for <strong>{email}</strong>, we've sent a link to reset your
          password. Click it to choose a new one.
        </p>
        <Link to="/sign-in" className="btn-primary btn-primary-hover mt-6 inline-flex">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="container-page py-16 max-w-md">
      <span className="badge-soft">Forgot Password</span>
      <h1 className="mt-3 font-serif text-3xl font-semibold">Reset your password.</h1>
      <p className="mt-2 text-muted-foreground">
        Enter the email on your account and we'll send you a link to reset your password.
      </p>
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
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button disabled={loading} className="btn-primary btn-primary-hover disabled:opacity-60">
          {loading ? "Sending…" : "Send Reset Link"}
        </button>
        <Link to="/sign-in" className="text-sm text-muted-foreground hover:text-foreground">
          Back to sign in
        </Link>
      </form>
    </div>
  );
}
