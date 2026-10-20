import { forwardRef } from "react";
import type { SiteFit } from "@/lib/site-fit";
import type { SurveyReading } from "@/lib/survey-reading";
import { SCHEMATIC_LABEL, type Rect } from "@/lib/schematic";

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export type PlanLayers = {
  building: Rect[];
  parking?: Rect | null;
  driveway?: { x: number; w: number; toY: number } | null;
  entrance?: "front" | "left" | "right" | "rear";
  openSpace?: (Rect & { label: string })[];
  /** red building when the program doesn't fit */
  overflow?: { needSqFt: number; fitsSqFt: number } | null;
};

// The site drawn to scale, street at the bottom: lot, setback zone,
// easement / no-build strips (hatched), buildable envelope (dashed), and the
// plan layers — building, parking with stall lines, driveway, entrance, open
// space. With `schematic` it also carries a north arrow, a scale bar and the
// "Conceptual schematic…" label, so a downloaded image keeps it.
export const SitePlanSvg = forwardRef<
  SVGSVGElement,
  {
    fit: SiteFit;
    reading: SurveyReading | null;
    layers: PlanLayers;
    schematic?: boolean;
    title?: string;
    idPrefix?: string;
  }
>(function SitePlanSvg({ fit, reading, layers, schematic, title, idPrefix = "plan" }, ref) {
  const lot = fit.lot!;
  const L = fit.limits!;
  const pad = 40;
  const scale = Math.min(460 / lot.widthFt, 400 / lot.depthFt);
  const w = lot.widthFt * scale,
    d = lot.depthFt * scale;
  const footer = schematic ? 70 : 26;
  const vbW = Math.max(w + pad * 2, schematic ? 560 : 0),
    vbH = d + pad * 2 + footer;
  const x0 = (vbW - w) / 2,
    y0 = pad;
  const s = (n: number) => n * scale;
  // plan feet (origin front-left, y toward the rear) → screen
  const X = (x: number) => x0 + s(x);
  const Y = (y: number) => y0 + d - s(y);
  const R = (r: Rect) => ({ x: X(r.x), y: Y(r.y + r.d), width: s(r.w), height: s(r.d) });

  const strips = [
    ...(reading?.easements ?? []).map((e) => ({ side: e.side, ft: e.widthFt })),
    ...(reading?.noBuildAreas ?? []).map((n) => ({ side: n.side, ft: n.depthFt })),
  ].filter(
    (x): x is { side: "front" | "rear" | "left" | "right"; ft: number } =>
      ["front", "rear", "left", "right"].includes(x.side) && x.ft != null,
  );
  const stripRect = (side: string, f: number): Rect =>
    side === "rear"
      ? { x: 0, y: lot.depthFt - f, w: lot.widthFt, d: f }
      : side === "front"
        ? { x: 0, y: 0, w: lot.widthFt, d: f }
        : side === "left"
          ? { x: 0, y: 0, w: f, d: lot.depthFt }
          : { x: lot.widthFt - f, y: 0, w: f, d: lot.depthFt };
  const env: Rect = {
    x: L.left.ft,
    y: L.front.ft,
    w: lot.widthFt - L.left.ft - L.right.ft,
    d: lot.depthFt - L.front.ft - L.rear.ft,
  };
  const hasEnv = env.w > 0 && env.d > 0;
  const bad = !!layers.overflow;

  // north arrow: the street side faces `frontFaces`; the top of the drawing faces the opposite way
  const ff = reading?.orientation.frontFaces;
  const northDeg = ff && COMPASS.includes(ff) ? -((COMPASS.indexOf(ff) * 45 + 180) % 360) : null;
  // scale bar: a round number of feet about a quarter of the lot width
  const barFt = [5, 10, 20, 25, 50, 100, 200].find((n) => n * scale >= w / 5) ?? 10;
  const b0 = layers.building[0];
  const summary =
    title ??
    `Site plan: lot ${lot.widthFt} by ${lot.depthFt} feet; buildable area ${hasEnv ? `${env.w} by ${env.d} feet` : "none"}${b0 ? `; building about ${Math.round(b0.w)} by ${Math.round(b0.d)} feet` : ""}.`;
  const hatch = `${idPrefix}-hatch`;
  const stall = `${idPrefix}-stall`;

  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${vbW} ${vbH}`}
      className="h-auto w-full max-w-[600px] rounded-lg border border-border bg-white text-slate-900"
      role="img"
      aria-label={summary}
      fontFamily="Inter, Arial, sans-serif"
    >
      <defs>
        <pattern
          id={hatch}
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
            stroke="#d97706"
            strokeOpacity="0.55"
            strokeWidth="1.5"
          />
        </pattern>
        <pattern id={stall} width={s(9)} height={s(18)} patternUnits="userSpaceOnUse" x={0} y={0}>
          <line x1="0" y1="0" x2="0" y2={s(18)} stroke="#64748b" strokeWidth="0.8" />
        </pattern>
      </defs>
      <rect width={vbW} height={vbH} fill="#ffffff" />
      {/* lot + setback zone */}
      <rect
        x={x0}
        y={y0}
        width={w}
        height={d}
        fill="#fbbf24"
        fillOpacity="0.12"
        stroke="#0f172a"
        strokeWidth={2}
      />
      {strips.map((st, i) => (
        <rect
          key={i}
          {...R(stripRect(st.side, st.ft))}
          fill={`url(#${hatch})`}
          stroke="#d97706"
          strokeOpacity="0.6"
          strokeDasharray="3 3"
        />
      ))}
      {hasEnv && (
        <rect {...R(env)} fill="#ffffff" stroke="#059669" strokeWidth={1.5} strokeDasharray="6 4" />
      )}
      {/* open space, parking, driveway */}
      {(layers.openSpace ?? []).map((o, i) => (
        <g key={`o${i}`}>
          <rect {...R(o)} fill="#22c55e" fillOpacity="0.18" stroke="#16a34a" strokeOpacity="0.6" />
          {/* label only where it fits — thin strips stay unlabelled (the legend covers them) */}
          {s(o.d) >= 18 && s(o.w) >= o.label.length * 5.5 && (
            <text
              x={X(o.x + o.w / 2)}
              y={Y(o.y + o.d / 2)}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={10}
              fill="#166534"
            >
              {o.label}
            </text>
          )}
        </g>
      ))}
      {layers.driveway && (
        <rect
          x={X(layers.driveway.x)}
          y={Y(layers.driveway.toY)}
          width={s(layers.driveway.w)}
          height={s(layers.driveway.toY)}
          fill="#94a3b8"
          fillOpacity="0.45"
          stroke="#64748b"
        />
      )}
      {layers.parking && (
        <g>
          <rect {...R(layers.parking)} fill="#cbd5e1" fillOpacity="0.6" stroke="#64748b" />
          <rect {...R(layers.parking)} fill={`url(#${stall})`} />
          <text
            x={X(layers.parking.x + layers.parking.w / 2)}
            y={Y(layers.parking.y + layers.parking.d / 2)}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={11}
            fontWeight={600}
            fill="#334155"
          >
            Parking
          </text>
        </g>
      )}
      {/* building */}
      {layers.building.map((b, i) => (
        <rect
          key={`b${i}`}
          {...R(b)}
          fill={bad ? "#ef4444" : "#0ea5e9"}
          fillOpacity={bad ? 0.25 : 0.3}
          stroke={bad ? "#dc2626" : "#0369a1"}
          strokeWidth={1.5}
        />
      ))}
      {b0 && (
        <>
          <text
            x={X(b0.x + b0.w / 2)}
            y={Y(b0.y + b0.d / 2)}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={12}
            fontWeight={600}
            fill="#0f172a"
          >
            {bad ? `Needs ${layers.overflow!.needSqFt.toLocaleString()} sf` : "Building"}
          </text>
          <text
            x={X(b0.x + b0.w / 2)}
            y={Y(b0.y + b0.d / 2) + 15}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={11}
            fill="#0f172a"
          >
            {bad
              ? `only ${layers.overflow!.fitsSqFt.toLocaleString()} sf fits`
              : `${Math.round(b0.w)}′ × ${Math.round(b0.d)}′`}
          </text>
        </>
      )}
      {layers.entrance &&
        b0 &&
        (() => {
          const e = layers.entrance;
          const cx = e === "left" ? X(b0.x) : e === "right" ? X(b0.x + b0.w) : X(b0.x + b0.w / 2);
          const cy = e === "front" ? Y(b0.y) : e === "rear" ? Y(b0.y + b0.d) : Y(b0.y + b0.d / 2);
          const rot = { front: 0, rear: 180, left: 90, right: -90 }[e];
          return (
            <g transform={`translate(${cx} ${cy}) rotate(${rot})`} aria-hidden>
              <polygon points="0,-1 -6,10 6,10" fill="#0f172a" />
            </g>
          );
        })()}
      {/* limit dimensions */}
      {[
        [X(lot.widthFt / 2), Y(L.front.ft / 2), L.front.ft],
        [X(lot.widthFt / 2), Y(lot.depthFt - L.rear.ft / 2), L.rear.ft],
        [X(L.left.ft / 2), Y(lot.depthFt / 2), L.left.ft],
        [X(lot.widthFt - L.right.ft / 2), Y(lot.depthFt / 2), L.right.ft],
      ].map(([x, y, v], i) =>
        (v as number) > 0 ? (
          <text
            key={`l${i}`}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={10}
            fill="#64748b"
          >
            {v}′
          </text>
        ) : null,
      )}
      {/* lot dimensions + street */}
      <text x={x0 + w / 2} y={y0 - 12} textAnchor="middle" fontSize={12} fill="#0f172a">
        {lot.widthFt}′ (rear)
      </text>
      <text
        x={x0 - 14}
        y={y0 + d / 2}
        textAnchor="middle"
        fontSize={12}
        fill="#0f172a"
        transform={`rotate(-90 ${x0 - 14} ${y0 + d / 2})`}
      >
        {lot.depthFt}′
      </text>
      <text
        x={x0 + w / 2}
        y={y0 + d + 20}
        textAnchor="middle"
        fontSize={12}
        fontWeight={600}
        fill="#0f172a"
      >
        {reading?.frontage.street ? `${reading.frontage.street} (front)` : "Street (front)"}
      </text>
      {schematic && (
        <>
          {northDeg != null && (
            <g transform={`translate(${vbW - 26} 28) rotate(${northDeg})`}>
              <polygon points="0,-14 6,6 0,2 -6,6" fill="#0f172a" />
              <text x="0" y="18" textAnchor="middle" fontSize={10} fontWeight={700} fill="#0f172a">
                N
              </text>
            </g>
          )}
          <g transform={`translate(${x0} ${y0 + d + 34})`}>
            <rect width={s(barFt)} height="5" fill="#0f172a" />
            <text x={s(barFt) + 6} y="5" fontSize={10} fill="#334155">
              {barFt}′
            </text>
          </g>
          <text
            x={vbW / 2}
            y={vbH - 24}
            textAnchor="middle"
            fontSize={11}
            fontWeight={600}
            fill="#b45309"
          >
            <tspan x={vbW / 2}>{SCHEMATIC_LABEL.split("; ")[0]};</tspan>
            <tspan x={vbW / 2} dy="14">
              {SCHEMATIC_LABEL.split("; ")[1]}
            </tspan>
          </text>
        </>
      )}
    </svg>
  );
});

export function PlanLegend({
  reading,
  building,
  parking,
  openSpace,
}: {
  reading: SurveyReading | null;
  building?: boolean;
  parking?: boolean;
  openSpace?: boolean;
}) {
  const strips = (reading?.easements.length ?? 0) + (reading?.noBuildAreas.length ?? 0) > 0;
  const item = (cls: string, label: string) => (
    <span>
      <span className={`mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle ${cls}`} />
      {label}
    </span>
  );
  return (
    <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {item("bg-amber-400/30", "Setback area")}
      {strips && item("border border-amber-600/60", "Easement / no-build")}
      {item("border border-dashed border-emerald-600", "Buildable area")}
      {building && item("bg-sky-500/40", "Building")}
      {parking && item("bg-slate-300", "Parking / driveway")}
      {openSpace && item("bg-green-500/25", "Open space")}
    </figcaption>
  );
}
