// Emails for "Schedule a Call or Google Meet" — shared by book-appointment and
// manage-appointment so a booking, a reschedule and a cancellation all read alike.
import { emailShell, escapeHtml } from "./email-shell.ts";
import { slotLabel } from "./appointment-rules.ts";
import { buildIcs, toBase64 } from "./appointment-ics.ts";

export const STAFF_EMAIL = "properties@srclandbuilding.com";
// Everyone on the team who is told about, and invited to, every appointment.
export const TEAM_EMAILS = [STAFF_EMAIL, "info@corvusre.com"];

// Where the manage page lives. APP_URL is not set as a secret today, so default to the
// real production address (the app is served under /corvuspt/).
export const appBaseUrl = () => (Deno.env.get("APP_URL") ?? "https://corvusre.com/corvuspt").replace(/\/$/, "");
export const manageUrl = (token: string) => `${appBaseUrl()}/appointment?token=${token}`;

export const longDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

export const whenText = (date: string, slot: string) =>
  `${longDate(date)} at ${slotLabel(slot)} Central Time`;

export const kindLabel = (meetingType: string) =>
  meetingType === "virtual" ? "Google Meet" : "phone call";

export type EmailAttachment = { filename: string; content: string; content_type: string };

export async function sendEmail(
  resendKey: string,
  to: string[],
  subject: string,
  html: string,
  text: string,
  replyTo?: string,
  attachments?: EmailAttachment[],
) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "CorvusPT <info@corvusre.com>",
      to,
      subject,
      html,
      text,
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(attachments?.length ? { attachments } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

// The visitor's confirmation — new booking or a reschedule. Always carries the
// "Reschedule or cancel" button.
export function confirmationEmail(opts: {
  name: string;
  when: string;
  meetingType: string;
  phone: string;
  token: string;
  startIso?: string;
  // The Google Meet link, when one was created (Google also emails its own invite).
  meetLink?: string | null;
  // True when Google itself is sending a calendar invite for this event (so ours is not attached).
  googleInvite?: boolean;
  rescheduled?: boolean;
}) {
  const kind = kindLabel(opts.meetingType);
  const url = manageUrl(opts.token);
  const how = opts.meetLink
    ? "Join with Google Meet at the time above:"
    : opts.meetingType === "virtual"
      ? "We'll email you the Google Meet link before your appointment."
      : `We'll call you at ${opts.phone}.`;
  const gcal = opts.startIso && !opts.googleInvite ? googleCalendarUrl(opts.startIso, kind, opts.name, opts.meetingType, url, opts.meetLink) : null;
  const html = emailShell({
    eyebrow: opts.rescheduled ? "Appointment rescheduled" : "Appointment confirmed",
    heading: opts.rescheduled ? "You're rebooked" : "You're booked",
    intro: `${opts.rescheduled ? "Your appointment has moved." : "Thanks,"} ${escapeHtml(opts.name)} — we'll see you on <strong>${escapeHtml(opts.when)}</strong> for a 60-minute ${kind}.`,
    bodyRows:
      `<tr><td style="padding:7px 0;">${escapeHtml(how)}${opts.meetLink ? ` <a href="${escapeHtml(opts.meetLink)}" style="color:#0f9d6b; font-weight:600;">${escapeHtml(opts.meetLink)}</a>` : ""}</td></tr>` +
      (opts.googleInvite
        ? `<tr><td style="padding:7px 0;">A Google Calendar invite with this link is also on its way from Google.</td></tr>`
        : "") +
      (gcal
        ? `<tr><td style="padding:7px 0;">A calendar invite is attached. Not showing up? <a href="${escapeHtml(gcal)}" style="color:#0f9d6b;">Add it to Google Calendar</a>.</td></tr>`
        : "") +
      `<tr><td style="padding:7px 0; color:#8592a6;">Plans changed? Use the button below to pick a new time or cancel — no phone call needed.</td></tr>`,
    ctaLabel: "Reschedule or cancel",
    ctaHref: url,
    footnote: "You received this because you booked an appointment on CorvusPT.",
  });
  const text =
    `${opts.rescheduled ? "Your appointment has moved" : "You're booked"}: ${opts.when} (60-minute ${kind}).\n${how}${opts.meetLink ? ` ${opts.meetLink}` : ""}\n` +
    (gcal ? `Add to Google Calendar: ${gcal}
` : "") +
    `Need to change it? Reschedule or cancel here: ${url}`;
  return {
    subject: `${opts.rescheduled ? "Rescheduled" : "Booked"}: your CorvusPT ${kind} — ${opts.when}`,
    html,
    text,
  };
}

export function cancellationEmail(opts: { name: string; when: string; meetingType: string }) {
  const kind = kindLabel(opts.meetingType);
  const book = `${appBaseUrl()}/contact`;
  const html = emailShell({
    eyebrow: "Appointment cancelled",
    heading: "Your appointment is cancelled",
    intro: `${escapeHtml(opts.name)}, your ${kind} on <strong>${escapeHtml(opts.when)}</strong> has been cancelled.`,
    bodyRows: `<tr><td style="padding:7px 0; color:#8592a6;">Want to talk another time? You can book a new appointment any time.</td></tr>`,
    ctaLabel: "Book a new time",
    ctaHref: book,
  });
  return {
    subject: `Cancelled: your CorvusPT ${kind} on ${opts.when}`,
    html,
    text: `Your ${kind} on ${opts.when} is cancelled. Book a new time: ${book}`,
  };
}

// The calendar invite attached to every appointment email (booking, reschedule, and
// cancellation), for both the visitor and staff. Same UID each time, so a reschedule
// replaces the event and a cancellation removes it.
export function inviteAttachment(opts: {
  appointmentId: string;
  startIso: string;
  meetingType: string;
  visitor: { name: string; email: string; phone?: string | null };
  token: string;
  meetLink?: string | null;
  method?: "REQUEST" | "CANCEL";
}): EmailAttachment {
  const startMs = new Date(opts.startIso).getTime();
  const virtual = opts.meetingType === "virtual";
  const method = opts.method ?? "REQUEST";
  const ics = buildIcs({
    uid: `${opts.appointmentId}@corvusre.com`,
    startMs,
    endMs: startMs + 60 * 60_000,
    summary: `CorvusPT — ${virtual ? "Google Meet" : "phone call"} with ${opts.visitor.name}`,
    description:
      (virtual
        ? opts.meetLink
          ? `Join with Google Meet: ${opts.meetLink}`
          : "Google Meet — the link will be emailed before the meeting."
        : `Phone call to ${opts.visitor.phone ?? "the number on file"}.`) +
      `
Reschedule or cancel: ${manageUrl(opts.token)}`,
    location: virtual ? (opts.meetLink ?? "Google Meet (link to follow)") : "Phone call",
    url: opts.meetLink ?? manageUrl(opts.token),
    organizerEmail: STAFF_EMAIL,
    organizerName: "CorvusPT",
    attendees: [
      { email: opts.visitor.email, name: opts.visitor.name },
      ...TEAM_EMAILS.map((email) => ({ email, name: "CorvusPT team" })),
    ],
    method,
  });
  return {
    filename: "invite.ics",
    content: toBase64(ics),
    content_type: `text/calendar; charset=UTF-8; method=${method}`,
  };
}

// A "add to Google Calendar" link — the fallback for mail apps that do not turn the
// attached invite into a calendar entry on their own.
function googleCalendarUrl(startIso: string, kind: string, name: string, meetingType: string, manage: string, meetLink?: string | null): string {
  const start = new Date(startIso).getTime();
  const f = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: `CorvusPT — ${kind} with ${name}`,
    dates: `${f(start)}/${f(start + 60 * 60_000)}`,
    details:
      (meetingType === "virtual" ? (meetLink ? `Join with Google Meet: ${meetLink}` : "Google Meet — the link will be emailed before the meeting.") : "Phone call.") +
      `
Reschedule or cancel: ${manage}`,
    location: meetingType === "virtual" ? (meetLink ?? "Google Meet (link to follow)") : "Phone call",
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

// The standing meeting link an admin saved (used when no Google host creates a fresh one).
export async function standingMeetLink(admin: { from: (t: string) => any }): Promise<string | null> {
  const { data } = await admin.from("appointment_settings").select("meeting_link").eq("id", true).maybeSingle();
  const link = (data?.meeting_link as string | null | undefined)?.trim();
  return link ? link : null;
}
