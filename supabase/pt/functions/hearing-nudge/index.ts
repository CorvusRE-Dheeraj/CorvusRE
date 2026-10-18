// Kept only for already-deployed pages still calling this name; the code
// now lives in _shared/handlers/hearing-nudge.ts and is served by deadline-nudge?action=hearing-nudge.
// Delete this function once the live site calls the router.
import { handle } from "../_shared/handlers/hearing-nudge.ts";

Deno.serve(handle);
