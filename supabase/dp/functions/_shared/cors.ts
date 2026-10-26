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

// Bad input is the caller's mistake, not a server failure: 400, not 500.
export class BadRequestError extends Error {
  status = 400;
}

/** The request body as a JSON object — malformed or non-object JSON is a 400. */
// deno-lint-ignore no-explicit-any
export async function readJson(req: Request): Promise<Record<string, any>> {
  let body: unknown;
  try {
    body = JSON.parse(await req.text());
  } catch {
    throw new BadRequestError("The request body must be valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequestError("The request body must be a JSON object.");
  }
  // deno-lint-ignore no-explicit-any
  return body as Record<string, any>;
}

export function errorStatus(err: unknown): number {
  return err instanceof BadRequestError ? 400 : 500;
}

export function errorResponse(err: unknown): Response {
  return jsonError(err instanceof Error ? err.message : "unknown error", errorStatus(err));
}
