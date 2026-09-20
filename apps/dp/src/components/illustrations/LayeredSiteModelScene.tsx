import { cn } from "@/lib/utils";

// Each stacked plane, top (most zoomed-in, the finished design) to bottom
// (most zoomed-out, the governing jurisdiction) — deliberately growing
// larger going down, same telescoping logic a real site model has: the
// building sits inside the permit footprint, which sits inside the setback
// envelope, which sits inside the zoning parcel, which sits inside the
// jurisdiction boundary.
const LAYERS = [
  { label: "Design Layer", cy: 88, hw: 118, color: "oklch(0.42 0.05 250)" },
  { label: "Permit Layer", cy: 168, hw: 138, color: "oklch(0.68 0.16 48)" },
  { label: "Setback Layer", cy: 248, hw: 158, color: "oklch(0.64 0.14 150)" },
  { label: "Zoning Layer", cy: 328, hw: 178, color: "oklch(0.6 0.13 250)" },
  { label: "Jurisdiction Layer", cy: 408, hw: 198, color: "oklch(0.75 0.05 240)" },
] as const;

const CX = 216;
const HW_TO_HH = 0.3;

function planePoints(cx: number, cy: number, hw: number): string {
  const hh = hw * HW_TO_HH;
  return `${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy}`;
}

/**
 * The "layered digital site model" hero visual — jurisdiction, zoning,
 * setback, permit and design information as one exploded stack instead of
 * five separate documents, each plane connected to the ones above/below it
 * by the same real dashed alignment lines a site model actually has (a
 * building corner lines up with a setback corner lines up with a parcel
 * corner). Replaces the old architectural-elevation hero drawing — this is
 * the thing CorvusDP actually does: unify these five layers into one
 * AI-readable project view, not draw one elevation.
 */
