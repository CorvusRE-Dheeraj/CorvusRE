// Router for a group of small functions merged into one slot (Supabase allows
// 100 functions per project). With no ?action= it behaves exactly as
// admin-update-plan always has; ?action=<name> runs that merged function instead.
// Each handler keeps its own auth checks.
import { handle as adminUpdatePlan } from "../_shared/handlers/admin-update-plan.ts";
import { handle as adminUpdateAdminStatus } from "../_shared/handlers/admin-update-admin-status.ts";
import { handle as adminUpdateFranchiseStatus } from "../_shared/handlers/admin-update-franchise-status.ts";
import { handle as marketingSend } from "../_shared/handlers/marketing-send.ts";
import { handle as marketingProspects } from "../_shared/handlers/marketing-prospects.ts";
import { handle as staffApprovals } from "../_shared/handlers/staff-approvals.ts";

const ACTIONS: Record<string, (req: Request) => Promise<Response>> = {
  "admin-update-admin-status": adminUpdateAdminStatus,
  "admin-update-franchise-status": adminUpdateFranchiseStatus,
  // Marketing Admin email sending (campaigns, follow-ups, scheduled sends).
  "marketing-send": marketingSend,
  // Marketing CRM county prospecting (commercial parcels from the CAD layers).
  "marketing-prospects": marketingProspects,
  "staff-approvals": staffApprovals,
};

Deno.serve((req: Request) => {
  const action = new URL(req.url).searchParams.get("action");
  const handler = (action && ACTIONS[action]) || adminUpdatePlan;
  return handler(req);
});
