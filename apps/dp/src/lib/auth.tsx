import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";
import { identitySupabase } from "@/lib/identity";
import { resetDpIntake } from "@/lib/dp-intake";
import { invokeEdgeFunction } from "@/lib/edge-functions";
import { tryBridgeFromIdentity } from "@/lib/login-bridge";

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
// Shared with CorvusPT's own auth.tsx (was "corvusdp.lastActivityAt") --
// both keys already live in the same-origin localStorage regardless of the
// /corvuspt/ vs /corvusdp/ path, so using one shared key gives a de facto
// shared idle clock across doors for free: activity on one door resets the
// clock the other door checks next time it's open.
const LAST_ACTIVITY_KEY = "corvusre.lastActivityAt";
// Written whenever this door signs out (see the onAuthStateChange handler
// below) so any other door's open tab on the same origin signs itself out
// too -- "sign out" should mean signed out everywhere, not just this one
// door while the underlying identity session quietly lives on.
const SIGNED_OUT_KEY = "corvusre.signedOutAt";
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
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) {
        setState({ user: data.session.user, session: data.session, loading: false });
        return;
      }
      // No local CorvusDP session yet -- before concluding "signed out",
      // try the CorvusRE login bridge (see lib/login-bridge.ts): if this
      // browser already has a CorvusPT session for an email that also has
      // a CorvusDP account, this silently establishes a real one here too.
      const bridged = await tryBridgeFromIdentity();
      if (!bridged) {
        setState({ user: null, session: null, loading: false });
      }
      // else: verifyOtp() inside the bridge already fired a real SIGNED_IN
      // event, which the listener below picks up and sets state from.
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      // The anonymous analysis flow's sessionStorage state isn't scoped to an
      // account — signing out is the one clear signal that whatever was in
      // progress no longer applies to whoever signs in next in this tab.
      if (event === "SIGNED_OUT") {
        resetDpIntake();
        // Propagate to every door: kill the shared identity session (so a
        // direct visit to CorvusPT, or the bridge on another door's tab,
        // doesn't silently keep this person signed in) and broadcast so any
        // other already-open door tab signs itself out too (see the
        // storage-event listener below).
        identitySupabase.auth.signOut().catch(() => {});
        try {
          localStorage.setItem(SIGNED_OUT_KEY, String(Date.now()));
        } catch {
          // storage-blocked edge case -- this door still signed out locally,
          // just won't propagate to other tabs.
        }
      }
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
      // INITIAL_SESSION fires automatically the moment this listener is
      // registered, always with whatever's synchronously already in local
      // storage at that instant (session: null on this door for anyone who
      // needs the bridge, since there IS no local session yet). Setting
      // state from it here raced ahead of the getSession().then() bridge
      // attempt above -- which is genuinely async (an Edge Function round
      // trip) -- flipping loading to false with no user well before the
      // bridge had a chance to finish, and the dashboard guard bounced to
      // sign-in on that premature state. The getSession() call above is
      // what correctly owns resolving the initial state (including trying
      // the bridge first); this listener only needs to react to events
      // that happen AFTER that, never INITIAL_SESSION itself.
      if (event === "INITIAL_SESSION") return;
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
      // Another door's tab (or this door in another tab) just signed out --
      // this tab's own onAuthStateChange SIGNED_OUT branch above will fire
      // once this completes, which is what actually clears state/redirects.
      if (e.key === SIGNED_OUT_KEY && !signingOutRef.current) {
        signingOutRef.current = true;
        supabase.auth.signOut().finally(() => {
          signingOutRef.current = false;
        });
      }
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
