// Router for a group of small functions merged into one slot (Supabase allows
// 100 functions per project). With no ?action= it behaves exactly as
// deadline-nudge always has; ?action=<name> runs that merged function instead.
// Each handler keeps its own auth checks.
import { handle as deadlineNudge } from "../_shared/handlers/deadline-nudge.ts";
import { handle as hearingNudge } from "../_shared/handlers/hearing-nudge.ts";

const ACTIONS: Record<string, (req: Request) => Promise<Response>> = {
  "hearing-nudge": hearingNudge,
};

Deno.serve((req: Request) => {
  const action = new URL(req.url).searchParams.get("action");
  const handler = (action && ACTIONS[action]) || deadlineNudge;
  return handler(req);
});
