// Deploy via CLI: `supabase functions deploy send-welcome-email`.
// Requires RESEND_API_KEY (shared with the other transactional emails).
//
// Called by the client (src/lib/auth.tsx) on every SIGNED_IN event — this
// is deliberately called far more often than a welcome email should ever
// actually go out. The UPDATE below is the real gate: it only sends when it
// atomically wins the race to flip welcome_email_sent_at from null to now(),
// so a user who signs in from two tabs at once, or every time they sign back
// in on any later day, never gets a second welcome email.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendWelcomeEmail } from "../_shared/welcome-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );
    const {
      data: { user },
      error: userErr,
    } = await callerClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "unauthenticated" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Atomic claim: only the caller that actually flips this row from null
    // gets a returned row, so exactly one send ever happens even under a
    // race (two tabs signing in at the same instant, a retry, etc.).
    const { data: claimed, error: claimErr } = await adminClient
      .from("profiles")
      .update({ welcome_email_sent_at: new Date().toISOString() })
      .eq("id", user.id)
      .is("welcome_email_sent_at", null)
      .select("email, first_name")
      .maybeSingle();
    if (claimErr) throw claimErr;

    if (claimed) {
      await sendWelcomeEmail(adminClient, {
        userId: user.id,
        email: claimed.email as string,
        firstName: (claimed.first_name as string | null) ?? null,
      });
    }

    return new Response(JSON.stringify({ ok: true, sent: !!claimed }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    console.error("send-welcome-email failed:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
