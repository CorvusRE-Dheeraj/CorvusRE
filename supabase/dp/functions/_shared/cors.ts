// Shared CORS + JSON headers for every CorvusDP Edge Function. The app is a
// static site with no backend of its own, so these functions are called
// directly from the browser (both signed-in and anonymous — the permitting
// and design wizards run their first pass with no account) — the wildcard
// origin matches how the rest of the client already talks to Supabase.
export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

export function preflight(req: Request): Response | null {
  return req.method === "OPTIONS" ? new Response("ok", { headers: corsHeaders }) : null;
}

export function jsonError(message: string, status = 500): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: corsHeaders });
}
