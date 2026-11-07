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
// Property-tax PAYMENTS (Nov 2026 — a bill's due date, a plan installment, a
// property's own due date; isPaymentEventKey) get their own schedule: 30, 15,
// 7, 2 and 1 days before, on the day, and once the day after it's missed
// ("past due"). The offsets the user turned off in Settings stay off; 1 day
// before and past due aren't in that list, so they're always on. Each payment
// in an email carries "Remind me later" / "Already paid" buttons — a one-use
// token (payment_reminder_links) opening /payment-reminder in the app, which
// asks for a click before acting (mail scanners open links). "Remind me later"
// snoozes that payment's reminders for 24 hours (payment_reminder_snoozes),
// then it's reminded again: a second cron job calls this function hourly with
// {"mode":"snoozes"}, which sends ONLY those snoozed follow-ups, so the next
// reminder lands ~24h later, not at tomorrow's daily run. "Already paid"
// marks the bill/installment paid (owner-reported), which resolves the event.
//
// Reminders are computed fresh from each event's CURRENT date every run —
// there is no stored "reminder schedule" to go stale. If a hearing date
// moves, tomorrow's run just measures days-until-the-new-date and the
// schedule has already "updated" with no migration needed. reminder_sends
// (schema.sql) only exists to stop the SAME (event, date, offset, channel)
// firing twice; because it's keyed on the date too, a changed date can't
// collide with an old date's dedup rows, so a rescheduled event gets its
// full run over again from wherever it now lands. Snoozed follow-ups are
// deduped by payment_reminder_snoozes.reminded_at instead (a payment can be
// snoozed again and again).
//
// One message per user per channel, not per event — bundles every event due
// that day into a single email and a single SMS, same reasoning as
// send-evidence-reminders (a customer with several properties otherwise
// gets spammed with near-identical messages the same morning).
//
// Email requires RESEND_API_KEY (already configured — same key every other
// transactional email here uses). SMS goes through Telnyx (_shared/telnyx.ts
// sendReminderSms), the same account marketing texts use; until its 10DLC
// registration is approved a send fails and is logged per run, never claimed
// as sent. The Settings UI keeps the SMS toggle "coming soon" until then. A
// STOP reply turns deadline_reminders_sms off (handlers/marketing-events).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { appBaseUrl } from "../_shared/app-url.ts";
import { isServiceRoleRequest, serviceRoleOnlyResponse } from "../_shared/service-role-only.ts";
import { emailShell, escapeHtml } from "../_shared/email-shell.ts";
import { sendReminderSms } from "../_shared/telnyx.ts";
import {
  buildDeadlineEvents,
  isPaymentEventKey,
  type DeadlineEvent,
} from "../_shared/deadline-events.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

// The full default-on set — also the only valid offsets, so a stray/garbage
// value in a user's stored preference (never trusted from the client) can't
// sneak in a reminder point that doesn't exist anywhere else in the system.
const ALL_OFFSETS = [30, 15, 7, 3, 2, 0] as const;
// Tax payments: 30/15/7/2/1 days before, the day itself, and the day after
// (past due). 1 and -1 aren't user-selectable, so they're always on.
const PAYMENT_OFFSETS = [30, 15, 7, 2, 1, 0, -1] as const;
const OFFSET_LABEL: Record<number, string> = {
  30: "in 30 days",
  15: "in 15 days",
  7: "in 7 days",
  3: "in 3 days",
  2: "in 2 days",
  1: "tomorrow",
  0: "today",
};
const SNOOZE_MS = 24 * 60 * 60 * 1000;
const LINK_TTL_MS = 60 * 24 * 60 * 60 * 1000;

type DueItem = DeadlineEvent & { offsetDays: number; snoozed?: boolean; actionUrl?: string };
type Channel = "email" | "sms";

