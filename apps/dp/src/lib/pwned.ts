// Has this password shown up in a known data breach? Checked against
// HaveIBeenPwned's free "range" API with k-anonymity: only the first 5
// characters of the password's SHA-1 hash leave the browser, never the
// password. (Supabase's built-in version of this check needs the Pro plan.)
// Fails open: if the service can't be reached, the password is allowed.
export async function isPwnedPassword(password: string): Promise<boolean> {
  try {
    const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(password));
    const hex = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
    const res = await fetch(`https://api.pwnedpasswords.com/range/${hex.slice(0, 5)}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return false;
    const suffix = hex.slice(5);
    return (await res.text()).split("\n").some((line) => {
      const [h, count] = line.trim().split(":");
      return h === suffix && Number(count) > 0;
    });
  } catch {
    return false;
  }
}

export const PWNED_MESSAGE =
  "This password has appeared in a known data breach, so it isn't safe to use. Please choose a different one.";
