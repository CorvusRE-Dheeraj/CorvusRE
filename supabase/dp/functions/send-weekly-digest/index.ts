// Deploy via CLI: `supabase functions deploy send-weekly-digest --no-verify-jwt`
// (cron-triggered via pg_net + pg_cron, service-role Bearer auth — same
// posture as send-permit-renewal-reminders).
//
// Weekly: for every account with notification_prefs.weekly on, at least one
// project, and due per last_digest_sent_at (>= ~6.5 days since the last
// send, so a cron that runs a little early/late each week never skips a
// week), sends one real snapshot email — permits in progress, approved/
// submitted in the last 7 days (from the real submitted_at/approved_at
// timestamps, never guessed), unread notifications, and upcoming renewals.
// An account with genuinely nothing to report (no permits, no unread, no
// renewals) is skipped — marked as sent anyway so it isn't re-checked every
// day — rather than mailing an empty summary.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendWeeklyDigestEmail, type DigestStats } from "../_shared/digest-email.ts";
import { corsHeaders, preflight, jsonError } from "../_shared/cors.ts";
import { getOrCreateUnsubscribeToken, unsubscribeUrl } from "../_shared/unsubscribe-token.ts";

const MS_PER_DAY = 86_400_000;
const DUE_AFTER_MS = 6.5 * MS_PER_DAY;
const RENEWAL_WINDOW_DAYS = 30;

Deno.serve(async (req: Request) => {
  const pf = preflight(req);
  if (pf) return pf;

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const { data: profiles, error } = await admin
      .from("profiles")
      .select("id, email, first_name, notification_prefs, last_digest_sent_at, unsubscribe_token");
    if (error) throw error;

    const now = Date.now();
    const due = (profiles ?? []).filter((p) => {
      const prefs = (p.notification_prefs ?? {}) as { weekly?: boolean };
      if (prefs.weekly === false) return false;
      const last = p.last_digest_sent_at ? new Date(p.last_digest_sent_at as string).getTime() : 0;
      return now - last >= DUE_AFTER_MS;
    });

    let sent = 0;
    let skippedEmpty = 0;
    let skippedNoProject = 0;
    const failures: { userId: string; message: string }[] = [];
    const renewalCutoff = new Date(now + RENEWAL_WINDOW_DAYS * MS_PER_DAY).toISOString().slice(0, 10);
    const weekAgoIso = new Date(now - 7 * MS_PER_DAY).toISOString();

    for (const profile of due) {
      try {
        const { data: projects, error: projErr } = await admin
          .from("projects")
          .select("id")
          .eq("user_id", profile.id);
        if (projErr) throw projErr;
        const projectIds = (projects ?? []).map((p) => p.id as string);

        if (projectIds.length === 0) {
          skippedNoProject++;
          continue; // never touched, not "checked and had nothing" — leave last_digest_sent_at alone
        }

        const [{ data: permits, error: permitsErr }, { count: unreadCount, error: unreadErr }] =
          await Promise.all([
            admin
              .from("project_permits")
              .select("status, submitted_at, approved_at, expiry_date")
              .in("project_id", projectIds),
            admin
              .from("project_notifications")
              .select("id", { count: "exact", head: true })
              .in("project_id", projectIds)
              .eq("read", false),
          ]);
        if (permitsErr) throw permitsErr;
        if (unreadErr) throw unreadErr;

        const rows = permits ?? [];
        const stats: DigestStats = {
          totalPermits: rows.length,
          pendingPermits: rows.filter((r) => r.status !== "approved").length,
          approvedPermits: rows.filter((r) => r.status === "approved").length,
          submittedThisWeek: rows.filter(
            (r) => r.submitted_at && (r.submitted_at as string) >= weekAgoIso,
          ).length,
          approvedThisWeek: rows.filter(
            (r) => r.approved_at && (r.approved_at as string) >= weekAgoIso,
          ).length,
          unreadNotifications: unreadCount ?? 0,
          upcomingRenewals: rows.filter(
            (r) =>
              r.status === "approved" &&
              r.expiry_date &&
              (r.expiry_date as string) <= renewalCutoff,
          ).length,
        };

        const hasContent =
          stats.pendingPermits > 0 ||
          stats.approvedThisWeek > 0 ||
          stats.submittedThisWeek > 0 ||
          stats.upcomingRenewals > 0 ||
          stats.unreadNotifications > 0;

        if (hasContent && profile.email) {
          const token = await getOrCreateUnsubscribeToken(
            admin,
            profile.id as string,
            profile.unsubscribe_token as string | null,
          );
          await sendWeeklyDigestEmail({
            email: profile.email as string,
            firstName: (profile.first_name as string | null) ?? null,
            stats,
            unsubscribeUrl: unsubscribeUrl(supabaseUrl, token, "weekly"),
          });
          sent++;
        } else {
          skippedEmpty++;
        }

        await admin
          .from("profiles")
          .update({ last_digest_sent_at: new Date().toISOString() })
          .eq("id", profile.id);
      } catch (err) {
        failures.push({
          userId: profile.id as string,
          message: err instanceof Error ? err.message : "unknown error",
        });
      }
    }

    return new Response(
      JSON.stringify({ sent, skippedEmpty, skippedNoProject, failed: failures.length, failures }),
      { status: 200, headers: corsHeaders },
    );
  } catch (err) {
    console.error("send-weekly-digest failed:", err);
    return jsonError(err instanceof Error ? err.message : "unknown error");
  }
});
