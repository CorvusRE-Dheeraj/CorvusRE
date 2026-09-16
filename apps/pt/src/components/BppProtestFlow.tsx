import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { SignaturePad, type SignatureValue } from "@/components/SignaturePad";
import { requestBppProtest, saveBppAuthorization, type ProtestRecord } from "@/lib/protests";
import {
  SERVICE_AGREEMENT_SECTIONS,
  OWNER_ACCEPTANCE_TEXT,
  SERVICE_AGREEMENT_VERSION,
  CORVUSPT_LEGAL_ENTITY,
  CORVUSPT_CONTACT,
} from "@/lib/service-agreement";
import { AI_ACK_CHECKBOX, AI_ACK_BODY, AI_ACK_VERSION } from "@/lib/legal";
import { getMyProfile } from "@/lib/profile";
import type { BppAccountRecord } from "@/lib/bpp-accounts";
import { getErrorMessage } from "@/lib/error-message";

type Step = "agreement" | "owner" | "aiack" | "review";

// BPP's own protest-authorization flow — mirrors ProtestAuthorizationFlow.tsx's
// proven agreement → owner → aiack → review/sign shape (minus its "purchased
// recently" step, which is a real-estate-specific signal with no BPP
// equivalent), but writes to protests' own bpp_* columns via
// saveBppAuthorization() instead of the separate service_agreement_
// acceptances/protest_authorizations tables that flow uses. See that
// function's own comment for why: this keeps the real-estate flow's existing,
// live legal-agreement pipeline completely untouched. Deliberately no
// "already accepted, skip this step" persistence the way the real-estate
// flow has (that early-write pattern doesn't fit here — see saveBppAuthorization's
// comment) — a BPP account only ever goes through this once per protest.
export function BppProtestFlow({
  userId,
  account,
  userEmail,
  open,
  isPaid,
  onOpenChange,
  onDone,
}: {
  userId: string;
  account: BppAccountRecord;
  userEmail?: string | null;
  open: boolean;
  isPaid: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (protest: ProtestRecord) => void;
}) {
  const [step, setStep] = useState<Step>("agreement");
  const [attested, setAttested] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState(userEmail ?? "");
  const [phone, setPhone] = useState("");
  const [aiAcked, setAiAcked] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [signature, setSignature] = useState<SignatureValue | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Synchronous double-submit guard -- see handleSubmit for why the
  // `submitting` state (and the button's disabled attribute) is not enough.
  const submittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  // Real account info, not guessed — fetched fresh each time the modal opens
  // rather than passed in as a prop. Only fills fields still empty, so it
  // can never clobber something the user already typed if this resolves
  // late. Same pattern as ProtestAuthorizationFlow.tsx's own autofill.
  useEffect(() => {
    if (!open) return;
    getMyProfile(userId)
      .then((profile) => {
        setFirstName((prev) => prev || (profile.firstName ?? ""));
        setLastName((prev) => prev || (profile.lastName ?? ""));
        setPhone((prev) => prev || (profile.phone ?? ""));
      })
      .catch((err) => console.error("Could not load profile for autofill:", err));
  }, [open, userId]);

  function reset() {
    setStep("agreement");
    setAttested(false);
    setAiAcked(false);
    setAgreed(false);
    setSignature(null);
    setError(null);
    setSubmitting(false);
  }

  function close() {
    onOpenChange(false);
    reset();
  }

  const ownerValid = firstName.trim() && lastName.trim() && email.trim() && phone.trim();

  async function handleSubmit() {
    if (!signature) return;
    if (!isPaid) {
      setError(
        "This BPP account isn't covered by an active subscription — subscribe before filing.",
      );
      return;
    }
    // `disabled={submitting}` is a React state flag: the button is only
    // really disabled on the NEXT render, so a real double-click runs this
    // handler twice. Reproduced live -- two clicks in one tick filed the
    // same protest twice (two protests rows, two authorization records, two
    // entries in the staff queue). Nothing server-side catches it either:
    // prevent_duplicate_active_protest only blocks a duplicate from a
    // DIFFERENT account. The ref flips synchronously.
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const protest = await requestBppProtest(userId, account.id, {
        businessName: account.businessName,
        userEmail: email,
        originalValue: account.noticeValue ?? account.renderedValue,
        taxYear: account.taxYear,
      });
      await saveBppAuthorization(protest.id, {
        ownerFirstName: firstName.trim(),
        ownerLastName: lastName.trim(),
        ownerEmail: email.trim(),
        ownerPhone: phone.trim(),
        signatureType: signature.type,
        signatureData: signature.data,
      });
      toast.success("Authorization signed. CorvusPT staff will follow up.");
      onDone(protest);
      close();
    } catch (err) {
      const message = getErrorMessage(err, "Could not submit your authorization.");
      setError(message);
      toast.error(message);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === "agreement" && "CorvusPT Service Agreement"}
            {step === "owner" && "Business Owner Details"}
            {step === "aiack" && "Review Before Proceeding"}
            {step === "review" && "Review & Sign"}
          </DialogTitle>
          <DialogDescription>{account.businessName}</DialogDescription>
        </DialogHeader>

        {step === "agreement" && (
          <div className="grid gap-4">
            {!isPaid && (
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
                This BPP account isn't covered by an active subscription yet — you can read the
                agreement, but you can't continue until you subscribe.
              </div>
            )}

            <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-lg bg-secondary/40 p-4 text-sm sm:grid-cols-2">
              {[
                ["Business", account.businessName],
                ["Account / PID", account.accountNumber ?? "—"],
                ["County", account.cad ?? "—"],
                ["Tax Year", account.taxYear != null ? String(account.taxYear) : "—"],
                [
                  "Rendered Value",
                  account.renderedValue != null
                    ? `$${account.renderedValue.toLocaleString("en-US")}`
                    : "—",
                ],
                [
                  "County's Notice Value",
                  account.noticeValue != null
                    ? `$${account.noticeValue.toLocaleString("en-US")}`
                    : "—",
                ],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3 sm:block">
                  <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
                  <dd className="min-w-0 truncate text-right sm:text-left">{value}</dd>
                </div>
              ))}
            </dl>

            <p className="text-sm text-muted-foreground">
              By checking the box below and selecting "Agree &amp; Continue," you ("Owner")
              authorize CorvusPT to provide property tax protest services for the business personal
              property above, subject to the following terms.
            </p>

            <div className="max-h-72 space-y-3 overflow-y-auto rounded-lg border border-border p-4 text-sm">
              {SERVICE_AGREEMENT_SECTIONS.map((s) => (
                <section key={s.n}>
                  <h3 className="font-semibold">
                    {s.n}. {s.title}
                  </h3>
                  {s.body.map((p, i) => (
                    <p key={i} className="mt-1 text-muted-foreground">
                      {p}
                    </p>
                  ))}
                </section>
              ))}
              <p className="pt-1 text-xs text-muted-foreground">
                {CORVUSPT_LEGAL_ENTITY} · {CORVUSPT_CONTACT.address} · {CORVUSPT_CONTACT.phone} ·{" "}
                {CORVUSPT_CONTACT.email}. Agreement version {SERVICE_AGREEMENT_VERSION}.
              </p>
            </div>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={attested}
                onChange={(e) => setAttested(e.target.checked)}
                className="mt-0.5"
              />
              {OWNER_ACCEPTANCE_TEXT}
            </label>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex gap-2">
              <button onClick={close} className="btn-outline">
                Cancel
              </button>
              <button
                disabled={!attested || !isPaid}
                onClick={() => setStep("owner")}
                className="btn-primary btn-primary-hover disabled:opacity-50"
              >
                Agree & Continue
              </button>
            </div>
          </div>
        )}

        {step === "owner" && (
          <div className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              Provide your full legal name, including any suffix (Jr., Sr., II), to ensure it
              matches the county's records.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">
                  First Name<span className="text-destructive"> *</span>
                </span>
                <input
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="rounded-md border border-input bg-background px-3 py-2"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">
                  Last Name<span className="text-destructive"> *</span>
                </span>
                <input
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="rounded-md border border-input bg-background px-3 py-2"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">
                  Email Address<span className="text-destructive"> *</span>
                </span>
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="rounded-md border border-input bg-background px-3 py-2"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">
                  Phone Number<span className="text-destructive"> *</span>
                </span>
                <input
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="rounded-md border border-input bg-background px-3 py-2"
                />
              </label>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setStep("agreement")} className="btn-outline">
                Back
              </button>
              <button
                disabled={!ownerValid}
                onClick={() => setStep("aiack")}
                className="btn-primary btn-primary-hover disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {step === "aiack" && (
          <div className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              Before you sign and submit this protest, please review how CorvusPT&apos;s AI-assisted
              analysis should be used.
            </p>
            <div className="space-y-3 rounded-lg border border-border p-4 text-sm text-muted-foreground">
              <p>{AI_ACK_BODY}</p>
              <p className="text-xs">Acknowledgement version {AI_ACK_VERSION}.</p>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={aiAcked}
                onChange={(e) => setAiAcked(e.target.checked)}
                className="mt-0.5"
              />
              {AI_ACK_CHECKBOX}
            </label>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => setStep("owner")} className="btn-outline">
                Go Back
              </button>
              <button
                disabled={!aiAcked}
                onClick={() => setStep("review")}
                className="btn-primary btn-primary-hover disabled:opacity-50"
              >
                Confirm & Continue
              </button>
            </div>
          </div>
        )}

        {step === "review" && (
          <div className="grid gap-4">
            {!isPaid && (
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
                This BPP account isn't covered by an active subscription yet — signing is disabled
                until you subscribe.
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              By signing below, you authorize CorvusPT to file and manage a protest of the county's
              assessed value for this business personal property account.
            </p>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5"
              />
              I authorize CorvusPT to prepare and file this protest on my behalf.
            </label>
            <div>
              <SignaturePad expectedName={`${firstName} ${lastName}`} onChange={setSignature} />
            </div>
            <div className="rounded-lg bg-secondary/40 p-4 text-sm grid gap-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Full Name</span>
                <span>
                  {firstName} {lastName}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Email</span>
                <span>{email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Phone</span>
                <span>{phone}</span>
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => setStep("aiack")} className="btn-outline">
                Back
              </button>
              <button
                disabled={!agreed || !signature || submitting || !isPaid}
                onClick={handleSubmit}
                className="btn-primary btn-primary-hover disabled:opacity-50"
              >
                {submitting ? "Submitting…" : "Sign & Submit"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
