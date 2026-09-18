import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Reset password — CorvusDP" }] }),
  component: ForgotPassword,
});

// Password reset now happens on the shared cross-door identity screen
// (/auth/, apps/identity) too, same as sign-in/sign-up — it already has its
// own "Forgot password?" flow against the same Supabase project this
// account's identity session lives in. ?screen=forgot opens straight on
// that screen instead of plain sign-in.
function ForgotPassword() {
  useEffect(() => {
    window.location.replace("/auth/?screen=forgot");
  }, []);
  return null;
}
