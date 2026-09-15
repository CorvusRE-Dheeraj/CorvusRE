import { cn } from "@/lib/utils";

/**
 * Construction-site line art — a tower crane lifting a steel bundle over a
 * partially framed building, with scaffold, site hoarding and a hard-hat
 * figure. Navy structure, amber crane rigging + hard hat. Same drawing
 * language (animated strokes, mono labels) as the elevation and site-plan
 * illustrations.
 */
export function ConstructionScene({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 520 420"
      role="img"
      aria-label="Tower crane lifting steel over a building under construction"
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

      {/* clouds */}
      <g stroke="currentColor" strokeOpacity="0.22" strokeWidth="1.6">
        <path d="M300 54c0-12 10-20 22-18 4-12 22-12 28-2 12-2 20 6 18 16" style={{ ["--d" as string]: "0ms" }} />
        <path d="M92 96c0-9 8-15 16-13 3-9 16-9 20-1 9-2 15 4 13 12" style={{ ["--d" as string]: "120ms" }} />
      </g>

      {/* ground */}
      <line
        x1="24"
        y1="360"
        x2="496"
        y2="360"
        stroke="currentColor"
        strokeOpacity="0.6"
        strokeWidth="2.5"
        style={{ ["--d" as string]: "60ms" }}
      />
      <g stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.3">
        {Array.from({ length: 15 }).map((_, i) => (
          <line
            key={i}
            x1={40 + i * 32}
            y1="360"
            x2={32 + i * 32}
            y2="372"
            style={{ ["--d" as string]: `${120 + i * 10}ms` }}
          />
        ))}
      </g>

      {/* ── tower crane ─────────────────────────────────────────────── */}
      <g className="text-accent">
        {/* mast lattice */}
        <line x1="112" y1="360" x2="112" y2="70" stroke="currentColor" strokeWidth="2.5" style={{ ["--d" as string]: "200ms" }} />
        <line x1="140" y1="360" x2="140" y2="70" stroke="currentColor" strokeWidth="2.5" style={{ ["--d" as string]: "220ms" }} />
        <path
          d="M112 360l28 -36 -28 -36 28 -36 -28 -36 28 -36 -28 -36 28 -36 -28 -36"
          stroke="currentColor"
          strokeOpacity="0.7"
          strokeWidth="1.6"
          style={{ ["--d" as string]: "260ms" }}
        />
        {/* base */}
        <path d="M96 360h60l-10 -16h-40z" stroke="currentColor" strokeWidth="2" fill="currentColor" fillOpacity="0.12" data-fill="" style={{ ["--d" as string]: "200ms" }} />

        {/* slew + cab */}
        <rect x="108" y="46" width="36" height="24" rx="3" stroke="currentColor" strokeWidth="2" style={{ ["--d" as string]: "420ms" }} />

        {/* A-frame apex */}
        <path d="M126 46l-24 -30 24 6 24 -6z" stroke="currentColor" strokeWidth="1.8" style={{ ["--d" as string]: "460ms" }} />

        {/* jib (working arm) */}
        <line x1="144" y1="52" x2="452" y2="52" stroke="currentColor" strokeWidth="2.5" style={{ ["--d" as string]: "500ms" }} />
        <line x1="150" y1="66" x2="430" y2="66" stroke="currentColor" strokeWidth="2" style={{ ["--d" as string]: "520ms" }} />
        <path
          d="M150 66l20 -14 22 14 20 -14 22 14 20 -14 22 14 20 -14 22 14 20 -14 22 14 20 -14"
          stroke="currentColor"
          strokeOpacity="0.7"
          strokeWidth="1.5"
          style={{ ["--d" as string]: "560ms" }}
        />
        {/* tie bars from apex */}
        <path d="M102 16l150 34M102 16l-1 0M102 16l-40 30" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.5" style={{ ["--d" as string]: "600ms" }} />

        {/* counter-jib + counterweight */}
        <line x1="108" y1="58" x2="60" y2="58" stroke="currentColor" strokeWidth="2.5" style={{ ["--d" as string]: "500ms" }} />
        <rect x="44" y="52" width="20" height="26" rx="2" stroke="currentColor" strokeWidth="2" fill="currentColor" fillOpacity="0.18" data-fill="" style={{ ["--d" as string]: "560ms" }} />

        {/* trolley + hoist cable + hook + load */}
        <rect x="356" y="46" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" style={{ ["--d" as string]: "700ms" }} />
        <line x1="365" y1="58" x2="365" y2="196" stroke="currentColor" strokeWidth="1.6" style={{ ["--d" as string]: "760ms" }} />
        <path d="M358 196h14l-3 12h-8z" stroke="currentColor" strokeWidth="1.8" style={{ ["--d" as string]: "820ms" }} />
        {/* steel bundle */}
        <g style={{ ["--d" as string]: "880ms" }}>
          <rect x="330" y="210" width="70" height="16" rx="2" stroke="currentColor" strokeWidth="2" fill="currentColor" fillOpacity="0.9" data-fill="" />
          <path d="M352 210l13 -12 13 12" stroke="currentColor" strokeWidth="1.6" />
        </g>
      </g>

      {/* ── building under construction ─────────────────────────────── */}
      <g stroke="currentColor" strokeOpacity="0.8" strokeWidth="2.5">
        {/* columns */}
        {[250, 312, 374, 436].map((x, i) => (
          <line key={x} x1={x} y1="360" x2={x} y2="150" style={{ ["--d" as string]: `${640 + i * 60}ms` }} />
        ))}
      </g>
      <g stroke="currentColor" strokeOpacity="0.6" strokeWidth="2">
        {/* floor beams */}
        {[300, 244, 190, 150].map((y, i) => (
          <line key={y} x1="250" y1={y} x2="436" y2={y} style={{ ["--d" as string]: `${820 + i * 70}ms` }} />
        ))}
      </g>
      {/* diagonal bracing */}
      <g stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.5">
        <path d="M250 300l62 -56M374 244l62 56M312 190l62 -40" style={{ ["--d" as string]: "1100ms" }} />
      </g>
      {/* poured decks on lower two floors */}
      <g data-fill="" style={{ ["--d" as string]: "1160ms" }}>
        <rect x="250" y="300" width="186" height="8" fill="currentColor" fillOpacity="0.16" />
        <rect x="250" y="356" width="186" height="6" fill="currentColor" fillOpacity="0.2" />
      </g>

      {/* scaffold on the right face */}
      <g stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.5">
        <line x1="448" y1="360" x2="448" y2="150" style={{ ["--d" as string]: "1180ms" }} />
        <line x1="470" y1="360" x2="470" y2="150" style={{ ["--d" as string]: "1200ms" }} />
        {[168, 212, 256, 300, 344].map((y, i) => (
          <line key={y} x1="448" y1={y} x2="470" y2={y} style={{ ["--d" as string]: `${1240 + i * 40}ms` }} />
        ))}
        <path d="M448 168l22 44M448 256l22 44" style={{ ["--d" as string]: "1360ms" }} />
      </g>

      {/* site hoarding / fence */}
      <g stroke="currentColor" strokeOpacity="0.55" strokeWidth="2">
        <line x1="40" y1="360" x2="40" y2="316" style={{ ["--d" as string]: "1300ms" }} />
        <line x1="196" y1="360" x2="196" y2="316" style={{ ["--d" as string]: "1300ms" }} />
        <rect x="40" y="316" width="156" height="44" style={{ ["--d" as string]: "1320ms" }} />
        <line x1="40" y1="338" x2="196" y2="338" strokeOpacity="0.3" style={{ ["--d" as string]: "1360ms" }} />
      </g>
      <text
        x="118"
        y="344"
        fill="currentColor"
        fillOpacity="0.6"
        fontSize="13"
        fontFamily="ui-monospace, Menlo, monospace"
        fontWeight="700"
        letterSpacing="2"
        textAnchor="middle"
        data-fill=""
        style={{ ["--d" as string]: "1500ms" }}
      >
        CORVUSDP
      </text>

      {/* hard-hat figure */}
      <g style={{ ["--d" as string]: "1440ms" }}>
        <line x1="222" y1="360" x2="222" y2="332" stroke="currentColor" strokeWidth="2.5" />
        <path d="M222 332l-9 14M222 332l9 14M222 340l-11 -6M222 340l11 -6" stroke="currentColor" strokeWidth="2.2" />
        <circle cx="222" cy="322" r="6" stroke="currentColor" strokeWidth="2" />
        <g className="text-accent">
          <path d="M213 320a9 9 0 0 1 18 0z" fill="currentColor" fillOpacity="0.95" data-fill="" />
          <line x1="209" y1="320" x2="235" y2="320" stroke="currentColor" strokeWidth="2.2" />
        </g>
      </g>

      {/* dust */}
      <g stroke="currentColor" strokeOpacity="0.18" strokeWidth="1.5">
        <path d="M250 360c-6 -10 8 -16 14 -8 6 -10 20 -4 16 8" style={{ ["--d" as string]: "1560ms" }} />
      </g>

      {/* spec label */}
      <text
        x="486"
        y="392"
        fill="currentColor"
        fillOpacity="0.45"
        fontSize="10"
        fontFamily="ui-monospace, Menlo, monospace"
        textAnchor="end"
        data-fill=""
        style={{ ["--d" as string]: "1620ms" }}
      >
        PHASE 3 · STRUCTURE
      </text>
    </svg>
  );
}
