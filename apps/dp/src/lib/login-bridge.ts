import { supabase } from "./supabase";
import { identitySupabase } from "./identity";

// If this browser already has a CorvusPT (identity) session but no CorvusDP
// session yet, silently mint a real CorvusDP session for the same person --
// no redirect, no new tab. Returns true if a session was established.
//
// Deliberately does NOT auto-provision a CorvusDP account: mint-door-session
// only succeeds for an email that already has one (see that function's own
// comments for why -- generateLink would otherwise silently create one).
// A fresh visitor with no CorvusDP account simply falls through to today's
// existing "signed out" behavior, same as before this bridge existed.
export async function tryBridgeFromIdentity(): Promise<boolean> {
  try {
    const {
      data: { session: identitySession },
    } = await identitySupabase.auth.getSession();
    if (!identitySession) return false;

    const { data, error } = await supabase.functions.invoke<{
      ok: boolean;
      email: string;
      hashedToken: string;
      verificationType: string;
    }>("mint-door-session", {
      body: { ptAccessToken: identitySession.access_token },
    });
    // 404 ("no_account_on_this_door") is an expected, common outcome -- not
    // a real error -- so this doesn't log/rethrow, it just declines to bridge.
    if (error || !data?.hashedToken) return false;

    const { error: verifyErr } = await supabase.auth.verifyOtp({
      type: data.verificationType as "magiclink",
      token_hash: data.hashedToken,
    });
    return !verifyErr;
  } catch {
    // Best-effort -- any failure here should look exactly like "not signed
    // in yet", never a crash on the dashboard's own auth check.
    return false;
  }
}
