// Router for a group of small functions merged into one slot (Supabase allows
// 100 functions per project). With no ?action= it behaves exactly as
// deadline-nudge always has; ?action=<name> runs that merged function instead.
// Each handler keeps its own auth checks.
import { handle as deadlineNudge } from "../_shared/handlers/deadline-nudge.ts";
import { handle as hearingNudge } from "../_shared/handlers/hearing-nudge.ts";
import { limitCaller } from "../_shared/require-user.ts";

const ACTIONS: Record<string, (req: Request) => Promise<Response>> = {
  "hearing-nudge": hearingNudge,
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  const action = new URL(req.url).searchParams.get("action");
  const handler = (action && ACTIONS[action]) || deadlineNudge;
  if (req.method !== "OPTIONS") {
    // A fixed bucket name — never the raw ?action=, which a caller could vary
    // to get a fresh allowance each time.
    const bucket = action && ACTIONS[action] ? action : "deadline-nudge";
    const limited = await limitCaller(req, bucket, corsHeaders);
    if (limited) return limited;
  }
  return handler(req);
});
