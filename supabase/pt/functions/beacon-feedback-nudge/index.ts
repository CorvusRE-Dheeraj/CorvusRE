// Deploy via CLI: `supabase functions deploy beacon-feedback-nudge --no-verify-jwt`
// (--no-verify-jwt because this is called from navigator.sendBeacon(), which
// cannot set custom headers at all — no Authorization header ever reaches
// this function, so the platform gateway's normal JWT check would 401
// every real call before this code even runs. The caller's identity is
// verified below instead, from an access_token carried in the beacon's own
// body — see the sendBeacon call in SiteChrome.tsx for where this token
// comes from.)
//
// Replaces the old time-based "email 1 hour after signup" approach
// (send-beta-feedback-invite, retired — it was never actually cron-
// scheduled) with an event-based one: the client fires this beacon from a
// `pagehide` listener, which — unlike `beforeunload` — fires reliably for
// EVERY way of leaving a page, including keyboard shortcuts (Ctrl+W) that
// no page JS can intercept or show its own UI for. We can't show a modal in
// that moment (the tab's already gone), so this sends a real "give us
// feedback" email shortly after instead — the one channel that still
// reaches someone who left via a method no in-page prompt could ever catch.
//
// Capped at 3 emails per account, at least 2 days apart, stopping
// immediately once they complete the form (profiles.beta_feedback_invite_
// count / _sent_at track this — see their own schema.sql comment). A user
// bouncing between several tabs in one sitting only triggers a send once
// the 2-day gap since the last one has actually elapsed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { emailShell, escapeHtml } from "../_shared/email-shell.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const MAX_SENDS = 3;
const MIN_GAP_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // sendBeacon is fire-and-forget — the client never reads this response —
  // so every path below returns 200 regardless of outcome. Real failures
  // still get logged server-side for visibility.
  try {
    const { accessToken } = (await req.json()) as { accessToken?: string };
    if (typeof accessToken !== "string" || !accessToken) {
      return new Response(JSON.stringify({ ignored: "no accessToken" }), {
        status: 200,
        headers: corsHeaders,
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const anonClient = createClient(supabaseUrl, anonKey);
    const {
      data: { user },
      error: userErr,
    } = await anonClient.auth.getUser(accessToken);
    if (userErr || !user) {
      return new Response(JSON.stringify({ ignored: "invalid token" }), {
        status: 200,
        headers: corsHeaders,
      });
    }

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: profile } = await admin
      .from("profiles")
      .select("plan, email, first_name, beta_feedback_invite_sent_at, beta_feedback_invite_count")
      .eq("id", user.id)
      .maybeSingle();

    // Beta testers only (see PlanValue's own comment in src/lib/billing.ts).
    if (!profile || profile.plan !== "beta") {
      return new Response(JSON.stringify({ ignored: "not eligible" }), {
        status: 200,
        headers: corsHeaders,
      });
    }

    const sendCount = (profile.beta_feedback_invite_count as number) ?? 0;
    if (sendCount >= MAX_SENDS) {
      return new Response(JSON.stringify({ ignored: "cap reached" }), {
        status: 200,
        headers: corsHeaders,
      });
    }
    const lastSentAt = profile.beta_feedback_invite_sent_at as string | null;
    if (lastSentAt && Date.now() - new Date(lastSentAt).getTime() < MIN_GAP_MS) {
      return new Response(JSON.stringify({ ignored: "too soon since last send" }), {
        status: 200,
        headers: corsHeaders,
      });
    }

    const { data: existingResponse } = await admin
      .from("beta_feedback_responses")
      .select("completed_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (existingResponse?.completed_at) {
      // Already done — nothing left to remind them about. Deliberately
      // doesn't bump the count/timestamp: no reason to leave a trace of a
      // send that correctly never happened.
      return new Response(JSON.stringify({ ignored: "already completed" }), {
        status: 200,
        headers: corsHeaders,
      });
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) throw new Error("RESEND_API_KEY is not configured");
    const to = profile.email as string | null;
    if (!to) throw new Error("No email on file for this user");

    const appUrl = Deno.env.get("APP_URL") ?? "https://corvuspt.com";
    const firstName = (profile.first_name as string | null) ?? "";
    const nextSendNumber = sendCount + 1;
    const html = emailShell({
      eyebrow: "Beta feedback",
      heading: "Got 7-10 minutes for us?",
      intro:
        `${firstName ? `Hi ${escapeHtml(firstName)}, ` : ""}we noticed you stepped away from Corvus — ` +
        `we'd love to know what's actually working and what isn't before you go much further. Help us ` +
        `break Corvus, in a good way.`,
      ctaLabel: "Give Feedback",
      ctaHref: `${appUrl}/dashboard/feedback`,
      footnote:
        nextSendNumber >= MAX_SENDS
          ? "This is the last time we'll ask — thanks for being an early tester, whichever way you go."
          : "We'll only ask a couple more times at most, a few days apart — thanks for being an early tester.",
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
      .update({
        beta_feedback_invite_sent_at: new Date().toISOString(),
        beta_feedback_invite_count: nextSendNumber,
      })
      .eq("id", user.id);

    return new Response(JSON.stringify({ sent: true, sendNumber: nextSendNumber }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    console.error("beacon-feedback-nudge failed:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }), {
      status: 200,
      headers: corsHeaders,
    });
  }
});
