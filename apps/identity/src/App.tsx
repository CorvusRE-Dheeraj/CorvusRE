import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "./lib/supabase";
import { safeRedirectTarget } from "./redirect";

type Mode = "sign-in" | "sign-up" | "forgot-password";
type Status =
  | "idle"
  | "checking-session"
  | "busy"
  | "check-email"
  | "choose-door"
  | "error"
  | "forgot-sent"
  | "reset-password"
  | "reset-done";

const DOORS = [
  { label: "CorvusPT — Property Tax Management", path: "/corvuspt/" },
  { label: "CorvusDP — Design, Plan, Permit", path: "/corvusdp/" },
];

// One shared sign-in screen for every CorvusRE door. On success, this is a
// full page navigation (window.location) to the door that sent the visitor
// here, not a client-side route change -- /auth/ and each door are
// separate built apps, not one router.
// Signup context a door forwards from its own /sign-in landing (referral links,
// admin invite links) -- read once, same as redirect/reason. Names and the
// referral code ride in signUp()'s options.data, which the identity project's
// handle_new_user() trigger already reads server-side (a referral code is
// only ever resolved there, never trusted client-side). A CorvusDP-bound
// signup is deliberately NOT given the code: DP has its own separate
// referral namespace, resolved when DP's own account is created (see
// mint-door-session), not against this project's profiles.
const PENDING_REF_KEY = "corvusre.pendingRef";

// A referral code has to survive a Google OAuth round trip (the query string
// doesn"t), and signUp() metadata can"t carry it for an OAuth signup at all --
// so it"s parked in localStorage and applied server-side (apply-referral,
// brand-new accounts only) the moment a session exists. Best-effort: never
// blocks getting the person where they were headed.
async function applyPendingReferral() {
  try {
    const code = localStorage.getItem(PENDING_REF_KEY);
    if (!code) return;
    localStorage.removeItem(PENDING_REF_KEY);
    await supabase.functions.invoke("apply-referral", { body: { referralCode: code } });
  } catch {
    // ignore -- a lost referral must not break sign-in
  }
}

function readSignupContext() {
  const q = new URLSearchParams(window.location.search);
  const target = q.get("redirect") ?? "";
  return {
    startOnSignUp: q.get("mode") === "signup",
    email: q.get("email") ?? "",
    firstName: q.get("firstName") ?? "",
    lastName: q.get("lastName") ?? "",
    ref: target.startsWith("/corvusdp/") ? "" : (q.get("ref") ?? ""),
  };
}

