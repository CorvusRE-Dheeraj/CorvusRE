// Deploy via CLI:
// `supabase functions deploy send-permit-renewal-reminders --no-verify-jwt`
// (JWT verification is off the same way CorvusPT's own cron-triggered
// functions are — pg_cron calls this with the service-role key as Bearer
// auth via net.http_post; see the cron.schedule call this project's memory
// records, or re-run it from supabase/schema.sql's tail if it's ever lost).
//
// Daily sweep: for every approved permit whose expiry_date falls within the
// next 30 days and hasn't been reminded yet, sends one real email via Resend
// — but only once per permit, ever (renewal_reminder_sent_at), and only if
// the owner's real notification_prefs.email is still on. An opted-out
// owner's permit is still marked reminded (so the daily sweep doesn't keep
// re-selecting it forever) — only a genuine send failure leaves it null so
// tomorrow's run retries it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendRenewalReminderEmail } from "../_shared/renewal-email.ts";
import { corsHeaders, preflight, jsonError } from "../_shared/cors.ts";
import { getOrCreateUnsubscribeToken, unsubscribeUrl } from "../_shared/unsubscribe-token.ts";

const MS_PER_DAY = 86_400_000;
const REMINDER_WINDOW_DAYS = 30;

type NotificationPrefs = { email?: boolean };

Deno.serve(async (req: Request) => {
  const pf = preflight(req);
  if (pf) return pf;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);
    const windowEndIso = new Date(today.getTime() + REMINDER_WINDOW_DAYS * MS_PER_DAY)
      .toISOString()
      .slice(0, 10);

    const { data: permits, error } = await admin
      .from("project_permits")
      .select("id, name, expiry_date, projects!inner(address, user_id)")
      .eq("status", "approved")
      .is("renewal_reminder_sent_at", null)
      .not("expiry_date", "is", null)
      .gte("expiry_date", todayIso)
      .lte("expiry_date", windowEndIso);
    if (error) throw error;

    const rows = permits ?? [];
    if (rows.length === 0) {
      return new Response(JSON.stringify({ sent: 0, skipped: 0, failed: 0 }), {
        status: 200,
        headers: corsHeaders,
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userIds = [...new Set(rows.map((r) => (r as any).projects?.user_id).filter(Boolean))];
    const { data: profiles, error: pErr } = await admin
      .from("profiles")
      .select("id, email, notification_prefs, unsubscribe_token")
      .in("id", userIds);
    if (pErr) throw pErr;
    const profileById = new Map((profiles ?? []).map((p) => [p.id as string, p]));

    let sent = 0;
    let skipped = 0;
    const failures: { permitId: string; message: string }[] = [];

    for (const row of rows) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const project = (row as any).projects as { address: string | null; user_id: string } | null;
      const profile = project ? profileById.get(project.user_id) : null;
      const daysLeft = Math.round(
        (new Date(row.expiry_date as string).getTime() - today.getTime()) / MS_PER_DAY,
      );

      const prefs = (profile?.notification_prefs ?? {}) as NotificationPrefs;
      const eligible = !!profile?.email && prefs.email !== false;

      if (!eligible) {
        skipped++;
        await admin
          .from("project_permits")
          .update({ renewal_reminder_sent_at: new Date().toISOString() })
          .eq("id", row.id);
        continue;
      }

      try {
        const token = await getOrCreateUnsubscribeToken(
          admin,
          profile!.id as string,
          profile!.unsubscribe_token as string | null,
        );
        await sendRenewalReminderEmail({
          email: profile!.email as string,
          permitName: row.name as string,
          projectAddress: project?.address ?? null,
          expiryDate: row.expiry_date as string,
          daysLeft,
          unsubscribeUrl: unsubscribeUrl(supabaseUrl, token, "email"),
        });
        await admin
          .from("project_permits")
          .update({ renewal_reminder_sent_at: new Date().toISOString() })
          .eq("id", row.id);
        sent++;
      } catch (err) {
        failures.push({
          permitId: row.id as string,
          message: err instanceof Error ? err.message : "unknown error",
        });
      }
    }

    return new Response(
      JSON.stringify({ sent, skipped, failed: failures.length, failures }),
      { status: 200, headers: corsHeaders },
    );
  } catch (err) {
    console.error("send-permit-renewal-reminders failed:", err);
    return jsonError(err instanceof Error ? err.message : "unknown error");
  }
});
