// Deploy via CLI: `supabase functions deploy book-appointment`.
// Books a 60-minute phone call / Google Meet. Public (works signed-out; a signed-in
// caller's account is attached). The slot is re-validated here against the same rules
// appointment-slots uses, then book_appointment() (schema.sql) takes it under a lock
// so two people can never double-book or land within 2 hours of each other.
//
// On success: a confirmation email to the visitor and a "new appointment" email to
// staff (Resend, same key as every other transactional email). The appointment also
// shows up immediately on the Admin dashboard → Appointments tab.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { escapeHtml } from "../_shared/email-shell.ts";
import { centralToUtcMs, slotProblem } from "../_shared/appointment-rules.ts";
import { createMeetEvent, hostAccessToken } from "../_shared/google-meet.ts";
import {
  TEAM_EMAILS,
  confirmationEmail,
  inviteAttachment,
  kindLabel,
  longDate,
  manageUrl,
  sendEmail,
  whenText,
} from "../_shared/appointment-email.ts";
import { slotLabel } from "../_shared/appointment-rules.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const MAX_ACTIVE_PER_EMAIL = 2;

const fail = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: corsHeaders });


Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail(405, "POST only");

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const str = (k: string, max: number) => String(body[k] ?? "").trim().slice(0, max);

    // Honeypot: real people never fill this hidden field.
    if (str("website", 200)) return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });

    const name = str("name", 120);
    const email = str("email", 200).toLowerCase();
    const phone = str("phone", 40);
    const notes = str("notes", 1000);
    const date = str("date", 10);
    const slot = str("slot", 5);
    // Every appointment is a Google Meet.
    const meetingType = "virtual";

    if (!name) return fail(400, "Please enter your name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(400, "Please enter a valid email address.");
    if (meetingType === "call" && !phone) return fail(400, "Please add a phone number so we can call you.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(400, "Pick a date.");

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const now = Date.now();

    // Attach the account if a signed-in customer booked (the anon key just fails this).
    let userId: string | null = null;
    try {
      const authHeader = req.headers.get("Authorization") ?? "";
      const callerClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data } = await callerClient.auth.getUser();
      userId = data.user?.id ?? null;
    } catch {
      // signed out — fine
    }

    const [{ data: booked }, { data: blocks }, { data: mine }] = await Promise.all([
      admin.from("appointments").select("start_at").eq("status", "booked").gte("start_at", new Date(now - 86_400_000).toISOString()),
      admin.from("appointment_blocks").select("block_date, slot").eq("block_date", date),
      admin.from("appointments").select("id").eq("status", "booked").eq("email", email).gte("start_at", new Date(now).toISOString()),
    ]);
    if ((mine ?? []).length >= MAX_ACTIVE_PER_EMAIL) {
      return fail(409, `You already have ${MAX_ACTIVE_PER_EMAIL} upcoming appointments. Please call us to change one.`);
    }

    const problem = slotProblem(
      date,
      slot,
      (booked ?? []).map((b) => ({ startMs: new Date(b.start_at as string).getTime() })),
      (blocks ?? []).map((b) => ({ date: b.block_date as string, slot: (b.slot as string | null) ?? null })),
      now,
    );
    if (problem) return fail(409, problem);

    const startIso = new Date(centralToUtcMs(date, Number(slot.slice(0, 2)))).toISOString();
    const { data: id, error } = await admin.rpc("book_appointment", {
      p_name: name,
      p_email: email,
      p_phone: phone || null,
      p_meeting_type: meetingType,
      p_notes: notes || null,
      p_user_id: userId,
      p_start: startIso,
    });
    if (error) {
      if (/slot_taken|slot_blocked|appointments_active_start_uniq/.test(error.message)) {
        return fail(409, "That time was just taken — please pick another.");
      }
      throw new Error(error.message);
    }

    const { data: row } = await admin.from("appointments").select("manage_token").eq("id", id).single();
    const token = (row?.manage_token as string | undefined) ?? "";

    // Every appointment gets a Google Meet: an event on the host's Google account, which
    // Google emails to everyone as an invite. If no host is connected (or Google errors),
    // the booking still stands and the emailed calendar file is used instead.
    let meetLink: string | null = null;
    let googleEventId: string | null = null;
    try {
      const gToken = await hostAccessToken(admin);
      if (gToken) {
        const ev = await createMeetEvent(gToken, {
          startIso,
          summary: `CorvusPT — Google Meet with ${name}`,
          description:
            `Booked on CorvusPT by ${name} <${email}>${phone ? ` · ${phone}` : ""}.\n` +
            (notes ? `Notes: ${notes}\n` : "") +
            `Reschedule or cancel: ${manageUrl(token)}`,
          attendees: [email, ...TEAM_EMAILS],
          requestId: id as string,
        });
        googleEventId = ev.eventId;
        meetLink = ev.meetLink;
        await admin.from("appointments").update({ google_event_id: googleEventId, meet_link: meetLink }).eq("id", id);
      }
    } catch (err) {
      console.error("Google Meet creation failed:", err);
    }

    // Emails are best-effort: the booking already exists and is on the admin dashboard.
    const resendKey = Deno.env.get("RESEND_API_KEY");
    let emailed = false;
    if (resendKey) {
      const when = whenText(date, slot);
      const kind = kindLabel(meetingType);
      const invite = inviteAttachment({
        appointmentId: id as string,
        startIso,
        meetingType,
        visitor: { name, email, phone },
        token,
      });
      try {
        const m = confirmationEmail({ name, when, meetingType, phone, token, startIso, meetLink });
        await sendEmail(resendKey, [email], m.subject, m.html, m.text, undefined, googleEventId ? undefined : [invite]);
        emailed = true;
      } catch (err) {
        console.error("Appointment confirmation email failed:", err);
      }
      try {
        const text = `New appointment: ${when}
${name} <${email}>${phone ? ` · ${phone}` : ""}
Type: ${kind}${meetLink ? `\nMeet link: ${meetLink}` : `\nTo do: create the Google Meet and email the link to ${email} (no Google host is connected yet).`}
${notes ? `Notes: ${notes}` : ""}`;
        await sendEmail(
          resendKey,
          TEAM_EMAILS,
          `New appointment — ${longDate(date)}, ${slotLabel(slot)} CT — ${name}`,
          `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(text)}</pre>`,
          text,
          email,
          googleEventId ? undefined : [invite],
        );
      } catch (err) {
        console.error("Appointment staff email failed:", err);
      }
    }

    return new Response(JSON.stringify({ ok: true, id, emailed, start: startIso, meetLink }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    return fail(500, err instanceof Error ? err.message : "Could not book the appointment.");
  }
});
