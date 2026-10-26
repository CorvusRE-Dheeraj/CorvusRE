// Guard for the cron-only entry points.
//
// The background jobs here are scheduled by pg_cron, which POSTs to them with
// the project's service-role key as Bearer auth (see the cron.job rows).
// They are deployed JWT-verified, and the original comments treated that as
// sufficient —
// but Supabase's verify_jwt only proves the caller presented SOME valid
// JWT for this project. Any ordinary signed-in user's access token passes
// it, and these jobs then run across EVERY user's data with service-role
// privileges: re-running county lookups and rewriting base-data snapshots
// for all properties, inserting reminders into other people's accounts,
// emailing real customers, and auto-filing protests. Confirmed live against
// this project before the fix: a plain, non-admin account POSTed
// refresh-property-base-data and got back
// {"checked":13,"changed":1} for other users' properties.
//
// Accepted: an exact match against a real secret — never a token's own
// claims. SUPABASE_SERVICE_ROLE_KEY / SB_SECRET_KEY are injected by the
// platform (the sb_secret_… form, used by function-to-function calls);
// CRON_SECRET holds the project's legacy service-role JWT, which is what the
// cron.job rows send. This used to also accept any JWT whose payload said
// role: service_role, relying on verify_jwt to have checked the signature —
// safe only while every caller stays deployed JWT-verified; one redeploy with
// --no-verify-jwt would have let anyone forge it. Compared in constant time.
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
