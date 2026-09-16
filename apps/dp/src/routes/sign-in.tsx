import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Clock, Info } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { readDpIntake } from "@/lib/dp-intake";
import {
  TERMS_VERSION,
  PRIVACY_VERSION,
  SIGNUP_ACK_INTRO,
  SIGNUP_ACK_ITEMS,
  SIGNUP_ACK_CONFIRM,
} from "@/lib/legal";
import { Field, inputCls } from "@/components/dp-ui";

export const Route = createFileRoute("/sign-in")({
  head: () => ({ meta: [{ title: "Sign in — CorvusDP" }] }),
  validateSearch: (
    search: Record<string, unknown>,
  ): { redirect?: string; mode?: "signup"; email?: string; reason?: string; ref?: string } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
    mode: search.mode === "signup" ? "signup" : undefined,
    email: typeof search.email === "string" ? search.email : undefined,
    reason: typeof search.reason === "string" ? search.reason : undefined,
    // A referral code (see buildReferralLink in src/lib/referrals.ts) —
    // resolved into a real referred_by user id SERVER-SIDE by
    // handle_new_user(), never trusted client-side.
    ref: typeof search.ref === "string" ? search.ref : undefined,
  }),
  component: SignIn,
});

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
  // open tab) — don't sit on the sign-in card, go where they were headed.
  useEffect(() => {
    if (authedUser) nav({ to: returnTo, replace: true });
  }, [authedUser, nav, returnTo]);

  // CorvusRE login bridge (Phase 4): a plain sign-in landing (no explicit
  // signup intent) now goes through the one shared sign-in screen instead
  // of this door's own form, so "sign in" means the same thing everywhere.
  // Deliberately NOT redirected when mode=signup or a referral code (ref)
  // is present — those carry real DP-specific business logic (referral
  // rewards, richer profile fields collected at signup) that the shared
  // screen doesn't replicate; that flow keeps using this door's own form.
  // A full page navigation (not router nav()) since /auth/ is a separate
  // built app, not a route in this one.
  //
  // Gated on authLoading too: AuthProvider resolves the session
  // asynchronously (it may even mint one via the login bridge), so firing
  // this on the first render — when `user` is still null purely because
  // nothing has resolved yet — bounced an ALREADY SIGNED-IN visitor out to
  // the identity app instead of letting the effect above send them to the
  // dashboard.
  useEffect(() => {
    if (authLoading || authedUser) return;
    if (sp.mode === "signup" || sp.ref) return;
    const here = `${import.meta.env.BASE_URL}${returnTo.replace(/^\//, "")}`;
    window.location.replace(`/auth/?redirect=${encodeURIComponent(here)}`);
  }, [authLoading, authedUser, sp.mode, sp.ref, returnTo]);

  const [mode, setMode] = useState<"signin" | "signup">(
    sp.mode === "signup" || sp.ref ? "signup" : "signin",
  );
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState(sp.email ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [terms, setTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "signup") {
      if (!firstName.trim() || !lastName.trim()) return setError("Enter your first and last name.");
      if (password.length < 6) return setError("Password must be at least 6 characters.");
      if (password !== confirm) return setError("Passwords don't match.");
      if (!terms) return setError("Please accept the Terms and Privacy Policy.");
    }
    if (!isSupabaseConfigured) {
      return setError("Accounts aren't set up in this deployment yet.");
    }
    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error: e1 } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              first_name: firstName.trim(),
              last_name: lastName.trim(),
              phone: phone.trim() || null,
              company_name: company.trim() || null,
              session_id: readDpIntake().sessionId,
              terms_version: TERMS_VERSION,
              privacy_version: PRIVACY_VERSION,
              // Recorded on the terms_acceptances row by handle_new_user (PRD 1.1.7.M).
              user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
              // Resolved into a real referred_by id server-side — see this
              // route's validateSearch comment above.
              referral_code_used: sp.ref ?? null,
            },
          },
        });
        if (e1) throw e1;
        if (!data.session) setCheckEmail(true);
        else nav({ to: returnTo });
      } else {
        const { error: e2 } = await supabase.auth.signInWithPassword({ email, password });
        if (e2) throw e2;
        nav({ to: returnTo });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  // Google handles both sign-up and sign-in in one flow — Supabase creates the
  // auth.users row (and, via handle_new_user() in schema.sql, a profiles row)
  // the first time a given Google account completes this, and just signs them in
  // on every return visit. Full-page redirect (to Google, then back to
  // `returnTo`), not an async call.
  async function handleOAuth(provider: "google" | "azure") {
    setError(null);
    if (!isSupabaseConfigured) {
      return setError("Accounts aren't set up in this deployment yet.");
    }
    // Land on the un-guarded /auth/callback page (carrying where to go next),
    // not straight onto /dashboard — otherwise the dashboard guard can bounce
    // the request to /sign-in before Supabase finishes reading the session out
    // of the redirect URL.
    const cb = `${window.location.origin}${import.meta.env.BASE_URL}auth/callback`;
    const redirectTo =
      returnTo === "/dashboard" ? cb : `${cb}?redirect=${encodeURIComponent(returnTo)}`;
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo },
    });
    if (oauthError) {
      setError(
        provider === "azure" && /provider is not enabled/i.test(oauthError.message)
          ? "Microsoft sign-in isn't enabled for CorvusDP yet — use Google or email."
          : oauthError.message,
      );
    }
  }
  const handleGoogleSignIn = () => handleOAuth("google");
  const handleMicrosoftSignIn = () => handleOAuth("azure");

  // Render nothing while either redirect effect above is what should
  // happen: still resolving the session, already signed in (effect #1 is
  // navigating to returnTo), or a plain sign-in landing that effect #2 is
  // handing off to the shared /auth/ screen. Deliberately placed AFTER every
  // hook — it used to sit above the useState block, so the moment
  // `authedUser` resolved, this component went from 0 to 11 useState calls
  // and React threw "Rendered more hooks than during the previous render",
  // blanking the page for anyone who hit /sign-in with a live session.
  if (authedUser || (sp.mode !== "signup" && !sp.ref)) {
    return null;
  }

  if (checkEmail) {
    return (
      <div className="container-page py-16 max-w-lg">
        <span className="badge-soft">Almost there</span>
        <h1 className="mt-3 font-serif text-3xl font-semibold">Check your email.</h1>
        <p className="mt-2 text-muted-foreground">
          We sent a confirmation link to <strong>{email}</strong>. Click it, then sign in.
        </p>
        <button
          onClick={() => {
            setMode("signin");
            setCheckEmail(false);
          }}
          className="btn-primary btn-primary-hover mt-6"
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <div className="container-page py-14 max-w-lg">
      <span className="badge-soft">{mode === "signin" ? "Sign in" : "Create account"}</span>
      <h1 className="mt-3 font-serif text-3xl font-semibold">
        {mode === "signin" ? "Welcome back." : "Create your CorvusDP account."}
      </h1>
      <p className="mt-2 text-muted-foreground">
        {mode === "signin"
          ? "Your projects, permits, roadmap and documents in one place."
          : "Save your analysis and unlock the full permitting report."}
      </p>
      {sp.reason && (
        <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm">
          {sp.reason.toLowerCase().includes("inactivity") ? (
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          ) : (
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          )}
          <span>{sp.reason}</span>
        </div>
      )}

      <form onSubmit={onSubmit} className="mt-6 card-elev grid gap-4 p-6">
        <button type="button" onClick={handleGoogleSignIn} className="btn-outline w-full">
          <svg viewBox="0 0 48 48" className="h-4 w-4 shrink-0" aria-hidden="true">
            <path
              fill="#FFC107"
              d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"
            />
            <path
              fill="#FF3D00"
              d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
            />
            <path
              fill="#4CAF50"
              d="M24 44c5.4 0 10.3-2.1 14-5.5l-6.5-5.5c-2 1.5-4.6 2.5-7.5 2.5-5.3 0-9.7-3.3-11.3-8l-6.6 5.1C9.6 39.6 16.2 44 24 44z"
            />
            <path
              fill="#1976D2"
              d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.3 5.6l6.5 5.5C39.9 37 44 31 44 24c0-1.3-.1-2.7-.4-3.5z"
            />
          </svg>
          {mode === "signin" ? "Continue with Google" : "Sign up with Google"}
        </button>
        <button type="button" onClick={handleMicrosoftSignIn} className="btn-outline w-full">
          <svg viewBox="0 0 21 21" className="h-4 w-4 shrink-0" aria-hidden="true">
            <rect x="1" y="1" width="9" height="9" fill="#F25022" />
            <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
            <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
            <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
          </svg>
          {mode === "signin" ? "Continue with Microsoft" : "Sign up with Microsoft"}
        </button>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" />
          or {mode === "signin" ? "sign in" : "sign up"} with email
          <div className="h-px flex-1 bg-border" />
        </div>
        {mode === "signup" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" required>
              <input
                required
                className={inputCls}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </Field>
            <Field label="Last name" required>
              <input
                required
                className={inputCls}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </Field>
          </div>
        )}
        {mode === "signup" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone (optional)">
              <input
                className={inputCls}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </Field>
            <Field label="Company (optional)">
              <input
                className={inputCls}
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </Field>
          </div>
        )}
        <Field label="Email" required>
          <input
            required
            type="email"
            autoComplete="email"
            className={inputCls}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password" required>
          <input
            required
            type="password"
            minLength={6}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            className={inputCls}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {mode === "signin" && (
          <Link
            to="/forgot-password"
            className="-mt-2 justify-self-end text-sm text-muted-foreground hover:text-foreground"
          >
            Forgot password?
          </Link>
        )}
        {mode === "signup" && (
          <Field label="Confirm password" required>
            <input
              required
              type="password"
              minLength={6}
              autoComplete="new-password"
              className={inputCls}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
        )}
        {mode === "signup" && (
          <div className="grid gap-2 rounded-lg border border-border p-3 text-sm">
            <label className="flex items-start gap-2 font-medium">
              <input
                type="checkbox"
                checked={terms}
                onChange={(e) => setTerms(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                I agree to the{" "}
                <Link to="/terms" className="text-accent underline underline-offset-2">
                  Terms
                </Link>{" "}
                and{" "}
                <Link to="/privacy" className="text-accent underline underline-offset-2">
                  Privacy Policy
                </Link>
                .
              </span>
            </label>
            <p className="text-xs text-muted-foreground">{SIGNUP_ACK_INTRO}</p>
            <ul className="grid list-disc gap-1 pl-5 text-xs text-muted-foreground">
              {SIGNUP_ACK_ITEMS.map((i, k) => (
                <li key={k}>{i}</li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">{SIGNUP_ACK_CONFIRM}</p>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button
          disabled={loading || (mode === "signup" && !terms)}
          className="btn-accent disabled:opacity-60"
        >
          {loading ? "Please wait…" : mode === "signin" ? "Sign in" : "Agree & create account"}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
          }}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          {mode === "signin" ? "Need an account? Create one." : "Already have an account? Sign in."}
        </button>
      </form>
    </div>
  );
}
