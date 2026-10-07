import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Copy, FileSearch, Mail, ShieldAlert, Upload } from "lucide-react";
import {
  analyzeCadEvidence,
  analyzeCadEvidencePacket,
  listCadEvidenceReviews,
  strongestPoints,
  WEAKNESS_LABEL,
  type StoredCadEvidenceReview,
} from "@/lib/cad-evidence-review";
import { getValuationWorksheet } from "@/lib/valuation-worksheet";
import { decisionCard } from "@/lib/decision-card";
import { getEffectiveTaxRate } from "@/lib/texas-tax-rates";
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

// The CAD evidence-response workflow. Once the district's evidence arrives,
// the owner uploads it; the AI reads every comp, the district's stated facts
// about the property, its adjustments and income assumptions
// (analyze-cad-evidence), and Corvus computes the rest deterministically
// (_shared/cad-evidence-analysis.ts): per-comp metrics, comparability
// problems, incorrect property facts, stale or post-date sales, adjustment
// size, inconsistent treatment, the district's value against Corvus's
// evidence, a rebuttal, and the 3-5 strongest points for the hearing.
type Facts = {
  buildingSqft: number | null;
  yearBuilt: number | null;
  acres: number | null;
  noi: number | null;
  capRatePct: number | null;
};

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const FLAG_LABEL: Record<string, string> = {
  size: "size",
  age: "age",
  stale_sale: "stale sale",
  post_date_sale: "sold after Jan 1",
  property_type: "different type",
  distance: "distant",
  adjustments: "heavy adjustments",
};

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
  const [facts, setFacts] = useState<Facts | null>(null);
  const [range, setRange] = useState<{ low: number; high: number } | null>(null);
  // Set when the range is only estimated from the savings figure, not the
  // property's Commercial Valuation.
  const [rangeEstimated, setRangeEstimated] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    listCadEvidenceReviews([protest.id])
      .then((m) => setReview(m.get(protest.id) ?? null))
      .catch(() => {});
    Promise.all([
      getPropertyBaseData(property.id).catch(() => null),
      getIncomeAnalysis(property.id).catch(() => null),
      getValuationWorksheet(property.id).catch(() => null),
    ]).then(([base, income, worksheet]) => {
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
      setFacts({
        buildingSqft: cad?.buildingSqft ?? null,
        yearBuilt: cad?.yearBuilt ?? null,
        acres: cad?.lotSizeAcres ?? null,
        noi: inc?.noi ?? null,
        capRatePct: inc?.capRatePct ?? null,
      });
      const dc = decisionCard({
        cadValue: protest.originalValue ?? property.totalValue,
        effectiveTaxRate: getEffectiveTaxRate(property.cad),
        healthScore: null,
        worksheet: worksheet?.summary ?? null,
        estimatedSavings: property.estimatedSavings,
        protest: null,
        cadReview: null,
        annualCost: null,
        arbitration: null,
      });
      setRange(dc.supportable);
      setRangeEstimated(!worksheet?.summary && !!dc.supportable);
    });
  }, [property, protest.id, protest.originalValue]);

  const taxYear = protest.taxYear ?? property.taxYear ?? new Date().getFullYear();
  const analysis =
    review && facts
      ? analyzeCadEvidencePacket(
          review.extraction,
          {
            buildingSqft: facts.buildingSqft,
            yearBuilt: facts.yearBuilt,
            acres: facts.acres,
            propertyType: property.propertyType,
            capRatePct: facts.capRatePct,
          },
          taxYear,
          range,
        )
      : null;
  const points = analysis && review ? strongestPoints(analysis, review.weaknesses) : [];
  const subjectErrors = analysis?.findings.filter((f) => f.kind === "subject_data") ?? [];
  const otherFindings = analysis?.findings.filter((f) => f.kind !== "subject_data") ?? [];

  async function analyze(files: File[]) {
    setAnalyzing(true);
    try {
      const r = await analyzeCadEvidence(userId, property, protest, files, {
        address: property.address,
        cad: property.cad,
        accountNumber: property.accountNumber,
        appraisedValue: protest.originalValue ?? property.totalValue,
        landValue: property.landValue,
        improvementValue: property.improvementValue,
        buildingSqft: facts?.buildingSqft ?? null,
        yearBuilt: facts?.yearBuilt ?? null,
        acres: facts?.acres ?? null,
        noi: facts?.noi ?? null,
        capRatePct: facts?.capRatePct ?? null,
        propertyType: property.propertyType,
        taxYear,
      });
      setReview(r);
      onReceived();
      toast.success(
        `Corvus read ${r.extraction.comps.length} comp${r.extraction.comps.length === 1 ? "" : "s"} from the district's evidence.`,
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
        Respond to the district&apos;s evidence
      </div>
      {!review && (
        <p className="mt-1 text-sm text-muted-foreground">
          When the district&apos;s evidence arrives, upload it. Corvus extracts every comp, checks
          each one against your property, and builds your rebuttal and the strongest points to make
          at the hearing.
        </p>
      )}

      {review && analysis && (
        <div className="mt-3 grid gap-4 text-sm">
          {/* Their value against Corvus's evidence. */}
          {analysis.comparison ? (
            <div
              className={`rounded-md p-3 ${analysis.comparison.gapToHigh > 0 ? "bg-success/10" : "bg-secondary/60"}`}
            >
              The district proposes <strong>{money(analysis.comparison.proposedValue)}</strong>.
              Your evidence supports{" "}
              <strong>
                {money(analysis.comparison.corvusLow)}–{money(analysis.comparison.corvusHigh)}
              </strong>
              {analysis.comparison.gapToHigh > 0
                ? ` — the district is ${analysis.comparison.gapPct}% above the top of that range.`
                : " — the district's value is at or below the top of your range."}
              {rangeEstimated && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Range estimated from your savings figure — run the Commercial Valuation in the
                  property&apos;s report for the full six-approach range.
                </div>
              )}
            </div>
          ) : analysis.proposedValue != null ? (
            <div className="rounded-md bg-secondary/60 p-3">
              The district proposes <strong>{money(analysis.proposedValue)}</strong>. Run the
              Commercial Valuation in the property&apos;s report to compare it with your evidence.
            </div>
          ) : null}

          {/* The 3-5 strongest points. */}
          {points.length > 0 && (
            <div>
              <div className="font-semibold">Strongest points for the hearing</div>
              <ol className="mt-1 grid gap-2">
                {points.map((p, i) => (
                  <li key={p.title} className="flex gap-2 rounded-md bg-accent/5 p-2.5">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-bold text-accent-foreground">
                      {i + 1}
                    </span>
                    <span>
                      <span className="font-medium">{p.title}</span>
                      {p.detail && <span className="text-muted-foreground"> — {p.detail}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Facts the district got wrong. */}
          {subjectErrors.length > 0 && (
            <div>
              <div className="font-semibold">Your property&apos;s facts the district got wrong</div>
              <ul className="mt-1 list-disc pl-5">
                {subjectErrors.map((f) => (
                  <li key={f.title}>{f.title}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Every comp, with its metrics. */}
          {analysis.metrics.length > 0 && (
            <div>
              <div className="font-semibold">
                The district&apos;s comps ({analysis.metrics.length})
              </div>
              <div className="mt-1 overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[640px] text-left text-xs">
                  <thead className="bg-secondary/60 text-muted-foreground">
                    <tr>
                      <th className="p-2">Comp</th>
                      <th className="p-2 text-right">Value</th>
                      <th className="p-2 text-right">$/SF</th>
                      <th className="p-2 text-right">Size vs yours</th>
                      <th className="p-2 text-right">Age vs yours</th>
                      <th className="p-2 text-right">Sold</th>
                      <th className="p-2 text-right">Adj. gross / net</th>
                      <th className="p-2">Problems</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.metrics.map((m) => (
                      <tr key={m.label} className="border-t border-border align-top">
                        <td className="p-2">
                          <div className="font-medium">{m.label}</div>
                          {m.address && <div className="text-muted-foreground">{m.address}</div>}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          {m.value != null ? money(m.value) : "—"}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          {m.pricePerSf != null ? `$${m.pricePerSf.toFixed(0)}` : "—"}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          {m.sizeDiffPct != null
                            ? `${m.sizeDiffPct > 0 ? "+" : ""}${m.sizeDiffPct}%`
                            : "—"}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          {m.ageDiffYears != null
                            ? m.ageDiffYears === 0
                              ? "same"
                              : `${Math.abs(m.ageDiffYears)} yrs ${m.ageDiffYears > 0 ? "newer" : "older"}`
                            : "—"}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          {m.saleMonthsBeforeValuation != null
                            ? m.saleMonthsBeforeValuation < 0
                              ? "after Jan 1"
                              : `${m.saleMonthsBeforeValuation} mo before`
                            : "—"}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          {m.grossAdjPct != null ? `${m.grossAdjPct}% / ${m.netAdjPct}%` : "—"}
                        </td>
                        <td className="p-2">
                          <div className="flex flex-wrap gap-1">
                            {m.flags.length === 0 ? (
                              <span className="text-muted-foreground">none found</span>
                            ) : (
                              m.flags.map((f) => (
                                <span
                                  key={f}
                                  className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive"
                                >
                                  {FLAG_LABEL[f] ?? f}
                                </span>
                              ))
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Every finding. */}
          {(otherFindings.length > 0 || review.weaknesses.length > 0) && (
            <div>
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="text-sm font-semibold text-accent"
                aria-expanded={showAll}
              >
                {showAll ? "Hide" : "Show"} all {otherFindings.length + review.weaknesses.length}{" "}
                findings
              </button>
              {showAll && (
                <ul className="mt-2 grid gap-2">
                  {otherFindings.map((f) => (
                    <li key={f.title} className="rounded-md bg-secondary/50 p-2.5">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Calculated{f.comp ? ` · ${f.comp}` : ""}
                      </div>
                      <div className="font-medium">{f.title}</div>
                      <div className="text-muted-foreground">{f.detail}</div>
                    </li>
                  ))}
                  {review.weaknesses.map((w, i) => (
                    <li key={i} className="rounded-md bg-secondary/50 p-2.5">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Reviewed · {WEAKNESS_LABEL[w.category]}
                        {w.item ? ` · ${w.item}` : ""}
                      </div>
                      <div className="font-medium">{w.finding}</div>
                      {w.detail && <div className="text-muted-foreground">{w.detail}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* The rebuttal. */}
          {review.hearingResponse && (
            <div>
              <div className="font-semibold">Your rebuttal</div>
              <textarea
                readOnly
                value={review.hearingResponse}
                aria-label="Rebuttal"
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
                <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy rebuttal
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
          ? "Corvus is reading the evidence…"
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
