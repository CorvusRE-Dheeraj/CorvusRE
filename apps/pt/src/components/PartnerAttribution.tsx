import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const KEY = "corvuspt.partnerCode";

// A referral partner's approved link (?partner=CODE): the code is kept in this
// browser, and once the visitor has an account their own CRM record is
// attributed to the partner (bd_attribute_partner — one attribution per
// prospect, never overwritten). Renders nothing.
export function PartnerAttribution() {
  const { user } = useAuth();
  useEffect(() => {
    try {
      const code = new URLSearchParams(window.location.search).get("partner");
      if (code && /^[A-Za-z0-9]{4,16}$/.test(code)) localStorage.setItem(KEY, code.toUpperCase());
    } catch {
      // storage blocked — the partner can still record the introduction by hand
    }
  }, []);
  useEffect(() => {
    if (!user) return;
    let code: string | null = null;
    try {
      code = localStorage.getItem(KEY);
    } catch {
      return;
    }
    if (!code) return;
    void supabase.rpc("bd_attribute_partner", { p_code: code }).then(({ data, error }) => {
      // attributed, or nothing to attribute yet (no CRM record) — try again next visit
      if (!error && data === true) {
        try {
          localStorage.removeItem(KEY);
        } catch {
          // ignore
        }
      }
    });
  }, [user]);
  return null;
}
