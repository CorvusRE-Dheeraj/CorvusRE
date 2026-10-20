import type { DesignRequestRow } from "@/lib/design-requests";
import { FIT_LABEL, siteFit, type SiteFit as Fit } from "@/lib/site-fit";
import { SIDES, SIDE_LABEL, ft, sqft, type SurveyReading } from "@/lib/survey-reading";
import { Pill } from "@/components/dp-ui";

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

// To scale: the lot, the strips kept clear on each side (setback = light,
// easement / no-build = hatched), the buildable envelope (dashed) and the
// footprint set at the front setback line, centred. Street at the bottom.
function SiteDiagram({ fit, reading }: { fit: Fit; reading: SurveyReading | null }) {
  const lot = fit.lot!;
  const L = fit.limits!;
  const pad = 34;
  const scale = Math.min(460 / lot.widthFt, 380 / lot.depthFt);
  const w = lot.widthFt * scale,
    d = lot.depthFt * scale;
  const vbW = w + pad * 2,
    vbH = d + pad * 2 + 26;
  const x0 = pad,
    y0 = pad;
  const s = (n: number) => n * scale;
  // easement / no-build strips along each side, drawn hatched
  const strips = [
    ...(reading?.easements ?? []).map((e) => ({
      side: e.side,
      ft: e.widthFt,
      label: e.label ?? `${e.type} easement`,
    })),
    ...(reading?.noBuildAreas ?? []).map((n) => ({
      side: n.side,
      ft: n.depthFt,
      label: n.label ?? n.description,
    })),
  ].filter(
    (x): x is { side: "front" | "rear" | "left" | "right"; ft: number; label: string } =>
      ["front", "rear", "left", "right"].includes(x.side) && x.ft != null,
  );
  const stripRect = (side: string, f: number) =>
    side === "rear"
      ? { x: x0, y: y0, width: w, height: s(f) }
      : side === "front"
        ? { x: x0, y: y0 + d - s(f), width: w, height: s(f) }
        : side === "left"
          ? { x: x0, y: y0, width: s(f), height: d }
          : { x: x0 + w - s(f), y: y0, width: s(f), height: d };
  const env = fit.envelope;
  const ex = x0 + s(L.left.ft),
    ey = y0 + s(L.rear.ft);
  const fp = fit.suggested && env ? fit.suggested : null;
  const fpx = fp ? ex + (s(env!.widthFt) - s(fp.widthFt)) / 2 : 0;
  const fpy = fp ? ey + s(env!.depthFt) - s(fp.depthFt) : 0; // pushed to the front setback line
  const summary = `Site diagram: lot ${lot.widthFt} by ${lot.depthFt} feet; buildable area ${env ? `${env.widthFt} by ${env.depthFt} feet` : "none"}${fp ? `; building footprint about ${Math.round(fp.widthFt)} by ${Math.round(fp.depthFt)} feet` : ""}.`;
  return (
    <figure className="min-w-0">
      <svg
        viewBox={`0 0 ${vbW} ${vbH}`}
        className="h-auto w-full max-w-[560px] rounded-lg border border-border bg-background"
        role="img"
        aria-label={summary}
      >
        <defs>
          <pattern
            id="fit-hatch"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="6"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-amber-600/60"
            />
          </pattern>
        </defs>
        {/* lot + setback zone */}
        <rect
          x={x0}
          y={y0}
          width={w}
          height={d}
          className="fill-amber-400/10 stroke-foreground"
          strokeWidth={2}
        />
        {strips.map((st, i) => (
          <rect
            key={i}
            {...stripRect(st.side, st.ft)}
            fill="url(#fit-hatch)"
            className="stroke-amber-600/60"
            strokeDasharray="3 3"
          />
        ))}
        {env && (
          <rect
            x={ex}
            y={ey}
            width={s(env.widthFt)}
            height={s(env.depthFt)}
            className="fill-background stroke-emerald-600"
            strokeWidth={1.5}
            strokeDasharray="6 4"
          />
        )}
        {fp && (
          <g>
            <rect
              x={fpx}
              y={fpy}
              width={s(fp.widthFt)}
              height={s(fp.depthFt)}
              className={
                fit.status === "too_big"
                  ? "fill-red-500/25 stroke-red-600"
                  : "fill-sky-500/25 stroke-sky-700"
              }
              strokeWidth={1.5}
            />
            <text
              x={fpx + s(fp.widthFt) / 2}
              y={fpy + s(fp.depthFt) / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-foreground"
              fontSize={12}
            >
              {fit.status === "too_big"
                ? `Needs ${fit.program.footprintSqFt!.toLocaleString()} sf`
                : `Building ${Math.round(fp.widthFt)}′ × ${Math.round(fp.depthFt)}′`}
            </text>
            {fit.status === "too_big" && (
              <text
                x={fpx + s(fp.widthFt) / 2}
                y={fpy + s(fp.depthFt) / 2 + 16}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-foreground"
                fontSize={11}
              >
                only {fit.envelope!.areaSqFt.toLocaleString()} sf fits
              </text>
            )}
          </g>
        )}
        {/* limit dimensions */}
        <text
          x={x0 + w / 2}
          y={y0 + d - s(L.front.ft) / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={11}
          className="fill-muted-foreground"
        >
          {L.front.ft}′
        </text>
        <text
          x={x0 + w / 2}
          y={y0 + s(L.rear.ft) / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={11}
          className="fill-muted-foreground"
        >
          {L.rear.ft}′
        </text>
        <text
          x={x0 + s(L.left.ft) / 2}
          y={y0 + d / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={11}
          className="fill-muted-foreground"
        >
          {L.left.ft}′
        </text>
        <text
          x={x0 + w - s(L.right.ft) / 2}
          y={y0 + d / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={11}
          className="fill-muted-foreground"
        >
          {L.right.ft}′
        </text>
        {/* lot dimensions + street */}
        <text
          x={x0 + w / 2}
          y={y0 - 10}
          textAnchor="middle"
          fontSize={12}
          className="fill-foreground"
        >
          {lot.widthFt}′ (rear)
        </text>
        <text
          x={x0 - 12}
          y={y0 + d / 2}
          textAnchor="middle"
          fontSize={12}
          className="fill-foreground"
          transform={`rotate(-90 ${x0 - 12} ${y0 + d / 2})`}
        >
          {lot.depthFt}′
        </text>
        <text
          x={x0 + w / 2}
          y={y0 + d + 20}
          textAnchor="middle"
          fontSize={12}
          fontWeight={600}
          className="fill-foreground"
        >
          {reading?.frontage.street ? `${reading.frontage.street} (front)` : "Street (front)"}
        </text>
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-amber-400/30 align-middle" />
          Setback area
        </span>
        {strips.length > 0 && (
          <span>
            <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-amber-600/60 align-middle" />
            Easement / no-build
          </span>
        )}
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-emerald-600 align-middle" />
          Buildable area
        </span>
        {fp && (
          <span>
            <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-sky-500/40 align-middle" />
            Building footprint
          </span>
        )}
      </figcaption>
    </figure>
  );
}
