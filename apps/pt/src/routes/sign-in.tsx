import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/sign-in")({
  head: () => ({
    meta: [
      { title: "Sign In — CorvusPT" },
      { name: "description", content: "Sign in to your CorvusPT property tax dashboard." },
    ],
  }),
  // Lets any page that sends a signed-out visitor here (the dashboard guard,
  // pricing's "sign in to subscribe" prompt, admin invite links, referral
  // links, etc.) say where to return to and why — carried straight through
  // to the shared identity screen's own ?redirect=/?reason= params below.
  // mode/email/firstName/lastName/ref (admin invite links, referral links)
  // are forwarded to the shared screen, which opens on sign-up, prefills, and
  // hands names + the referral code to the identity project's signup trigger.
  // beta is accepted for older call sites but not forwarded: plan changes
  // are never client-granted (see schema.sql handle_new_user).
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    redirect?: string;
    mode?: "signup";
    email?: string;
    firstName?: string;
    lastName?: string;
    beta?: string;
    ref?: string;
    reason?: string;
  } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
    mode: search.mode === "signup" ? "signup" : undefined,
    email: typeof search.email === "string" ? search.email : undefined,
    firstName: typeof search.firstName === "string" ? search.firstName : undefined,
    lastName: typeof search.lastName === "string" ? search.lastName : undefined,
    beta: typeof search.beta === "string" ? search.beta : undefined,
    ref: typeof search.ref === "string" ? search.ref : undefined,
    reason: typeof search.reason === "string" ? search.reason : undefined,
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
  const { user, loading: authLoading } = useAuth();
  const searchParams = Route.useSearch();
  const { redirect, reason } = searchParams;
  // `redirect` must be an app-relative path. Also heal a stale value that
  // still carries the GitHub Pages base ("/corvuspt/dashboard/...") — passing
  // that along would prepend the base a second time and 404.
  const base = import.meta.env.BASE_URL.replace(/\/$/, ""); // "" locally, "/corvuspt" in prod
  let cleaned = redirect ?? "";
  if (base && cleaned.startsWith(`${base}/`)) cleaned = cleaned.slice(base.length);
  // Never bounce back to /sign-in itself — the header's "Sign In" link carries
  // `redirect: pathname`, so clicking it while already on /sign-in would make
  // returnTo "/sign-in" and every post-sign-in nav() a no-op ("nothing
  // happens when I click Sign In").
  const isSelf = cleaned === "/sign-in" || cleaned.startsWith("/sign-in?");
  const returnTo =
    cleaned && cleaned.startsWith("/") && !cleaned.startsWith("//") && !isSelf ? cleaned : "/";

  // Already signed in (e.g. an open tab, or a session that resolved while
  // this page was loading) — go straight to where they were headed.
  useEffect(() => {
    if (authLoading || !user) return;
    nav({ to: returnTo, replace: true });
  }, [authLoading, user, nav, returnTo]);

  // The actual hand-off — a full page navigation (not router nav()) since
  // /auth/ is a separate built app, not a route in this one.
  useEffect(() => {
    if (authLoading || user) return;
    const here = `${import.meta.env.BASE_URL}${returnTo.replace(/^\//, "")}`;
    const params = new URLSearchParams({ redirect: here });
    if (reason) params.set("reason", reason);
    // Signup context (admin invite prefill, referral link) rides along so the
    // shared screen can open on sign-up, prefill, and attach the referral.
    for (const k of ["mode", "email", "firstName", "lastName", "ref"] as const) {
      const v = searchParams[k];
      if (v) params.set(k, v);
    }
    window.location.replace(`/auth/?${params.toString()}`);
  }, [authLoading, user, returnTo, reason, searchParams]);

  return null;
}
