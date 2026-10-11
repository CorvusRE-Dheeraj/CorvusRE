// Deploy via CLI: `supabase functions deploy send-hour-before-alerts`
// (JWT-verified — only pg_cron, calling with the service-role key as Bearer auth,
// is meant to trigger this; same pattern as send-deadline-reminders).
//
// Runs every 15 minutes. Sends a short "about an hour left" alert for:
//  - an ARB hearing or informal review that has a start time on file, one hour before
//    it starts; and
//  - a date-only deadline (protest / BPP protest deadline, tax due, penalty date) on the
//    day it falls due — taken as closing at 5:00 PM Central, so the alert lands at
//    4:00 PM. See ../_shared/alert-time.ts for the exact rules.
// Each (event, date) alerts once per channel (reminder_sends, offset_days = -1 is the
// "one hour" marker), so the every-15-minutes schedule never repeats it, and a
// rescheduled hearing (new date) alerts again for its new time.
//
// Uses the same per-account settings as send-deadline-reminders (email on by default,
// SMS off / not yet connected) plus notification_prefs.deadline_hour_alert (default ON).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isServiceRoleRequest, serviceRoleOnlyResponse } from "../_shared/service-role-only.ts";
import { emailShell, escapeHtml } from "../_shared/email-shell.ts";
import { buildDeadlineEvents } from "../_shared/deadline-events.ts";
import { alertTarget, inAlertWindow, minutesLeft, type AlertKind } from "../_shared/alert-time.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const HOUR_MARKER = -1;
type Channel = "email" | "sms";
type Due = {
  key: string;
  date: string;
  title: string;
  dueMs: number;
  kind: AlertKind;
};

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  });

