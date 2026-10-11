import { useMemo } from "react";

const COLORS = ["#10b981", "#0ea5e9", "#f59e0b", "#8b5cf6", "#f43f5e", "#84cc16", "#14b8a6"];

// A one-time burst of confetti that falls from the top of its (relatively positioned)
// parent. Pieces are positioned once and never re-randomise; switched off entirely for
// people who prefer reduced motion (see .confetti-piece in styles.css).
export function Confetti({ pieces = 44 }: { pieces?: number }) {
  const items = useMemo(
    () =>
      Array.from({ length: pieces }, (_, i) => ({
        id: i,
        left: `${(i * 97) % 100}%`,
        color: COLORS[i % COLORS.length],
        delay: `${((i * 53) % 90) / 100}s`,
        duration: `${2.4 + ((i * 37) % 14) / 10}s`,
        drift: `${((i * 61) % 160) - 80}px`,
      })),
    [pieces],
  );
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {items.map((p) => (
        <span
          key={p.id}
          className="confetti-piece"
          style={
            {
              left: p.left,
              background: p.color,
              "--confetti-delay": p.delay,
              "--confetti-d": p.duration,
              "--confetti-x": p.drift,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
