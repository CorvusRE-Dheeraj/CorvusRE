import { useState } from "react";
import { toast } from "sonner";
import type { PropertyRecord } from "@/lib/properties";
import type { ProtestRecord } from "@/lib/protests";
import { buildCaseOutcome } from "@/lib/case-outcome";
import {
  confirmSettlementOutcome,
  type SettlementAgreementRecord,
} from "@/lib/settlement-agreement";
import { logCaseEvent } from "@/lib/case-audit";
import { recordEscalation } from "@/lib/protest-case";
import { getDocumentUrl, getDocumentById } from "@/lib/documents";
import { currency } from "@/lib/intake-store";
import { getErrorMessage } from "@/lib/error-message";

type Answer = "satisfied" | "not_satisfied";

const answerKey = (protestId: string) => `corvuspt.outcomeAnswer.${protestId}`;

function readLocalAnswer(protestId: string): Answer | null {
  try {
    const v = localStorage.getItem(answerKey(protestId));
    return v === "satisfied" || v === "not_satisfied" ? v : null;
  } catch {
    return null;
  }
}

const pct = (n: number | null) =>
  n == null ? "—" : `${n.toFixed(n >= 10 ? 1 : 2).replace(/\.?0+$/, "")}%`;

// The Decision tab's answer to "how did this end?": closed at the informal or
// the formal stage, what the settlement/decision says, what it saved in $ and
// %, what the tax comes to now, and whether the owner is happy with it. Renders
// nothing until the case has actually concluded.
export function CaseOutcomeSection({
  userId,
  protest,
  property,
  agreement,
  onAgreementChange,
  onOpenAppeal,
  onUpdate,
}: {
  userId: string;
  protest: ProtestRecord;
  property: PropertyRecord;
  agreement: SettlementAgreementRecord | null;
  onAgreementChange: (a: SettlementAgreementRecord | null) => void;
  onOpenAppeal: () => void;
  onUpdate: (patch: Partial<ProtestRecord>) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [localAnswer, setLocalAnswer] = useState<Answer | null>(() => readLocalAnswer(protest.id));
  const [openingDoc, setOpeningDoc] = useState(false);
  const [choosing, setChoosing] = useState(false);

  const outcome = buildCaseOutcome(property, protest, agreement?.settledValue ?? null);
  if (!outcome) return null;

  // An informal settlement's answer lives on the settlement agreement row; a
  // formal decision has no such row, so it is remembered in this browser and
  // written to the case history.
  const answer: Answer | null = agreement?.outcome ?? localAnswer;

  async function record(next: Answer) {
    setSaving(true);
    try {
      if (agreement && outcome?.stage !== "formal") {
        await confirmSettlementOutcome(protest.id, agreement.id, next);
        onAgreementChange({
          ...agreement,
          outcome: next,
          outcomeConfirmedAt: new Date().toISOString(),
        });
      } else {
        void logCaseEvent(
          protest.id,
          "status_change",
          `Owner ${next === "satisfied" ? "is" : "is not"} satisfied with the ${outcome?.stage === "formal" ? "formal decision" : "outcome"}.`,
          { outcome: next },
        );
        try {
          localStorage.setItem(answerKey(protest.id), next);
        } catch {
          // storage blocked — the case history entry above still records it
        }
        setLocalAnswer(next);
      }
      toast.success(
        next === "satisfied" ? "Glad it worked out — thanks." : "Thanks for telling us.",
      );
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save your answer."));
    } finally {
      setSaving(false);
    }
  }

  async function openSettlementDocument() {
    if (!agreement?.documentId) return;
    setOpeningDoc(true);
    try {
      const doc = await getDocumentById(userId, agreement.documentId);
      if (!doc) throw new Error("Could not find the settlement document.");
      window.open(await getDocumentUrl(doc.storagePath), "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not open the settlement document."));
    } finally {
      setOpeningDoc(false);
    }
  }

  // Unsatisfied with a formal (ARB) result: pick arbitration or a court appeal.
  const escalated = protest.escalationPath === "appeal" || protest.escalationPath === "arbitration";
  const canEscalate = outcome.stage === "formal" && !outcome.closed && !escalated;

  async function escalate(path: "appeal" | "arbitration") {
    setSaving(true);
    try {
      await recordEscalation(protest.id, path);
      onUpdate({ escalationPath: path, status: path === "appeal" ? "appealing" : "arbitrating" });
      setChoosing(false);
      toast.success(
        path === "appeal"
          ? "Recorded — the case moved to a court appeal."
          : "Recorded — the case moved to arbitration.",
      );
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not record this next step."));
    } finally {
      setSaving(false);
    }
  }

  const what = outcome.stage === "formal" ? "decision" : "settlement";
  const rows: [string, string][] = [];
  if (outcome.stage === "informal" && agreement) {
    if (agreement.settledValue != null)
      rows.push(["Settled value", currency(agreement.settledValue)]);
    if (agreement.taxYear) rows.push(["Tax year", agreement.taxYear]);
    if (agreement.accountNumber) rows.push(["Account number", agreement.accountNumber]);
    if (agreement.propertyAddress) rows.push(["Property", agreement.propertyAddress]);
  }
  if (outcome.stage === "formal") {
    if (protest.arbDecision) rows.push(["ARB decision", protest.arbDecision]);
    if (protest.arbDecisionDate) rows.push(["Decision date", protest.arbDecisionDate]);
  }

  return (
    <div className="mt-2 rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-serif text-base font-semibold">How your protest ended</h4>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            outcome.closed ? "bg-success/15 text-success" : "bg-warning/15 text-warning-foreground"
          }`}
        >
          {outcome.stage === "formal"
            ? "Formal hearing (ARB)"
            : outcome.stage === "informal"
              ? "Informal review"
              : "Closed"}
        </span>
      </div>
      <p className="mt-1 text-sm">{outcome.headline}.</p>

      {(rows.length > 0 || agreement?.termsSummary) && (
        <div className="mt-3 rounded-md bg-secondary/40 p-3 text-xs">
          <div className="font-semibold text-foreground">
            {outcome.stage === "formal" ? "Decision details" : "What the settlement document says"}
          </div>
          {rows.length > 0 && (
            <dl className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
              {rows.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-right font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {outcome.stage === "informal" && agreement?.termsSummary && (
            <p className="mt-2 text-muted-foreground">{agreement.termsSummary}</p>
          )}
          {outcome.stage === "informal" && agreement && agreement.discrepancies.length > 0 && (
            <ul className="mt-2 list-disc pl-4 text-warning-foreground">
              {agreement.discrepancies.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
          {outcome.stage === "informal" && agreement?.documentId && (
            <button
              type="button"
              onClick={() => void openSettlementDocument()}
              disabled={openingDoc}
              className="mt-2 text-accent hover:underline disabled:opacity-60"
            >
              {openingDoc ? "Opening…" : "View settlement document"}
            </button>
          )}
        </div>
      )}

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-md border border-border p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Value reduced
          </div>
          <div className="mt-0.5 text-sm">
            {currency(outcome.originalValue)} → <strong>{currency(outcome.finalValue)}</strong>
          </div>
        </div>
        <div className="rounded-md border border-border p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">You saved</div>
          <div className="mt-0.5 text-lg font-semibold text-success">
            {outcome.taxSavings != null ? currency(outcome.taxSavings) : "—"}
            <span className="text-xs font-normal text-muted-foreground"> /yr in tax</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {pct(outcome.valueReductionPct)} lower value
            {outcome.valueReduction != null ? ` (−${currency(outcome.valueReduction)})` : ""}
          </div>
        </div>
        <div className="rounded-md border border-border p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Your tax now
          </div>
          <div className="mt-0.5 text-sm">
            {outcome.taxBefore != null ? currency(outcome.taxBefore) : "—"} →{" "}
            <strong>{outcome.taxAfter != null ? currency(outcome.taxAfter) : "—"}</strong>
          </div>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Tax figures apply your county&apos;s average combined rate (
        {(outcome.taxRate * 100).toFixed(2)}%) to the value change — an estimate; your actual bill
        uses each taxing unit&apos;s exact rate.
      </p>

      <div className="mt-3 border-t border-border pt-3">
        {outcome.stage === "formal" && escalated ? (
          <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            <p className="font-medium">
              Formal hearing result was unsatisfactory, so the case moved to{" "}
              {protest.escalationPath === "appeal" ? "a court appeal" : "arbitration"}.
            </p>
            <button
              type="button"
              onClick={onOpenAppeal}
              className="mt-1.5 text-xs text-accent hover:underline"
            >
              Open Appeal / Arbitration →
            </button>
          </div>
        ) : (
          <>
            <div className="text-sm font-medium">Are you happy with this {what}?</div>
            {choosing && canEscalate ? (
              <div className="mt-2 rounded-md border border-border p-3">
                <p className="text-sm">
                  Do you want to proceed with arbitration or a court appeal?
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void escalate("arbitration")}
                    disabled={saving}
                    className="btn-accent text-xs py-1.5 disabled:opacity-60"
                  >
                    Arbitration
                  </button>
                  <button
                    type="button"
                    onClick={() => void escalate("appeal")}
                    disabled={saving}
                    className="btn-accent text-xs py-1.5 disabled:opacity-60"
                  >
                    Court appeal
                  </button>
                  <button
                    type="button"
                    onClick={() => setChoosing(false)}
                    disabled={saving}
                    className="text-xs text-muted-foreground hover:underline"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : answer ? (
              <div className="mt-1.5 text-xs">
                <span className="badge-soft">
                  {answer === "satisfied" ? "Happy with it" : "Not happy with it"}
                </span>
                {answer === "not_satisfied" && (
                  <p className="mt-1.5 text-muted-foreground">
                    If you think the value is still too high, you may have options — see Appeal /
                    Arbitration.{" "}
                    <button
                      type="button"
                      onClick={onOpenAppeal}
                      className="text-accent hover:underline"
                    >
                      Review my options →
                    </button>
                  </p>
                )}
                <button
                  type="button"
                  onClick={() =>
                    canEscalate && answer === "satisfied"
                      ? setChoosing(true)
                      : void record(answer === "satisfied" ? "not_satisfied" : "satisfied")
                  }
                  disabled={saving}
                  className="mt-1.5 block text-muted-foreground hover:underline disabled:opacity-60"
                >
                  Change my answer
                </button>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void record("satisfied")}
                  disabled={saving}
                  className="btn-accent text-xs py-1.5 disabled:opacity-60"
                >
                  Yes, I&apos;m happy
                </button>
                <button
                  type="button"
                  onClick={() => (canEscalate ? setChoosing(true) : void record("not_satisfied"))}
                  disabled={saving}
                  className="btn-outline text-xs py-1.5 disabled:opacity-60"
                >
                  {canEscalate ? "Unsatisfied" : "No, I'm not"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
