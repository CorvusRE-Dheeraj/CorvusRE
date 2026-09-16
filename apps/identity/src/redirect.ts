// A "redirect" search param is how a door sends someone here and gets them
// back afterward (e.g. /auth/?redirect=/corvusdp/dashboard). Only ever
// follow a same-origin, absolute path -- never an attacker-supplied
// external URL ("//evil.com" parses as protocol-relative, so it's excluded
// alongside anything not starting with a single leading "/").
//
// Returns null when there's no real, specific target -- e.g. the hub's own
// generic "Sign In" link, which isn't tied to any one door -- so callers can
// tell that apart from an actual requested destination. Blindly falling
// back to "/" here made an already-signed-in visitor's click on that link
// silently bounce straight back to the exact page they started on, which
// looks exactly like nothing happened.
export function safeRedirectTarget(): string | null {
  const raw = new URLSearchParams(window.location.search).get("redirect");
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return null;
}
