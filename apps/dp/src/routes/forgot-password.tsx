import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { Field, inputCls } from "@/components/dp-ui";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Reset password — CorvusDP" }] }),
  component: ForgotPassword,
});

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isSupabaseConfigured) return setError("Accounts aren't set up in this deployment yet.");
    setLoading(true);
    try {
      const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}reset-password`;
      const { error: e1 } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (e1) throw e1;
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container-page py-16 max-w-md">
      <span className="badge-soft">Reset password</span>
      <h1 className="mt-3 font-serif text-2xl font-semibold">Forgot your password?</h1>
      {sent ? (
        <p className="mt-3 text-muted-foreground">
          If an account exists for <strong>{email}</strong>, a reset link is on its way.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-6 card-elev grid gap-4 p-6">
          <Field label="Email" required>
            <input
              required
              type="email"
              className={inputCls}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button disabled={loading} className="btn-accent disabled:opacity-60">
            {loading ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
    </div>
  );
}
