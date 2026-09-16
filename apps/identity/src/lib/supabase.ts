import { createClient } from "@supabase/supabase-js";

// CorvusPT's existing project is the shared identity source for every
// CorvusRE door (see the migration plan -- no new/paid Supabase project was
// created for this). Signing in here for the first time creates a real
// CorvusPT account; that's an accepted consequence of reusing an existing
// door rather than a dedicated identity project.
const IDENTITY_URL = "https://iotzuhuajbsxxuccuihn.supabase.co";
const IDENTITY_ANON_KEY = "sb_publishable_RpyqtM6EeGiT7qc3FyN5Iw_vm0aiuM3";

export const supabase = createClient(IDENTITY_URL, IDENTITY_ANON_KEY);
