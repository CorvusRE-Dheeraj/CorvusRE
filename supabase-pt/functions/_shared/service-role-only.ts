// Guard for the cron-only entry points.
//
// Four functions here are background jobs, scheduled by pg_cron, which POST
// to them with the project's service-role key as Bearer auth (see the
// cron.job rows for google-calendar-sync, refresh-property-base-data,
// send-evidence-reminders and auto-refile-cases). They are deployed
// JWT-verified, and the original comments treated that as sufficient —
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
// Two accepted forms, because this project has both key generations in play:
//
//  1. An exact match against the secret key the platform injects into this
//     function's own environment (SUPABASE_SERVICE_ROLE_KEY / SB_SECRET_KEY,
//     currently the sb_secret_… form).
//  2. A JWT whose `role` claim is service_role — which is what the cron.job
//     rows actually send today (the project's LEGACY service-role JWT, a
//     different string from the injected sb_secret_… key; verified against
//     the live project, an exact-match-only check 403s the real cron
//     caller). Reading the claim without re-verifying the signature is safe
//     here precisely because all four of these functions are deployed
//     JWT-verified: the platform gateway has already rejected anything not
//     signed with this project's JWT secret before the request reaches this
//     code. If one of them is ever redeployed with --no-verify-jwt, this
//     second branch must go with it.
//
// Either way, an ordinary signed-in user's access token carries
// role: "authenticated" and matches neither — which is the whole point.
export function isServiceRoleRequest(req: Request): boolean {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;

  const keys = [Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), Deno.env.get("SB_SECRET_KEY")].filter(
    (k): k is string => typeof k === "string" && k.length > 0,
  );
  if (keys.some((k) => k === token)) return true;

  try {
    const payload = token.split(".")[1];
    if (!payload) return false;
    const json = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    ) as { role?: unknown };
    return json.role === "service_role";
  } catch {
    return false;
  }
}

export function serviceRoleOnlyResponse(corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: "forbidden" }), {
    status: 403,
    headers: corsHeaders,
  });
}
