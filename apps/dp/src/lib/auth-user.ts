import type { User } from "@supabase/supabase-js";

// supabase-js re-announces the session (SIGNED_IN / TOKEN_REFRESHED) with a
// brand-new User object every time a browser tab regains focus. Handing that
// new object to React makes every `useEffect(..., [user])` in the app re-run,
// which reloads the page's data and resets whatever the person was typing.
// Keep the previous object whenever it's the same account with the same
// profile data, so those effects only re-run on a real sign-in, sign-out, or
// profile change.
export function stableUser(prev: User | null, next: User | null): User | null {
  if (!prev || !next) return next;
  if (prev.id === next.id && prev.updated_at === next.updated_at && prev.email === next.email) {
    return prev;
  }
  return next;
}
