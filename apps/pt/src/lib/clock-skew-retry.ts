// Right after sign-in the auth server's clock can be a moment ahead of the
// database's, and the database then rejects the brand-new token with 401
// "JWT issued at future" (PGRST303) — seen live 2026-11-14 on reads fired in
// the first second after signing in, which left widgets empty. The request
// is rejected before anything runs, so sending it once more a moment later
// is safe for reads and writes alike.

const RETRY_DELAY_MS = 1200;

export function withClockSkewRetry(
  base: typeof fetch = (...a) => fetch(...a),
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): typeof fetch {
  return async (input, init) => {
    const res = await base(input, init);
    if (res.status !== 401) return res;
    const body = await res
      .clone()
      .text()
      .catch(() => "");
    if (!/PGRST303|issued at future/i.test(body)) return res;
    // A Request object's body can only be read once; such calls aren't made
    // by supabase-js (it passes url + init), so leave them as they are.
    if (input instanceof Request) return res;
    await wait(RETRY_DELAY_MS);
    return base(input, init);
  };
}
