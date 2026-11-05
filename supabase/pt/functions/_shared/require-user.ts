// For functions only signed-in customers/staff should reach. verify_jwt on its
// own isn't enough: the public anon key is a valid JWT too, so without this
// anyone could call an AI function (and run up its cost) without signing in.
//
//   const who = await requireUser(req, corsHeaders);
//   if (who instanceof Response) return who;
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { rateLimit, rateLimitUser } from "./rate-limit.ts";

/**
 * Usage cap for AI functions that guest pages (the free AI report, the Ask
 * AI widget) also call, so they can't require sign-in: a signed-in caller
 * gets a generous per-account allowance, anyone else a tighter per-IP one.
 * Without it the public anon key alone could run up the Gemini bill.
 *
 *   const limited = await limitCaller(req, "site-gis", corsHeaders);
 *   if (limited) return limited;
 */
export async function limitCaller(
  req: Request,
  fn: string,
  corsHeaders: Record<string, string>,
  { guest = 40, user = 300 }: { guest?: number; user?: number } = {},
): Promise<Response | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (token && token !== Deno.env.get("SUPABASE_ANON_KEY")) {
    const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      auth: { persistSession: false },
    });
    const { data } = await client.auth.getUser(token);
    if (data?.user) return rateLimitUser(data.user.id, fn, user, corsHeaders);
  }
  return rateLimit(req, fn, guest, corsHeaders);
}

export async function requireUser(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<{ id: string } | Response> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (token) {
    const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      auth: { persistSession: false },
    });
    const { data } = await client.auth.getUser(token);
    if (data?.user) return { id: data.user.id };
  }
  return new Response(JSON.stringify({ error: "Please sign in to use this." }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** A request body field that must be a non-empty object. */
export function isFilledObject(value: unknown): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}
