// Deploy via CLI: `supabase functions deploy manage-appointment`.
// The "Reschedule or cancel" link in the confirmation email. Public — the secret
// manage_token in the link is the only credential (the visitor has no account).
//   { token, action: "get" }                         → the appointment's details
//   { token, action: "cancel" }                      → cancels; the time opens up again
//   { token, action: "reschedule", date, slot }      → moves it, with the same rules as
//        booking (notice, weekdays, holidays, admin blocks, 2 hours between visits)
// Staff get a short email for every change; the visitor gets a fresh confirmation.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { escapeHtml } from "../_shared/email-shell.ts";
import { centralToUtcMs, slotKey, slotProblem } from "../_shared/appointment-rules.ts";
import { deleteMeetEvent, hostAccessToken, moveMeetEvent } from "../_shared/google-meet.ts";
import {
  STAFF_EMAIL,
  TEAM_EMAILS,
  cancellationEmail,
  confirmationEmail,
  inviteAttachment,
  kindLabel,
  sendEmail,
  whenText,
} from "../_shared/appointment-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const fail = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: corsHeaders });

// Central date + slot of a stored instant.
function centralParts(startIso: string): { date: string; slot: string } {
  const d = new Date(startIso);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(d);
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", hourCycle: "h23" }).format(d),
  );
  return { date, slot: slotKey(hour) };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail(405, "POST only");
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const token = String(body.token ?? "").trim();
    const action = String(body.action ?? "get");
    if (!/^[a-f0-9]{32}$/.test(token)) return fail(404, "This link isn't valid.");

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: appt, error } = await admin
      .from("appointments")
      .select("id, name, email, phone, meeting_type, start_at, status, google_event_id, meet_link")
      .eq("manage_token", token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!appt) return fail(404, "We couldn't find that appointment.");

    const { date, slot } = centralParts(appt.start_at as string);
    const summary = {
      name: appt.name,
      meetingType: appt.meeting_type,
      startAt: appt.start_at,
      date,
      slot,
      status: appt.status,
      // Past appointments can't be changed.
      canChange: appt.status === "booked" && new Date(appt.start_at as string).getTime() > Date.now(),
    };

    if (action === "get") {
      return new Response(JSON.stringify({ appointment: summary }), { status: 200, headers: corsHeaders });
    }
    if (!summary.canChange) {
      return fail(409, appt.status === "cancelled" ? "This appointment was already cancelled." : "This appointment has already happened.");
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const kind = kindLabel(appt.meeting_type as string);
    const oldWhen = whenText(date, slot);

    if (action === "cancel") {
      const { error: upErr } = await admin
        .from("appointments")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("id", appt.id);
      if (upErr) throw new Error(upErr.message);
      // Remove the Google event too (Google emails everyone the cancellation).
      let googleHandled = false;
      if (appt.google_event_id) {
        try {
          const gToken = await hostAccessToken(admin);
          if (gToken) {
            await deleteMeetEvent(gToken, appt.google_event_id as string);
            googleHandled = true;
          }
        } catch (e) {
          console.error("Google event delete failed:", e);
        }
      }
      const cancelInvite = inviteAttachment({
        appointmentId: appt.id as string,
        startIso: appt.start_at as string,
        meetingType: appt.meeting_type as string,
        visitor: { name: appt.name as string, email: appt.email as string, phone: appt.phone as string | null },
        token,
        meetLink: appt.meet_link as string | null,
        method: "CANCEL",
      });
      if (resendKey) {
        try {
          const m = cancellationEmail({ name: appt.name as string, when: oldWhen, meetingType: appt.meeting_type as string });
          await sendEmail(resendKey, [appt.email as string], m.subject, m.html, m.text, STAFF_EMAIL, googleHandled ? undefined : [cancelInvite]);
        } catch (e) {
          console.error("Cancellation email failed:", e);
        }
        try {
          const text = `Appointment CANCELLED by the visitor: ${oldWhen}\n${appt.name} <${appt.email}>\nType: ${kind}`;
          await sendEmail(resendKey, TEAM_EMAILS, `Cancelled — ${oldWhen} — ${appt.name}`, `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(text)}</pre>`, text, undefined, googleHandled ? undefined : [cancelInvite]);
        } catch (e) {
          console.error("Cancellation staff email failed:", e);
        }
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
    }

    if (action === "reschedule") {
      const newDate = String(body.date ?? "").trim();
      const newSlot = String(body.slot ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return fail(400, "Pick a new date.");
      const now = Date.now();

      const [{ data: booked }, { data: blocks }] = await Promise.all([
        admin.from("appointments").select("id, start_at").eq("status", "booked").gte("start_at", new Date(now - 86_400_000).toISOString()),
        admin.from("appointment_blocks").select("block_date, slot").eq("block_date", newDate),
      ]);
      const problem = slotProblem(
        newDate,
        newSlot,
        (booked ?? []).filter((b) => b.id !== appt.id).map((b) => ({ startMs: new Date(b.start_at as string).getTime() })),
        (blocks ?? []).map((b) => ({ date: b.block_date as string, slot: (b.slot as string | null) ?? null })),
        now,
      );
      if (problem) return fail(409, problem);
      if (newDate === date && newSlot === slot) return fail(409, "That's the time you already have.");

      const startIso = new Date(centralToUtcMs(newDate, Number(newSlot.slice(0, 2)))).toISOString();
      const { error: rpcErr } = await admin.rpc("reschedule_appointment", { p_token: token, p_start: startIso });
      if (rpcErr) {
        if (/slot_taken|slot_blocked|appointments_active_start_uniq/.test(rpcErr.message)) {
          return fail(409, "That time was just taken — please pick another.");
        }
        if (/not_found/.test(rpcErr.message)) return fail(409, "This appointment can't be changed any more.");
        throw new Error(rpcErr.message);
      }

      // Move the Google event too (Google emails everyone the new time).
      let googleMoved = false;
      if (appt.google_event_id) {
        try {
          const gToken = await hostAccessToken(admin);
          if (gToken) {
            await moveMeetEvent(gToken, appt.google_event_id as string, startIso);
            googleMoved = true;
          }
        } catch (e) {
          console.error("Google event move failed:", e);
        }
      }
      const newWhen = whenText(newDate, newSlot);
      const moveInvite = inviteAttachment({
        appointmentId: appt.id as string,
        startIso,
        meetingType: appt.meeting_type as string,
        visitor: { name: appt.name as string, email: appt.email as string, phone: appt.phone as string | null },
        token,
        meetLink: appt.meet_link as string | null,
      });
      if (resendKey) {
        try {
          const m = confirmationEmail({
            name: appt.name as string,
            when: newWhen,
            meetingType: appt.meeting_type as string,
            phone: (appt.phone as string) ?? "",
            token,
            startIso,
            meetLink: appt.meet_link as string | null,
            googleInvite: googleMoved,
            rescheduled: true,
          });
          await sendEmail(resendKey, [appt.email as string], m.subject, m.html, m.text, STAFF_EMAIL, googleMoved ? undefined : [moveInvite]);
        } catch (e) {
          console.error("Reschedule confirmation email failed:", e);
        }
        try {
          const text = `Appointment RESCHEDULED by the visitor:\nWas: ${oldWhen}\nNow: ${newWhen}\n${appt.name} <${appt.email}>${appt.phone ? ` · ${appt.phone}` : ""}\nType: ${kind}${appt.meeting_type === "virtual" ? `
To do: update the Google Meet time and re-send the link to ${appt.email}.` : ""}`;
          await sendEmail(resendKey, TEAM_EMAILS, `Rescheduled — now ${newWhen} — ${appt.name}`, `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(text)}</pre>`, text, appt.email as string, googleMoved ? undefined : [moveInvite]);
        } catch (e) {
          console.error("Reschedule staff email failed:", e);
        }
      }
      return new Response(JSON.stringify({ ok: true, startAt: startIso, date: newDate, slot: newSlot }), {
        status: 200,
        headers: corsHeaders,
      });
    }

    return fail(400, "Unknown action.");
  } catch (err) {
    return fail(500, err instanceof Error ? err.message : "Could not update the appointment.");
  }
});
