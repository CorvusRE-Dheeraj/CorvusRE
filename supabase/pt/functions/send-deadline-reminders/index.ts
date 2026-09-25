// Deploy via CLI: `supabase functions deploy send-deadline-reminders`
// (JWT-verified — only pg_cron, calling with the service-role key as Bearer
// auth, is meant to trigger this; same pattern as send-evidence-reminders /
// refresh-property-base-data — see ../_shared/service-role-only.ts).
//
// Daily: for every protest deadline, ARB hearing, informal review, tax due
// date, tax penalty date, refund date, BPP protest deadline, and personal
// reminder on a user's calendar (see ../_shared/deadline-events.ts — the
// same set getCalendarEvents() in src/lib/tax-calendar.ts already shows on
// the Calendar page), sends a reminder at 30/15/7/3/2/0 days out — all six on
// by default — by email and/or SMS, per that user's own Settings →
// Notification Preferences, which also lets them turn individual offsets off
// (notification_prefs.deadline_reminder_offsets; missing key = all six, same
// "absent = default" treatment as everything else in that column).
//
// Reminders are computed fresh from each event's CURRENT date every run —
// there is no stored "reminder schedule" to go stale. If a hearing date
// moves, tomorrow's run just measures days-until-the-new-date and the
// schedule has already "updated" with no migration needed. reminder_sends
// (schema.sql) only exists to stop the SAME (event, date, offset, channel)
// firing twice; because it's keyed on the date too, a changed date can't
// collide with an old date's dedup rows, so a rescheduled event gets its
// full 30/15/7/3/2/0 run over again from wherever it now lands.
//
// One message per user per channel, not per event — bundles every event due
// that day into a single email and a single SMS, same reasoning as
// send-evidence-reminders (a customer with several properties otherwise
// gets spammed with near-identical messages the same morning).
//
// Email requires RESEND_API_KEY (already configured — same key every other
// transactional email here uses). SMS requires TWILIO_ACCOUNT_SID /
// TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER, which are NOT configured yet as of
// this writing — until they are, a user who turns SMS on simply accumulates
// per-run failures here (logged, never silently claimed as sent) rather
// than the whole run breaking; the Settings UI also disables the SMS toggle
// until a phone number is on file, and is labeled "coming soon" until this
// function can actually reach a provider.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isServiceRoleRequest, serviceRoleOnlyResponse } from "../_shared/service-role-only.ts";
import { emailShell, escapeHtml } from "../_shared/email-shell.ts";
import { buildDeadlineEvents, type DeadlineEvent } from "../_shared/deadline-events.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

// The full default-on set — also the only valid offsets, so a stray/garbage
// value in a user's stored preference (never trusted from the client) can't
// sneak in a reminder point that doesn't exist anywhere else in the system.
const ALL_OFFSETS = [30, 15, 7, 3, 2, 0] as const;
const OFFSET_LABEL: Record<number, string> = {
  30: "in 30 days",
  15: "in 15 days",
  7: "in 7 days",
  3: "in 3 days",
  2: "in 2 days",
  0: "today",
};

type DueItem = DeadlineEvent & { offsetDays: number };
type Channel = "email" | "sms";

