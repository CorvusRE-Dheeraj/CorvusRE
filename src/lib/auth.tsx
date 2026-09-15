import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";
import { resetDpIntake } from "@/lib/dp-intake";
import { invokeEdgeFunction } from "@/lib/edge-functions";

type AuthState = {
  user: User | null;
  session: Session | null;
  loading: boolean;
};

const AuthContext = createContext<AuthState>({ user: null, session: null, loading: true });

// Idle sign-out — a standard security control (an unattended, still-signed-in
// browser tab shouldn't stay authenticated forever), independent of the Supabase
// session's own JWT expiry/refresh.
const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes
const IDLE_CHECK_INTERVAL_MS = 30 * 1000;
const LAST_ACTIVITY_KEY = "corvusdp.lastActivityAt";
const ACTIVITY_EVENTS = ["mousedown", "keydown", "scroll", "touchstart", "wheel"] as const;

function markActivity() {
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
  } catch {
    // storage-blocked edge case — the idle timer falls back to "no recorded
    // activity", which is safe (only ever causes an earlier sign-out).
  }
}

function msSinceLastActivity(): number {
  try {
    const raw = localStorage.getItem(LAST_ACTIVITY_KEY);
    return raw ? Date.now() - Number(raw) : 0;
  } catch {
    return 0;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, session: null, loading: true });
  const nav = useNavigate();
  const signingOutRef = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setState({ user: data.session?.user ?? null, session: data.session, loading: false });
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      // The anonymous analysis flow's sessionStorage state isn't scoped to an
      // account — signing out is the one clear signal that whatever was in
      // progress no longer applies to whoever signs in next in this tab.
      if (event === "SIGNED_OUT") resetDpIntake();
      // Fire-and-forget on every real sign-in (password, Google, Microsoft,
      // sign-up) — deliberately not on mere session restoration on page load
      // (that fires INITIAL_SESSION, not SIGNED_IN). Safe to call this often
      // anyway: send-welcome-email only actually emails once per account,
      // gated by its own atomic DB claim on profiles.welcome_email_sent_at.
      if (event === "SIGNED_IN") {
        invokeEdgeFunction("send-welcome-email", {}).catch((err) =>
          console.error("Could not send welcome email:", err),
        );
      }
      setState({ user: session?.user ?? null, session, loading: false });
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const userId = state.user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    signingOutRef.current = false;
    markActivity();

    function handleStorageActivityPing(e: StorageEvent) {
      if (e.key === LAST_ACTIVITY_KEY) signingOutRef.current = false;
    }

    async function checkIdle() {
      if (signingOutRef.current || msSinceLastActivity() < IDLE_TIMEOUT_MS) return;
      signingOutRef.current = true;
      await supabase.auth.signOut();
      nav({
        to: "/sign-in",
        search: {
          reason: "You were signed out after 60 minutes of inactivity, for your security.",
        },
      });
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") checkIdle();
    }

    window.addEventListener("storage", handleStorageActivityPing);
    ACTIVITY_EVENTS.forEach((event) =>
      window.addEventListener(event, markActivity, { passive: true }),
    );
    const interval = window.setInterval(checkIdle, IDLE_CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("storage", handleStorageActivityPing);
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, markActivity));
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [userId, nav]);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