function line(d: Due, nowMs: number): string {
  const left = minutesLeft(d.dueMs, nowMs);
  return d.kind === "timed"
    ? `${d.title} — starts at ${clock(d.dueMs)} Central (about ${left} min from now).`
    : `${d.title} — due today. Offices typically close at 5:00 PM Central (about ${left} min from now); confirm your county's cutoff.`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!isServiceRoleRequest(req)) return serviceRoleOnlyResponse(corsHeaders);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const twilioFrom = Deno.env.get("TWILIO_FROM_NUMBER");
  const appUrl = Deno.env.get("APP_URL") ?? "https://corvuspt.com";
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: profiles, error } = await admin
    .from("profiles")
    .select("id, phone, notification_prefs, unsubscribe_token");
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  const nowMs = Date.now();
  let emailsSent = 0;
  let smsSent = 0;
  let skipped = 0;
  const failures: { userId: string; channel?: Channel; message: string }[] = [];

  for (const profile of profiles ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prefs = (profile.notification_prefs ?? {}) as Record<string, any>;
    if (prefs.deadline_hour_alert === false) {
      skipped++;
      continue;
    }
    const emailEnabled = prefs.deadline_reminders_email !== false;
    const smsEnabled = prefs.deadline_reminders_sms === true && !!profile.phone;
    if (!emailEnabled && !smsEnabled) {
      skipped++;
      continue;
    }

    let events;
    try {
      events = await buildDeadlineEvents(admin, profile.id);
    } catch (err) {
      failures.push({
        userId: profile.id,
        message: `could not read calendar: ${err instanceof Error ? err.message : "unknown error"}`,
      });
      continue;
    }

    // A protest deadline only matters while no protest has been filed for that property
    // (or BPP account) — the calendar itself only knows the date, so check here.
    const { data: filedRows } = await admin
      .from("protests")
      .select("property_id, bpp_account_id, status")
      .eq("user_id", profile.id)
      .neq("status", "requested");
    const filed = new Set(
      (filedRows ?? []).flatMap((r) => [r.property_id, r.bpp_account_id].filter(Boolean) as string[]),
    );

    const due: Due[] = [];
    for (const ev of events) {
      // A date-only deadline is `resolved` once its date is past; a hearing the same. On
      // the day itself neither is resolved yet, so the resolved flag is only a guard for
      // paid bills and the like.
      if (ev.resolved) continue;
      if (
        (ev.key.startsWith("protest-deadline:") || ev.key.startsWith("bpp-protest-deadline:")) &&
        filed.has(ev.key.split(":")[1])
      ) {
        continue;
      }
      const target = alertTarget(ev.key, ev.date, ev.time);
      if (!target || !inAlertWindow(target.dueMs, nowMs)) continue;
      due.push({ key: ev.key, date: ev.date, title: ev.title, ...target });
    }
    if (due.length === 0) {
      skipped++;
      continue;
    }

    const { data: already } = await admin
      .from("reminder_sends")
      .select("event_key, event_date, channel")
      .eq("user_id", profile.id)
      .eq("offset_days", HOUR_MARKER)
      .in(
        "event_key",
        due.map((d) => d.key),
      );
    const sentSet = new Set((already ?? []).map((r) => `${r.event_key}|${r.event_date}|${r.channel}`));

    const channels: Channel[] = [];
    if (emailEnabled) channels.push("email");
    if (smsEnabled) channels.push("sms");

    for (const channel of channels) {
      const toSend = due.filter((d) => !sentSet.has(`${d.key}|${d.date}|${channel}`));
      if (toSend.length === 0) continue;
      try {
        if (channel === "email") {
          if (!resendKey) throw new Error("RESEND_API_KEY is not configured");
          const { data: userData, error: userErr } = await admin.auth.admin.getUserById(profile.id);
          const to = userData?.user?.email;
          if (userErr || !to) throw new Error(userErr?.message ?? "No email on file for this user");

          let unsubscribeToken = profile.unsubscribe_token as string | null;
          if (!unsubscribeToken) {
            unsubscribeToken = crypto.randomUUID().replace(/-/g, "");
            await admin.from("profiles").update({ unsubscribe_token: unsubscribeToken }).eq("id", profile.id);
          }
          const unsubscribeUrl = `${supabaseUrl}/functions/v1/unsubscribe-deadline-reminders?token=${unsubscribeToken}`;

          const subject =
            toSend.length === 1
              ? `⏰ About an hour left: ${toSend[0].title}`
              : `⏰ About an hour left on ${toSend.length} items`;
          const text = toSend.map((d) => `- ${line(d, nowMs)}`).join("\n");
          const rows = toSend
            .map(
              (d) =>
                `<tr><td style="padding:7px 0; vertical-align:top; width:22px;">⏰</td><td style="padding:7px 0;">${escapeHtml(line(d, nowMs))}</td></tr>`,
            )
            .join("");
          const html = emailShell({
            eyebrow: "Heads up",
            heading: "About an hour left",
            intro:
              toSend.length === 1
                ? `<strong>${escapeHtml(toSend[0].title)}</strong> is coming up within the hour.`
                : `${toSend.length} items are coming up within the hour:`,
            bodyRows: rows,
            ctaLabel: "Open Calendar",
            ctaHref: `${appUrl}/dashboard/calendar`,
            unsubscribeUrl,
          });
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ from: "CorvusPT <info@corvusre.com>", to: [to], subject, text, html }),
          });
          if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
          emailsSent++;
        } else {
          if (!twilioSid || !twilioToken || !twilioFrom) {
            throw new Error("SMS provider not configured (TWILIO_*)");
          }
          const body =
            `CorvusPT — about an hour left: ` +
            toSend.map((d) => line(d, nowMs)).join(" ") +
            ` ${appUrl}/dashboard/calendar`;
          const res = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
            {
              method: "POST",
              headers: {
                Authorization: `Basic ${btoa(`${twilioSid}:${twilioToken}`)}`,
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: new URLSearchParams({ To: profile.phone as string, From: twilioFrom, Body: body }),
            },
          );
          if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`);
          smsSent++;
        }
        await admin.from("reminder_sends").upsert(
          toSend.map((d) => ({
            user_id: profile.id,
            event_key: d.key,
            event_date: d.date,
            offset_days: HOUR_MARKER,
            channel,
          })),
          { onConflict: "user_id,event_key,event_date,offset_days,channel", ignoreDuplicates: true },
        );
      } catch (err) {
        failures.push({
          userId: profile.id,
          channel,
          message: err instanceof Error ? err.message : "unknown error",
        });
      }
    }
  }

  return new Response(
    JSON.stringify({ emailsSent, smsSent, skipped, failed: failures.length, failures }),
    { status: 200, headers: corsHeaders },
  );
});
