import type { ReactNode } from "react";

// A circular progress ring drawn around its child (e.g. a numbered badge). The ring takes
// the colour of the surrounding text colour class passed in `className`. `spinning` turns it
// into a loading spinner. Animates from empty to `percent`; static for reduced motion.
export function ProgressRing({
  percent,
  spinning = false,
  className = "",
  children,
}: {
  percent: number;
  spinning?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const r = 20;
  const c = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(100, percent));
  return (
    <span className={`relative inline-grid shrink-0 place-items-center ${className}`}>
      <svg
        aria-hidden
        viewBox="0 0 48 48"
        className={`pointer-events-none absolute -inset-1.5 h-[calc(100%+0.75rem)] w-[calc(100%+0.75rem)] -rotate-90 ${
          spinning ? "animate-spin motion-reduce:animate-none" : ""
        }`}
      >
        <circle
          cx="24"
          cy="24"
          r={r}
          fill="none"
          strokeWidth="3"
          className="stroke-current opacity-15"
        />
        <circle
          cx="24"
          cy="24"
          r={r}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          className="stroke-current transition-[stroke-dashoffset] duration-1000 ease-out"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - filled / 100)}
        />
      </svg>
      <span className="relative text-foreground">{children}</span>
    </span>
  );
}
