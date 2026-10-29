// The Track Map's railway graphics (same rails and sleepers as the earlier
// map's RouteTrack): a straight piece of track under a row of stations, and
// the pieces that join one section to the next — one continuous main line,
// the main line splitting into one parallel track per permit, those tracks
// running side by side, and merging back into the main line.
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

export const MAIN_RAIL = "#6a7987";
const SLEEPER = "#c4cdd5";

// A horizontal piece of track, 14px tall: two rails over sleepers.
export function Rail({ color = MAIN_RAIL, className }: { color?: string; className?: string }) {
  const style: CSSProperties = {
    background: [
      `linear-gradient(${color}, ${color}) 0 2px / 100% 2.5px no-repeat`,
      `linear-gradient(${color}, ${color}) 0 9.5px / 100% 2.5px no-repeat`,
      `repeating-linear-gradient(90deg, ${color === MAIN_RAIL ? SLEEPER : `${color}55`} 0 4px, transparent 4px 13px)`,
    ].join(", "),
  };
  return <div aria-hidden className={cn("h-[14px] rounded-sm", className)} style={style} />;
}

// What kind of track a row of stations runs on — said in words and shown.
export function TrackLabel({
  kind,
  label,
  color = MAIN_RAIL,
}: {
  kind: "main" | "parallel" | "loop";
  label?: string;
  color?: string;
}) {
  const text =
    kind === "main"
      ? "Continuous main line"
      : kind === "loop"
        ? "Parallel track · review loop"
        : "Parallel track";
  return (
    <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-muted-foreground">
      <Rail color={color} className="w-10" />
      <span>
        {kind === "main" ? "━" : "∥"} {text}
        {label && <span className="text-foreground"> · {label}</span>}
      </span>
    </div>
  );
}

const RAIL_W = 11; // outer width of the two rails, px
const GAP_W = 6.5; // the gap between them
const H = 64; // height of a joining piece, px

// Joins two sections with real track: `from` tracks at the top, `to` at the
// bottom (1 = the main line). 1→1 runs straight on, 1→N splits, N→N runs in
// parallel, N→1 merges. Rails are a wide stroke with a narrower card-coloured
// stroke on top (so they follow the curves); sleepers a dashed stroke between.
export function TrackJunction({
  from,
  to,
  colors,
  title,
  text,
}: {
  from: number;
  to: number;
  colors: string[];
  title: string;
  text: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const xs = (n: number) =>
    Array.from({ length: n }, (_, i) => (n === 1 ? w / 2 : (w * (i + 1)) / (n + 1)));
  const top = xs(Math.max(from, 1));
  const bottom = xs(Math.max(to, 1));
  const lines = Math.max(from, to, 1);
  const paths = Array.from({ length: lines }, (_, i) => {
    const a = top[from === 1 ? 0 : i] ?? top[0];
    const b = bottom[to === 1 ? 0 : i] ?? bottom[0];
    const color = from === 1 && to === 1 ? MAIN_RAIL : (colors[i] ?? MAIN_RAIL);
    return { d: `M ${a} 0 C ${a} ${H / 2}, ${b} ${H / 2}, ${b} ${H}`, color };
  });
  const kind =
    from === 1 && to === 1 ? "main" : from === 1 ? "split" : to === 1 ? "merge" : "parallel";
  return (
    <div className="-my-2 grid gap-1" data-junction={kind}>
      <div ref={ref} className="relative h-16 w-full">
        {w > 0 && (
          <svg width={w} height={H} className="absolute inset-0" aria-hidden>
            {paths.map((p, i) => (
              <g key={i} fill="none">
                <path d={p.d} stroke={p.color} strokeWidth={RAIL_W} />
                <path d={p.d} stroke="var(--background)" strokeWidth={GAP_W} />
                <path
                  d={p.d}
                  stroke={p.color === MAIN_RAIL ? SLEEPER : `${p.color}66`}
                  strokeWidth={GAP_W}
                  strokeDasharray="3 6"
                />
              </g>
            ))}
          </svg>
        )}
      </div>
      <p className="px-4 text-center text-xs text-muted-foreground">
        <strong className="text-foreground">{title}</strong> {text}
      </p>
    </div>
  );
}
