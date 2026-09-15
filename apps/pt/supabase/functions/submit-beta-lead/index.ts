// Deploy with `supabase functions deploy submit-beta-lead --no-verify-jwt` —
// unlike the admin-* functions, this is called from hub/index.html, a fully
// separate static site with no Supabase session of its own (no anon-key JWT
// gets attached the way supabase-js's functions.invoke() does it
// automatically from an authenticated app), so the platform gateway would
//401 before this code even runs without --no-verify-jwt.
//
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected by the Edge
// Runtime for every function — no manual secret configuration needed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const fullName = isNonEmptyString(body.fullName) ? body.fullName.trim() : null;
    const workEmail = isNonEmptyString(body.workEmail) ? body.workEmail.trim() : null;
    const company = isNonEmptyString(body.company) ? body.company.trim() : null;
    const areaOfInterest = isNonEmptyString(body.areaOfInterest)
      ? body.areaOfInterest.trim()
      : null;
    const useCase = isNonEmptyString(body.useCase) ? body.useCase.trim() : null;
    const sourceDoor = isNonEmptyString(body.sourceDoor) ? body.sourceDoor.trim() : null;

    if (!fullName || !workEmail || !company || !areaOfInterest) {
      return new Response(
        JSON.stringify({ error: "fullName, workEmail, company, and areaOfInterest are required" }),
        { status: 400, headers: corsHeaders },
      );
    }

    // No caller identity to check here on purpose — this is a public,
    // unauthenticated lead form. The service-role client bypasses RLS to
    // perform the one insert this function exists for; beta_leads has no
    // insert policy of its own (see supabase/schema.sql), only an
    // admin-only select policy, precisely so this is the only write path.
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { error: insertErr } = await adminClient.from("beta_leads").insert({
      full_name: fullName,
      work_email: workEmail,
      company,
      area_of_interest: areaOfInterest,
      use_case: useCase,
      source_door: sourceDoor,
    });
    if (insertErr) throw insertErr;

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
