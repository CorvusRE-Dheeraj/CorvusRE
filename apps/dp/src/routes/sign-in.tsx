import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/sign-in")({
  head: () => ({ meta: [{ title: "Sign in — CorvusDP" }] }),
  // mode/email/ref are legacy fields older call sites may still pass (this
  // route used to render its own sign-in/sign-up form and read them to
  // prefill it) — kept in the search schema so those call sites' typed
  // <Link search={{...}}> props still compile, but none of them are read
  // here any more; the shared identity screen doesn't collect them.
  validateSearch: (
    search: Record<string, unknown>,
  ): { redirect?: string; mode?: "signup"; email?: string; reason?: string; ref?: string } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
    mode: search.mode === "signup" ? "signup" : undefined,
    email: typeof search.email === "string" ? search.email : undefined,
    reason: typeof search.reason === "string" ? search.reason : undefined,
    ref: typeof search.ref === "string" ? search.ref : undefined,
  }),
  component: SignIn,
});

// Every sign-in AND sign-up now happens on the one shared cross-door
// identity screen (/auth/, apps/identity) — this route's only job left is
// to hand off to it (carrying where to return to, and why, if a guard set
// one), and to leave immediately once a session already exists. Renders
// nothing at any point: no flash of a form that no longer does anything,
// just a full page navigation.
function SignIn() {
  const nav = useNavigate();
  const sp = Route.useSearch();
  const { user: authedUser, loading: authLoading } = useAuth();

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  let cleaned = sp.redirect ?? "";
  if (base && cleaned.startsWith(`${base}/`)) cleaned = cleaned.slice(base.length);
  const returnTo =
    cleaned && cleaned.startsWith("/") && !cleaned.startsWith("//") ? cleaned : "/dashboard";

  // Already signed in (e.g. landed back here with a session in the URL, or an
  // open tab) — don't sit here, go where they were headed.
  useEffect(() => {
    if (authedUser) nav({ to: returnTo, replace: true });
  }, [authedUser, nav, returnTo]);

  // The actual hand-off — a full page navigation (not router nav()) since
  // /auth/ is a separate built app, not a route in this one. Gated on
  // authLoading too: AuthProvider resolves the session asynchronously (it
  // may even mint one via the login bridge), so firing this on the first
  // render — when `user` is still null purely because nothing has resolved
  // yet — would bounce an ALREADY SIGNED-IN visitor out to the identity app
  // instead of letting the effect above send them to the dashboard.
  useEffect(() => {
    if (authLoading || authedUser) return;
    const here = `${import.meta.env.BASE_URL}${returnTo.replace(/^\//, "")}`;
    const params = new URLSearchParams({ redirect: here });
    if (sp.reason) params.set("reason", sp.reason);
    window.location.replace(`/auth/?${params.toString()}`);
  }, [authLoading, authedUser, returnTo, sp.reason]);

  return null;
}
