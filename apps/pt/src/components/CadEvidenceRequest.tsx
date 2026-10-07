import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, FileSearch, Mail } from "lucide-react";
import type { PropertyRecord } from "@/lib/properties";
import type { ProtestRecord } from "@/lib/protests";
import { setCadEvidenceReceived, setCadEvidenceRequested } from "@/lib/protest-case";
import { cadEvidenceRequestLetter, cadEvidenceRequestSubject } from "@/lib/cad-evidence-request";
import { getCountyProtestInfo } from "@/lib/county-protest-info";
import { getErrorMessage } from "@/lib/error-message";

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// The "Request CAD Evidence" stage in View Case: Corvus drafts the §41.461
// request, the owner sends it (copy, or open it in their email), then marks it
// sent — and later, received.
export function CadEvidenceRequest({
  property,
  protest,
  userEmail,
  onChange,
}: {
  property: PropertyRecord;
  protest: ProtestRecord;
  userEmail: string | null;
  onChange: (patch: Partial<ProtestRecord>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [showLetter, setShowLetter] = useState(!protest.cadEvidenceRequestedAt);
  const county = getCountyProtestInfo(property.cad);
  // The district's own confirmed filing email only — never the ARB contact,
  // since this request goes to the chief appraiser, not the review board.
  const to = county?.filingMethod.email.address ?? null;
  const input = {
    cadName: property.cad,
    address: property.address,
    accountNumber: property.accountNumber,
    taxYear: protest.taxYear ?? property.taxYear,
    ownerName: property.ownerName,
    replyEmail: userEmail,
  };
  const letter = cadEvidenceRequestLetter(input);
  const subject = cadEvidenceRequestSubject(input);

  async function set(kind: "requested" | "received", on: boolean) {
    setBusy(true);
    try {
      if (kind === "requested") {
        const at = await setCadEvidenceRequested(protest.id, on);
        onChange({ cadEvidenceRequestedAt: at, ...(on ? {} : { cadEvidenceReceivedAt: null }) });
        if (on) {
          setShowLetter(false);
          toast.success(
            "Marked as requested. The district owes you its evidence 14 days before your hearing.",
          );
        }
      } else {
        const at = await setCadEvidenceReceived(protest.id, on);
        onChange({ cadEvidenceReceivedAt: at });
        if (on)
          toast.success("Marked as received — upload it to your case documents to compare comps.");
      }
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save this."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="case-cad-evidence" className="card-elev scroll-mt-24 p-5">
      <div className="flex items-center gap-2">
        <FileSearch className="h-5 w-5 text-accent" aria-hidden="true" />
        <h3 className="font-serif text-lg font-semibold">
          Request the appraisal district&apos;s evidence
        </h3>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Texas Tax Code §41.461 lets you ask {property.cad ?? "the district"} for the comps,
        schedules and data it plans to use at your hearing. Once you ask, it must give them to you
        at least 14 days before the hearing — so you can rebut them in advance instead of seeing
        them for the first time at the table.
      </p>

      {protest.cadEvidenceRequestedAt ? (
        <div className="mt-3 grid gap-2 text-sm">
          <div className="flex items-center gap-2 text-success">
            <Check className="h-4 w-4" aria-hidden="true" /> Requested on{" "}
            {fmt(protest.cadEvidenceRequestedAt)}
          </div>
          {protest.cadEvidenceReceivedAt ? (
            <div className="flex items-center gap-2 text-success">
              <Check className="h-4 w-4" aria-hidden="true" /> Evidence received on{" "}
              {fmt(protest.cadEvidenceReceivedAt)}
            </div>
          ) : (
            <p className="text-muted-foreground">
              Waiting for the district&apos;s evidence. If it hasn&apos;t arrived 14 days before
              your hearing, tell the ARB — evidence the district didn&apos;t provide on request may
              be excluded.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {!protest.cadEvidenceReceivedAt && (
              <button
                type="button"
                disabled={busy}
                onClick={() => set("received", true)}
                className="btn-outline text-sm disabled:opacity-60"
              >
                The evidence arrived
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowLetter((v) => !v)}
              className="text-sm text-accent underline"
            >
              {showLetter ? "Hide" : "Show"} the request letter
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => set("requested", false)}
              className="text-sm text-muted-foreground underline"
            >
              Undo “requested”
            </button>
          </div>
        </div>
      ) : null}

      {showLetter && (
        <div className="mt-4">
          <textarea
            readOnly
            value={letter}
            aria-label="Evidence request letter"
            className="h-64 w-full rounded-md border border-input bg-background p-3 font-mono text-xs"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                navigator.clipboard
                  .writeText(letter)
                  .then(() => toast.success("Copied."))
                  .catch(() => toast.error("Could not copy — select the text instead."))
              }
              className="btn-outline inline-flex items-center gap-1.5 text-sm"
            >
              <Copy className="h-4 w-4" aria-hidden="true" /> Copy letter
            </button>
            <a
              href={`mailto:${to ?? ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(letter)}`}
              className="btn-outline inline-flex items-center gap-1.5 text-sm"
            >
              <Mail className="h-4 w-4" aria-hidden="true" /> Email it{to ? ` to ${to}` : ""}
            </a>
            {!protest.cadEvidenceRequestedAt && (
              <button
                type="button"
                disabled={busy}
                onClick={() => set("requested", true)}
                className="btn-primary btn-primary-hover text-sm disabled:opacity-60"
              >
                I sent the request
              </button>
            )}
          </div>
          {!to && (
            <p className="mt-2 text-xs text-muted-foreground">
              Send it to the district by email, mail or its online portal — keep proof of when you
              sent it.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