function daysUntil(date: string, today: Date): number {
  const eventDate = new Date(`${date}T00:00:00Z`);
  return Math.round((eventDate.getTime() - today.getTime()) / 86_400_000);
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

  const todayIso = new Date().toISOString().slice(0, 10);
  const today = new Date(`${todayIso}T00:00:00Z`);

  let emailsSent = 0;
  let smsSent = 0;
  let remindersIncluded = 0;
  let skipped = 0;
  const failures: { userId: string; channel?: Channel; message: string }[] = [];

  for (const profile of profiles ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prefs = (profile.notification_prefs ?? {}) as Record<string, any>;
    const emailEnabled = prefs.deadline_reminders_email !== false; // default ON
    const smsEnabled = prefs.deadline_reminders_sms === true && !!profile.phone; // default OFF, needs a phone on file
    if (!emailEnabled && !smsEnabled) {
      skipped++;
      continue;
    }
    // Which of the 30/15/7/3/2/0 points this account actually wants —
    // missing key (or anything not a real array) = all of them.
    const selectedOffsets: number[] = Array.isArray(prefs.deadline_reminder_offsets)
      ? prefs.deadline_reminder_offsets.filter((n: unknown) =>
          (ALL_OFFSETS as readonly unknown[]).includes(n),
        )
      : [...ALL_OFFSETS];
    if (selectedOffsets.length === 0) {
      skipped++;
      continue;
    }

    let events: DeadlineEvent[];
    try {
      events = await buildDeadlineEvents(admin, profile.id);
    } catch (err) {
      failures.push({
        userId: profile.id,
        message: `could not read calendar: ${err instanceof Error ? err.message : "unknown error"}`,
      });
      continue;
    }

    const due: DueItem[] = [];
    for (const ev of events) {
      if (ev.resolved) continue;
      const offsetDays = daysUntil(ev.date, today);
      if (selectedOffsets.includes(offsetDays)) {
        due.push({ ...ev, offsetDays });
      }
    }
    if (due.length === 0) {
      skipped++;
      continue;
    }

    // Which of these (event, date, offset) combos already fired, for either
    // channel — checked once per user rather than per channel.
    const { data: already } = await admin
      .from("reminder_sends")
      .select("event_key, event_date, offset_days, channel")
      .eq("user_id", profile.id)
      .in(
        "event_key",
        due.map((d) => d.key),
      );
    const sentSet = new Set(
      (already ?? []).map((r) => `${r.event_key}|${r.event_date}|${r.offset_days}|${r.channel}`),
    );

    const channels: Channel[] = [];
    if (emailEnabled) channels.push("email");
    if (smsEnabled) channels.push("sms");

    for (const channel of channels) {
      const toSend = due.filter(
        (d) => !sentSet.has(`${d.key}|${d.date}|${d.offsetDays}|${channel}`),
      );
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
            await admin
              .from("profiles")
              .update({ unsubscribe_token: unsubscribeToken })
              .eq("id", profile.id);
          }
          const unsubscribeUrl = `${supabaseUrl}/functions/v1/unsubscribe-deadline-reminders?token=${unsubscribeToken}`;

          const subject =
            toSend.length === 1
              ? `Reminder: ${toSend[0].title} is ${OFFSET_LABEL[toSend[0].offsetDays]}`
              : `You have ${toSend.length} upcoming deadlines`;
          const text = toSend
            .map((d) => `- ${d.title} — ${OFFSET_LABEL[d.offsetDays]} (${d.date})`)
            .join("\n");
          const rows = toSend
            .map(
              (d) =>
                `<tr><td style="padding:7px 0; vertical-align:top; width:22px;">📅</td><td style="padding:7px 0;"><strong>${escapeHtml(d.title)}</strong><br/><span style="color:#8592a6;">${OFFSET_LABEL[d.offsetDays]} — ${escapeHtml(d.date)}${d.amount != null ? ` — $${d.amount.toLocaleString()}` : ""}</span></td></tr>`,
            )
            .join("");
          const html = emailShell({
            eyebrow: "Reminder",
            heading: toSend.length === 1 ? "Deadline coming up" : "Deadlines coming up",
            intro:
              toSend.length === 1
                ? `<strong>${escapeHtml(toSend[0].title)}</strong> is ${OFFSET_LABEL[toSend[0].offsetDays]}.`
                : `You have ${toSend.length} deadlines coming up:`,
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
            throw new Error(
              "SMS provider not configured (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM_NUMBER)",
            );
          }
          const body =
            toSend.length === 1
              ? `CorvusPT reminder: ${toSend[0].title} is ${OFFSET_LABEL[toSend[0].offsetDays]}.`
              : `CorvusPT: ${toSend.length} deadlines coming up — ` +
                toSend.map((d) => `${d.title} (${OFFSET_LABEL[d.offsetDays]})`).join("; ") +
                `. Details: ${appUrl}/dashboard/calendar`;

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

        remindersIncluded += toSend.length;
        await admin.from("reminder_sends").upsert(
          toSend.map((d) => ({
            user_id: profile.id,
            event_key: d.key,
            event_date: d.date,
            offset_days: d.offsetDays,
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
    JSON.stringify({ emailsSent, smsSent, remindersIncluded, skipped, failed: failures.length, failures }),
    { status: 200, headers: corsHeaders },
  );
});
