// For functions only signed-in customers/staff should reach. verify_jwt on its
// own isn't enough: the public anon key is a valid JWT too, so without this
// anyone could call an AI function (and run up its cost) without signing in.
//
//   const who = await requireUser(req, corsHeaders);
//   if (who instanceof Response) return who;
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
