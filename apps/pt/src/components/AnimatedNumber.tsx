import { useEffect, useRef, useState } from "react";

// Counts up from the previous value to the new one over a short duration,
// instead of a stat card just snapping to a new number. Animates from 0 on
// first mount too — callers like StatCard only mount this once the real data
// has actually arrived (showing a plain "…" while loading), so a component's
// first mount IS the "data just arrived" moment count-up is meant for. Skips
// the animation entirely for prefers-reduced-motion.
export function AnimatedNumber({
  value,
  format = (n: number) => Math.round(n).toLocaleString(),
  duration = 700,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
}) {
  const [display, setDisplay] = useState(0);
  // Tracks whatever's actually been painted so far — mutated ONLY from inside
  // the rAF tick, never synchronously at the top of the effect. That matters
  // under React 18 StrictMode's dev-only double-invoke (mount → cleanup →
  // mount): if this ref were written eagerly, the first (soon-cancelled) pass
  // would mark the animation "already done" before its own tick ever ran,
  // making the second pass see from === value and skip straight to the end
  // with no visible animation at all.
  const current = useRef(0);

  useEffect(() => {
    const from = current.current;
    if (from === value) return;

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      current.current = value;
      setDisplay(value);
      return;
    }

    let raf: number;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const next = from + (value - from) * eased;
      current.current = next;
      setDisplay(next);
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <>{format(display)}</>;
}