export function App() {
  const [signupCtx] = useState(readSignupContext);
  useEffect(() => {
    if (!signupCtx.ref) return;
    try {
      localStorage.setItem(PENDING_REF_KEY, signupCtx.ref);
    } catch {
      // storage blocked -- referral just won't attach for a Google signup
    }
  }, [signupCtx.ref]);
  // A door redirecting a forgot-password landing here (?screen=forgot) opens
  // straight on that screen instead of plain sign-in -- see each door's own
  // forgot-password.tsx, which now just forwards here.
  const [mode, setMode] = useState<Mode>(
    new URLSearchParams(window.location.search).get("screen") === "forgot"
      ? "forgot-password"
      : signupCtx.startOnSignUp
        ? "sign-up"
        : "sign-in",
  );
  const [email, setEmail] = useState(signupCtx.email);
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("checking-session");
  const [error, setError] = useState<string | null>(null);
  // A short, plain-text explanation a door sets when it sends a signed-out
  // visitor here (e.g. an idle-timeout sign-out) -- shown once on the plain
  // sign-in screen so the redirect doesn't feel unexplained. Read once on
  // mount, same as `redirect` -- this page never mutates its own URL.
  const [reason] = useState(() => new URLSearchParams(window.location.search).get("reason"));
  // Separate from `status` -- the forgot/reset screens are picked by status
  // (reached via a link click or a recovery-email URL, not the sign-in/up
  // toggle), so a failed submit on either must NOT fall back to "error"
  // (that's the generic sign-in/up form's own status) and lose the screen.
  const [submitting, setSubmitting] = useState(false);

  // Where to go once a real session exists (fresh sign-in, or one already
  // found on mount): a specific door if one was requested (a door sent the
  // visitor here with ?redirect=..., or Google OAuth carried it through),
  // otherwise the "choose a door" screen below -- never a silent bounce back
  // to wherever this page happened to be reached from (the hub's own
  // generic Sign In link doesn't name a door, and blindly defaulting that
  // to "/" used to make an already-signed-in visitor's click look like
  // nothing had happened at all).
  async function proceed() {
    await applyPendingReferral();
    const target = safeRedirectTarget();
    if (target) {
      window.location.assign(target);
    } else {
      setStatus("choose-door");
    }
  }

  // Completes the Google OAuth round trip: signInWithGoogle() below sends
  // the browser to Google and back to THIS page (never straight to a door)
  // with the session tokens in the URL hash, specifically so this app's own
  // Supabase client (pointed at the real identity project) is what
  // validates them -- redirecting a door's OWN client straight to a door
  // with PT-issued tokens in the URL would have that door's client try to
  // treat them as its own, which they aren't (different project, different
  // signing key), and fail. Once a real session exists here, finish the
  // trip to whatever door originally sent the visitor here (or offer a
  // choice, per proceed() above).
  useEffect(() => {
    // A password-reset email link lands here with a recovery token in the
    // URL hash (#...&type=recovery) -- supabase-js parses it and fires
    // PASSWORD_RECOVERY once the session is established from it. Checked
    // before the plain getSession()-based proceed() below, since that
    // recovery token DOES create a real session, and this page (unlike a
    // door's own dedicated /reset-password route) is also where an already
    // signed-in visitor normally lands and gets bounced straight through --
    // without this, a password-reset click would skip the "choose a new
    // password" screen entirely.
    if (window.location.hash.includes("type=recovery")) {
      setStatus("reset-password");
      return;
    }
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setStatus("reset-password");
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        proceed();
        return;
      }
      setStatus("idle");
    });
    return () => listener.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitForgotPassword(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    setSubmitting(false);
    if (resetErr) {
      setError(resetErr.message);
      return;
    }
    setStatus("forgot-sent");
  }

  async function submitNewPassword(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setSubmitting(true);
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (updateErr) {
      setError(updateErr.message);
      return;
    }
    setStatus("reset-done");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setStatus("busy");
    setError(null);

    if (mode === "sign-in") {
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
      if (signInErr) {
        setError(signInErr.message);
        setStatus("error");
        return;
      }
      proceed();
      return;
    }

    const { data, error: signUpErr } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          ...(signupCtx.firstName ? { first_name: signupCtx.firstName } : {}),
          ...(signupCtx.lastName ? { last_name: signupCtx.lastName } : {}),
          ...(signupCtx.ref ? { referral_code_used: signupCtx.ref } : {}),
        },
      },
    });
    if (signUpErr) {
      setError(signUpErr.message);
      setStatus("error");
      return;
    }
    if (!data.session) {
      // Email confirmation required before a session exists.
      setStatus("check-email");
      return;
    }
    proceed();
  }

  async function signInWithGoogle() {
    setStatus("busy");
    setError(null);
    // Carries the same redirect target forward as a query param (blank if
    // there wasn't one) -- Supabase appends #access_token=... to whatever
    // URL this is, query params survive intact. Lands back on THIS page
    // (see the effect above), not directly on a door.
    const target = safeRedirectTarget();
    const redirectTo = `${window.location.origin}${window.location.pathname}${
      target ? `?redirect=${encodeURIComponent(target)}` : ""
    }`;
    const { error: oauthErr } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (oauthErr) {
      setError(oauthErr.message);
      setStatus("error");
    }
    // On success there's no more work to do here -- the browser is already
    // navigating to Google.
  }

  async function signOut() {
    await supabase.auth.signOut();
    setStatus("idle");
  }

  if (status === "checking-session") {
    // Deliberately blank rather than flashing the sign-in form for the
    // instant it takes to check for (and, after Google OAuth, consume) an
    // existing session.
    return null;
  }

  if (status === "choose-door") {
    return (
      <div className="wrap">
        <div className="card">
          <Logo />
          <h1>You're signed in</h1>
          <p className="sub">Choose a door to continue.</p>
          <div className="door-list">
            {DOORS.map((d) => (
              <a key={d.path} href={d.path} className="door-link">
                {d.label}
              </a>
            ))}
          </div>
          <div className="toggle">
            <button type="button" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status === "check-email") {
    return (
      <div className="wrap">
        <div className="card">
          <Logo />
          <h1>Check your email</h1>
          <p className="notice">
            We sent a confirmation link to <strong>{email}</strong>. Follow it to finish creating
            your account, then come back here to sign in.
          </p>
        </div>
      </div>
    );
  }

  if (status === "forgot-sent") {
    return (
      <div className="wrap">
        <div className="card">
          <Logo />
          <h1>Check your email</h1>
          <p className="notice">
            If an account exists for <strong>{email}</strong>, we've sent a link to reset your
            password. Click it to choose a new one.
          </p>
          <div className="toggle">
            <button
              type="button"
              onClick={() => {
                setStatus("idle");
                setMode("sign-in");
              }}
            >
              Back to sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status === "reset-password" || status === "reset-done") {
    return (
      <div className="wrap">
        <div className="card">
          <Logo />
          {status === "reset-done" ? (
            <>
              <h1>Password updated</h1>
              <p className="notice">You're all set -- your password has been changed.</p>
              <div className="toggle">
                <button type="button" onClick={proceed}>
                  Continue
                </button>
              </div>
            </>
          ) : (
            <>
              <h1>Choose a new password</h1>
              <p className="sub">One account works across every CorvusRE door.</p>
              <form onSubmit={submitNewPassword}>
                <label>
                  New password
                  <input
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                {error && <p className="error">{error}</p>}
                <button type="submit" disabled={submitting}>
                  {submitting ? "Saving…" : "Set new password"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    );
  }

  if (mode === "forgot-password") {
    return (
      <div className="wrap">
        <div className="card">
          <Logo />
          <h1>Reset your password</h1>
          <p className="sub">
            Enter the email on your account and we'll send you a link to reset your password.
          </p>
          <form onSubmit={submitForgotPassword}>
            <label>
              Email
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            {error && <p className="error">{error}</p>}
            <button type="submit" disabled={submitting}>
              {submitting ? "Sending…" : "Send reset link"}
            </button>
          </form>
          <div className="toggle">
            <button type="button" onClick={() => setMode("sign-in")}>
              Back to sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <div className="card">
        <Logo />
        <h1>{mode === "sign-in" ? "Sign in" : "Create your account"}</h1>
        <p className="sub">One account works across every CorvusRE door.</p>
        {reason && <p className="notice">{reason}</p>}

        <button type="button" className="google-btn" onClick={signInWithGoogle} disabled={status === "busy"}>
          <GoogleIcon />
          Continue with Google
        </button>

        <div className="divider">
          <span>or</span>
        </div>

        <form onSubmit={submit}>
          <label>
            Email
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              minLength={8}
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={status === "busy"}>
            {status === "busy" ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Sign up"}
          </button>
        </form>

        {mode === "sign-in" && (
          <div className="toggle">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode("forgot-password");
              }}
            >
              Forgot password?
            </button>
          </div>
        )}

        <div className="toggle">
          {mode === "sign-in" ? (
            <>
              Don't have an account?{" "}
              <button type="button" onClick={() => setMode("sign-up")}>
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button type="button" onClick={() => setMode("sign-in")}>
                Sign in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Logo() {
  return (
    <div className="logo">
      <span className="mark" aria-hidden>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 20c3-6 5-9 8-9s5 3 8 9" strokeLinecap="round" />
          <circle cx="16" cy="7" r="2" fill="currentColor" />
        </svg>
      </span>
      <span className="word">CorvusRE</span>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.4 0 10.3-2.1 14-5.5l-6.5-5.5C29.5 34.6 26.9 35.5 24 35.5c-5.2 0-9.6-3.3-11.3-8l-6.6 5.1C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.3-4.1 5.7l6.5 5.5C41.8 35.6 44 30.3 44 24c0-1.3-.1-2.7-.4-3.5z"
      />
    </svg>
  );
}
