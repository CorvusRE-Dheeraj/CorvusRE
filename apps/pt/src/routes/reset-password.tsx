import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset Password — CorvusPT" },
      { name: "description", content: "Choose a new password for your CorvusPT account." },
    ],
  }),
  component: ResetPassword,
});

// Password reset now completes on the shared cross-door identity screen
// (/auth/, apps/identity), which is what forgot-password.tsx sends new
// reset emails to (its own resetPasswordForEmail's redirectTo already
// points there). This route only still exists for a reset link sent
// BEFORE that change -- those still point here, with the recovery token
// in the URL hash, which must be carried over (a bare redirect would drop
// it and strand the link).
function ResetPassword() {
  useEffect(() => {
    window.location.replace(`/auth/${window.location.hash}`);
  }, []);
  return null;
}
