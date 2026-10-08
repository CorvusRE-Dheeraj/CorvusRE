import { useEffect, useState } from "react";
import { History } from "lucide-react";
import {
  compareOffer,
  getSettlementBenchmark,
  type SettlementBenchmark,
} from "@/lib/settlement-history";

const pct = (n: number) => `${n}%`;

// How similar protests actually settled (historical settlement database),
// and — given an informal offer — where that offer falls among them.
export function SettlementHistory({
  cad,
  propertyType,
  value,
  offer,
  compact,
}: {
  cad: string | null;
  propertyType: string | null;
  value: number | null;
  offer?: { original: number; offer: number } | null;
  compact?: boolean;
}) {
  const [b, setB] = useState<SettlementBenchmark | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    getSettlementBenchmark({ cad, propertyType, value })
      .then((r) => !cancelled && setB(r))
      .catch(() => !cancelled && setB(null));
    return () => {
      cancelled = true;
    };
  }, [cad, propertyType, value]);

  if (!b) return null;
  const offerLine = offer ? compareOffer(b, offer.original, offer.offer) : null;

  return (
    <section
      aria-label="Settlement history"
      className={`rounded-lg border border-border ${compact ? "p-3" : "p-4"}`}
    >
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 text-accent" aria-hidden="true" />
        <h3 className="text-sm font-semibold">How similar protests settled</h3>
      </div>
      {offerLine && <p className="mt-1.5 text-sm font-medium">{offerLine}</p>}
      {b.kind === "published_average" ? (
        <p className="mt-1.5 text-sm text-muted-foreground">
          {b.cad ?? "This county"} doesn&apos;t publish protest-by-protest outcomes. Its published
          average reduction for {b.label.toLowerCase()} is about {pct(b.averageCutPct)}.
        </p>
      ) : (
        <div className="mt-1.5 grid gap-2 text-sm">
          <p>
            <span className="font-medium">{b.label}</span>, {b.latest.taxYear}:{" "}
            {b.latest.protests.toLocaleString("en-US")} protests —{" "}
            <span className="font-semibold">{pct(b.latest.reducedPct)}</span> got a reduction, a
            median <span className="font-semibold">{pct(b.latest.medianCutPct)}</span> (middle half{" "}
            {b.latest.p25CutPct}–{b.latest.p75CutPct}%)
            {b.latest.medianCutWhenReducedPct != null
              ? `; ${pct(b.latest.medianCutWhenReducedPct)} when reduced`
              : ""}
            .
          </p>
          {!compact && (
            <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
              {b.byRepresentation.owner && b.byRepresentation.agent && (
                <div>
                  Owners representing themselves: median{" "}
                  {pct(b.byRepresentation.owner.medianCutPct)} (
                  {b.byRepresentation.owner.protests.toLocaleString("en-US")}) · with an agent:{" "}
                  {pct(b.byRepresentation.agent.medianCutPct)} (
                  {b.byRepresentation.agent.protests.toLocaleString("en-US")})
                </div>
              )}
              {b.byStage.informal && b.byStage.formal && (
                <div>
                  Settled informally: median {pct(b.byStage.informal.medianCutPct)} · scheduled for
                  the ARB: {pct(b.byStage.formal.medianCutPct)}
                </div>
              )}
              {b.trend.length > 1 && (
                <div className="sm:col-span-2">
                  Median by year:{" "}
                  {b.trend.map((t) => `${t.taxYear} ${pct(t.medianCutPct)}`).join(" · ")}
                </div>
              )}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            From {b.source}. Past outcomes for similar properties, not a prediction for this one.
          </p>
        </div>
      )}
    </section>
  );
}
