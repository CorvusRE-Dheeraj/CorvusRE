import { useState, type FormEvent } from "react";
import { supabase } from "./lib/supabase";
import { safeRedirectTarget } from "./redirect";

type Mode = "sign-in" | "sign-up";
type Status = "idle" | "busy" | "check-email" | "error";

// One shared sign-in screen for every CorvusRE door. On success, this is a
// full page navigation (window.location) to the door that sent the visitor
// here, not a client-side route change -- /auth/ and each door are
// separate built apps, not one router.
export function App() {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

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
      window.location.assign(safeRedirectTarget());
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
    window.location.assign(safeRedirectTarget());
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
