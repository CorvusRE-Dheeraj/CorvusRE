import { useEffect, useState } from "react";

// Counts from 0 up to `to` over ~1s, then shows `format(to)`. Jumps straight to the final
// number for anyone who prefers reduced motion.
export function CountUp({
  to,
  format = (n: number) => String(n),
  duration = 1000,
}: {
  to: number;
  format?: (n: number) => string;
  duration?: number;
}) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || to <= 0) {
      setN(to);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to, duration]);
  return <>{format(n)}</>;
}
