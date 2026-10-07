import { useEffect, useState } from "react";
import { Check, CircleAlert, Gavel, Receipt, Scale, X } from "lucide-react";
import type { PropertyRecord } from "@/lib/properties";
import { listProtests, type ProtestRecord } from "@/lib/protests";
import { listTaxBills, type TaxBillRecord } from "@/lib/tax-bills";
import { listDocuments } from "@/lib/documents";
import { getValuationWorksheet } from "@/lib/valuation-worksheet";
import { decisionCard } from "@/lib/decision-card";
import { getEffectiveTaxRate } from "@/lib/texas-tax-rates";
import { evaluateEscalation } from "@/lib/escalation-eval";
import { evaluateArbitrationEligibility } from "@/lib/arbitration";
import { localTodayIso } from "@/lib/case-pipeline";
import { postHearing, type PostHearing } from "@/lib/post-hearing";

const usd = (n: number) => `${n < 0 ? "−" : ""}${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const fmtDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

function Row({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`text-right font-semibold tabular-nums ${tone === "good" ? "text-success" : tone === "bad" ? "text-destructive" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

// The post-hearing decision layer (lib/post-hearing.ts): once the ARB has
// ruled or the case settled — the outcome, whether the tax bill reflects it,
// appeal deadlines and arbitration eligibility, the economics of each appeal
// route, the documents still needed, and the prior-year comparison.
export function PostHearingDecision({
  userId,
  property,
  protest,
  evidenceDocumentCount,
}: {
  userId: string;
  property: PropertyRecord;
  protest: ProtestRecord;
  evidenceDocumentCount: number;
}) {
  const [data, setData] = useState<{
    bills: TaxBillRecord[];
    docTypes: string[];
    protests: ProtestRecord[];
    supportableLow: number | null;
  } | null>(null);

  useEffect(() => {
    Promise.all([
      listTaxBills(userId).catch(() => [] as TaxBillRecord[]),
      listDocuments(userId).catch(() => []),
      listProtests(userId).catch(() => [] as ProtestRecord[]),
      getValuationWorksheet(property.id).catch(() => null),
    ]).then(([bills, docs, protests, worksheet]) => {
      const range = decisionCard({
        cadValue: protest.originalValue ?? property.totalValue,
        effectiveTaxRate: getEffectiveTaxRate(property.cad),
        healthScore: null,
        worksheet: worksheet?.summary ?? null,
        estimatedSavings: property.estimatedSavings,
        protest: null,
        cadReview: null,
        annualCost: null,
        arbitration: null,
      }).supportable;
      setData({
        bills: bills.filter((b) => b.propertyId === property.id),
        docTypes: docs.filter((d) => d.propertyId === property.id).map((d) => d.documentType ?? ""),
        protests: protests.filter((x) => x.propertyId === property.id),
        supportableLow: range?.low ?? null,
      });
    });
  }, [userId, property, protest.originalValue]);

  if (protest.finalValue == null || !data) return null;
  const ph: PostHearing | null = postHearing({
    protest,
    priorValue: protest.originalValue ?? property.totalValue,
    effectiveTaxRate: getEffectiveTaxRate(property.cad),
    taxBills: data.bills,
    valueHistory: (property.valueHistory ?? []).map((h) => ({
      year: h.year,
      total: h.appraisedValue ?? h.marketValue ?? null,
    })),
    priorProtests: data.protests,
    escalation: evaluateEscalation(property, protest, evidenceDocumentCount, data.supportableLow),
    arbitration:
      protest.arbDecision != null
        ? evaluateArbitrationEligibility(property, protest, evidenceDocumentCount)
        : null,
    supportableLow: data.supportableLow,
    documentTypes: data.docTypes,
    today: localTodayIso(),
  });
  if (!ph) return null;

  const missing = ph.documents.filter((d) => !d.onFile).length;

  return (
    <section aria-labelledby="post-hearing" className="card-elev mt-4 p-5">
      <div className="flex items-center gap-2">
        <Gavel className="h-5 w-5 text-accent" aria-hidden="true" />
        <h2 id="post-hearing" className="font-serif text-xl font-semibold">
          Post-hearing decision
        </h2>
      </div>
      <div className="mt-3 rounded-lg bg-accent/5 p-3">
        <div className="font-semibold">{ph.verdict.headline}</div>
        <div className="text-sm text-muted-foreground">{ph.verdict.detail}</div>
      </div>

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        {/* Outcome */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Outcome
          </h3>
          <Row label="Final value" value={usd(ph.finalValue)} />
          {ph.priorValue != null && <Row label="Prior value" value={usd(ph.priorValue)} />}
          {ph.reduction != null && (
            <Row
              label="Reduction"
              value={`${usd(ph.reduction)}${ph.reductionPct != null ? ` (${ph.reductionPct}%)` : ""}`}
              tone={ph.reduction > 0 ? "good" : undefined}
            />
          )}
          {ph.estimatedSavings != null && (
            <Row
              label="Estimated tax savings"
              value={`${usd(ph.estimatedSavings)} / yr`}
              tone="good"
            />
          )}
        </div>

        {/* Bill reconciliation */}
        <div>
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Receipt className="h-3.5 w-3.5" aria-hidden="true" /> Actual bill reconciliation
          </h3>
          {ph.bill.status === "awaiting_bill" ? (
            <>
              {ph.bill.expectedBill != null && (
                <Row label="Expected bill at the final value" value={usd(ph.bill.expectedBill)} />
              )}
              <p className="mt-1 text-sm text-muted-foreground">{ph.bill.note}</p>
            </>
          ) : (
            <>
              <Row label="Billed" value={usd(ph.bill.billed)} />
              <Row label="Expected at the final value" value={usd(ph.bill.expectedBill)} />
              {ph.bill.billedValue != null && (
                <Row label="Value on the bill" value={usd(ph.bill.billedValue)} />
              )}
              <Row
                label="Difference"
                value={`${ph.bill.difference > 0 ? "+" : ""}${usd(ph.bill.difference)}`}
                tone={ph.bill.status === "too_high" ? "bad" : "good"}
              />
              <p
                className={`mt-1 flex gap-1.5 text-sm ${ph.bill.status === "too_high" ? "text-destructive" : "text-muted-foreground"}`}
              >
                {ph.bill.status === "too_high" && (
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                )}
                {ph.bill.note}
              </p>
            </>
          )}
        </div>

        {/* Appeal deadline, arbitration, economics */}
        <div className="lg:col-span-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Scale className="h-3.5 w-3.5" aria-hidden="true" /> Further appeal — deadlines and
            economics
          </h3>
          {ph.arbitration && (
            <p className="mt-1 text-sm">
              <span className="font-semibold">Binding arbitration: {ph.arbitration.label}.</span>{" "}
              <span className="text-muted-foreground">{ph.arbitration.reasons[0]}</span>
            </p>
          )}
          {ph.routes.length > 0 ? (
            <div className="mt-2 overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-secondary/60 text-xs text-muted-foreground">
                  <tr>
                    <th className="p-2">Route</th>
                    <th className="p-2">Deadline</th>
                    <th className="p-2 text-right">Up-front cost</th>
                    <th className="p-2 text-right">Could save / yr</th>
                    <th className="p-2 text-right">Return</th>
                  </tr>
                </thead>
                <tbody>
                  {ph.routes.map((r) => (
                    <tr
                      key={r.id}
                      className={`border-t border-border align-top ${r.eligible ? "" : "text-muted-foreground"}`}
                    >
                      <td className="p-2">
                        <div className="font-medium">
                          {r.title}
                          {r.recommended && r.eligible && (
                            <span className="ml-1.5 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                              Strongest by Corvus&apos;s numbers
                            </span>
                          )}
                        </div>
                        {!r.eligible && <div className="text-xs">{r.basis}</div>}
                      </td>
                      <td className="p-2 text-xs">
                        {r.deadline
                          ? `${fmtDate(r.deadline)}${r.daysLeft != null ? ` · ${r.daysLeft < 0 ? "passed" : `${r.daysLeft} days`}` : ""}`
                          : "60 days from the order"}
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {r.cost
                          ? r.cost.min === r.cost.max
                            ? usd(r.cost.min)
                            : `${usd(r.cost.min)}–${usd(r.cost.max)}`
                          : "—"}
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {r.potentialSavings != null ? usd(r.potentialSavings) : "—"}
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {r.roi != null ? `${r.roi}x` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">No appeal route applies.</p>
          )}
        </div>

        {/* Documents required */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Documents required{missing > 0 ? ` · ${missing} missing` : " · all on file"}
          </h3>
          <ul className="mt-1 grid gap-1.5 text-sm">
            {ph.documents.map((d) => (
              <li key={d.label} className="flex gap-2">
                {d.onFile ? (
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-label="On file" />
                ) : (
                  <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-label="Missing" />
                )}
                <span>
                  <span className="font-medium">{d.label}</span>
                  <span className="text-muted-foreground"> — {d.why}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Prior-year comparison */}
        {ph.priorYear && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Compared with {ph.priorYear.year}
            </h3>
            {ph.priorYear.value != null ? (
              <>
                <Row label={`${ph.priorYear.year} value`} value={usd(ph.priorYear.value)} />
                {ph.priorYear.change != null && (
                  <Row
                    label="Change this year"
                    value={`${ph.priorYear.change > 0 ? "+" : ""}${usd(ph.priorYear.change)}${ph.priorYear.changePct != null ? ` (${ph.priorYear.changePct > 0 ? "+" : ""}${ph.priorYear.changePct}%)` : ""}`}
                    tone={ph.priorYear.change > 0 ? "bad" : "good"}
                  />
                )}
                {ph.priorYear.estimatedTaxChange != null && (
                  <Row
                    label="Estimated tax change"
                    value={`${ph.priorYear.estimatedTaxChange > 0 ? "+" : ""}${usd(ph.priorYear.estimatedTaxChange)} / yr`}
                  />
                )}
                {ph.priorYear.priorOutcome && (
                  <Row label={`${ph.priorYear.year} protest`} value={ph.priorYear.priorOutcome} />
                )}
              </>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                No {ph.priorYear.year} value on file for this property.
              </p>
            )}
          </div>
        )}
      </div>
      <p className="mt-4 text-[11px] text-muted-foreground">
        Estimates from the county record, your case and your bills — confirm deadlines and amounts
        with the appraisal district and tax office.
      </p>
    </section>
  );
}
