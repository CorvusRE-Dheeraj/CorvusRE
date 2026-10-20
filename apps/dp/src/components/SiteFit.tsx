import type { DesignRequestRow } from "@/lib/design-requests";
import { FIT_LABEL, siteFit, type SiteFit as Fit } from "@/lib/site-fit";
import { SIDES, SIDE_LABEL, ft, sqft, type SurveyReading } from "@/lib/survey-reading";
import { Pill } from "@/components/dp-ui";
import { PlanLegend, SitePlanSvg } from "@/components/SitePlan";

const TONE = {
  needs_info: "amber",
  no_room: "red",
  fits: "green",
  tight: "amber",
  too_big: "red",
} as const;

// Step 3 of the survey workflow: how the design fits on the land once the
// setbacks, easements and no-build strips are taken off — numbers plus a
// to-scale site diagram (street at the bottom).
export function SiteFitPanel({ dr }: { dr: DesignRequestRow }) {
  if (!dr.survey_path) return null;
  const reading = (dr.survey_reading ?? null) as SurveyReading | null;
  const fit = siteFit(reading, dr.site_inputs ?? null, {
    buildingArea: dr.building_area,
    floors: dr.floors,
  });
  return (
    <section className="card-elev p-5 sm:p-6" aria-labelledby="site-fit-h">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="site-fit-h" className="font-serif text-lg font-semibold">
            Setback fit
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The buildable area once setbacks, easements and no-build strips are taken off — and
            whether the planned building fits in it.
          </p>
        </div>
        <Pill tone={TONE[fit.status]}>{FIT_LABEL[fit.status]}</Pill>
      </div>

      {fit.status === "needs_info" ? (
        <p className="rounded-lg border border-amber-400/50 bg-amber-400/10 p-3 text-sm">
          Enter {fit.missing.join(", ").toLowerCase()} above to check how the design fits.
        </p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <SiteDiagram fit={fit} reading={reading} />
          <FitNumbers fit={fit} />
        </div>
      )}
      {fit.notes.length > 0 && (
        <ul className="mt-4 grid gap-1 text-sm">
          {fit.notes.map((n, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden>•</span>
              <span>{n}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        * An early check from the survey and the values above — confirm setbacks with the zoning
        district and a design professional.
      </p>
    </section>
  );
}

function FitNumbers({ fit }: { fit: Fit }) {
  const row = (k: string, v: React.ReactNode, sub?: string) => (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right font-medium tabular-nums">
        {v}
        {sub && <span className="block text-xs font-normal text-muted-foreground">{sub}</span>}
      </span>
    </div>
  );
  return (
    <div className="grid content-start gap-4 text-sm">
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Lot
        </div>
        {row("Width × depth", `${ft(fit.lot!.widthFt)} × ${ft(fit.lot!.depthFt)}`)}
        {row("Area", sqft(fit.lot!.areaSqFt))}
      </div>
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Kept clear from each property line
        </div>
        {SIDES.map((s) => {
          const l = fit.limits![s];
          return row(
            SIDE_LABEL[s],
            ft(l.ft),
            l.ft !== l.setbackFt ? `${l.governedBy} (setback ${ft(l.setbackFt)})` : undefined,
          );
        })}
      </div>
      {fit.envelope && (
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Buildable area
          </div>
          {row("Width × depth", `${ft(fit.envelope.widthFt)} × ${ft(fit.envelope.depthFt)}`)}
          {row("Area", sqft(fit.envelope.areaSqFt), `${fit.envelope.pctOfLot}% of the lot`)}
        </div>
      )}
      {fit.program.footprintSqFt != null && fit.envelope && (
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Planned building
          </div>
          {row(
            "Footprint",
            sqft(fit.program.footprintSqFt),
            `${fit.program.buildingAreaSqFt!.toLocaleString()} sf on ${fit.program.floors} floor${fit.program.floors === 1 ? "" : "s"}`,
          )}
          {row("Uses", `${fit.usePct}% of the buildable area`)}
          {fit.floorsNeeded && row("Would fit on", `${fit.floorsNeeded} floors`)}
        </div>
      )}
    </div>
  );
}

// The fit drawn to scale: the planned footprint set at the front setback
// line, centred in the buildable area (red when the program doesn't fit).
function SiteDiagram({ fit, reading }: { fit: Fit; reading: SurveyReading | null }) {
  const L = fit.limits!;
  const env = fit.envelope;
  const fp = fit.suggested && env ? fit.suggested : null;
  const building = fp
    ? [
        {
          x: L.left.ft + (env!.widthFt - fp.widthFt) / 2,
          y: L.front.ft,
          w: fp.widthFt,
          d: fp.depthFt,
        },
      ]
    : [];
  return (
    <figure className="min-w-0">
      <SitePlanSvg
        fit={fit}
        reading={reading}
        idPrefix="fit"
        layers={{
          building,
          overflow:
            fit.status === "too_big" && env
              ? { needSqFt: fit.program.footprintSqFt!, fitsSqFt: env.areaSqFt }
              : null,
        }}
      />
      <PlanLegend reading={reading} building={!!fp} />
    </figure>
  );
}
