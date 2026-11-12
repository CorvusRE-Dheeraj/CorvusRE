import { supabase } from "@/lib/supabase";
import { SIGN_IN_REQUIRED_FALLBACK } from "@/lib/public-paths";

// Site-wide switches stored in public.site_settings (supabase/dp/site-settings.sql),
// flipped by an admin in Admin → Settings. Everyone can read them; only
// admins can change them (RLS).

const KEY = "sign_in_required";

// The last answer, remembered in this browser so the next page load can show
// the page straight away (see signInEarlyScript).
export const SIGN_IN_CACHE_KEY = "corvusdp.signInRequired";
// Set on <html> while the switch is known to be off: CSS then shows the page
// (and hides "Loading CorvusDP…") before the app's code has even loaded.
export const SIGN_IN_OPEN_ATTR = "data-signin-open";

// Runs inline in <head> (routes/__root.tsx), before anything is drawn:
// applies the remembered answer at once, and asks the database straight away
// — in parallel with the app's code downloading, not after it — leaving the
// answer on window.__dpSignInRequired for getSignInRequired() to pick up.
// Before this, the page showed "Loading CorvusDP…" for about a second on every
// open while the app loaded and only then asked.
export function signInEarlyScript(url: string, anonKey: string): string {
  const c = JSON.stringify(SIGN_IN_CACHE_KEY);
  const a = JSON.stringify(SIGN_IN_OPEN_ATTR);
  // the key as a query parameter, not a header: a plain GET skips the CORS
  // preflight, which cost a whole extra round trip on a first visit
  const q = JSON.stringify(
    `${url}/rest/v1/site_settings?select=value&key=eq.${KEY}&apikey=${encodeURIComponent(anonKey)}`,
  );
  return `(function(){var d=document.documentElement,C=${c},A=${a};function set(v){try{localStorage.setItem(C,String(v))}catch(e){}if(v)d.removeAttribute(A);else d.setAttribute(A,"")}try{if(localStorage.getItem(C)==="false")d.setAttribute(A,"")}catch(e){}try{window.__dpSignInRequired=fetch(${q}).then(function(r){return r.ok?r.json():null}).then(function(rows){if(!rows||!rows[0])return null;var v=rows[0].value!==false;set(v);return v}).catch(function(){return null})}catch(e){}})();`;
}

declare global {
  interface Window {
    __dpSignInRequired?: Promise<boolean | null>;
  }
}

// Keeps the remembered answer and the <html> marker in step with `required`.
function remember(required: boolean) {
  try {
    localStorage.setItem(SIGN_IN_CACHE_KEY, String(required));
  } catch {
    // storage blocked — the next load just asks again
  }
  if (typeof document === "undefined") return;
  if (required) document.documentElement.removeAttribute(SIGN_IN_OPEN_ATTR);
  else document.documentElement.setAttribute(SIGN_IN_OPEN_ATTR, "");
}

// Read once per page load and shared by every caller.
let pending: Promise<boolean> | null = null;

// Whether every CorvusDP page needs a signed-in user. If the setting can't be
// read, the safe default (sign-in required) applies.
export function getSignInRequired(): Promise<boolean> {
  pending ??= (async () => {
    // the head script's answer, usually already in by now
    const early = typeof window !== "undefined" ? await window.__dpSignInRequired : null;
    if (early != null) return early;
    try {
      const { data, error } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", KEY)
        .maybeSingle();
      if (error || !data) return fallback();
      const required = (data as { value: unknown }).value !== false;
      remember(required);
      return required;
    } catch {
      return fallback();
    }
  })();
  return pending;
}

function fallback(): boolean {
  remember(SIGN_IN_REQUIRED_FALLBACK);
  return SIGN_IN_REQUIRED_FALLBACK;
}

// Admin only (RLS rejects anyone else — the update then matches no row).
export async function setSignInRequired(required: boolean): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("site_settings")
    .update({ value: required, updated_at: new Date().toISOString(), updated_by: user?.id ?? null })
    .eq("key", KEY)
    .select("key");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Only admins can change this setting.");
  pending = Promise.resolve(required);
  remember(required);
}
