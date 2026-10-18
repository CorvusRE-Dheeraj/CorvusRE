// Router for a group of small functions merged into one slot (Supabase allows
// 100 functions per project). With no ?action= it behaves exactly as
// google-calendar-status always has; ?action=<name> runs that merged function instead.
// Each handler keeps its own auth checks.
import { handle as googleCalendarStatus } from "../_shared/handlers/google-calendar-status.ts";
import { handle as googleCalendarStart } from "../_shared/handlers/google-calendar-start.ts";
import { handle as googleCalendarDisconnect } from "../_shared/handlers/google-calendar-disconnect.ts";

const ACTIONS: Record<string, (req: Request) => Promise<Response>> = {
  "google-calendar-start": googleCalendarStart,
  "google-calendar-disconnect": googleCalendarDisconnect,
};

Deno.serve((req: Request) => {
  const action = new URL(req.url).searchParams.get("action");
  const handler = (action && ACTIONS[action]) || googleCalendarStatus;
  return handler(req);
});
