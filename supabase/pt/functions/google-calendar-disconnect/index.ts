// Kept only for already-deployed pages still calling this name; the code
// now lives in _shared/handlers/google-calendar-disconnect.ts and is served by google-calendar-status?action=google-calendar-disconnect.
// Delete this function once the live site calls the router.
import { handle } from "../_shared/handlers/google-calendar-disconnect.ts";

Deno.serve(handle);
