// What the protest actually ended at — for the Decision tab. Pure: every figure
// is a straight function of real fields on the case (original / final value)
// and the county's effective tax rate (texas-tax-rates.ts, the same rate the
// Module 9 final summary uses). Nothing here is an AI read or a guarantee; the
// tax figures are the value change multiplied by that effective rate.
import type { PropertyRecord } from "./properties";
import type { ProtestRecord } from "./protests";
import { getEffectiveTaxRate } from "./texas-tax-rates";

export type CaseOutcomeStage = "informal" | "formal";

export type CaseOutcome = {
  // Where it ended: an accepted informal settlement, or an ARB (formal) decision.
  // null = the case is closed/decided but neither route can be told apart.
  stage: CaseOutcomeStage | null;
  closed: boolean;
  headline: string;
  originalValue: number | null;
  finalValue: number | null;
  valueReduction: number | null;
  valueReductionPct: number | null;
  taxRate: number;
  taxBefore: number | null;
  taxAfter: number | null;
  taxSavings: number | null;
};

export function buildCaseOutcome(
  property: PropertyRecord,
  protest: ProtestRecord,
  settledValue: number | null = null,
): CaseOutcome | null {
  const resolved = protest.status === "resolved";
  const informalAccepted = protest.informalStatus === "accepted";
  const formalDecided = protest.arbDecision != null;
  if (!resolved && !informalAccepted && !formalDecided) return null;

  // A formal decision wins if both exist (an informal offer was rejected, then
  // the ARB ruled); an accepted informal offer with no ARB decision is informal.
  const stage: CaseOutcomeStage | null = formalDecided
    ? "formal"
    : informalAccepted
      ? "informal"
      : null;

  const original = protest.originalValue ?? property.totalValue ?? null;
  const final =
    protest.finalValue ??
    (stage === "informal" ? (settledValue ?? protest.settlementOfferValue ?? null) : null);

  const reduction = original != null && final != null ? Math.max(0, original - final) : null;
  const pct =
    reduction != null && original != null && original > 0 ? (reduction / original) * 100 : null;

  const taxRate = getEffectiveTaxRate(property.cad);
  const taxBefore = original != null ? Math.round(original * taxRate) : null;
  const taxAfter = final != null ? Math.round(final * taxRate) : null;
  const taxSavings =
    taxBefore != null && taxAfter != null ? Math.max(0, taxBefore - taxAfter) : null;

  const headline =
    stage === "informal"
      ? resolved
        ? "Protest closed at the informal review"
        : "Informal settlement accepted — not yet closed"
      : stage === "formal"
        ? resolved
          ? "Protest closed after the formal hearing (ARB)"
          : "Decided at the formal hearing (ARB) — not yet closed"
        : "Protest closed";

  return {
    stage,
    closed: resolved,
    headline,
    originalValue: original,
    finalValue: final,
    valueReduction: reduction,
    valueReductionPct: pct,
    taxRate,
    taxBefore,
    taxAfter,
    taxSavings,
  };
}
