import { cn } from "@/lib/utils";

/**
 * Top-down site plan — property boundary, dashed setback lines, a building
 * footprint, driveway, trees, a north arrow and a couple of dimension /
 * zoning callouts. The permitting page's counterpart to the elevation
 * drawing on the design page.
 */
export function SitePlanScene({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 520 420"
      role="img"
      aria-label="Site plan showing property line, setbacks and building footprint"
      className={cn("draw h-auto w-full text-primary", className)}
      style={{ ["--len" as string]: 4000 }}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect
        x="8"
        y="8"
        width="504"
        height="404"
        rx="6"
        stroke="currentColor"
        strokeOpacity="0.18"
        strokeWidth="1.5"
      />

      {/* right-of-way / street */}
      <g stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.4">
        <line x1="40" y1="372" x2="480" y2="372" style={{ ["--d" as string]: "0ms" }} />
        <g strokeDasharray="10 12">
          <line x1="40" y1="392" x2="480" y2="392" style={{ ["--d" as string]: "80ms" }} />
        </g>
      </g>
      <text
        x="60"
        y="408"
        fill="currentColor"
        fillOpacity="0.5"
        fontSize="10"
        fontFamily="ui-monospace, Menlo, monospace"
        data-fill=""
        style={{ ["--d" as string]: "200ms" }}
      >
        MAPLE AVE — 60&apos; R.O.W.
      </text>

      {/* property boundary */}
      <path
        d="M96 60h300v290H96z"
        stroke="currentColor"
        strokeOpacity="0.8"
        strokeWidth="2.5"
        style={{ ["--d" as string]: "150ms" }}
      />
      {/* boundary bearing ticks */}
      <g stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.4">
        <path d="M92 56l8 8M388 56l8 8M92 342l8 8M388 342l8 8" style={{ ["--d" as string]: "260ms" }} />
      </g>

      {/* setback line (dashed, inset) */}
      <path
        d="M128 92h236v226H128z"
        stroke="currentColor"
        strokeOpacity="0.5"
        strokeWidth="1.6"
        strokeDasharray="8 8"
        style={{ ["--d" as string]: "340ms" }}
      />
      <text
        x="246"
        y="108"
        fill="currentColor"
        fillOpacity="0.5"
        fontSize="10"
        fontFamily="ui-monospace, Menlo, monospace"
        textAnchor="middle"
        data-fill=""
        style={{ ["--d" as string]: "520ms" }}
      >
        25&apos; FRONT SETBACK
      </text>

      {/* building footprint */}
      <g className="text-accent">
        <rect
          x="168"
          y="150"
          width="150"
          height="120"
          rx="3"
          fill="currentColor"
          fillOpacity="0.14"
          data-fill=""
          style={{ ["--d" as string]: "560ms" }}
        />
        <rect
          x="168"
          y="150"
          width="150"
          height="120"
          rx="3"
          stroke="currentColor"
          strokeWidth="2.5"
          style={{ ["--d" as string]: "560ms" }}
        />
        <line
          x1="168"
          y1="230"
          x2="318"
          y2="230"
          stroke="currentColor"
          strokeOpacity="0.5"
          strokeWidth="1.4"
          style={{ ["--d" as string]: "720ms" }}
        />
      </g>
      <text
        x="243"
        y="196"
        fill="currentColor"
        fillOpacity="0.6"
        fontSize="11"
        fontFamily="ui-monospace, Menlo, monospace"
        textAnchor="middle"
        data-fill=""
        style={{ ["--d" as string]: "820ms" }}
      >
        FOOTPRINT
      </text>
      <text
        x="243"
        y="212"
        fill="currentColor"
        fillOpacity="0.45"
        fontSize="9"
        fontFamily="ui-monospace, Menlo, monospace"
        textAnchor="middle"
        data-fill=""
        style={{ ["--d" as string]: "880ms" }}
      >
        18,000 SF
      </text>

      {/* driveway to street */}
      <path
        d="M224 270v80"
        stroke="currentColor"
        strokeOpacity="0.4"
        strokeWidth="14"
        style={{ ["--d" as string]: "900ms" }}
      />
      <path
        d="M224 270v80"
        stroke="currentColor"
        strokeOpacity="0.5"
        strokeWidth="1.4"
        strokeDasharray="6 8"
        style={{ ["--d" as string]: "980ms" }}
      />

      {/* trees */}
      <g className="text-accent">
        {[
          [340, 120],
          [364, 300],
          [116, 300],
        ].map(([cx, cy], i) => (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r="12"
            stroke="currentColor"
            strokeOpacity="0.55"
            strokeWidth="1.6"
            style={{ ["--d" as string]: `${1000 + i * 90}ms` }}
          />
        ))}
      </g>

      {/* left dimension line */}
      <g stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.4">
        <line x1="70" y1="60" x2="70" y2="350" style={{ ["--d" as string]: "1150ms" }} />
        <path d="M65 66l5-8 5 8M65 344l5 8 5-8" style={{ ["--d" as string]: "1220ms" }} />
      </g>
      <text
        x="56"
        y="205"
        fill="currentColor"
        fillOpacity="0.6"
        fontSize="12"
        fontFamily="ui-monospace, Menlo, monospace"
        transform="rotate(-90 56 205)"
        textAnchor="middle"
        data-fill=""
        style={{ ["--d" as string]: "1320ms" }}
      >
        150&apos;–0&quot;
      </text>

      {/* zoning tag */}
      <g className="text-accent" style={{ ["--d" as string]: "1360ms" }}>
        <rect
          x="404"
          y="44"
          width="72"
          height="26"
          rx="13"
          fill="currentColor"
          fillOpacity="0.9"
          data-fill=""
        />
        <text
          x="440"
          y="61"
          fill="var(--color-accent-foreground)"
          fontSize="12"
          fontFamily="ui-monospace, Menlo, monospace"
          fontWeight="700"
          textAnchor="middle"
          data-fill=""
        >
          ZONE C-2
        </text>
      </g>

      {/* north arrow */}
      <g className="text-accent" style={{ ["--d" as string]: "1440ms" }}>
        <circle cx="448" cy="340" r="18" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.5" />
        <path d="M448 326l6 16-6-4-6 4z" fill="currentColor" fillOpacity="0.9" data-fill="" />
        <text
          x="448"
          y="372"
          fill="currentColor"
          fillOpacity="0.7"
          fontSize="10"
          fontFamily="ui-monospace, Menlo, monospace"
          textAnchor="middle"
          data-fill=""
        >
          N
        </text>
      </g>
    </svg>
  );
}
