// Deploy via CLI: `supabase functions deploy send-evidence-reminders`
// (JWT-verified — only pg_cron, calling with the service-role key as Bearer
// auth, is meant to trigger this; same pattern as refresh-property-base-data
// / google-calendar-sync).
//
// Daily: for every "evidence" protest_form_submissions row that isn't yet
// confirmed with the county and hasn't opted out (reminder_frequency !=
// 'off'), sends a reminder email once it's actually due per that row's own
// frequency (daily/weekly) and last_reminder_sent_at — never more than once
// per real cadence, and never for a case that already confirmed or
// rejected/needs-more (filing_confirmed_at is null covers "not done";
// additional_requested/rejected still count as "not done" and keep getting
// reminded, which is correct — there's still real work outstanding).
//
// One email per USER, not per row — a customer with several properties (or
// BPP accounts) all due the same day previously got one separate email per
// property, which read as spam rather than a single clear to-do list. Every
// due row for that user is grouped into one email; a send failure leaves
// every row in that group unmarked (none of them silently counts as
// reminded if the email never went out).
//
// Requires the RESEND_API_KEY secret. Without it, this still runs on
// schedule and records a clear per-user failure — it never marks
// last_reminder_sent_at or claims success for a message it didn't actually
// send.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const MS_PER_DAY = 86_400_000;
// A minute of slack so a cron run that lands a little early/late each day
// doesn't skip a row that's genuinely due.
const DUE_AFTER_MS: Record<string, number> = {
  daily: MS_PER_DAY - 60_000,
  weekly: 7 * MS_PER_DAY - 60_000,
};

function isDue(frequency: string | null, lastSentAt: string | null): boolean {
  const freq = frequency ?? "daily";
  if (freq === "off") return false;
  if (!lastSentAt) return true;
  const elapsed = Date.now() - new Date(lastSentAt).getTime();
  return elapsed >= (DUE_AFTER_MS[freq] ?? DUE_AFTER_MS.daily);
}

type DueItem = { rowId: string; protestId: string; label: string; deadline: string | null };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const admin = createClient(supabaseUrl, serviceKey);

  // properties/bpp_accounts are plain (not !inner) joins — a BPP protest has
  // no property_id (see protests_subject_check in schema.sql), so an !inner
  // join on properties silently dropped every BPP evidence row from this
  // query entirely. Both are read and whichever is non-null wins below.
  const { data: rows, error } = await admin
    .from("protest_form_submissions")
    .select(
      "id, protest_id, user_id, reminder_frequency, last_reminder_sent_at, protests!inner(property_id, bpp_account_id, properties(address, protest_deadline), bpp_accounts(business_name, protest_deadline))",
    )
    .eq("form_type", "evidence")
    .is("filing_confirmed_at", null)
    .neq("reminder_frequency", "off");

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  // Group every DUE row by user, so each user gets exactly one email
  // regardless of how many properties/BPP accounts still need evidence.
  const byUser = new Map<string, DueItem[]>();
  let skipped = 0;
  for (const row of rows ?? []) {
    if (!isDue(row.reminder_frequency, row.last_reminder_sent_at)) {
      skipped++;
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const protestRow = (row as any).protests;
    const property = protestRow?.properties;
    const bppAccount = protestRow?.bpp_accounts;
    const label: string = property?.address ?? bppAccount?.business_name ?? "your case";
    const deadline: string | null =
      property?.protest_deadline ?? bppAccount?.protest_deadline ?? null;

    const items = byUser.get(row.user_id) ?? [];
    items.push({ rowId: row.id, protestId: row.protest_id, label, deadline });
    byUser.set(row.user_id, items);
  }

  let sent = 0;
  let remindersIncluded = 0;
  const failures: { userId: string; protestIds: string[]; message: string }[] = [];

  for (const [userId, items] of byUser) {
    try {
      if (!resendKey) throw new Error("RESEND_API_KEY is not configured");

      const { data: userData, error: userErr } = await admin.auth.admin.getUserById(userId);
      const to = userData?.user?.email;
      if (userErr || !to) throw new Error(userErr?.message ?? "No email on file for this user");

      const subject =
        items.length === 1
          ? `Reminder: submit your evidence for ${items[0].label}`
          : `Reminder: submit your evidence for ${items.length} properties`;
      const lines = items
        .map((it) => `- ${it.label}${it.deadline ? ` (deadline: ${it.deadline})` : ""}`)
        .join("\n");
      const text =
        (items.length === 1
          ? `Your evidence for ${items[0].label} hasn't been marked submitted yet.`
          : `Evidence hasn't been marked submitted yet for ${items.length} of your cases:`) +
        `\n\n${lines}\n\n` +
        `Open CorvusPT, go to View Case, and use Generate Evidence Package to finish each one.`;

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "CorvusPT <onboarding@resend.dev>",
          to: [to],
          subject,
          text,
        }),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);

      await admin
        .from("protest_form_submissions")
        .update({ last_reminder_sent_at: new Date().toISOString() })
        .in(
          "id",
          items.map((it) => it.rowId),
        );
      sent++;
      remindersIncluded += items.length;
    } catch (err) {
      failures.push({
        userId,
        protestIds: items.map((it) => it.protestId),
        message: err instanceof Error ? err.message : "unknown error",
      });
    }
  }

  return new Response(
    JSON.stringify({ sent, remindersIncluded, skipped, failed: failures.length, failures }),
    { status: 200, headers: corsHeaders },
  );
});
