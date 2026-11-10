import { supabase } from "@/lib/supabase";
import { SIGN_IN_REQUIRED_FALLBACK } from "@/lib/public-paths";

// Site-wide switches stored in public.site_settings (supabase/dp/site-settings.sql),
// flipped by an admin in Admin → Settings. Everyone can read them; only
// admins can change them (RLS).

const KEY = "sign_in_required";

// Read once per page load and shared by every caller.
let pending: Promise<boolean> | null = null;

// Whether every CorvusDP page needs a signed-in user. If the setting can't be
// read, the safe default (sign-in required) applies.
export function getSignInRequired(): Promise<boolean> {
  pending ??= (async () => {
    try {
      const { data, error } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", KEY)
        .maybeSingle();
      if (error || !data) return SIGN_IN_REQUIRED_FALLBACK;
      return (data as { value: unknown }).value === true;
    } catch {
      return SIGN_IN_REQUIRED_FALLBACK;
    }
  })();
  return pending;
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
}
