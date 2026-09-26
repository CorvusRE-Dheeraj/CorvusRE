import { createContext, useContext } from "react";
import { FileSearch, TrendingDown, TrendingUp } from "lucide-react";
import type { EvidenceAdjustment } from "@/lib/evidence-value";

export type EvidenceImpact = {
  adjustment: EvidenceAdjustment;
  // Estimated yearly tax savings before and after the evidence was taken into account.
  beforeAmount: number;
  afterAmount: number;
  // True while uploaded files are still being read.
  reading: boolean;
  evidenceCount: number;
};

export const EvidenceImpactContext = createContext<EvidenceImpact | null>(null);

const money = (v: number) => `$${Math.round(v).toLocaleString()}`;

// Shows the owner what their uploaded evidence did to the numbers: the AI reads each file, and the
// score and the estimated savings are recomputed from what it found. Only changes when evidence
// is added or removed, never on a refresh.
export function EvidenceImpactCard() {
  const ctx = useContext(EvidenceImpactContext);
  if (!ctx) return null;
  const { adjustment: a, beforeAmount, afterAmount, reading, evidenceCount } = ctx;

  if (reading) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-secondary/40 p-3 text-xs">
        <FileSearch className="h-4 w-4 shrink-0 animate-pulse text-accent" />
        Reading your uploaded evidence to update your score and savings…
      </div>
    );
  }

  if (!a.applied) {
    if (evidenceCount === 0) {
      return (
        <p className="mt-3 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
          Upload evidence (an independent appraisal, repair estimates, income statements) and our AI
          will read it, then raise or lower your score and estimated savings to match.
        </p>
      );
    }
    return (
      <p className="mt-3 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
        Your {evidenceCount} uploaded file{evidenceCount === 1 ? "" : "s"} did not include a value
        we could use (an appraisal value, repair total, or income with a cap rate). Add one to move
        your score and savings.
        {a.ignored.length > 0 && <span className="mt-1 block">{a.ignored[0]}</span>}
      </p>
    );
  }

  const diff = afterAmount - beforeAmount;
  const up = diff > 0;
  const same = Math.abs(diff) < 1;
  return (
    <section
      aria-label="What your evidence changed"
      className="mt-3 rounded-lg border border-accent/30 bg-accent/5 p-3 text-left text-xs"
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        {same ? (
          <FileSearch className="h-4 w-4 text-accent" />
        ) : up ? (
          <TrendingUp className="h-4 w-4 text-emerald-700" />
        ) : (
          <TrendingDown className="h-4 w-4 text-amber-700" />
        )}
        What your evidence changed
      </div>
      <p className="mt-1 text-muted-foreground">
        {same
          ? "Your evidence matches our estimate, so your savings figure stays about the same."
          : up
            ? `Your evidence points to a lower value than the county's. Estimated yearly savings went from ${money(beforeAmount)} to ${money(afterAmount)}.`
            : `Your evidence points to a value closer to the county's. Estimated yearly savings went from ${money(beforeAmount)} to ${money(afterAmount)}.`}{" "}
        Your protest score was updated the same way.
      </p>
      <ul className="mt-2 grid gap-1">
        {a.contributions.map((c, i) => (
          <li key={i}>
            <span className="font-medium">{c.label}:</span>{" "}
            <span className="text-muted-foreground">{c.detail}</span>
          </li>
        ))}
        {a.ignored.map((n, i) => (
          <li key={`ig-${i}`} className="text-muted-foreground">
            Not used: {n}
          </li>
        ))}
      </ul>
    </section>
  );
}
