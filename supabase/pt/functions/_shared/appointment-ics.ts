// A calendar invite (iCalendar / .ics) for an appointment, so the confirmation email
// lands on the person's calendar (Gmail / Outlook / Apple show an "Add to calendar" or
// RSVP card for an attached text/calendar part). Pure — no I/O.
//
// One UID per appointment (its id), so a reschedule REPLACES the earlier event and a
// cancellation removes it — the SEQUENCE just has to increase, and the current Unix
// time does that without storing anything.

const esc = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");

// RFC 5545 §3.1: lines are folded at 75 octets; continuation lines start with a space.
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    const limit = out.length === 0 ? 75 : 74; // continuation lines lose one octet to the space
    if (enc.encode(cur + ch).length > limit) {
      out.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.join("\r\n ");
}

const utc = (ms: number) =>
  new Date(ms)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

export type InviteInput = {
  uid: string; // stable per appointment
  startMs: number;
  endMs: number;
  summary: string;
  description: string;
  location: string;
  url: string;
  organizerEmail: string;
  organizerName: string;
  attendees: { email: string; name?: string }[];
  method: "REQUEST" | "CANCEL";
  nowMs?: number;
};

export function buildIcs(i: InviteInput): string {
  const now = i.nowMs ?? Date.now();
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//CorvusPT//Appointments//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `METHOD:${i.method}`,
    "BEGIN:VEVENT",
    `UID:${i.uid}`,
    `DTSTAMP:${utc(now)}`,
    `DTSTART:${utc(i.startMs)}`,
    `DTEND:${utc(i.endMs)}`,
    `SEQUENCE:${Math.floor(now / 1000)}`,
    `SUMMARY:${esc(i.summary)}`,
    `DESCRIPTION:${esc(i.description)}`,
    `LOCATION:${esc(i.location)}`,
    `URL:${i.url}`,
    `ORGANIZER;CN=${esc(i.organizerName)}:mailto:${i.organizerEmail}`,
    ...i.attendees.map(
      (a) =>
        `ATTENDEE;CN=${esc(a.name ?? a.email)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:${a.email}`,
    ),
    `STATUS:${i.method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    "TRANSP:OPAQUE",
  ];
  if (i.method === "REQUEST") {
    // A reminder 15 minutes before.
    lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(i.summary)}`, "TRIGGER:-PT15M", "END:VALARM");
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

// UTF-8 text → base64 (what the email API's attachment `content` wants).
export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
