// Kept only for already-deployed pages still calling this name; the code
// now lives in _shared/handlers/google-calendar-start.ts and is served by google-calendar-status?action=google-calendar-start.
// Delete this function once the live site calls the router.
import { handle } from "../_shared/handlers/google-calendar-start.ts";

Deno.serve(handle);
