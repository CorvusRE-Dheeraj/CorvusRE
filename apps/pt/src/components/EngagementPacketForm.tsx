import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { SignaturePad, type SignatureValue } from "@/components/SignaturePad";
import {
  PACKET_CONSENT_TEXT,
  PACKET_DOCUMENTS,
  SIGNEE_ROLE_LABEL,
  signEngagementPacket,
  type EngagementPacket,
  type PacketDocument,
  type SigneeRole,
} from "@/lib/engagement-packet";
import {
  SERVICE_AGREEMENT_SECTIONS,
  SERVICE_AGREEMENT_VERSION,
  CORVUSPT_LEGAL_ENTITY,
  CORVUSPT_CONTACT,
} from "@/lib/service-agreement";
import { AI_ACK_BODY, AI_ACK_CHECKBOX, SIGNUP_ACK_INTRO, SIGNUP_ACK_ITEMS } from "@/lib/legal";
import { getMyProfile } from "@/lib/profile";
import { getErrorMessage } from "@/lib/error-message";

// The official Texas Comptroller form the Appointment of Agent summary refers to.
const FORM_50_162_URL = "https://comptroller.texas.gov/forms/50-162.pdf";

export type PacketPrefill = Partial<{
  firstName: string;
  lastName: string;
  title: string;
  role: SigneeRole;
  companyName: string;
  phone: string;
}>;

