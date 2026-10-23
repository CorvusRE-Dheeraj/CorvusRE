// Router for a group of small functions merged into one slot (Supabase allows
// 100 functions per project). With no ?action= it behaves exactly as
// resume-subscription always has; ?action=<name> runs that merged function instead.
// Each handler keeps its own auth checks.
import { handle as resumeSubscription } from "../_shared/handlers/resume-subscription.ts";
import { handle as cancelPropertySubscription } from "../_shared/handlers/cancel-property-subscription.ts";
import { handle as cancelBppSubscription } from "../_shared/handlers/cancel-bpp-subscription.ts";
import { handle as resumeBppSubscription } from "../_shared/handlers/resume-bpp-subscription.ts";

const ACTIONS: Record<string, (req: Request) => Promise<Response>> = {
  "cancel-property-subscription": cancelPropertySubscription,
  "cancel-bpp-subscription": cancelBppSubscription,
  "resume-bpp-subscription": resumeBppSubscription,
};

Deno.serve((req: Request) => {
  const action = new URL(req.url).searchParams.get("action");
  const handler = (action && ACTIONS[action]) || resumeSubscription;
  return handler(req);
});
