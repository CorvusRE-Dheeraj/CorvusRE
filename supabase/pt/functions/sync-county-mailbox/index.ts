// Deploy via CLI: `supabase functions deploy sync-county-mailbox`
// (JWT-verified — only pg_cron, calling with the service-role key as Bearer auth,
// is meant to trigger this; schedule in supabase/pt/schema.sql's county mailbox
// section). Every 15 minutes: read new county mail from CorvusPT's agent mailbox
// and file it — see ../_shared/county-mailbox-sync.ts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isServiceRoleRequest, serviceRoleOnlyResponse } from "../_shared/service-role-only.ts";
import { syncCountyMailbox } from "../_shared/county-mailbox-sync.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!isServiceRoleRequest(req)) return serviceRoleOnlyResponse(corsHeaders);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: box } = await admin.from("county_mailbox").select("id").eq("id", true).maybeSingle();
  // Not connected yet — nothing to do, not an error.
  if (!box) return new Response(JSON.stringify({ skipped: "not connected" }), { status: 200, headers: corsHeaders });

  try {
    const result = await syncCountyMailbox(admin);
    console.log(`sync-county-mailbox: ${JSON.stringify(result)}`);
    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("sync-county-mailbox failed:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
