// Kept only for already-deployed pages still calling this name; the code
// now lives in _shared/handlers/admin-update-franchise-status.ts and is served by admin-update-plan?action=admin-update-franchise-status.
// Delete this function once the live site calls the router.
import { handle } from "../_shared/handlers/admin-update-franchise-status.ts";

Deno.serve(handle);
