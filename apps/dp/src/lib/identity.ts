import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// CorvusPT is the shared identity source for the CorvusRE login bridge (see
// supabase/dp/functions/mint-door-session/index.ts for the full mechanics
// and why -- no new/paid Supabase project was created for this). This is a
// second, independent Supabase client in the SAME browser, pointed at
// CorvusPT's project purely to read whether the visitor already has a
// CorvusPT session -- it never reads or writes any CorvusDP data itself.
//
// Session storage keys are project-ref-scoped ("sb-<ref>-auth-token"), so
// this client's session and CorvusDP's own client's session coexist in the
// same origin's localStorage without collision.
declare global {
  // eslint-disable-next-line no-var
  var __corvusreIdentitySupabase__: SupabaseClient | undefined;
}

const IDENTITY_URL = "https://iotzuhuajbsxxuccuihn.supabase.co";
const IDENTITY_ANON_KEY = "sb_publishable_RpyqtM6EeGiT7qc3FyN5Iw_vm0aiuM3";

export const identitySupabase =
  globalThis.__corvusreIdentitySupabase__ ??
  (globalThis.__corvusreIdentitySupabase__ = createClient(IDENTITY_URL, IDENTITY_ANON_KEY, {
    auth: {
      // persistSession stays on (default) so getSession() below actually
      // finds whatever CorvusPT session already sits in this browser's
      // localStorage, under a project-ref-scoped key derived from
      // IDENTITY_URL -- the same key CorvusPT's own app and the shared
      // /auth/ sign-in app both write to.
      //
      // autoRefreshToken is off -- this client is only ever consulted once
      // at mount, it shouldn't run its own background refresh timer.
      //
      // detectSessionInUrl is off -- CorvusDP's own client is what should
      // handle any magic-link/OAuth URL fragment on this origin, not this
      // read-only identity check.
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }));
