import { createContext, useContext } from "react";
import { FileSearch, TrendingDown, TrendingUp } from "lucide-react";
import { moduleLabel, type EvidenceAdjustment, type ModuleKey } from "@/lib/evidence-value";

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

const IMPORTANCE_STYLE = {
  Critical: "bg-emerald-600 text-white",
  Strong: "bg-emerald-500/20 text-emerald-800 dark:text-emerald-300",
  Moderate: "bg-amber-500/20 text-amber-800 dark:text-amber-300",
  Minor: "bg-secondary text-muted-foreground",
} as const;

// Shows the owner what their uploaded evidence did to the numbers: the AI reads each file and rates
// how important it is, and the scores and the estimated savings move in proportion — a critical file
// moves them a lot, a minor one a little, and evidence that backs the county moves them down. Only
// changes when evidence is added or removed, never on a refresh.
export function EvidenceImpactCard() {
  const ctx = useContext(EvidenceImpactContext);
  if (!ctx) return null;
  const { adjustment: a, beforeAmount, afterAmount, reading, evidenceCount } = ctx;

  if (reading) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-secondary/40 p-3 text-xs">
        <FileSearch className="h-4 w-4 shrink-0 animate-pulse text-accent" />
        Reading your uploaded evidence and rating how important it is…
      </div>
    );
  }

  if (!a.applied) {
    if (evidenceCount === 0) {
      return (
        <p className="mt-3 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
          Upload evidence (an independent appraisal, repair estimates, income statements, sales) and
          our AI will read it, rate how important it is, then raise or lower your scores and
          estimated savings to match. The more important the evidence, the bigger the change.
        </p>
      );
    }
    return (
      <p className="mt-3 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
        Your {evidenceCount} uploaded file{evidenceCount === 1 ? "" : "s"} did not include anything
        we could use to change the numbers (such as an appraisal value, a repair total, or income
        with a cap rate).
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
        Your scores moved by how important each file is.
      </p>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">
          Overall evidence strength: {Math.round(a.strength * 100)}%
        </span>
        {(Object.keys(a.moduleUplift) as ModuleKey[])
          .filter((m) => a.moduleUplift[m] !== 0)
          .map((m) => (
            <span key={m} className={a.moduleUplift[m] > 0 ? "text-emerald-700" : "text-amber-700"}>
              {moduleLabel(m)} {a.moduleUplift[m] > 0 ? "+" : ""}
              {a.moduleUplift[m]}
            </span>
          ))}
      </p>
      <ul className="mt-2 grid gap-2">
        {a.contributions.map((c, i) => (
          <li key={c.docId ?? i} className="rounded-md border border-border bg-background/60 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${IMPORTANCE_STYLE[c.importance]}`}
              >
                {c.importance} · {c.weightPct}%
              </span>
              <span className="font-medium">{c.label}</span>
              {c.fileName && (
                <span className="truncate text-[11px] text-muted-foreground">{c.fileName}</span>
              )}
            </div>
            <p className="mt-1 text-muted-foreground">{c.detail}</p>
            {c.reason && <p className="mt-0.5 text-muted-foreground/80">Why: {c.reason}</p>}
            {c.effects.length > 0 && (
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                {c.effects.map((e) => (
                  <span
                    key={e.module}
                    className={e.points > 0 ? "text-emerald-700" : "text-amber-700"}
                  >
                    {moduleLabel(e.module)} {e.points > 0 ? "+" : ""}
                    {e.points}
                  </span>
                ))}
              </p>
            )}
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
