// Informal Review: how to reach the district, and how to join the meeting
// once it's scheduled (video link, phone number or address — by mode).
import { CalendarCheck, Mail, MapPin, Phone, Video } from "lucide-react";
import { mapsHref, telHref, type InformalContact } from "@/lib/county-protest-info";
import type { ProtestRecord } from "@/lib/protests";

const chip =
  "inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-accent hover:text-accent";

function PhoneLink({ phone }: { phone: string }) {
  const href = telHref(phone);
  return href ? (
    <a href={href} className={chip}>
      <Phone className="h-3.5 w-3.5" /> Call {phone}
    </a>
  ) : (
    <span className="text-xs">{phone}</span>
  );
}

// Email links open in a new tab: when the browser hands mailto: to webmail
// (Gmail, Outlook on the web) the same tab would leave the case.
function EmailLink({ email }: { email: string }) {
  return (
    <a href={`mailto:${email}`} target="_blank" rel="noopener noreferrer" className={chip}>
      <Mail className="h-3.5 w-3.5" /> Email {email}
    </a>
  );
}

export function CountyInformalContact({
  cad,
  contact,
  howToRequest,
}: {
  cad: string;
  contact: InformalContact;
  howToRequest: string | null;
}) {
  return (
    <div className="mt-3 rounded-md border border-border p-3">
      <div className="text-xs font-semibold text-foreground">Contact {cad}</div>
      {howToRequest && <p className="mt-0.5 text-[11px] text-muted-foreground">{howToRequest}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {contact.bookingUrl && (
          <a href={contact.bookingUrl} target="_blank" rel="noopener noreferrer" className={chip}>
            <CalendarCheck className="h-3.5 w-3.5" /> Book online
          </a>
        )}
        {contact.phones.map((p) => (
          <PhoneLink key={p} phone={p} />
        ))}
        {contact.email && <EmailLink email={contact.email} />}
      </div>
      {!contact.email && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {cad} doesn&apos;t publish an email address for informal reviews.
        </p>
      )}
    </div>
  );
}

// The scheduled meeting's way in, by mode.
export function JoinInformalMeeting({ protest }: { protest: ProtestRecord }) {
  const mode = protest.informalReviewMode;
  const link = protest.informalReviewLink;
  const phone = protest.informalReviewPhone;
  const location = protest.informalReviewLocation;
  const fromEmail = protest.informalReviewLinkSource === "county_email";
  if (mode === "Videoconference" || (!mode && link)) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-accent inline-flex items-center gap-1.5 text-xs py-1.5"
          >
            <Video className="h-3.5 w-3.5" /> Join video meeting
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">
            No meeting link yet — the district emails it before the review.
          </span>
        )}
        {phone && <PhoneLink phone={phone} />}
        {fromEmail && (
          <span className="text-[11px] text-muted-foreground">From the district&apos;s email</span>
        )}
      </div>
    );
  }
  if (mode === "Phone") {
    return phone ? (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <PhoneLink phone={phone} />
      </div>
    ) : null;
  }
  if (mode === "In Person" && location) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <a href={mapsHref(location)} target="_blank" rel="noopener noreferrer" className={chip}>
          <MapPin className="h-3.5 w-3.5" /> {location}
        </a>
      </div>
    );
  }
  return null;
}
