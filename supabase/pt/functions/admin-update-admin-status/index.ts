// Kept only for already-deployed pages still calling this name; the code
// now lives in _shared/handlers/admin-update-admin-status.ts and is served by admin-update-plan?action=admin-update-admin-status.
// Delete this function once the live site calls the router.
import { handle } from "../_shared/handlers/admin-update-admin-status.ts";

Deno.serve(handle);
