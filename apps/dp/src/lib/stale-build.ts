// Same handling as apps/pt/src/lib/client-errors.ts. A page's code is split
// into per-route files whose names change on every deploy, and a deploy
// removes the old ones, so a tab opened before a deploy fails to load the next
// page it visits. Instead of "This page didn't load", reload once with a
// one-off query string — GitHub Pages lets the browser cache the HTML for 10
// minutes, and a plain reload could come back with the same old HTML.
const STALE_BUILD_RE =
  /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to load module script|ChunkLoadError/i;
const FRESH_PARAM = "_fresh";
const FRESH_KEY = "corvusdp.freshReloadAt";
const FRESH_RETRY_WINDOW_MS = 2 * 60 * 1000;

function message(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export function isStaleBuildError(error: unknown): boolean {
  return STALE_BUILD_RE.test(message(error));
}

// True when a fresh reload hasn't just been tried — so a genuinely missing
// file can't send the page into a reload loop.
export function canReloadFresh(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Date.now() - Number(sessionStorage.getItem(FRESH_KEY) || 0) > FRESH_RETRY_WINDOW_MS;
  } catch {
    return false;
  }
}

export function reloadFresh(): void {
  try {
    sessionStorage.setItem(FRESH_KEY, String(Date.now()));
  } catch {
    return; // without storage there's no loop guard — don't reload
  }
  const url = new URL(window.location.href);
  url.searchParams.set(FRESH_PARAM, String(Date.now()));
  window.location.replace(url.toString());
}

/** Drops the cache-busting parameter once the fresh page has loaded. */
export function stripFreshParam(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(FRESH_PARAM)) return;
  url.searchParams.delete(FRESH_PARAM);
  window.history.replaceState(window.history.state, "", url.toString());
}

// Firefox reports a code file cancelled by navigating away as the same error;
// the visitor is already leaving, so it isn't a failure to show.
let leaving = false;
if (typeof window !== "undefined") {
  const mark = () => {
    leaving = true;
  };
  window.addEventListener("beforeunload", mark);
  window.addEventListener("pagehide", mark);
  window.addEventListener("pageshow", () => {
    leaving = false;
  });
}

export function isPageLeaving(): boolean {
  return leaving;
}