export function LayeredSiteModelScene({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 560 500"
      role="img"
      aria-label="Layered digital site model combining jurisdiction, zoning, setback, permit and design information into one project view"
      className={cn("draw h-auto w-full", className)}
      style={{ ["--len" as string]: 4000 }}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* sheet border */}
      <rect
        x="8"
        y="8"
        width="544"
        height="484"
        rx="6"
        stroke="currentColor"
        strokeOpacity="0.14"
        strokeWidth="1.5"
        className="text-primary"
      />

      {/* dashed alignment lines running through every layer, with a dot at
          each plane it crosses — the same corner of the project, tracked
          from the finished design all the way down to the jurisdiction
          boundary that ultimately governs it. */}
      {[CX - 78, CX, CX + 78].map((x, li) => (
        <g key={x}>
          <line
            x1={x}
            y1={LAYERS[0].cy - 6}
            x2={x}
            y2={LAYERS[LAYERS.length - 1].cy}
            stroke="currentColor"
            strokeOpacity="0.35"
            strokeWidth="1.3"
            strokeDasharray="5 6"
            className="text-primary"
            style={{ ["--d" as string]: `${900 + li * 60}ms` }}
          />
          {LAYERS.map((layer, i) => (
            <circle
              key={layer.label}
              cx={x}
              cy={layer.cy}
              r="3.5"
              fill={layer.color}
              data-fill=""
              style={{ ["--d" as string]: `${950 + li * 60 + i * 40}ms` }}
            />
          ))}
        </g>
      ))}

      {/* the five stacked planes themselves */}
      {LAYERS.map((layer, i) => (
        <polygon
          key={layer.label}
          points={planePoints(CX, layer.cy, layer.hw)}
          fill={layer.color}
          fillOpacity="0.16"
          stroke={layer.color}
          strokeWidth="2"
          data-fill=""
          style={{ ["--d" as string]: `${200 + i * 140}ms` }}
        />
      ))}

      {/* Design layer: a tiny building + parking glyph, same footprint the
          Permit/Setback/Zoning layers below it are all sized around. */}
      <g style={{ ["--d" as string]: "260ms" }}>
        <rect
          x={CX - 34}
          y={LAYERS[0].cy - 14}
          width="68"
          height="26"
          rx="2"
          fill="oklch(0.68 0.16 48)"
          data-fill=""
        />
        {[0, 1, 2, 3, 4].map((i) => (
          <rect
            key={i}
            x={CX - 70 + i * 14}
            y={LAYERS[0].cy + 18}
            width="10"
            height="16"
            fill="currentColor"
            fillOpacity="0.35"
            className="text-primary"
            data-fill=""
          />
        ))}
      </g>

      {/* Permit layer: the five real permit tracks, as a row of tags just
          above that plane. */}
      <g fontFamily="ui-monospace, Menlo, monospace" fontSize="9" fontWeight="700">
        {["Site", "Grading", "Building", "Fire", "Utilities"].map((t, i) => (
          <g key={t} style={{ ["--d" as string]: `${560 + i * 60}ms` }}>
            <rect
              x={CX - 118 + i * 60}
              y={LAYERS[1].cy - 46}
              width="52"
              height="20"
              rx="10"
              fill="oklch(0.68 0.16 48)"
              fillOpacity="0.15"
              stroke="oklch(0.68 0.16 48)"
              strokeWidth="1.3"
              data-fill=""
            />
            <text
              x={CX - 92 + i * 60}
              y={LAYERS[1].cy - 32}
              fill="oklch(0.55 0.14 48)"
              textAnchor="middle"
              data-fill=""
            >
              {t}
            </text>
          </g>
        ))}
      </g>

      {/* Setback layer: real dimension callouts, same as a setback plan
          actually shows. */}
      <g
        fontFamily="ui-monospace, Menlo, monospace"
        fontSize="10"
        fill="oklch(0.5 0.13 150)"
        style={{ ["--d" as string]: "980ms" }}
      >
        <text x={CX - 150} y={LAYERS[2].cy - 8} data-fill="">
          25&apos;
        </text>
        <text x={CX + 132} y={LAYERS[2].cy - 8} data-fill="">
          20&apos;
        </text>
        <text x={CX - 60} y={LAYERS[2].cy + 34} data-fill="">
          15&apos;
        </text>
        <text x={CX + 40} y={LAYERS[2].cy + 34} data-fill="">
          10&apos;
        </text>
      </g>

      {/* Zoning layer label */}
      <text
        x={CX}
        y={LAYERS[3].cy + 5}
        fill="oklch(0.4 0.1 250)"
        fontFamily="ui-monospace, Menlo, monospace"
        fontSize="12"
        fontWeight="700"
        textAnchor="middle"
        data-fill=""
        style={{ ["--d" as string]: "1040ms" }}
      >
        C-2 COMMERCIAL
      </text>

      {/* Jurisdiction layer labels */}
      <g
        fontFamily="ui-monospace, Menlo, monospace"
        fontSize="10"
        fill="oklch(0.4 0.03 240)"
        style={{ ["--d" as string]: "1100ms" }}
      >
        <text x={CX - 60} y={LAYERS[4].cy - 6} textAnchor="middle" data-fill="">
          CITY OF RIVERTON
        </text>
        <text x={CX + 90} y={LAYERS[4].cy + 14} textAnchor="middle" data-fill="">
          ETJ
        </text>
      </g>

      {/* layer name pills, right of the stack */}
      {LAYERS.map((layer, i) => (
        <g key={layer.label} style={{ ["--d" as string]: `${300 + i * 140}ms` }}>
          <rect
            x={CX + layer.hw + 18}
            y={layer.cy - 13}
            width="132"
            height="26"
            rx="13"
            fill="var(--color-card)"
            stroke={layer.color}
            strokeWidth="1.4"
            data-fill=""
          />
          <circle cx={CX + layer.hw + 34} cy={layer.cy} r="4" fill={layer.color} data-fill="" />
          <text
            x={CX + layer.hw + 46}
            y={layer.cy + 4}
            fill="currentColor"
            className="text-foreground"
            fontFamily="ui-sans-serif, system-ui"
            fontSize="11"
            fontWeight="600"
            data-fill=""
          >
            {layer.label}
          </text>
        </g>
      ))}

      {/* "Design Checks" callout, top right */}
      <g style={{ ["--d" as string]: "1400ms" }}>
        <rect
          x="366"
          y="14"
          width="178"
          height="60"
          rx="10"
          fill="var(--color-card)"
          stroke="oklch(0.64 0.14 150)"
          strokeWidth="1.4"
          data-fill=""
        />
        <circle cx="386" cy="30" r="8" fill="oklch(0.64 0.14 150)" data-fill="" />
        <path
          d="M382 30l3 3 6-6"
          stroke="var(--color-card)"
          strokeWidth="1.8"
          data-fill=""
        />
        <text
          x="400"
          y="34"
          fill="currentColor"
          className="text-foreground"
          fontFamily="ui-sans-serif, system-ui"
          fontSize="11"
          fontWeight="700"
          data-fill=""
        >
          Design Checks
        </text>
        <text
          x="380"
          y="52"
          fill="currentColor"
          className="text-muted-foreground"
          fontFamily="ui-sans-serif, system-ui"
          fontSize="10"
          data-fill=""
        >
          Parking count ✓
        </text>
        <text
          x="380"
          y="66"
          fill="currentColor"
          className="text-muted-foreground"
          fontFamily="ui-sans-serif, system-ui"
          fontSize="10"
          data-fill=""
        >
          Accessible route ✓
        </text>
      </g>
    </svg>
  );
}
