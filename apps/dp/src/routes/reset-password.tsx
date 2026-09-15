import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Field, inputCls } from "@/components/dp-ui";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Set new password — CorvusDP" }] }),
  component: ResetPassword,
});

function ResetPassword() {
  const nav = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) return setError("Password must be at least 6 characters.");
    if (password !== confirm) return setError("Passwords don't match.");
    setLoading(true);
    try {
      const { error: e1 } = await supabase.auth.updateUser({ password });
      if (e1) throw e1;
      nav({ to: "/dashboard" });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Reset link may have expired — request a new one.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container-page py-16 max-w-md">
      <span className="badge-soft">New password</span>
      <h1 className="mt-3 font-serif text-2xl font-semibold">Set a new password</h1>
      <form onSubmit={submit} className="mt-6 card-elev grid gap-4 p-6">
        <Field label="New password" required>
          <input
            required
            type="password"
            minLength={6}
            className={inputCls}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field label="Confirm password" required>
          <input
            required
            type="password"
            minLength={6}
            className={inputCls}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button disabled={loading} className="btn-accent disabled:opacity-60">
          {loading ? "Saving…" : "Update password"}
        </button>
      </form>
    </div>
  );
}
