// Informal review and formal ARB hearing: how to reach the district, and how
// to join the meeting once it's set (video link, phone number or address — by
// mode). The link/dial-in can also come from the district's email.
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { CalendarCheck, Mail, MapPin, Phone, Video } from "lucide-react";
import {
  getCountyProtestInfo,
  mapsHref,
  telHref,
  type InformalContact,
} from "@/lib/county-protest-info";
import type { PropertyRecord } from "@/lib/properties";
import type { ProtestRecord } from "@/lib/protests";
import { saveHearingJoin } from "@/lib/protest-case";
import { getErrorMessage } from "@/lib/error-message";
import { LEGAL_CONTACT } from "@/lib/legal";

type Mode = NonNullable<ProtestRecord["hearingMode"]>;

const chip =
  "inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-accent hover:text-accent";
const input = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";
const wideField = "grid w-full min-w-0 gap-1 text-xs sm:w-auto sm:min-w-[260px] sm:flex-1";

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

function CountyContact({
  title,
  intro,
  phones,
  email,
  bookingUrl,
  noEmailNote,
}: {
  title: string;
  intro: string | null;
  phones: string[];
  email: string | null;
  bookingUrl: string | null;
  noEmailNote: string;
}) {
  return (
    <div className="mt-3 rounded-md border border-border p-3">
      <div className="text-xs font-semibold text-foreground">{title}</div>
      {intro && <p className="mt-0.5 text-[11px] text-muted-foreground">{intro}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {bookingUrl && (
          <a href={bookingUrl} target="_blank" rel="noopener noreferrer" className={chip}>
            <CalendarCheck className="h-3.5 w-3.5" /> Book online
          </a>
        )}
        {phones.map((p) => (
          <PhoneLink key={p} phone={p} />
        ))}
        {email && <EmailLink email={email} />}
      </div>
      {!email && <p className="mt-1.5 text-[11px] text-muted-foreground">{noEmailNote}</p>}
    </div>
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
    <CountyContact
      title={`Contact ${cad}`}
      intro={howToRequest}
      phones={contact.phones}
      email={contact.email}
      bookingUrl={contact.bookingUrl}
      noEmailNote={`${cad} doesn't publish an email address for informal reviews.`}
    />
  );
}

// The meeting's way in, by mode.
function JoinMeeting({
  mode,
  link,
  phone,
  location,
  fromEmail,
}: {
  mode: Mode | null | undefined;
  link: string | null | undefined;
  phone: string | null | undefined;
  location: string | null | undefined;
  fromEmail: boolean;
}) {
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
            No meeting link yet — the district emails it before the meeting.
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

export function JoinInformalMeeting({ protest }: { protest: ProtestRecord }) {
  return (
    <JoinMeeting
      mode={protest.informalReviewMode}
      link={protest.informalReviewLink}
      phone={protest.informalReviewPhone}
      location={protest.informalReviewLocation}
      fromEmail={protest.informalReviewLinkSource === "county_email"}
    />
  );
}

// The inputs a meeting mode needs: a link (+ optional dial-in), a number, or an address.
export function MeetingJoinFields({
  mode,
  link,
  phone,
  location,
  onLink,
  onPhone,
  onLocation,
  phonePlaceholder,
}: {
  mode: Mode;
  link: string;
  phone: string;
  location: string;
  onLink: (v: string) => void;
  onPhone: (v: string) => void;
  onLocation: (v: string) => void;
  phonePlaceholder: string;
}) {
  return (
    <>
      {mode === "Videoconference" && (
        <label className={wideField}>
          Meeting link
          <input
            type="url"
            inputMode="url"
            value={link}
            onChange={(e) => onLink(e.target.value)}
            placeholder="https://… (from the district's email)"
            className={input}
          />
        </label>
      )}
      {(mode === "Phone" || mode === "Videoconference") && (
        <label className="grid gap-1 text-xs">
          {mode === "Phone" ? "Phone number" : "Dial-in (optional)"}
          <input
            type="tel"
            value={phone}
            onChange={(e) => onPhone(e.target.value)}
            placeholder={phonePlaceholder}
            className={`w-44 ${input}`}
          />
        </label>
      )}
      {mode === "In Person" && (
        <label className={wideField}>
          Address
          <input
            value={location}
            onChange={(e) => onLocation(e.target.value)}
            placeholder="The district's office address"
            className={input}
          />
        </label>
      )}
    </>
  );
}

export function EmailedLinkNote() {
  return (
    <p className="mt-1.5 text-[11px] text-muted-foreground">
      Districts email the video link before the meeting. When that email reaches CorvusPT (forward
      it to {LEGAL_CONTACT.email} if it came to you), Corvus AI adds the link here.
    </p>
  );
}

const JOIN_MODES: Mode[] = ["In Person", "Phone", "Videoconference"];

// Formal Hearing: the ARB's contact and how the owner will attend — the same
// buttons the informal review has.
export function HearingJoinSection({
  protest,
  property,
  onUpdate,
}: {
  protest: ProtestRecord;
  property: PropertyRecord;
  onUpdate: (patch: Partial<ProtestRecord>) => void;
}) {
  const info = getCountyProtestInfo(property.cad);
  const arbPhones = info?.arbContact?.phone ? [info.arbContact.phone] : [];
  const arbEmail = info?.arbContact?.email ?? null;
  const officeAddress = info?.filingMethod.inPerson?.address ?? null;
  const savedMode = protest.hearingMode;
  const [mode, setMode] = useState<Mode>(
    savedMode && JOIN_MODES.includes(savedMode) ? savedMode : "In Person",
  );
  const [link, setLink] = useState(protest.hearingLink ?? "");
  const [phone, setPhone] = useState(protest.hearingPhone ?? arbPhones[0] ?? "");
  const [location, setLocation] = useState(protest.hearingLocation ?? officeAddress ?? "");
  const [saving, setSaving] = useState(false);
  // A notice or the district's email can fill these in while the tab is open.
  useEffect(() => {
    if (protest.hearingLink) setLink(protest.hearingLink);
    if (protest.hearingPhone) setPhone(protest.hearingPhone);
    if (protest.hearingLocation) setLocation(protest.hearingLocation);
    if (protest.hearingMode && JOIN_MODES.includes(protest.hearingMode))
      setMode(protest.hearingMode);
  }, [protest.hearingLink, protest.hearingPhone, protest.hearingLocation, protest.hearingMode]);

  async function save(e: FormEvent) {
    e.preventDefault();
    const l = mode === "Videoconference" ? link.trim() || null : null;
    if (l && !/^https:\/\/\S+$/i.test(l)) {
      toast.error("Paste the full meeting link, starting with https://");
      return;
    }
    const p = mode === "Phone" || mode === "Videoconference" ? phone.trim() || null : null;
    const loc = mode === "In Person" ? location.trim() || null : (protest.hearingLocation ?? null);
    const linkSource =
      protest.hearingLinkSource === "county_email" &&
      l === (protest.hearingLink ?? null) &&
      p === (protest.hearingPhone ?? null)
        ? "county_email"
        : "owner";
    setSaving(true);
    try {
      await saveHearingJoin(protest.id, { mode, link: l, phone: p, location: loc, linkSource });
      onUpdate({
        hearingMode: mode,
        hearingLink: l,
        hearingPhone: p,
        hearingLocation: loc,
        hearingLinkSource: linkSource,
      });
      toast.success("Saved how you'll attend the hearing.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save this."));
    } finally {
      setSaving(false);
    }
  }

  const saved =
    !!savedMode &&
    ((savedMode === "Videoconference" && !!protest.hearingLink) ||
      (savedMode === "Phone" && !!protest.hearingPhone) ||
      (savedMode === "In Person" && !!protest.hearingLocation));

  return (
    <div id="case-hearing-join" className="mt-5 border-t border-border pt-5">
      <h2 className="text-sm font-semibold">Attend your hearing</h2>
      {property.cad && (arbPhones.length > 0 || arbEmail) && (
        <CountyContact
          title={`Contact the ${property.cad} review board`}
          intro="Questions about your hearing date, time or how to attend go to the Appraisal Review Board."
          phones={arbPhones}
          email={arbEmail}
          bookingUrl={null}
          noEmailNote={`${property.cad} doesn't publish an email address for the review board.`}
        />
      )}
      <form onSubmit={save} className="mt-3 rounded-md border border-border p-3">
        <div className="text-xs font-semibold text-foreground">How you&apos;ll attend</div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Your hearing notice says how the hearing is held — in person, by phone or by video.
        </p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs">
            Mode
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
              className={input}
            >
              {JOIN_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <MeetingJoinFields
            mode={mode}
            link={link}
            phone={phone}
            location={location}
            onLink={setLink}
            onPhone={setPhone}
            onLocation={setLocation}
            phonePlaceholder={arbPhones[0] ?? "(469) 742-9200"}
          />
          <button
            type="submit"
            disabled={saving}
            className="btn-accent text-xs py-1.5 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
        {mode === "Videoconference" && <EmailedLinkNote />}
        {saved && (
          <JoinMeeting
            mode={savedMode}
            link={protest.hearingLink}
            phone={protest.hearingPhone}
            location={protest.hearingLocation}
            fromEmail={protest.hearingLinkSource === "county_email"}
          />
        )}
      </form>
    </div>
  );
}
