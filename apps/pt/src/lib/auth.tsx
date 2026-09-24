import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";
import { resetIntake } from "@/lib/intake-store";
import { invokeEdgeFunction } from "@/lib/edge-functions";
import { stableUser } from "@/lib/auth-user";

type AuthState = {
  user: User | null;
  session: Session | null;
  loading: boolean;
};

const AuthContext = createContext<AuthState>({ user: null, session: null, loading: true });

// Idle sign-out — a standard security control (an unattended, still-signed-in
// browser tab shouldn't stay authenticated forever), independent of the
// Supabase session's own JWT expiry/refresh (which is about token validity,
// not user presence — Supabase auto-refreshes that in the background well
// inside 60 minutes, so it can never substitute for this).
const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes
// Checked well inside the timeout itself so the actual sign-out never lags
// noticeably behind the real 60-minute mark, while still cheap to run.
const IDLE_CHECK_INTERVAL_MS = 30 * 1000;
// Shared across every tab of this browser (see the effect below for why a
// per-tab in-memory clock isn't enough) — just a timestamp, nothing
// sensitive, so plain localStorage is fine. Also shared with CorvusDP's own
// auth.tsx (was "corvuspt.lastActivityAt") -- both keys already live in the
// same-origin localStorage regardless of the /corvuspt/ vs /corvusdp/ path,
// so one shared key gives a de facto shared idle clock across doors: activity
// on one door resets the clock the other door checks next time it's open.
const LAST_ACTIVITY_KEY = "corvusre.lastActivityAt";
// Written whenever this door signs out (see the onAuthStateChange handler
// below) so any other door's open tab on the same origin signs itself out
// too. CorvusPT is the shared identity source, so this door's own sign-out
// IS the identity sign-out -- no separate client to also sign out of here,
// unlike CorvusDP's side of this same mechanism.
const SIGNED_OUT_KEY = "corvusre.signedOutAt";
// Real user-presence signals only — deliberately not anything the app
// itself triggers (a background poll, a timer-driven refetch), or an idle
// tab just left open would look "active" forever and this control would do
// nothing. Not mousemove — cheap to keep active, but firing on a stray
// mouse drift across an otherwise-idle tab defeats the point.
const ACTIVITY_EVENTS = ["mousedown", "keydown", "scroll", "touchstart", "wheel"] as const;

function markActivity() {
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
  } catch {
    // Private-browsing/storage-blocked edge case — the idle timer just falls
    // back to always reading "no recorded activity," which is safe (it only
    // ever causes an earlier sign-out, never a session that outlives 60
    // minutes unattended).
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
  // Guards against the interval tick and the visibilitychange check both
  // firing the sign-out within the same idle window.
  const signingOutRef = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setState({ user: data.session?.user ?? null, session: data.session, loading: false });
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      // The intake flow's sessionStorage state (address, CAD match, etc.) isn't
      // scoped to an account — it's just "whatever this browser tab was in the
      // middle of." Left uncleared across a sign-out, the JourneyTracker on a
      // fresh sign-in would show stale progress ("Step 4 of 11") for an account
      // that has never touched intake at all. Signing out is the one clear
      // signal that whatever was in progress no longer applies to whoever
      // signs in next in this tab.
      if (event === "SIGNED_OUT") {
        resetIntake();
        // Broadcast so any other door's already-open tab signs itself out
        // too (see the storage-event listener below).
        try {
          localStorage.setItem(SIGNED_OUT_KEY, String(Date.now()));
        } catch {
          // storage-blocked edge case -- this tab still signed out locally,
          // just won't propagate to other tabs.
        }
      }
      // Fire-and-forget on every real sign-in (password, Google, sign-up) —
      // deliberately not on mere session restoration on page load, which
      // fires INITIAL_SESSION instead, not SIGNED_IN. Safe to call more
      // often than that anyway: send-welcome-email only actually emails once
      // per account, gated by its own atomic DB claim.
      if (event === "SIGNED_IN") {
        invokeEdgeFunction("send-welcome-email", {}).catch((err) =>
          console.error("Could not send welcome email:", err),
        );
      }
      // Same account re-announced (e.g. the tab regaining focus): keep the
      // existing user object so effects keyed on it don't re-run and reset
      // forms — only the session (fresh token) is replaced.
      setState((prev) => ({
        user: stableUser(prev.user, session?.user ?? null),
        session,
        loading: false,
      }));
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // Keyed on the user's id (not the `user`/`state` object itself, which gets
  // a new reference on every auth event including Supabase's own background
  // TOKEN_REFRESHED) — otherwise a routine token refresh would tear down and
  // re-arm this effect, silently resetting the idle clock and defeating the
  // whole control. This only (re)starts on a real sign-in/sign-out.
  const userId = state.user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    signingOutRef.current = false;
    // Arriving here — a fresh interactive sign-in, or just reopening/
    // reloading the app on an already-valid session — is itself a real
    // activity signal, so this always starts a clean 60-minute clock rather
    // than risking an immediate sign-out from a stale leftover timestamp.
    markActivity();

    function handleStorageActivityPing(e: StorageEvent) {
      if (e.key === LAST_ACTIVITY_KEY) signingOutRef.current = false;
      // Another door signed out (or this door did, in another tab) -- this
      // tab's own onAuthStateChange SIGNED_OUT branch above fires once this
      // completes, which is what actually clears state/redirects.
      if (e.key === SIGNED_OUT_KEY && !signingOutRef.current) {
        signingOutRef.current = true;
        supabase.auth.signOut().finally(() => {
          signingOutRef.current = false;
        });
      }
    }

    // Reads the SAME shared timestamp every tab of this browser writes to —
    // not a purely per-tab clock — so an actively-used tab is never signed
    // out just because a different, genuinely idle tab of the same session
    // happens to check first. supabase.auth.signOut()'s default scope
    // revokes the session everywhere at once, so every tab of a truly idle
    // browser ends up here at roughly the same real 60-minute mark anyway.
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
    // Catches a backgrounded/throttled tab whose setInterval got suspended
    // for longer than the check interval — re-checks the real elapsed time
    // the instant the tab is looked at again, instead of waiting for a
    // (possibly badly delayed) next tick.
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
