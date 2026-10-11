import { supabase } from "./supabase";

// Records a crash that reached the root error page ("This page didn't load")
// in public.client_errors, so a report from a user can be traced to the real
// error: the page shows the same short reference it stores here. Lovable's own
// reporter (lovable-error-reporting.ts) still runs too — this one is ours to
// query. Best-effort: never throws, since it runs while the app is already
// failing.
export function newErrorRef(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let ref = "";
  for (let i = 0; i < 6; i++) ref += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `E-${ref}`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

// A page's code is split into per-route files whose names change on every
// deploy, and a deploy removes the old ones. A tab opened before a deploy
// then fails to load the next page it visits. The router already reloads
// once, but GitHub Pages lets the browser cache the HTML for 10 minutes
// (max-age=600), so that reload can come back with the same old HTML,
// pointing at the same missing file — and the user lands on "This page
// didn't load" (reported 2026-10-08, minutes after a deploy). A reload with
// a one-off query string always fetches fresh HTML.
const STALE_BUILD_RE =
  /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to load module script|ChunkLoadError/i;
const FRESH_PARAM = "_fresh";
const FRESH_KEY = "corvuspt.freshReloadAt";
const FRESH_RETRY_WINDOW_MS = 2 * 60 * 1000;

export function isStaleBuildError(error: unknown): boolean {
  return STALE_BUILD_RE.test(errorMessage(error));
}

// True when a fresh reload hasn't just been tried — so a genuinely missing
// file can't send the page into a reload loop.
export function canReloadFresh(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const last = Number(sessionStorage.getItem(FRESH_KEY) || 0);
    return Date.now() - last > FRESH_RETRY_WINDOW_MS;
  } catch {
    return false;
  }
}

export function reloadFresh(): void {
  try {
    sessionStorage.setItem(FRESH_KEY, String(Date.now()));
  } catch {
    // Without storage there's no loop guard — don't reload.
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.set(FRESH_PARAM, String(Date.now()));
  window.location.replace(url.toString());
}

// Drops the cache-busting parameter from the address bar once the fresh page
// has loaded, so it isn't bookmarked or shared.
export function stripFreshParam(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(FRESH_PARAM)) return;
  url.searchParams.delete(FRESH_PARAM);
  window.history.replaceState(window.history.state, "", url.toString());
}

export async function logClientError(ref: string, error: unknown): Promise<void> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    await supabase.from("client_errors").insert({
      ref,
      user_id: session?.user.id ?? null,
      route:
        typeof window !== "undefined" ? window.location.pathname + window.location.search : null,
      message: errorMessage(error).slice(0, 2000),
      stack: error instanceof Error ? (error.stack ?? "").slice(0, 8000) : null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 400) : null,
    });
  } catch {
    // Nothing more to do — the page is already showing the failure.
  }
}
