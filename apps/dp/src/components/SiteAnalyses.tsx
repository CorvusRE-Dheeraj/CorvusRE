import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import {
  GRADE_LABEL,
  access,
  floodplain,
  grading,
  runSiteAnalysis,
  type SiteAnalysisRaw,
} from "@/lib/site-analysis";
import { Pill } from "@/components/dp-ui";

type Program = Parameters<typeof access>[1];
const FLOOD_TONE = {
  floodway: "red",
  sfha: "red",
  moderate: "amber",
  minimal: "green",
  undetermined: "amber",
  unknown: "gray",
} as const;
const GRADE_TONE = {
  very_flat: "amber",
  gentle: "green",
  moderate: "amber",
  steep: "red",
  very_steep: "red",
} as const;
const TIA_TONE = {
  likely: "red",
  possible: "amber",
  unlikely: "green",
  needs_info: "gray",
} as const;
const TIA_LABEL = {
  likely: "TIA likely required",
  possible: "TIA possibly required",
  unlikely: "TIA unlikely",
  needs_info: "TIA: needs building area",
} as const;

// Site grading, floodplain and ingress/egress for the Site Data pages — run
// from public FEMA / USGS / Census data the first time the page opens (then
// saved; "Refresh" re-runs it), interpreted by lib/site-analysis.ts.
export function SiteAnalyses({
  target,
  address,
  raw,
  program,
  refetch,
}: {
  target: { projectId: string } | { designRequestId: string };
  address: string | null;
  raw: SiteAnalysisRaw | null;
  program: Program;
  refetch: () => unknown;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tried = useRef(false);
  async function run() {
    setBusy(true);
    setError(null);
    try {
      await runSiteAnalysis(target);
      await refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't run the site analyses.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (raw || !address || tried.current) return;
    tried.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, address]);

  const g = grading(raw),
    f = floodplain(raw),
    a = access(raw, program);
  const card = (title: string, pill: React.ReactNode, body: React.ReactNode, err?: string) => (
    <div className="rounded-lg border border-border p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{title}</span>
        {pill}
      </div>
      {err ? (
        <p className="mt-2 text-xs text-red-700">
          Couldn&apos;t load this one ({err}). Try Refresh.
        </p>
      ) : (
        body
      )}
    </div>
  );
  const list = (items: string[]) => (
    <ul className="mt-2 grid gap-1 text-xs text-muted-foreground">
      {items.map((n, i) => (
        <li key={i} className="flex gap-1.5">
          <span aria-hidden>•</span>
          <span>{n}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="mt-5" aria-labelledby="site-analyses-h">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div id="site-analyses-h" className="text-sm font-semibold">
          Site grading, floodplain &amp; access
        </div>
        {address && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run()}
            className="btn-outline inline-flex items-center gap-1.5 text-xs"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            )}
            {busy ? "Analyzing…" : raw ? "Refresh" : "Run analysis"}
          </button>
        )}
      </div>
      {!address && (
        <p className="mt-2 text-sm text-muted-foreground">
          Add the property address to run these analyses.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-2 rounded-lg border border-red-400/40 bg-red-400/10 p-3 text-sm"
        >
          {error}
        </p>
      )}
      {busy && !raw && (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Checking FEMA flood maps, USGS
          elevations and nearby roads…
        </p>
      )}
      {raw && (
        <>
          <div className="mt-2 grid gap-3 lg:grid-cols-3">
            {card(
              "Site Grading",
              g ? <Pill tone={GRADE_TONE[g.grade]}>{GRADE_LABEL[g.grade]}</Pill> : null,
              g && (
                <>
                  <p className="mt-2 text-base font-semibold tabular-nums">
                    ~{g.slopePct}% slope{g.downhill ? `, falls to the ${g.downhill}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {g.reliefFt} ft relief · ground {Math.round(g.lowFt)}–{Math.round(g.highFt)} ft
                    above sea level, across ~{g.sideFt} ft
                    {g.assumedLot ? " (lot size not given — assumed 1 acre)" : ""}
                  </p>
                  {list(g.notes)}
                </>
              ),
              raw.errors.elevation,
            )}
            {card(
              "Floodplain Analysis",
              f ? (
                <Pill tone={FLOOD_TONE[f.status]}>
                  {f.inFloodplain
                    ? "In floodplain"
                    : f.status === "moderate"
                      ? "500-year area"
                      : f.status === "minimal"
                        ? "Not in floodplain"
                        : "Check locally"}
                </Pill>
              ) : null,
              f && (
                <>
                  <p className="mt-2 font-semibold">{f.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {f.panel
                      ? `FEMA FIRM panel ${f.panel.number}${f.panel.effective ? `, effective ${f.panel.effective}` : ""}`
                      : "FEMA National Flood Hazard Layer"}
                  </p>
                  {f.nearFloodplain && (
                    <p className="mt-2 rounded-md bg-amber-400/15 p-2 text-xs font-medium text-amber-900 dark:text-amber-200">
                      A mapped floodplain is within about 500 ft — part of the lot may be in it. A
                      survey showing the floodplain line will tell.
                    </p>
                  )}
                  {list(f.requirements)}
                </>
              ),
              raw.errors.flood,
            )}
            {card(
              "Ingress & Egress",
              a ? <Pill tone={TIA_TONE[a.tia]}>{TIA_LABEL[a.tia]}</Pill> : null,
              a && (
                <>
                  <div className="mt-2 grid gap-1">
                    {a.frontage.map((r) => (
                      <div key={r.name}>
                        <span className="font-semibold">{r.name}</span>
                        {r.aliases.length > 0 && (
                          <span className="text-muted-foreground"> ({r.aliases.join(", ")})</span>
                        )}
                        <span className="block text-xs text-muted-foreground">
                          {r.classLabel}
                          {r.state ? " · state road (TxDOT)" : ""}
                        </span>
                      </div>
                    ))}
                    {a.frontage.length === 0 && (
                      <span className="text-muted-foreground">
                        No road found next to the address point.
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs">
                    <b>Traffic Impact Analysis:</b> {a.tiaReason}
                    {a.trips ? ` (Based on ${a.trips.basis}.)` : ""}
                  </p>
                  {list(a.notes)}
                  {a.others.length > 0 && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Also nearby: {a.others.map((r) => r.name).join(", ")}
                    </p>
                  )}
                </>
              ),
              raw.errors.roads,
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            * From FEMA&apos;s National Flood Hazard Layer, USGS 3DEP elevations and US Census road
            data for {raw.geocode.matched} (checked {new Date(raw.fetchedAt).toLocaleDateString()}).
            Trips use typical ITE rates and TIA thresholds vary by city — early estimates, not a
            flood determination, topographic survey or traffic study.
          </p>
        </>
      )}
    </div>
  );
}
