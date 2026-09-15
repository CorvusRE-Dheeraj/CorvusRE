// Deploy via CLI: `supabase functions deploy send-notification-email --no-verify-jwt`.
// Requires RESEND_API_KEY.
//
// Called by the client (src/lib/notifications.ts addNotification) right
// after every in-app notification row is inserted — a permit status change,
// an engagement request. Re-derives everything server-side rather than
// trusting the client: looks up the notification's own project/owner, checks
// that owner is really the caller, then re-checks the owner's real
// notification_prefs (never the client's copy) before sending anything.
// Claims atomically via email_sent_at so a retry of the same call can never
// double-email the same event.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendNotificationEmail } from "../_shared/notification-email.ts";
import { corsHeaders, preflight, jsonError } from "../_shared/cors.ts";

type NotificationPrefs = {
  email?: boolean;
  permit_status?: boolean;
};

Deno.serve(async (req: Request) => {
  const pf = preflight(req);
  if (pf) return pf;

  try {
    const { notificationId } = await req.json();
    if (!notificationId || typeof notificationId !== "string") {
      throw new Error("notificationId is required");
    }

    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );
    const {
      data: { user },
      error: userErr,
    } = await callerClient.auth.getUser();
    if (userErr || !user) return jsonError("unauthenticated", 401);

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: notification, error: nErr } = await adminClient
      .from("project_notifications")
      .select("id, kind, title, body, email_sent_at, projects!inner(user_id)")
      .eq("id", notificationId)
      .maybeSingle();
    if (nErr) throw nErr;
    if (!notification) return jsonError("notification not found", 404);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ownerId = (notification as any).projects?.user_id as string | null;
    if (!ownerId || ownerId !== user.id) return jsonError("forbidden", 403);
    if (notification.email_sent_at) {
      return new Response(JSON.stringify({ ok: true, sent: false, reason: "already_sent" }), {
        status: 200,
        headers: corsHeaders,
      });
    }

    const { data: profile, error: pErr } = await adminClient
      .from("profiles")
      .select("email, notification_prefs")
      .eq("id", ownerId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!profile?.email) return jsonError("no email on file for this account", 404);

    const prefs = (profile.notification_prefs ?? {}) as NotificationPrefs;
    const emailOn = prefs.email !== false;
    const permitStatusOn = notification.kind !== "permit_status" || prefs.permit_status !== false;
    const eligible = emailOn && permitStatusOn;

    // Claim regardless of eligibility — an opted-out user's notifications
    // should never re-trigger this function on a later retry either.
    const { data: claimed, error: claimErr } = await adminClient
      .from("project_notifications")
      .update({ email_sent_at: new Date().toISOString() })
      .eq("id", notificationId)
      .is("email_sent_at", null)
      .select("id")
      .maybeSingle();
    if (claimErr) throw claimErr;

    if (claimed && eligible) {
      await sendNotificationEmail({
        email: profile.email as string,
        title: notification.title as string,
        body: (notification.body as string | null) ?? null,
        kind: notification.kind as string,
      });
    }

    return new Response(
      JSON.stringify({ ok: true, sent: !!claimed && eligible, eligible }),
      { status: 200, headers: corsHeaders },
    );
  } catch (err) {
    console.error("send-notification-email failed:", err);
    return jsonError(err instanceof Error ? err.message : "unknown error");
  }
});
