// Deploy via CLI: `supabase functions deploy send-beta-feedback-invite`
// (JWT-verified — only pg_cron, calling with the service-role key as Bearer
// auth, is meant to trigger this; same pattern as send-evidence-reminders /
// send-deadline-reminders — see ../_shared/service-role-only.ts).
//
// Run every ~20-30 minutes: emails any BETA-PLAN account (plan = 'beta' —
// see PlanValue's own comment in src/lib/billing.ts; a real paying customer
// was never a beta tester and shouldn't get this) that signed up 50-70
// minutes ago (a window, not an exact minute, since a periodic cron can't
// land on the exact 60-minute mark) — "roughly an hour after they started
// using Corvus" — inviting them to the beta feedback form, once, ever.
// Skips anyone who already completed it (no reason to nudge someone who
// already gave feedback) and anyone already sent this exact email
// (beta_feedback_invite_sent_at, set right after a successful send — never
// claimed before the email actually goes out).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isServiceRoleRequest, serviceRoleOnlyResponse } from "../_shared/service-role-only.ts";
import { emailShell, escapeHtml } from "../_shared/email-shell.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const WINDOW_MIN_MS = 50 * 60_000;
const WINDOW_MAX_MS = 70 * 60_000;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!isServiceRoleRequest(req)) return serviceRoleOnlyResponse(corsHeaders);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const appUrl = Deno.env.get("APP_URL") ?? "https://corvuspt.com";
  const admin = createClient(supabaseUrl, serviceKey);

  const now = Date.now();
  const windowStart = new Date(now - WINDOW_MAX_MS).toISOString();
  const windowEnd = new Date(now - WINDOW_MIN_MS).toISOString();

  const { data: candidates, error } = await admin
    .from("profiles")
    .select("id, email, first_name")
    // Beta testers only — the free/full-access grant (see PlanValue's own
    // comment in src/lib/billing.ts). A real paying customer was never a
    // beta tester and shouldn't get invited to a beta-tester survey.
    .eq("plan", "beta")
    .is("beta_feedback_invite_sent_at", null)
    .gte("created_at", windowStart)
    .lte("created_at", windowEnd);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  let sent = 0;
  let skippedAlreadyDone = 0;
  const failures: { userId: string; message: string }[] = [];

  for (const profile of candidates ?? []) {
    try {
      const { data: existing } = await admin
        .from("beta_feedback_responses")
        .select("completed_at")
        .eq("user_id", profile.id)
        .maybeSingle();
      if (existing?.completed_at) {
        // Already done before the hour was even up — mark it sent too, so
        // this row never gets re-checked on future runs.
        await admin
          .from("profiles")
          .update({ beta_feedback_invite_sent_at: new Date().toISOString() })
          .eq("id", profile.id);
        skippedAlreadyDone++;
        continue;
      }

      if (!resendKey) throw new Error("RESEND_API_KEY is not configured");
      const to = profile.email as string | null;
      if (!to) throw new Error("No email on file for this user");

      const firstName = (profile.first_name as string | null) ?? "";
      const html = emailShell({
        eyebrow: "Beta feedback",
        heading: "Got 7-10 minutes for us?",
        intro:
          `${firstName ? `Hi ${escapeHtml(firstName)}, ` : ""}you've been using Corvus for about an hour now — ` +
          `we'd love to know what's actually working and what isn't. Help us break Corvus, in a good way.`,
        ctaLabel: "Give Feedback",
        ctaHref: `${appUrl}/dashboard/feedback`,
        footnote: "This is the only time we'll send this — thanks for being an early tester.",
      });
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "CorvusPT <info@corvusre.com>",
          to: [to],
          subject: "Got 7-10 minutes to help us make Corvus better?",
          html,
        }),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);

      await admin
        .from("profiles")
        .update({ beta_feedback_invite_sent_at: new Date().toISOString() })
        .eq("id", profile.id);
      sent++;
    } catch (err) {
      failures.push({
        userId: profile.id,
        message: err instanceof Error ? err.message : "unknown error",
      });
    }
  }

  return new Response(
    JSON.stringify({ sent, skippedAlreadyDone, failed: failures.length, failures }),
    { status: 200, headers: corsHeaders },
  );
});
