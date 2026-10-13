import type { CaseOutcome } from "@/lib/case-outcome";
import { currency } from "@/lib/intake-store";

const pct = (n: number | null) => (n == null ? "—" : `${n.toFixed(n < 10 ? 1 : 0)}%`);

// The three outcome tiles (value, savings or increase, tax), shared by the
// Decision tab and the closed-case view. A value can go up as well as down —
// an increase is shown as one, in red, never as a "reduction" with $0 saved.
export function OutcomeFigures({ outcome }: { outcome: CaseOutcome }) {
  const up = outcome.direction === "increased";
  const same = outcome.direction === "unchanged";
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-3">
      <div className="rounded-md border border-border p-3">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {up ? "Value increased" : same ? "Value unchanged" : "Value reduced"}
        </div>
        <div className="mt-0.5 text-sm">
          {currency(outcome.originalValue)} →{" "}
          <strong className={up ? "text-destructive" : ""}>{currency(outcome.finalValue)}</strong>
        </div>
      </div>
      <div
        className={`rounded-md border p-3 ${up ? "border-destructive/40 bg-destructive/5" : "border-border"}`}
      >
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {up ? "Tax increase" : "You saved"}
        </div>
        {up ? (
          <>
            <div className="mt-0.5 text-lg font-semibold text-destructive">
              +{outcome.taxIncrease != null ? currency(outcome.taxIncrease) : "—"}
              <span className="text-xs font-normal text-muted-foreground"> /yr in tax</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {pct(outcome.valueIncreasePct)} higher value
              {outcome.valueIncrease != null ? ` (+${currency(outcome.valueIncrease)})` : ""}
            </div>
          </>
        ) : (
          <>
            <div className="mt-0.5 text-lg font-semibold text-success">
              {outcome.taxSavings != null ? currency(outcome.taxSavings) : "—"}
              <span className="text-xs font-normal text-muted-foreground"> /yr in tax</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {same
                ? "No change in value"
                : `${pct(outcome.valueReductionPct)} lower value${
                    outcome.valueReduction != null ? ` (−${currency(outcome.valueReduction)})` : ""
                  }`}
            </div>
          </>
        )}
      </div>
      <div className="rounded-md border border-border p-3">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Your tax now
        </div>
        <div className="mt-0.5 text-sm">
          {outcome.taxBefore != null ? currency(outcome.taxBefore) : "—"} →{" "}
          <strong className={up ? "text-destructive" : ""}>
            {outcome.taxAfter != null ? currency(outcome.taxAfter) : "—"}
          </strong>
        </div>
      </div>
    </div>
  );
}
