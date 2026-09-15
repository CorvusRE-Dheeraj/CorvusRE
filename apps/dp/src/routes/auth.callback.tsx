import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

// Captured at module load — before the router or anything else can rewrite
// window.location (trailing-slash redirect, search normalization, hash
// clearing). This is the raw URL the OAuth provider redirected us to.
const INITIAL_URL = typeof window !== "undefined" ? window.location.href : "";

export const Route = createFileRoute("/auth/callback")({
  head: () => ({ meta: [{ title: "Signing you in… — CorvusDP" }] }),
  // Pass the OAuth params through untouched (don't let validateSearch strip
  // `code` / `error`), plus our own `redirect`.
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    redirect?: string;
    code?: string;
    error?: string;
    error_description?: string;
  } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
    code: typeof search.code === "string" ? search.code : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
    error_description:
      typeof search.error_description === "string" ? search.error_description : undefined,
  }),
  component: AuthCallback,
});

function parseTarget(redirect: string | undefined): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  let t = redirect ?? "/dashboard";
  if (base && t.startsWith(`${base}/`)) t = t.slice(base.length);
  if (!t.startsWith("/") || t.startsWith("//")) t = "/dashboard";
  return t;
}

function AuthCallback() {
  const nav = useNavigate();
  const { redirect } = Route.useSearch();
  const { user } = useAuth();
  const [status, setStatus] = useState<"working" | "error">("working");
  const [detail, setDetail] = useState<string | null>(null);
  const ranRef = useRef(false);

  const target = parseTarget(redirect);

  // Explicitly complete the OAuth exchange from the captured URL, rather than
  // relying on supabase-js's detectSessionInUrl winning a race with the router.
  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    (async () => {
      try {
        const url = new URL(INITIAL_URL || window.location.href);
        const qs = url.searchParams;
        const hash = new URLSearchParams(url.hash.replace(/^#/, ""));

        const err = qs.get("error") || hash.get("error");
        if (err) {
          setDetail(qs.get("error_description") || hash.get("error_description") || err);
          setStatus("error");
          return;
        }

        // Already have a session (e.g. detectSessionInUrl beat us to it).
        const existing = await supabase.auth.getSession();
        if (existing.data.session) {
          nav({ to: target, replace: true });
          return;
        }

        const code = qs.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          nav({ to: target, replace: true });
          return;
        }

        const accessToken = hash.get("access_token");
        const refreshToken = hash.get("refresh_token");
        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
          nav({ to: target, replace: true });
          return;
        }

        // Nothing to exchange — give detectSessionInUrl / an in-flight refresh
        // a short window, then fail.
        setTimeout(async () => {
          const s = await supabase.auth.getSession();
          if (s.data.session) nav({ to: target, replace: true });
          else setStatus("error");
        }, 4000);
      } catch (e) {
        setDetail(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    })();
  }, [nav, target]);

  // If the auth context flips to signed-in by any path, move on.
  useEffect(() => {
    if (user) nav({ to: target, replace: true });
  }, [user, nav, target]);

  if (status === "error") {
    return (
      <div className="container-page py-20 max-w-md text-center">
        <h1 className="font-serif text-2xl font-semibold">Sign-in didn't complete</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We couldn't establish a session from the sign-in redirect.
        </p>
        {detail && (
          <p className="mt-2 break-words rounded-md bg-secondary px-3 py-2 text-xs text-muted-foreground">
            {detail}
          </p>
        )}
        <Link to="/sign-in" className="btn-accent mt-6 inline-flex">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="container-page py-20 max-w-md text-center">
      <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      <p className="mt-4 text-sm text-muted-foreground">Signing you in…</p>
    </div>
  );
}
