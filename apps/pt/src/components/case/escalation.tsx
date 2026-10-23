// Post-hearing options: arbitration vs court appeal comparison (split out of CaseDetailModal.tsx).
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { askAboutDocument } from "@/lib/document-ai";
import { MarkdownLite } from "@/components/MarkdownLite";
import { type PropertyRecord } from "@/lib/properties";
import { type ProtestRecord } from "@/lib/protests";
import { currency } from "@/lib/intake-store";
import { recordEscalation, closeCase } from "@/lib/protest-case";
import {
  evaluateEscalation,
  type EscalationOption,
  type EscalationEvaluation,
} from "@/lib/escalation-eval";

// --- Tabbed filing workflow -------------------------------------------------
// The case work is grouped into 5 phase tabs, all shown as a roadmap; a phase
// the case hasn't reached yet is visible but locked. The tab set and lock
// rules are derived purely from the protest's real status/fields — no schema,
// no new state beyond which tab is open.
// Fired by the Arbitration / Court Appeal tab's intro line; the option comparison
// listens and runs its AI comparison.
const COMPARE_ESCALATION_EVENT = "corvuspt:compare-escalation";

// "Escalation May Be Available" — shown only once the informal review and the
// formal ARB hearing have both closed unfavourably (see evaluateEscalation's
// availability gate). Every figure is deterministic (escalation-eval.ts): the
// statutory deadline windows, the real Comptroller deposit schedule, savings
// from the value gap × the county effective tax rate. It is explicitly an
// evaluation of options, not a prediction — the disclaimer says so and so
// does every option row.
export function EscalationEvaluationSection({
  protest,
  property,
  evidenceDocumentCount,
  onUpdate,
  onChosen,
}: {
  protest: ProtestRecord;
  property: PropertyRecord;
  evidenceDocumentCount: number;
  onUpdate: (patch: Partial<ProtestRecord>) => void;
  // Called after a path is recorded, so the page can jump to that path's tab.
  onChosen?: (path: "appeal" | "arbitration") => void;
}) {
  const [comparison, setComparison] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [opinionInput, setOpinionInput] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [showApprove, setShowApprove] = useState(false);
  const [approveId, setApproveId] = useState("");
  const [showClose, setShowClose] = useState(false);
  const [closeValue, setCloseValue] = useState(String(protest.finalValue ?? ""));
  const [busy, setBusy] = useState(false);

  const opinionOfValue = opinionInput ? Number(opinionInput.replace(/[^0-9.]/g, "")) : null;
  const evalr: EscalationEvaluation = evaluateEscalation(
    property,
    protest,
    evidenceDocumentCount,
    opinionOfValue && opinionOfValue > 0 ? opinionOfValue : null,
  );
  const compareRef = useRef<() => void>(() => {});
  compareRef.current = () => void compareWithAi();
  useEffect(() => {
    const run = () => compareRef.current();
    window.addEventListener(COMPARE_ESCALATION_EVENT, run);
    return () => window.removeEventListener(COMPARE_ESCALATION_EVENT, run);
  }, []);
  if (!evalr.available) return null;

  async function compareWithAi() {
    if (comparing || !evalr.available) return;
    setComparing(true);
    try {
      const lines = evalr.options.map(
        (o) =>
          `- ${o.title} (${o.statute}): ${o.eligible ? "available" : "not available"}; deadline ${o.deadline.date ?? "n/a"}; ` +
          `est. cost ${o.estimatedCost ? `${currency(o.estimatedCost.min)}-${currency(o.estimatedCost.max)}` : "n/a"}; ` +
          `added savings/yr ${o.potentialAdditionalSavings.amount != null ? currency(o.potentialAdditionalSavings.amount) : "n/a"}; ` +
          `ROI ${o.estimatedRoi.ratio != null ? `${o.estimatedRoi.ratio}x` : "n/a"}; evidence ${o.evidenceStrength}; risk ${o.risk.band}. ${o.practicalBenefit}`,
      );
      const { answer } = await askAboutDocument({
        question:
          "Compare these remedies for my case in plain language: binding arbitration versus a district-court appeal (and any other listed option). " +
          "Reply as short bullets under these labels: Best fit for my case; Arbitration vs court appeal; Main risks; Questions to ask the county or an attorney. " +
          "Use only the data below. Do not give legal advice or predict outcomes; remind me to verify deadlines with the county.",
        context:
          `CASE: ${property.address}; ARB decision ${protest.arbDecision ?? "n/a"}; original value ${protest.originalValue ?? "n/a"}; final value ${protest.finalValue ?? "n/a"}.\n` +
          `HEADLINE: ${evalr.headline}\nMARKET-DISCONNECT EVIDENCE: ${evalr.marketDisconnectEvidence.narrative}\n` +
          `OPTIONS:\n${lines.join("\n")}`,
      });
      setComparison(answer);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not compare the options.");
    } finally {
      setComparing(false);
    }
  }

  const eligibleValueRemedies = evalr.options.filter(
    (o) =>
      o.eligible &&
      (o.id === "binding_arbitration" || o.id === "district_court" || o.id === "soah"),
  );
  const recommended = evalr.options.find((o) => o.recommended) ?? null;
  const pathFor = (id: string): "appeal" | "arbitration" =>
    id === "district_court" ? "appeal" : "arbitration";

  async function approveEscalation() {
    const id = approveId || recommended?.id || eligibleValueRemedies[0]?.id;
    if (!id || id === "no_further_action") return;
    const path = pathFor(id);
    setBusy(true);
    try {
      await recordEscalation(protest.id, path);
      onUpdate({ escalationPath: path, status: path === "appeal" ? "appealing" : "arbitrating" });
      toast.success(
        path === "appeal"
          ? "Recorded — district court appeal. This proceeds outside CorvusPT."
          : "Recorded — binding arbitration. This is handled with the Comptroller's office.",
      );
      setShowApprove(false);
      onChosen?.(path);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record this next step.");
    } finally {
      setBusy(false);
    }
  }

  async function closeNow(e: FormEvent) {
    e.preventDefault();
    if (!closeValue) return;
    setBusy(true);
    try {
      const finalValue = Number(closeValue);
      await closeCase(protest.id, finalValue);
      onUpdate({ finalValue, closedAt: new Date().toISOString(), status: "resolved" });
      toast.success("Case closed.");
      setShowClose(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not close this case.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div id="case-escalation" className="mt-5 border-t border-border pt-5">
      <h2 className="text-sm font-semibold">Escalation May Be Available</h2>
      <p className="mt-1 text-sm text-foreground">{evalr.headline}</p>
      <p className="mt-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] leading-snug text-warning-foreground">
        {evalr.disclaimer}
      </p>

      {evalr.marketDisconnectEvidence.available && (
        <div
          className={`mt-3 rounded-md border px-3 py-2 text-xs leading-relaxed ${
            evalr.marketDisconnectEvidence.overCeiling
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-border bg-muted/40 text-muted-foreground"
          }`}
        >
          <span className="font-semibold">
            {evalr.marketDisconnectEvidence.overCeiling
              ? "Statistical evidence: "
              : "Countywide ratio study: "}
          </span>
          {evalr.marketDisconnectEvidence.narrative}{" "}
          <a
            href={evalr.marketDisconnectEvidence.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            Source: Texas Comptroller ratio study
          </a>
        </div>
      )}

      <label className="mt-3 block text-xs font-medium text-muted-foreground">
        Your opinion of value (optional — enables the savings &amp; ROI columns)
        <input
          inputMode="numeric"
          value={opinionInput}
          onChange={(e) => setOpinionInput(e.target.value)}
          placeholder="e.g. 11,000,000"
          className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
        />
      </label>

      <ul className="mt-3 grid gap-2">
        {evalr.options.map((o) => (
          <EscalationOptionRow key={o.id} o={o} expanded={expanded} />
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="btn-outline text-sm py-1.5"
        >
          {expanded ? "Hide detail" : "Review Escalation"}
        </button>
        <button
          type="button"
          onClick={() => void compareWithAi()}
          disabled={comparing}
          className="btn-outline text-sm py-1.5 disabled:opacity-60"
        >
          {comparing ? "Comparing…" : comparison ? "Compare again with AI" : "Compare with AI"}
        </button>
        {eligibleValueRemedies.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setApproveId(recommended?.id ?? eligibleValueRemedies[0].id);
              setShowApprove((v) => !v);
              setShowClose(false);
            }}
            className="btn-primary text-sm py-1.5"
          >
            Approve Escalation
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setShowClose((v) => !v);
            setShowApprove(false);
          }}
          className="btn-outline text-sm py-1.5"
        >
          Close Case
        </button>
      </div>

      {comparison && (
        <div className="mt-3 rounded-md border border-border bg-secondary/30 p-3">
          <div className="text-xs font-semibold">AI comparison of your options</div>
          <MarkdownLite text={comparison} className="mt-1 text-xs text-muted-foreground" />
        </div>
      )}

      {showApprove && eligibleValueRemedies.length > 0 && (
        <div className="mt-3 rounded-md border border-border p-3">
          <label className="block text-xs font-medium text-muted-foreground">
            Record which escalation you're pursuing
            <select
              value={approveId}
              onChange={(e) => setApproveId(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
            >
              {eligibleValueRemedies.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title} ({o.statute})
                </option>
              ))}
            </select>
          </label>
          <p className="mt-2 text-[11px] text-muted-foreground">
            This records your decision on the case. CorvusPT does not file the arbitration request
            or court petition for you — you or your attorney do that with the appraisal district by
            the deadline shown above.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={approveEscalation}
            className="btn-primary mt-2 text-sm py-1.5 disabled:opacity-60"
          >
            {busy ? "Recording…" : "Confirm"}
          </button>
        </div>
      )}

      {showClose && (
        <form onSubmit={closeNow} className="mt-3 rounded-md border border-border p-3">
          <label className="block text-xs font-medium text-muted-foreground">
            Final value to record
            <input
              inputMode="numeric"
              value={closeValue}
              onChange={(e) => setCloseValue(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !closeValue}
            className="btn-primary mt-2 text-sm py-1.5 disabled:opacity-60"
          >
            {busy ? "Closing…" : "Close case at this value"}
          </button>
        </form>
      )}
    </div>
  );
}

function EscalationOptionRow({ o, expanded }: { o: EscalationOption; expanded: boolean }) {
  return (
    <li
      className={`rounded-md border p-3 text-sm ${
        o.recommended ? "border-success/50 bg-success/5" : "border-border"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-foreground">{o.title}</span>
        <span className="text-[11px] text-muted-foreground">{o.statute}</span>
        {o.recommended && (
          <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">
            Suggested
          </span>
        )}
        {!o.eligible && (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
            Not available
          </span>
        )}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Deadline</dt>
          <dd className="font-medium">
            {o.deadline.date
              ? new Date(`${o.deadline.date}T00:00:00`).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Est. cost</dt>
          <dd className="font-medium">
            {o.estimatedCost
              ? o.estimatedCost.min === o.estimatedCost.max
                ? currency(o.estimatedCost.min)
                : `${currency(o.estimatedCost.min)}–${currency(o.estimatedCost.max)}`
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Added savings / yr</dt>
          <dd className="font-medium">
            {o.potentialAdditionalSavings.amount != null
              ? currency(o.potentialAdditionalSavings.amount)
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Est. ROI</dt>
          <dd className="font-medium">
            {o.estimatedRoi.ratio != null ? `${o.estimatedRoi.ratio}×` : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Evidence</dt>
          <dd className="font-medium capitalize">{o.evidenceStrength}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Risk</dt>
          <dd className="font-medium capitalize">{o.risk.band}</dd>
        </div>
      </dl>
      {expanded && (
        <div className="mt-2 space-y-1 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
          <p>{o.practicalBenefit}</p>
          <p>
            <span className="font-medium text-foreground">Eligibility:</span> {o.eligibilityBasis}
          </p>
          <p>
            <span className="font-medium text-foreground">Deadline basis:</span> {o.deadline.basis}
          </p>
          {o.estimatedCost && (
            <p>
              <span className="font-medium text-foreground">Cost basis:</span>{" "}
              {o.estimatedCost.basis}
            </p>
          )}
          <p>
            <span className="font-medium text-foreground">Savings basis:</span>{" "}
            {o.potentialAdditionalSavings.basis}
          </p>
          <p>
            <span className="font-medium text-foreground">Risk basis:</span> {o.risk.basis}
          </p>
        </div>
      )}
    </li>
  );
}
