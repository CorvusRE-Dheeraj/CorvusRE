// Guard for the cron-only entry points (send-permit-renewal-reminders,
// send-weekly-digest). They are deployed with verify_jwt off, and had no check
// of their own — anyone on the internet could trigger the renewal reminders
// and weekly digest emails to every customer. pg_cron POSTs to them with the
// project's legacy service-role JWT (stored as CRON_SECRET).
// Same guard as supabase/pt/functions/_shared/service-role-only.ts.
//
// Accepted: an exact match against a real secret — never a token's own
// claims. SUPABASE_SERVICE_ROLE_KEY / SB_SECRET_KEY are injected by the
// platform (the sb_secret_… form, used by function-to-function calls);
// CRON_SECRET holds the project's legacy service-role JWT, which is what the
// cron.job rows send. A token's own role claim is never trusted (these run
// with verify_jwt off, so nothing has checked its signature). Compared in
// constant time.
export function isServiceRoleRequest(req: Request): boolean {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;

  const keys = [
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    Deno.env.get("SB_SECRET_KEY"),
    Deno.env.get("CRON_SECRET"),
  ].filter((k): k is string => typeof k === "string" && k.length > 0);
  // every key is compared (no early exit) so timing reveals nothing
  return keys.reduce((hit, k) => safeEqual(token, k) || hit, false);
}

function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function serviceRoleOnlyResponse(corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: "forbidden" }), {
    status: 403,
    headers: corsHeaders,
  });
}
