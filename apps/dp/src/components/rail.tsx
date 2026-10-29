// The Track Map's railway graphics (same rails and sleepers as the earlier
// map's RouteTrack).
//
// On wide screens (xl, where every row of stations fits without scrolling)
// <ContinuousTrack> draws the whole track as ONE unbroken line, measured from
// the page, with the original route track's rails: every row is entered at its
// first station and left after its last — the line bends down past the card,
// crosses back through the band below it and comes into the next row at its
// first station; at Submission Management it branches into one track per
// permit, each running on unbroken through that permit's lane and its review
// loop, and they rejoin the main line into the closeout row at Station 25. The per-row <Rail>s with a
// `railId` mark where the track goes; while it's drawn, the container carries
// data-track-on and styles.css hides those rails and the junction pieces.
//
// Narrower screens scroll the rows sideways, so they keep the per-row rails
// and the drawn junction pieces between sections (so does a wide screen where
// some row still doesn't fit).
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

import { GAUGE, MAIN_RAIL, planTrack, railPath, type TrackLine } from "@/lib/track-path";

const SLEEPER = "#c4cdd5";
const sleeperOf = (color: string) => (color === MAIN_RAIL ? SLEEPER : `${color}55`);

// A horizontal piece of track, 14px tall: two rails over sleepers. With a
// railId it's where the continuous track runs on wide screens (and hides there).
export function Rail({
  color = MAIN_RAIL,
  className,
  railId,
}: {
  color?: string;
  className?: string;
  railId?: string;
}) {
  const style: CSSProperties = {
    background: [
      `linear-gradient(${color}, ${color}) 0 2px / 100% 2.5px no-repeat`,
      `linear-gradient(${color}, ${color}) 0 9.5px / 100% 2.5px no-repeat`,
      `repeating-linear-gradient(90deg, ${sleeperOf(color)} 0 4px, transparent 4px 13px)`,
    ].join(", "),
  };
  return (
    <div
      aria-hidden
      data-rail={railId}
      className={cn("h-[14px] rounded-sm", className)}
      style={style}
    />
  );
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

function TrackLines({ lines }: { lines: TrackLine[] }) {
  return (
    <>
      {lines.map((l, i) => (
        <g key={i} fill="none" strokeLinejoin="round">
          <path
            d={railPath(l.points)}
            stroke={sleeperOf(l.color)}
            strokeWidth={14}
            strokeDasharray="4 9"
          />
          <path d={railPath(l.points, GAUGE)} stroke={l.color} strokeWidth={2.5} />
          <path d={railPath(l.points, -GAUGE)} stroke={l.color} strokeWidth={2.5} />
        </g>
      ))}
    </>
  );
}

// Rendered as the first child of the map container (position: relative); it
// finds that container itself — its own wrapper is always there, so the
// measuring runs on first render too (a ref passed down from the parent isn't
// attached yet when a child's layout effect runs).
export function ContinuousTrack({
  plan,
  pad,
  version,
}: {
  plan: Parameters<typeof planTrack>[4];
  pad: number;
  version: string; // changes whenever the content behind the track changes
}) {
  const [lines, setLines] = useState<TrackLine[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const planKey = JSON.stringify(plan);
  const self = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = self.current?.parentElement;
    if (!el) return;
    const wide = window.matchMedia("(min-width: 1280px)");
    let live = true;
    const measure = () => {
      if (!live) return;
      // only where every row of stations fits — a row that scrolls sideways
      // would slide its stations out from under the drawn track
      const fits = [...el.querySelectorAll<HTMLElement>("[data-rail]")].every((r) => {
        const s = r.closest<HTMLElement>(".overflow-x-auto");
        return !s || s.scrollWidth <= s.clientWidth + 1;
      });
      if (!wide.matches || !fits) {
        el.removeAttribute("data-track-on");
        return setLines([]);
      }
      const box = el.getBoundingClientRect();
      const rect = (q: string) => el.querySelector<HTMLElement>(q)?.getBoundingClientRect() ?? null;
      const rail = (id: string) => {
        const r = rect(`[data-rail="${id}"]`);
        return r ? { x0: r.left - box.left, x1: r.right - box.left, y: r.top - box.top + 7 } : null;
      };
      const corridor = (i: number) => {
        const r = rect(`[data-corridor="${i}"]`);
        const g = rect(`[data-gap="corridor-${i}"]`);
        return r && g
          ? { left: r.left - box.left, right: r.right - box.left, gapTop: g.top - box.top }
          : null;
      };
      const band = (id: string) => {
        const r = rect(`[data-gap="${id}"]`);
        return r && r.height > 0 ? r.top - box.top : null;
      };
      const next = planTrack(
        { width: el.clientWidth, pad },
        rail,
        corridor,
        band,
        JSON.parse(planKey),
      );
      el.toggleAttribute("data-track-on", next.length > 0);
      setSize({ w: el.clientWidth, h: el.clientHeight });
      setLines(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // a row can stop (or start) overflowing without the map changing size —
    // e.g. once the web font loads — so watch each row too
    el.querySelectorAll("[data-rail]").forEach((r) => {
      const row = r.closest(".overflow-x-auto")?.querySelector("ol");
      if (row) ro.observe(row);
    });
    void document.fonts?.ready.then(measure);
    // and once more as the page settles (images, late data)
    const timers = [300, 1000, 2500].map((ms) => window.setTimeout(measure, ms));
    wide.addEventListener("change", measure);
    window.addEventListener("resize", measure);
    return () => {
      live = false;
      timers.forEach((t) => window.clearTimeout(t));
      el.removeAttribute("data-track-on");
      ro.disconnect();
      wide.removeEventListener("change", measure);
      window.removeEventListener("resize", measure);
    };
  }, [pad, planKey, version]);
  return (
    <div ref={self} aria-hidden className="pointer-events-none absolute left-0 top-0 z-[1]">
      {lines.length > 0 && (
        <svg data-continuous-track width={size.w} height={size.h} className="block">
          <TrackLines lines={lines} />
        </svg>
      )}
    </div>
  );
}

const RAIL_W = 11; // outer width of the two rails, px
const GAP_W = 6.5; // the gap between them
const H = 64; // height of a joining piece, px

// Joins two sections on narrow screens with a drawn piece of track — `from`
// tracks at the top, `to` at the bottom (1 = the main line): 1→1 runs straight
// on, 1→N splits, N→N runs in parallel, N→1 merges. (On wide screens the
// continuous track runs past it down the side instead, and only the words stay.)
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
  const count = Math.max(from, to, 1);
  const paths = Array.from({ length: count }, (_, i) => {
    const a = top[from === 1 ? 0 : i] ?? top[0];
    const b = bottom[to === 1 ? 0 : i] ?? bottom[0];
    const color = from === 1 && to === 1 ? MAIN_RAIL : (colors[i] ?? MAIN_RAIL);
    return { d: `M ${a} 0 C ${a} ${H / 2}, ${b} ${H / 2}, ${b} ${H}`, color };
  });
  const kind =
    from === 1 && to === 1 ? "main" : from === 1 ? "split" : to === 1 ? "merge" : "parallel";
  return (
    <div className="-my-2 grid gap-1" data-junction={kind}>
      <div ref={ref} data-junction-art className="relative h-16 w-full">
        {w > 0 && (
          <svg width={w} height={H} className="absolute inset-0" aria-hidden>
            {paths.map((p, i) => (
              <g key={i} fill="none">
                <path d={p.d} stroke={p.color} strokeWidth={RAIL_W} />
                <path d={p.d} stroke="var(--background)" strokeWidth={GAP_W} />
                <path
                  d={p.d}
                  stroke={sleeperOf(p.color)}
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
