// Per-caller rate limiting for public edge functions (see supabase/dp/rate-limits.sql).
//
// Callers are identified by a SHA-256 of their IP address — the raw IP is
// never stored. Fails open: if the limiter itself is unavailable the request
// goes through, so a database hiccup can't take the feature down.
//
//   const limited = await rateLimit(req, "ai-health-score", 60);
//   if (limited) return limited;

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const WINDOW_SECS = 600; // 10 minutes

let admin: ReturnType<typeof createClient> | null = null;
function client() {
  if (!admin) {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return null;
    admin = createClient(url, key, { auth: { persistSession: false } });
  }
  return admin;
}

function callerIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Counts this call against `limit` per 10 minutes for the caller. Returns a
 * ready 429 Response when they're over, or null to carry on.
 */
export async function rateLimit(
  req: Request,
  fn: string,
  limit: number,
  headers: Record<string, string> = {},
): Promise<Response | null> {
  const db = client();
  if (!db) return null;
  try {
    const bucket = `${fn}:${(await sha256(callerIp(req))).slice(0, 32)}`;
    const { data, error } = await db.rpc("hit_rate_limit", {
      p_bucket: bucket,
      p_limit: limit,
      p_window_secs: WINDOW_SECS,
    });
    if (error || data !== false) return null;
  } catch {
    return null;
  }
  return new Response(
    JSON.stringify({ error: "Too many requests — please wait a few minutes and try again." }),
    {
      status: 429,
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "Retry-After": String(WINDOW_SECS),
      },
    },
  );
}