// The single place every CorvusPT agreement is reviewed and signed — rendered in
// the first-visit / filing pop-up (EngagementPacketHost) and on the Agreements tab.
// Brief summaries with the full text one click away, the signer's details, and one
// signature. Skipping (when offered) is the host's job: it gets `secondaryAction`.
export function EngagementPacketForm({
  userId,
  prefill,
  secondaryAction,
  onSigned,
}: {
  userId: string;
  prefill?: PacketPrefill;
  // "Skip for now" / "Cancel" — rendered beside Submit, run by the host.
  secondaryAction?: { label: string; onClick: (details: PacketPrefill) => void; busy?: boolean };
  onSigned: (packet: EngagementPacket) => void;
}) {
  const [firstName, setFirstName] = useState(prefill?.firstName ?? "");
  const [lastName, setLastName] = useState(prefill?.lastName ?? "");
  const [title, setTitle] = useState(prefill?.title ?? "");
  const [role, setRole] = useState<SigneeRole>(prefill?.role ?? "owner");
  const [companyName, setCompanyName] = useState(prefill?.companyName ?? "");
  const [phone, setPhone] = useState(prefill?.phone ?? "");
  const [signature, setSignature] = useState<SignatureValue | null>(null);
  const [padKey, setPadKey] = useState(0);
  const [openDoc, setOpenDoc] = useState<PacketDocument["doc"] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // A real double-click runs the handler twice before `submitting` re-renders —
  // same guard ProtestAuthorizationFlow uses.
  const submittingRef = useRef(false);

  // Fill anything still blank from the profile — never clobbers what's typed.
  useEffect(() => {
    getMyProfile(userId)
      .then((p) => {
        setFirstName((v) => v || (p.firstName ?? ""));
        setLastName((v) => v || (p.lastName ?? ""));
        setPhone((v) => v || (p.phone ?? ""));
        setCompanyName((v) => v || (p.companyName ?? ""));
      })
      .catch(() => {});
  }, [userId]);

  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
  const detailsValid =
    !!firstName.trim() &&
    !!lastName.trim() &&
    !!title.trim() &&
    !!phone.trim() &&
    (role === "owner" || !!companyName.trim());

  async function submit() {
    if (!detailsValid || !signature || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const packet = await signEngagementPacket({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        title: title.trim(),
        role,
        companyName: role === "representative" ? companyName.trim() : "",
        phone: phone.trim(),
        signature,
      });
      toast.success("Agreements signed. You're all set to file.");
      onSigned(packet);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not record your signature. Please try again."));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const input = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
  const label = "grid gap-1 text-sm";
  const req = <span className="text-destructive"> *</span>;

  return (
    <div className="grid gap-4">
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground">
          Below are brief summaries of the documents in the CorvusPT Engagement Packet
        </div>
        <ul className="divide-y divide-border bg-secondary/30">
          {PACKET_DOCUMENTS.map((d) => (
            <li key={d.doc} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <h3 className="text-sm font-semibold">{d.title}</h3>
                <button
                  type="button"
                  onClick={() => setOpenDoc(openDoc === d.doc ? null : d.doc)}
                  aria-expanded={openDoc === d.doc}
                  className="text-xs font-medium text-accent underline underline-offset-2"
                >
                  {openDoc === d.doc ? "Hide full document" : "Read full document"}
                </button>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{d.summary}</p>
              {openDoc === d.doc && <FullDocument doc={d.doc} />}
            </li>
          ))}
        </ul>
      </div>

      <p className="text-sm">{PACKET_CONSENT_TEXT}</p>

      <div className="grid gap-4 rounded-lg border border-accent/50 bg-accent/5 p-4 md:grid-cols-[minmax(0,16rem)_1fr]">
        <div className="grid content-start gap-3">
          <div className="grid grid-cols-2 gap-2">
            <label className={label}>
              <span className="font-medium">First name{req}</span>
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
                className={input}
              />
            </label>
            <label className={label}>
              <span className="font-medium">Last name{req}</span>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
                className={input}
              />
            </label>
          </div>
          <label className={label}>
            <span className="font-medium">Title{req}</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Owner, Manager, Trustee…"
              autoComplete="organization-title"
              className={input}
            />
          </label>
          <label className={label}>
            <span className="font-medium">I am signing as{req}</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as SigneeRole)}
              className={input}
            >
              {(Object.keys(SIGNEE_ROLE_LABEL) as SigneeRole[]).map((r) => (
                <option key={r} value={r}>
                  {SIGNEE_ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
          {role === "representative" && (
            <label className={label}>
              <span className="font-medium">Company / entity name{req}</span>
              <input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                autoComplete="organization"
                className={input}
              />
            </label>
          )}
          <label className={label}>
            <span className="font-medium">Phone{req}</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              type="tel"
              autoComplete="tel"
              className={input}
            />
          </label>
        </div>

        <div className="grid content-start gap-3">
          <span className="text-sm font-medium">Signature{req}</span>
          <SignaturePad key={padKey} adoptName={fullName} onChange={setSignature} />
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setSignature(null);
                setPadKey((k) => k + 1);
              }}
              className="btn-outline text-sm"
            >
              Clear
            </button>
            {secondaryAction && (
              <button
                type="button"
                onClick={() =>
                  secondaryAction.onClick({ firstName, lastName, title, role, companyName, phone })
                }
                disabled={secondaryAction.busy || submitting}
                className="btn-outline text-sm disabled:opacity-60"
              >
                {secondaryAction.label}
              </button>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={!detailsValid || !signature || submitting}
              className="btn-accent text-sm disabled:opacity-60"
            >
              {submitting ? "Signing…" : "Submit"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FullDocument({ doc }: { doc: PacketDocument["doc"] }) {
  const box =
    "mt-2 max-h-64 overflow-y-auto rounded-md border border-border bg-background p-3 text-xs";
  if (doc === "terms") {
    return (
      <div className={`${box} space-y-2`}>
        <p>
          Read the full{" "}
          <Link
            to="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline"
          >
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link
            to="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline"
          >
            Privacy Policy
          </Link>{" "}
          (each opens in a new tab).
        </p>
        <p className="font-medium">{SIGNUP_ACK_INTRO}</p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          {SIGNUP_ACK_ITEMS.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </div>
    );
  }
  if (doc === "service-agreement") {
    return (
      <div className={`${box} space-y-2`}>
        {SERVICE_AGREEMENT_SECTIONS.map((s) => (
          <section key={s.n}>
            <h4 className="font-semibold">
              {s.n}. {s.title}
            </h4>
            {s.body.map((p, i) => (
              <p key={i} className="mt-1 text-muted-foreground">
                {p}
              </p>
            ))}
          </section>
        ))}
        <p className="text-muted-foreground">
          {CORVUSPT_LEGAL_ENTITY} · {CORVUSPT_CONTACT.address} · {CORVUSPT_CONTACT.phone} ·{" "}
          {CORVUSPT_CONTACT.email}. Agreement version {SERVICE_AGREEMENT_VERSION}.
        </p>
      </div>
    );
  }
  if (doc === "appointment") {
    return (
      <div className={`${box} space-y-2 text-muted-foreground`}>
        <p>
          For each property you ask CorvusPT to protest, we prepare the Texas Comptroller&apos;s
          Appointment of Agent for Property Tax Matters (Form 50-162) with that property&apos;s
          appraisal district account, apply the signature you give below, and file it with the
          appraisal district so CorvusPT can act for you on that property.
        </p>
        <p>
          <a
            href={FORM_50_162_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline"
          >
            View the official Form 50-162 (PDF)
          </a>
        </p>
      </div>
    );
  }
  return (
    <div className={`${box} space-y-2 text-muted-foreground`}>
      <p>{AI_ACK_CHECKBOX}</p>
      <p>{AI_ACK_BODY}</p>
    </div>
  );
}
