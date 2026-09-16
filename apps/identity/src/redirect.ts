// A "redirect" search param is how a door sends someone here and gets them
// back afterward (e.g. /auth/?redirect=/corvusdp/dashboard). Only ever
// follow a same-origin, absolute path -- never an attacker-supplied
// external URL ("//evil.com" parses as protocol-relative, so it's excluded
// alongside anything not starting with a single leading "/").
export function safeRedirectTarget(): string {
  const raw = new URLSearchParams(window.location.search).get("redirect");
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/";
}
