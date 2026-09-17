import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "./lib/supabase";
import { safeRedirectTarget } from "./redirect";

type Mode = "sign-in" | "sign-up";
type Status = "idle" | "checking-session" | "busy" | "check-email" | "choose-door" | "error";

const DOORS = [
  { label: "CorvusPT — Property Tax Management", path: "/corvuspt/" },
  { label: "CorvusDP — Design, Plan, Permit", path: "/corvusdp/" },
];

// One shared sign-in screen for every CorvusRE door. On success, this is a
// full page navigation (window.location) to the door that sent the visitor
// here, not a client-side route change -- /auth/ and each door are
// separate built apps, not one router.
export function App() {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("checking-session");
  const [error, setError] = useState<string | null>(null);

  // Where to go once a real session exists (fresh sign-in, or one already
  // found on mount): a specific door if one was requested (a door sent the
  // visitor here with ?redirect=..., or Google OAuth carried it through),
  // otherwise the "choose a door" screen below -- never a silent bounce back
  // to wherever this page happened to be reached from (the hub's own
  // generic Sign In link doesn't name a door, and blindly defaulting that
  // to "/" used to make an already-signed-in visitor's click look like
  // nothing had happened at all).
  function proceed() {
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
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        proceed();
        return;
      }
      setStatus("idle");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    const { data, error: signUpErr } = await supabase.auth.signUp({ email, password });
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

  return (
    <div className="wrap">
      <div className="card">
        <Logo />
        <h1>{mode === "sign-in" ? "Sign in" : "Create your account"}</h1>
        <p className="sub">One account works across every CorvusRE door.</p>

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
