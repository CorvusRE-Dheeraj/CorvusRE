import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// SSR + route code-splitting can cause this module to be evaluated more than once
// in the same browser context, which would otherwise construct a second
// GoTrueClient that doesn't share in-memory auth state with the first. Cache the
// instance on globalThis so every re-evaluation reuses the same client.
declare global {
  // eslint-disable-next-line no-var
  var __corvusdpSupabase__: SupabaseClient | undefined;
}

export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured) {
  console.warn(
    "Supabase is not configured — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env " +
      "(see .env.example). Sign up / sign in and saved projects will not work until this is set.",
  );
}

// The anon key is safe to ship in the client bundle by design — Supabase enforces
// per-row access via the Row Level Security policies in supabase/schema.sql.
//
// createClient() throws synchronously on an empty URL, and this app prerenders
// every route at build time, so an unconfigured env would crash the whole build.
// Fall back to a syntactically valid placeholder so the app builds and runs;
// unconfigured auth calls simply fail over the network.
export const supabase =
  globalThis.__corvusdpSupabase__ ??
  (globalThis.__corvusdpSupabase__ = createClient(
    url || "https://placeholder.supabase.co",
    anonKey || "placeholder-anon-key",
  ));
