import { cn } from "@/lib/utils";

/**
 * Architectural elevation wireframe — a "permit set" drawing rendered as
 * animated line art. Navy strokes on transparent; the entrance and one
 * highlighted bay pick up the amber accent. Draws itself on when it enters
 * the viewport is handled by the caller wrapping it in <ScrollReveal>; the
 * stroke-draw animation runs on mount (see .draw in styles.css) and is
 * disabled for reduced-motion users, who see the finished drawing.
 */
export function BlueprintScene({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 520 420"
      role="img"
      aria-label="Architectural elevation drawing with dimension lines"
      className={cn("draw h-auto w-full text-primary", className)}
      style={{ ["--len" as string]: 4000 }}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* sheet border */}
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

      {/* ground line */}
      <line
        x1="40"
        y1="356"
        x2="492"
        y2="356"
        stroke="currentColor"
        strokeOpacity="0.55"
        strokeWidth="2"
        style={{ ["--d" as string]: "0ms" }}
      />
      {/* hatched grade */}
      <g stroke="currentColor" strokeOpacity="0.28" strokeWidth="1.4">
        {Array.from({ length: 14 }).map((_, i) => (
          <line
            key={i}
            x1={52 + i * 32}
            y1="356"
            x2={44 + i * 32}
            y2="368"
            style={{ ["--d" as string]: `${100 + i * 12}ms` }}
          />
        ))}
      </g>

      {/* building envelope */}
      <g stroke="currentColor" strokeOpacity="0.75" strokeWidth="2">
        <path
          d="M96 356V150l164-58 164 58v206"
          style={{ ["--d" as string]: "200ms" }}
        />
        {/* parapet cap */}
        <path d="M88 150h344" style={{ ["--d" as string]: "420ms" }} />
      </g>

      {/* floor plates */}
      <g stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.6">
        {[201, 253, 305].map((y, i) => (
          <line
            key={y}
            x1="96"
            y1={y}
            x2="424"
            y2={y}
            style={{ ["--d" as string]: `${520 + i * 90}ms` }}
          />
        ))}
      </g>

      {/* window grid */}
      <g stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.5">
        {[0, 1, 2, 3].map((row) =>
          [0, 1, 2, 3, 4].map((col) => {
            const x = 116 + col * 60;
            const y = 166 + row * 52;
            const accent = row === 1 && col === 2;
            if (accent) return null;
            return (
              <rect
                key={`${row}-${col}`}
                x={x}
                y={y}
                width="40"
                height="32"
                rx="2"
                style={{ ["--d" as string]: `${700 + (row * 5 + col) * 45}ms` }}
              />
            );
          }),
        )}
      </g>

      {/* highlighted bay */}
      <g className="text-accent">
        <rect
          x="236"
          y="218"
          width="40"
          height="32"
          rx="2"
          fill="currentColor"
          fillOpacity="0.9"
          data-fill=""
          style={{ ["--d" as string]: "1100ms" }}
        />
      </g>

      {/* entrance */}
      <g className="text-accent">
        <path
          d="M240 356v-40a20 20 0 0 1 40 0v40"
          stroke="currentColor"
          strokeWidth="2.5"
          style={{ ["--d" as string]: "1000ms" }}
        />
        <line
          x1="260"
          y1="316"
          x2="260"
          y2="356"
          stroke="currentColor"
          strokeOpacity="0.7"
          strokeWidth="1.5"
          style={{ ["--d" as string]: "1120ms" }}
        />
      </g>

      {/* left vertical dimension line */}
      <g stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.4">
        <line x1="60" y1="150" x2="60" y2="356" style={{ ["--d" as string]: "1200ms" }} />
        <path d="M55 156l5-8 5 8M55 350l5 8 5-8" style={{ ["--d" as string]: "1260ms" }} />
        <line x1="52" y1="150" x2="68" y2="150" style={{ ["--d" as string]: "1240ms" }} />
        <line x1="52" y1="356" x2="68" y2="356" style={{ ["--d" as string]: "1240ms" }} />
      </g>
      <text
        x="46"
        y="258"
        fill="currentColor"
        fillOpacity="0.6"
        fontSize="12"
        fontFamily="ui-monospace, Menlo, monospace"
        transform="rotate(-90 46 258)"
        textAnchor="middle"
        data-fill=""
        style={{ ["--d" as string]: "1400ms" }}
      >
        42&apos;–0&quot;
      </text>

      {/* bottom horizontal dimension line */}
      <g stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.4">
        <line x1="96" y1="388" x2="424" y2="388" style={{ ["--d" as string]: "1300ms" }} />
        <path d="M102 383l-8 5 8 5M418 383l8 5-8 5" style={{ ["--d" as string]: "1360ms" }} />
        <line x1="96" y1="380" x2="96" y2="396" style={{ ["--d" as string]: "1340ms" }} />
        <line x1="424" y1="380" x2="424" y2="396" style={{ ["--d" as string]: "1340ms" }} />
      </g>
      <text
        x="260"
        y="405"
        fill="currentColor"
        fillOpacity="0.6"
        fontSize="12"
        fontFamily="ui-monospace, Menlo, monospace"
        textAnchor="middle"
        data-fill=""
        style={{ ["--d" as string]: "1480ms" }}
      >
        68&apos;–0&quot;
      </text>

      {/* compass rose */}
      <g className="text-accent" style={{ ["--d" as string]: "1500ms" }}>
        <circle
          cx="452"
          cy="60"
          r="20"
          stroke="currentColor"
          strokeOpacity="0.5"
          strokeWidth="1.5"
        />
        <path
          d="M452 44l6 16-6-4-6 4z"
          fill="currentColor"
          fillOpacity="0.9"
          data-fill=""
        />
        <text
          x="452"
          y="94"
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
