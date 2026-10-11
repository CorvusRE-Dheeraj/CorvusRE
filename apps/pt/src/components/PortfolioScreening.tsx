import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { PropertyRecord } from "@/lib/properties";
import type { PortfolioScreening as Screening, ScreeningTier } from "@/lib/portfolio-screening";

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

const TIER: Record<ScreeningTier, { label: string; tone: string; dot: string }> = {
  high: { label: "High priority", tone: "text-success", dot: "bg-success" },
  moderate: { label: "Moderate", tone: "text-warning-foreground", dot: "bg-warning" },
  low: {
    label: "Probably not worth protesting",
    tone: "text-muted-foreground",
    dot: "bg-muted-foreground/50",
  },
};

// Free portfolio screening (lib/portfolio-screening.ts): every property the
// owner hasn't activated, sorted by Corvus into high-priority, moderate and
// low-priority cases — so they pay only to activate the ones worth it.
export function PortfolioScreening({
  screening,
  onActivate,
}: {
  screening: Screening;
  onActivate: (p: PropertyRecord) => void;
}) {
  const [open, setOpen] = useState<ScreeningTier | null>("high");
  const { counts, highSavings } = screening;
  const total = screening.screened.length;

  return (
    <section aria-labelledby="screening-title" className="card-elev mt-6 p-5">
      <div className="text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">
        Free portfolio screening
      </div>
      <h2 id="screening-title" className="mt-1 font-serif text-xl font-semibold">
        Corvus AI screened {total} {total === 1 ? "property" : "properties"}
      </h2>
      <ul className="mt-2 grid gap-1 text-sm">
        <li>
          <span className="font-semibold">{counts.low}</span> {counts.low === 1 ? "is" : "are"}{" "}
          probably not worth protesting.
        </li>
        <li>
          <span className="font-semibold">{counts.moderate}</span>{" "}
          {counts.moderate === 1 ? "is a moderate case" : "are moderate cases"}.
        </li>
        <li>
          <span className="font-semibold text-success">{counts.high}</span>{" "}
          {counts.high === 1 ? "is a high-priority case" : "are high-priority cases"}
          {highSavings > 0 && (
            <>
              {" "}
              representing approximately{" "}
              <span className="font-semibold text-success">{usd(highSavings)}</span> of potential
              annual savings
            </>
          )}
          .
        </li>
      </ul>
      {screening.pending > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          {screening.pending} still being scored — the screening updates as each finishes.
        </p>
      )}

      <div className="mt-4 grid gap-2">
        {(["high", "moderate", "low"] as const)
          .filter((t) => counts[t] > 0)
          .map((t) => {
            const rows = screening.screened.filter((s) => s.tier === t);
            const isOpen = open === t;
            return (
              <div key={t} className="rounded-lg border border-border">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : t)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm"
                >
                  <span className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${TIER[t].dot}`} aria-hidden="true" />
                    <span className={`font-semibold ${TIER[t].tone}`}>{TIER[t].label}</span>
                    <span className="text-muted-foreground">({rows.length})</span>
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
                    aria-hidden="true"
                  />
                </button>
                {isOpen && (
                  <ul className="divide-y divide-border border-t border-border">
                    {rows.map((s) => (
                      <li
                        key={s.property.id}
                        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{s.property.address}</div>
                          <div className="text-xs text-muted-foreground">{s.reason}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          {s.savings != null && s.savings > 0 && (
                            <span className="text-sm tabular-nums text-muted-foreground">
                              ~{usd(s.savings)}/yr
                            </span>
                          )}
                          {t !== "low" && (
                            <button
                              type="button"
                              onClick={() => onActivate(s.property)}
                              className={
                                t === "high"
                                  ? "btn-primary btn-primary-hover text-sm"
                                  : "btn-outline text-sm"
                              }
                            >
                              Activate case
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        Screening is free. You pay only to activate a case. CorvusPT earns the same per property
        either way, so it has no reason to enroll a case it doesn&apos;t think is worth it.
        Estimates come from your county record and comparables; they aren&apos;t a guarantee of any
        outcome.
      </p>
    </section>
  );
}
