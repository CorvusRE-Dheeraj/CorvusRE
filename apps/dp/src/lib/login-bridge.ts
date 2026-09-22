import { supabase } from "./supabase";
import { identitySupabase } from "./identity";

// If this browser already has a CorvusPT (identity) session but no CorvusDP
// session yet, silently mint a real CorvusDP session for the same person --
// no redirect, no new tab. Returns "new" / "existing" if a session was
// established (and which kind), or null if it wasn't.
//
// mint-door-session now auto-provisions a fresh CorvusDP account the first
// time a given identity email bridges in -- every /sign-in landing (sign-in
// AND sign-up) redirects to the shared identity screen (apps/identity), so
// this bridge is the ONLY place a first-time CorvusDP visitor's account
// actually gets created. It arrives with no name/company/etc; ProfileGate
// (src/components/ProfileGate.tsx) collects those right after, the first
// time a nameless account lands on a real page.
const PENDING_REF_KEY = "corvusdp.pendingRef";
function readPendingRef(): string | undefined {
  try {
    return localStorage.getItem(PENDING_REF_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}
function clearPendingRef() {
  try {
    localStorage.removeItem(PENDING_REF_KEY);
  } catch {
    // ignore
  }
}

export async function tryBridgeFromIdentity(): Promise<"new" | "existing" | null> {
  try {
    const {
      data: { session: identitySession },
    } = await identitySupabase.auth.getSession();
    if (!identitySession) return null;

    const { data, error } = await supabase.functions.invoke<{
      ok: boolean;
      email: string;
      hashedToken: string;
      verificationType: string;
      isNewAccount: boolean;
    }>("mint-door-session", {
      body: {
        ptAccessToken: identitySession.access_token,
        // A referral link's code, stashed by /sign-in before it handed off to
        // the shared screen -- only honored server-side when this bridge is
        // what creates the DP account (see mint-door-session).
        referralCode: readPendingRef(),
      },
    });
    if (error || !data?.hashedToken) return null;

    const { error: verifyErr } = await supabase.auth.verifyOtp({
      type: data.verificationType as "magiclink",
      token_hash: data.hashedToken,
    });
    if (verifyErr) return null;
    clearPendingRef();
    return data.isNewAccount ? "new" : "existing";
  } catch {
    // Best-effort -- any failure here should look exactly like "not signed
    // in yet", never a crash on the dashboard's own auth check.
    return null;
  }
}
