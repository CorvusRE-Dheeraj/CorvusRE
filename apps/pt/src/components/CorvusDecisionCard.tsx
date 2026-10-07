import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, Gavel, Info, Scale, ShieldCheck } from "lucide-react";
import type { DecisionCard } from "@/lib/decision-card";
import { OPENING_DISCOUNT, SETTLEMENT_POSITION } from "@/lib/decision-card";
import type { NextAction } from "@/lib/case-pipeline";

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
// "$8.45M" / "$742K" — the card's compact figures.
function m(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2).replace(/0$/, "")}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return usd(n);
}
const fmtDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });

const VERDICT_TONE = {
  PROTEST: "text-success",
  REVIEW: "text-warning-foreground",
  "NO PROTEST": "text-muted-foreground",
} as const;

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">
        {label}
        {hint && (
          <span title={hint} className="ml-1 inline-flex align-middle">
            <Info className="h-3 w-3" aria-label={hint} />
          </span>
        )}
      </span>
      <span className="text-right font-semibold tabular-nums">{value}</span>
    </div>
  );
}

// The Corvus decision card for one property: the recommendation and numbers
// to act on now, and — as the case moves — what the district's evidence gets
// wrong, whether to take an informal offer, and what the outcome was worth.
export function CorvusDecisionCard({
  card,
  next,
  address,
  propertyId,
  hasCase,
  onStart,
  onReviewEvidence,
  defaultOpen = true,
}: {
  card: DecisionCard;
  next: NextAction;
  address: string;
  propertyId: string;
  hasCase: boolean;
  onStart: () => void;
  onReviewEvidence: () => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const caseLink = (anchor: string) => ({
    to: "/dashboard/case" as const,
    search: { propertyId, anchor },
  });

  return (
    <article className="card-elev overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 p-5 text-left"
      >
        <div className="min-w-0">
          <div className="text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">
            Corvus Recommendation
          </div>
          <div className="mt-1 font-serif text-2xl font-semibold">
            <span className={VERDICT_TONE[card.verdict]}>{card.verdict}</span>
            <span className="text-muted-foreground"> — {card.strength}</span>
          </div>
          <div className="truncate text-xs text-muted-foreground">{address}</div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {card.savingsAtSettlement != null && card.stage === "assess" && (
            <div className="hidden text-right sm:block">
              <div className="text-[11px] text-muted-foreground">Potential annual savings</div>
              <div className="text-lg font-semibold text-success">
                {usd(card.savingsAtSettlement)}
              </div>
            </div>
          )}
          <ChevronDown
            className={`h-5 w-5 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </div>
      </button>

      {open && (
        <div className="grid gap-4 border-t border-border p-5">
          {/* Assessment — always shown. */}
          <section aria-label="Assessment">
            {card.cadValue != null && <Row label="CAD assessment" value={m(card.cadValue)} />}
            {card.supportable ? (
              <Row
                label="Corvus supportable range"
                value={`${m(card.supportable.low)}–${m(card.supportable.high)}`}
                hint={card.supportableBasis}
              />
            ) : (
              <p className="py-1.5 text-sm text-muted-foreground">{card.supportableBasis}</p>
            )}
            {card.openingPosition != null && (
              <Row
                label="Opening owner position"
                value={m(card.openingPosition)}
                hint={`About ${OPENING_DISCOUNT * 100}% below the low end of the supportable range, leaving room to negotiate.`}
              />
            )}
            {card.likelySettlement != null && (
              <Row
                label="Estimated likely settlement"
                value={m(card.likelySettlement)}
                hint={`Estimated at ${SETTLEMENT_POSITION * 100}% of the way from the low to the high end of the supportable range.`}
              />
            )}
            {card.evidenceStrength != null && (
              <Row
                label="Evidence strength"
                value={`${card.evidenceStrength}/100`}
                hint="Corvus's county-data protest score: comps, value trend, the county's assessment ratio, and your uploaded evidence."
              />
            )}
            {card.arguments[0] && <Row label="Strongest argument" value={card.arguments[0]} />}
            {card.arguments[1] && <Row label="Second argument" value={card.arguments[1]} />}
            {card.savingsAtSettlement != null && card.likelySettlement != null && (
              <Row
                label={`Potential annual tax savings at ${m(card.likelySettlement)}`}
                value={usd(card.savingsAtSettlement)}
              />
            )}
          </section>

          {/* The district's evidence, once reviewed. */}
          {card.evidence && (
            <section
              aria-label="CAD evidence"
              className="rounded-lg border border-accent/30 bg-accent/5 p-4"
            >
              <div className="flex items-center gap-2 font-semibold">
                <ShieldCheck className="h-4 w-4 text-accent" aria-hidden="true" />
                CAD evidence received
              </div>
              <p className="mt-1 text-sm">
                Corvus found <strong>{card.evidence.weaknessCount}</strong> weakness
                {card.evidence.weaknessCount === 1 ? "" : "es"}.
              </p>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {card.evidence.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              {card.evidence.responseReady && (
                <Link
                  {...caseLink("case-cad-evidence")}
                  className="mt-2 inline-block text-sm font-semibold text-accent underline"
                >
                  Recommended hearing response generated →
                </Link>
              )}
            </section>
          )}

          {/* An informal offer to decide on. */}
          {card.offer && (
            <section
              aria-label="Informal offer"
              className="rounded-lg border border-warning/50 bg-warning/5 p-4"
            >
              <div className="flex items-center gap-2 font-semibold">
                <Scale className="h-4 w-4" aria-hidden="true" /> Informal settlement offer
              </div>
              <div className="mt-2">
                <Row label="CAD offer" value={m(card.offer.offer)} />
                <Row label="Original" value={m(card.offer.original)} />
                <Row
                  label="Tax savings at the offer"
                  value={`~${usd(card.offer.savingsAtOffer)}`}
                />
                {card.offer.arbRange && (
                  <Row
                    label="Corvus estimated likely ARB range"
                    value={`${m(card.offer.arbRange.low)}–${m(card.offer.arbRange.high)}`}
                  />
                )}
              </div>
              <p className="mt-2 text-sm">
                <strong>Decision: {card.offer.decision}.</strong> {card.offer.reasoning}
              </p>
            </section>
          )}

          {/* The outcome. */}
          {card.result && (
            <section
              aria-label="Result"
              className="rounded-lg border border-success/40 bg-success/5 p-4"
            >
              <div className="flex items-center gap-2 font-semibold">
                <Gavel className="h-4 w-4" aria-hidden="true" /> After the ARB
              </div>
              <div className="mt-2">
                <Row label="Final value" value={m(card.result.finalValue)} />
                <Row label="Reduction" value={m(card.result.reduction)} />
                <Row label="Estimated annual tax savings" value={usd(card.result.annualSavings)} />
                {card.result.cost != null && (
                  <Row label="Corvus cost" value={usd(card.result.cost)} />
                )}
                {card.result.netFirstYear != null && (
                  <Row label="Net first-year benefit" value={`~${usd(card.result.netFirstYear)}`} />
                )}
                <Row
                  label="Binding-arbitration eligibility"
                  value={
                    card.result.arbitrationEligible == null
                      ? "Needs information"
                      : card.result.arbitrationEligible
                        ? "Yes"
                        : "No"
                  }
                />
                {card.result.arbitrationDeadline && (
                  <Row
                    label="Deadline"
                    value={`${fmtDate(card.result.arbitrationDeadline)}${
                      card.result.arbitrationDaysLeft != null
                        ? ` · ${card.result.arbitrationDaysLeft} days`
                        : ""
                    }`}
                  />
                )}
                <Row
                  label="Further appeal economics"
                  value={card.result.furtherAppeal}
                  hint={card.result.furtherAppealReason}
                />
              </div>
            </section>
          )}

          {/* What to do now. */}
          <section aria-label="Next action" className="rounded-lg bg-secondary/50 p-4">
            <p className="text-sm">
              <span className="font-semibold">Next action:</span> {next.title}
              {next.dueDate && <> by {fmtDate(next.dueDate)}</>}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {hasCase ? (
                <Link
                  {...caseLink("case-documents")}
                  className="btn-primary btn-primary-hover text-sm"
                >
                  File Myself — Instructions
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={onStart}
                  className="btn-primary btn-primary-hover text-sm"
                >
                  File Myself — Instructions
                </button>
              )}
              {hasCase ? (
                <Link {...caseLink("case-documents")} className="btn-outline text-sm">
                  Download Form
                </Link>
              ) : (
                <button type="button" onClick={onStart} className="btn-outline text-sm">
                  Download Form
                </button>
              )}
              <button type="button" onClick={onReviewEvidence} className="btn-outline text-sm">
                Review Evidence
              </button>
              {hasCase && (
                <Link {...caseLink("case-hearing-prep")} className="btn-outline text-sm">
                  Prepare for Hearing
                </Link>
              )}
            </div>
          </section>
          <p className="text-[11px] text-muted-foreground">
            Estimates from your county record, Corvus&apos;s valuation approaches and your case — to
            support your decisions, not a guarantee of any outcome.
          </p>
        </div>
      )}
    </article>
  );
}
