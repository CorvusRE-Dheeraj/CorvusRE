import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Copy, FileSearch, Mail, ShieldAlert, Upload } from "lucide-react";
import {
  analyzeCadEvidence,
  listCadEvidenceReviews,
  WEAKNESS_LABEL,
  type StoredCadEvidenceReview,
} from "@/lib/cad-evidence-review";
import { getPropertyBaseData } from "@/lib/property-base-data";
import { getIncomeAnalysis } from "@/lib/income-analysis";
import { computeIncomeApproach } from "@/lib/income-approach";
import type { PropertyRecord } from "@/lib/properties";
import type { ProtestRecord } from "@/lib/protests";
import { setCadEvidenceReceived, setCadEvidenceRequested } from "@/lib/protest-case";
import { cadEvidenceRequestLetter, cadEvidenceRequestSubject } from "@/lib/cad-evidence-request";
import { getCountyProtestInfo } from "@/lib/county-protest-info";
import { getErrorMessage } from "@/lib/error-message";
import { CORVUSPT_COUNTY_EMAIL } from "@/lib/county-email";

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// The "Request CAD Evidence" stage in View Case: Corvus drafts the §41.461
// request, the owner sends it (copy, or open it in their email), then marks it
// sent — and later, received.
export function CadEvidenceRequest({
  userId,
  property,
  protest,
  userEmail,
  onChange,
}: {
  userId: string;
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
  const managed = property.planTier === "corvusrf_managed";
  const input = {
    cadName: property.cad,
    address: property.address,
    accountNumber: property.accountNumber,
    taxYear: protest.taxYear ?? property.taxYear,
    ownerName: property.ownerName,
    // Expert/Managed: the district answers CorvusPT, the agent. Owner-managed:
    // the owner, with CorvusPT copied so the reply is filed automatically.
    replyEmail: managed ? CORVUSPT_COUNTY_EMAIL : userEmail,
    copyEmail: CORVUSPT_COUNTY_EMAIL,
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
          <CadEvidenceReviewPanel
            userId={userId}
            property={property}
            protest={protest}
            onReceived={() => {
              if (!protest.cadEvidenceReceivedAt) void set("received", true);
            }}
          />
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
              href={`mailto:${to ?? ""}?cc=${encodeURIComponent(CORVUSPT_COUNTY_EMAIL)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(letter)}`}
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

// Once the district's evidence arrives: upload it and Corvus lists its
// weaknesses against this property's facts and drafts the hearing response
// (analyze-cad-evidence). Also shown on the dashboard's Corvus decision card.
function CadEvidenceReviewPanel({
  userId,
  property,
  protest,
  onReceived,
}: {
  userId: string;
  property: PropertyRecord;
  protest: ProtestRecord;
  onReceived: () => void;
}) {
  const [review, setReview] = useState<StoredCadEvidenceReview | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    listCadEvidenceReviews([protest.id])
      .then((m) => setReview(m.get(protest.id) ?? null))
      .catch(() => {});
  }, [protest.id]);

  async function analyze(files: File[]) {
    setAnalyzing(true);
    try {
      const [base, income] = await Promise.all([
        getPropertyBaseData(property.id).catch(() => null),
        getIncomeAnalysis(property.id).catch(() => null),
      ]);
      const inc = income
        ? computeIncomeApproach(
            {
              grossPotentialIncome: income.grossPotentialIncome,
              otherIncome: income.otherIncome,
              vacancyPct: income.vacancyPct,
              operatingExpenses: income.operatingExpenses,
              noiStated: income.noiStated,
              rentableSqft: income.rentableSqft,
              capRatePct: income.capRatePct,
              capRateSource: income.capRateSource,
              documentKinds: [],
            },
            property.totalValue,
          )
        : null;
      const cad = base?.snapshot.cad;
      const r = await analyzeCadEvidence(userId, property, protest, files, {
        address: property.address,
        cad: property.cad,
        accountNumber: property.accountNumber,
        appraisedValue: protest.originalValue ?? property.totalValue,
        landValue: property.landValue,
        improvementValue: property.improvementValue,
        buildingSqft: cad?.buildingSqft ?? null,
        yearBuilt: cad?.yearBuilt ?? null,
        acres: cad?.lotSizeAcres ?? null,
        noi: inc?.noi ?? null,
        capRatePct: inc?.capRatePct ?? null,
      });
      setReview(r);
      onReceived();
      toast.success(
        `Corvus found ${r.weaknesses.length} weakness${r.weaknesses.length === 1 ? "" : "es"} in the district's evidence.`,
      );
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not analyze the district's evidence."));
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-border p-4">
      <div className="flex items-center gap-2 font-semibold">
        <ShieldAlert className="h-4 w-4 text-accent" aria-hidden="true" />
        Corvus review of the district&apos;s evidence
      </div>
      {!review && (
        <p className="mt-1 text-sm text-muted-foreground">
          When the district&apos;s evidence arrives, upload it. Corvus checks every comp and
          assumption against your property and drafts your hearing response.
        </p>
      )}
      {review && (
        <div className="mt-2 grid gap-3 text-sm">
          {review.summary && <p>{review.summary}</p>}
          <p className="font-medium">
            {review.weaknesses.length} weakness{review.weaknesses.length === 1 ? "" : "es"} found
            {review.cadIndicatedValue != null &&
              ` · the district argues for $${review.cadIndicatedValue.toLocaleString("en-US")}`}
          </p>
          <ul className="grid gap-2">
            {review.weaknesses.map((w, i) => (
              <li key={i} className="rounded-md bg-secondary/50 p-2.5">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {WEAKNESS_LABEL[w.category]}
                  {w.item ? ` · ${w.item}` : ""}
                </div>
                <div className="font-medium">{w.finding}</div>
                {w.detail && <div className="text-muted-foreground">{w.detail}</div>}
              </li>
            ))}
          </ul>
          {review.hearingResponse && (
            <div>
              <div className="text-xs font-semibold">Recommended hearing response</div>
              <textarea
                readOnly
                value={review.hearingResponse}
                aria-label="Recommended hearing response"
                className="mt-1 h-48 w-full rounded-md border border-input bg-background p-3 text-xs"
              />
              <button
                type="button"
                onClick={() =>
                  navigator.clipboard
                    .writeText(review.hearingResponse)
                    .then(() => toast.success("Copied."))
                    .catch(() => toast.error("Could not copy — select the text instead."))
                }
                className="btn-outline mt-1 inline-flex items-center gap-1.5 text-xs"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy response
              </button>
            </div>
          )}
        </div>
      )}
      <label
        className={`btn-primary btn-primary-hover mt-3 inline-flex cursor-pointer items-center gap-1.5 text-sm ${analyzing ? "pointer-events-none opacity-60" : ""}`}
      >
        <Upload className="h-4 w-4" aria-hidden="true" />
        {analyzing
          ? "Corvus is reviewing the evidence…"
          : review
            ? "Upload updated evidence"
            : "Upload the district's evidence"}
        <input
          type="file"
          accept="application/pdf,image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.target.files ? Array.from(e.target.files) : [];
            e.target.value = "";
            if (files.length) void analyze(files);
          }}
        />
      </label>
    </div>
  );
}