function whenLabel(d: DueItem): string {
  if (d.offsetDays < 0) return d.offsetDays === -1 ? "past due since yesterday" : "past due";
  return OFFSET_LABEL[d.offsetDays] ?? `in ${d.offsetDays} days`;
}

// "Protest deadline — 1800 Market Place Blvd" due today ->
// "Protest deadline today — 1800 Market Place Blvd"; a reminder note keeps
// its headline and only says when if it isn't today.
function shortSubject(d: DueItem): string {
  const when = whenLabel(d);
  if (d.isReminder) return d.offsetDays === 0 ? d.subject : `${d.subject} (${when})`;
  const [what, ...where] = d.subject.split(" — ");
  return where.length ? `${what} ${when} — ${where.join(" — ")}` : `${what} ${when}`;
}

function daysUntil(date: string, today: Date): number {
  const eventDate = new Date(`${date}T00:00:00Z`);
  return Math.round((eventDate.getTime() - today.getTime()) / 86_400_000);
}

const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

// The two buttons under a payment in the email.
function paymentButtons(url: string): string {
  const btn = (label: string, href: string, primary: boolean) =>
    `<a href="${escapeHtml(href)}" style="display:inline-block; margin:6px 8px 0 0; padding:7px 14px; border-radius:8px; font-size:13px; font-weight:600; text-decoration:none; ${
      primary
        ? "background-color:#0f7a4f; color:#ffffff;"
        : "background-color:#ffffff; color:#16233a; border:1px solid #c9d2dc;"
    }">${label}</a>`;
  return btn("Already paid", `${url}&a=paid`, true) + btn("Remind me later", `${url}&a=later`, false);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!isServiceRoleRequest(req)) return serviceRoleOnlyResponse(corsHeaders);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const appUrl = appBaseUrl();
  const admin = createClient(supabaseUrl, serviceKey);

  let mode: "daily" | "snoozes" = "daily";
  try {
    const body = (await req.json()) as { mode?: unknown };
    if (body?.mode === "snoozes") mode = "snoozes";
  } catch {
    // no body — the daily run
  }
  const now = new Date();

  // Snoozes whose 24 hours are up and haven't been followed up yet.
  const { data: dueSnoozeRows } = await admin
    .from("payment_reminder_snoozes")
    .select("user_id, event_key")
    .lte("snoozed_until", now.toISOString())
    .is("reminded_at", null);
  const snoozeUsers = new Set((dueSnoozeRows ?? []).map((r) => r.user_id as string));
  if (mode === "snoozes" && snoozeUsers.size === 0) {
    return new Response(JSON.stringify({ mode, emailsSent: 0, smsSent: 0, remindersIncluded: 0 }), {
      status: 200,
      headers: corsHeaders,
    });
  }

  let profileQuery = admin.from("profiles").select("id, phone, notification_prefs, unsubscribe_token");
  if (mode === "snoozes") profileQuery = profileQuery.in("id", [...snoozeUsers]);
  const { data: profiles, error } = await profileQuery;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  const todayIso = now.toISOString().slice(0, 10);
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
    const paymentOffsets: number[] = PAYMENT_OFFSETS.filter(
      (o) => !(ALL_OFFSETS as readonly number[]).includes(o) || selectedOffsets.includes(o),
    );

    let events: DeadlineEvent[];
    let snoozes: { event_key: string; snoozed_until: string; reminded_at: string | null }[];
    try {
      events = await buildDeadlineEvents(admin, profile.id);
      const { data } = await admin
        .from("payment_reminder_snoozes")
        .select("event_key, snoozed_until, reminded_at")
        .eq("user_id", profile.id);
      snoozes = data ?? [];
    } catch (err) {
      failures.push({
        userId: profile.id,
        message: `could not read calendar: ${err instanceof Error ? err.message : "unknown error"}`,
      });
      continue;
    }
    const snoozedNow = new Set(
      snoozes.filter((s) => new Date(s.snoozed_until) > now).map((s) => s.event_key),
    );
    const snoozeDue = new Set(
      snoozes
        .filter((s) => new Date(s.snoozed_until) <= now && !s.reminded_at)
        .map((s) => s.event_key),
    );

    const due: DueItem[] = [];
    for (const ev of events) {
      if (ev.resolved) continue;
      const offsetDays = daysUntil(ev.date, today);
      if (isPaymentEventKey(ev.key)) {
        if (snoozedNow.has(ev.key)) continue; // "remind me later" — not yet
        if (snoozeDue.has(ev.key)) {
          due.push({ ...ev, offsetDays, snoozed: true });
          continue;
        }
        if (mode === "daily" && paymentOffsets.includes(offsetDays)) due.push({ ...ev, offsetDays });
      } else if (mode === "daily" && selectedOffsets.includes(offsetDays)) {
        due.push({ ...ev, offsetDays });
      }
    }
    // A snooze whose payment has since been paid (or removed) has nothing left
    // to follow up — close it so the hourly run stops picking this user up.
    const settled = [...snoozeDue].filter((k) => !due.some((d) => d.key === k));
    if (settled.length > 0) {
      await admin
        .from("payment_reminder_snoozes")
        .update({ reminded_at: now.toISOString() })
        .eq("user_id", profile.id)
        .in("event_key", settled);
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
    const isNew = (d: DueItem, channel: Channel) =>
      d.snoozed || !sentSet.has(`${d.key}|${d.date}|${d.offsetDays}|${channel}`);
    if (!due.some((d) => isNew(d, "email") || isNew(d, "sms"))) {
      skipped++;
      continue;
    }

    // One "Remind me later / Already paid" link per payment in this message.
    const payments = due.filter((d) => isPaymentEventKey(d.key));
    if (payments.length > 0) {
      const links = payments.map((d) => ({
        token: crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, ""),
        user_id: profile.id,
        event_key: d.key,
        event_date: d.date,
        title: d.title.slice(0, 300),
        amount: d.amount,
        expires_at: new Date(now.getTime() + LINK_TTL_MS).toISOString(),
      }));
      const { error: linkErr } = await admin.from("payment_reminder_links").insert(links);
      if (!linkErr) {
        payments.forEach((d, i) => {
          d.actionUrl = `${appUrl}/payment-reminder?t=${links[i].token}`;
        });
      }
    }

    const channels: Channel[] = [];
    if (emailEnabled) channels.push("email");
    if (smsEnabled) channels.push("sms");

    let anySent = false;
    for (const channel of channels) {
      const toSend = due.filter((d) => isNew(d, channel));
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

          // Short subjects: "Protest deadline today — 1800 Market Place Blvd",
          // "Property base data updated — 1800 Market Place Blvd". The full
          // text is in the body.
          const one = toSend.length === 1 ? toSend[0] : null;
          const allReminders = toSend.every((d) => d.isReminder);
          const allPayments = toSend.every((d) => isPaymentEventKey(d.key));
          const anyPastDue = toSend.some((d) => isPaymentEventKey(d.key) && d.offsetDays < 0);
          const subject = one
            ? shortSubject(one)
            : allPayments
              ? `${toSend.length} property tax payments ${anyPastDue ? "need attention" : "coming up"}`
              : `You have ${toSend.length} upcoming ${allReminders ? "reminders" : "deadlines"}`;
          const text = toSend
            .map(
              (d) =>
                `- ${d.title} — ${whenLabel(d)} (${d.date})${
                  d.actionUrl ? `\n  Already paid or remind me later: ${d.actionUrl}` : ""
                }`,
            )
            .join("\n");
          const rows = toSend
            .map(
              (d) =>
                `<tr><td style="padding:9px 0; vertical-align:top; width:22px;">${d.offsetDays < 0 && isPaymentEventKey(d.key) ? "⚠️" : "📅"}</td><td style="padding:9px 0;"><strong>${escapeHtml(d.title)}</strong><br/><span style="color:${d.offsetDays < 0 ? "#b42318" : "#8592a6"};">${whenLabel(d)} — ${escapeHtml(d.date)}${d.amount != null ? ` — ${money(d.amount)}` : ""}</span>${d.actionUrl ? `<br/>${paymentButtons(d.actionUrl)}` : ""}</td></tr>`,
            )
            .join("");
          const onePayment = one && isPaymentEventKey(one.key);
          const html = emailShell({
            eyebrow: "Reminder",
            heading: allReminders
              ? one ? "Reminder" : "Reminders"
              : allPayments
                ? anyPastDue
                  ? one ? "Property tax payment past due" : "Property tax payments need attention"
                  : one ? "Property tax payment coming up" : "Property tax payments coming up"
                : one ? "Deadline coming up" : "Deadlines coming up",
            intro: one
              ? one.isReminder
                ? escapeHtml(one.title)
                : `<strong>${escapeHtml(one.title)}</strong> is ${whenLabel(one)} — ${escapeHtml(one.date)}${one.amount != null ? ` — ${money(one.amount)}` : ""}.${
                    onePayment && one.actionUrl
                      ? `<br/>${paymentButtons(one.actionUrl)}<br/><span style="font-size:12px; color:#8592a6;">“Remind me later” pauses this reminder for 24 hours.</span>`
                      : ""
                  }`
              : `You have ${toSend.length} ${allReminders ? "reminders" : allPayments ? "property tax payments" : "deadlines"} ${anyPastDue ? "that need attention" : "coming up"}:`,
            // one item is fully in the intro — the card would only repeat it
            bodyRows: one ? undefined : rows,
            ctaLabel: allPayments ? "Open Pay Taxes" : "Open Calendar",
            ctaHref: allPayments ? `${appUrl}/dashboard/pay-taxes` : `${appUrl}/dashboard/calendar`,
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
          const firstAction = toSend.find((d) => d.actionUrl)?.actionUrl;
          const body =
            (toSend.length === 1
              ? `CorvusPT: ${shortSubject(toSend[0])}.`
              : `CorvusPT: ${toSend.length} deadlines — ` +
                toSend.map((d) => `${d.title} (${whenLabel(d)})`).join("; ") +
                ".") +
            (firstAction && toSend.length === 1
              ? ` Paid, or remind me later: ${firstAction}`
              : ` Details: ${appUrl}/dashboard/${toSend.every((d) => isPaymentEventKey(d.key)) ? "pay-taxes" : "calendar"}`);

          await sendReminderSms(profile.phone as string, body);
          smsSent++;
        }

        anySent = true;
        remindersIncluded += toSend.length;
        const logged = toSend.filter((d) => !d.snoozed);
        if (logged.length > 0) {
          await admin.from("reminder_sends").upsert(
            logged.map((d) => ({
              user_id: profile.id,
              event_key: d.key,
              event_date: d.date,
              offset_days: d.offsetDays,
              channel,
            })),
            { onConflict: "user_id,event_key,event_date,offset_days,channel", ignoreDuplicates: true },
          );
        }
      } catch (err) {
        failures.push({
          userId: profile.id,
          channel,
          message: err instanceof Error ? err.message : "unknown error",
        });
      }
    }

    // A snoozed payment is followed up once; "Remind me later" again re-arms it.
    const followedUp = due.filter((d) => d.snoozed).map((d) => d.key);
    if (anySent && followedUp.length > 0) {
      await admin
        .from("payment_reminder_snoozes")
        .update({ reminded_at: now.toISOString() })
        .eq("user_id", profile.id)
        .in("event_key", followedUp);
    }
  }

  return new Response(
    JSON.stringify({ mode, emailsSent, smsSent, remindersIncluded, skipped, failed: failures.length, failures }),
    { status: 200, headers: corsHeaders },
  );
});
