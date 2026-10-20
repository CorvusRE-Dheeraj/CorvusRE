import { supabase } from "./supabase";

// A prospect's registration link from the Marketing CRM carries ?lead=<token>.
// The sign-in route remembers it (the shared /auth/ screen is the same origin,
// so localStorage survives the hand-off) and records that the link was opened;
// once the new account is signed in, the account claims that CRM lead so its
// marketing history stays attached (marketing_claim_lead).
const KEY = "corvuspt.leadRef";
const TOKEN = /^[0-9a-f-]{36}$/i;

export function rememberLeadLink(token: string | undefined): void {
  if (!token || !TOKEN.test(token)) return;
  try {
    localStorage.setItem(KEY, token);
  } catch {
    // storage blocked — the email/phone match in the account sync still links them
  }
  void supabase.rpc("marketing_track_link", { p_token: token, p_event: "registration_opened" });
}

export async function claimLeadLink(): Promise<void> {
  let token: string | null = null;
  try {
    token = localStorage.getItem(KEY);
  } catch {
    return;
  }
  if (!token) return;
  const { error } = await supabase.rpc("marketing_claim_lead", { p_token: token });
  if (!error) {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // nothing to clean up
    }
  }
}
