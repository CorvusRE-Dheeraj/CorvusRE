// Kept only for already-deployed pages still calling this name; the code
// now lives in _shared/handlers/cancel-bpp-subscription.ts and is served by resume-subscription?action=cancel-bpp-subscription.
// Delete this function once the live site calls the router.
import { handle } from "../_shared/handlers/cancel-bpp-subscription.ts";

Deno.serve(handle);
