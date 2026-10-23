import { useLayoutEffect, useRef, useState } from "react";
import { trackLightDashes } from "@/lib/track-light";

// The track through one route card of the Track Map, drawn as one SVG so the
// line bends on curves (like real track) instead of meeting at right angles.
//
// The routes snake down the page: a route's line comes in from the route
// above on one side of the card (`entry`) and leaves for the next route on
// the other (`exit`), alternating right, left, right… Each row of stations
// is a rail between those two bends. On narrow screens the stations wrap
// into several rows; the extra rows curve into the exit-side line.
// Rails are two strokes offset from the centre line, sleepers a dashed wide
// stroke along it — so both follow the curves.
//
// Rows are measured from the rendered station slots, so the drawing always
// matches the layout.
//
// Each centre-line path also carries the Track Map's travelling light (two
// dashes, lib/track-light) and how far along this card's line it starts;
// the svg carries the line's length from entry to exit. The page's
// useTrackLight animates them.

export type TrackSide = "left" | "right";

const RADIUS = 28; // centre-line radius of every bend, px
const GAUGE = 5.5; // centre line → each rail, px
const RAIL = "#6a7987";
const SLEEPER = "#c4cdd5";
// Rail centre within a slot: the slot's rail band starts 1.1rem down and is 14px tall.
const RAIL_IN_SLOT = 17.6 + 7;

type Row = { y: number; x0: number; x1: number };
type Layout = { width: number; height: number; rows: Row[] };
type Piece = { d: string; at: number }; // a path, and px along the line where it starts

export function RouteTrack({
  entry,
  exit,
}: {
  // Side the line comes in from / leaves by; null for the first / last route.
  entry: TrackSide | null;
  exit: TrackSide | null;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [layout, setLayout] = useState<Layout | null>(null);

  useLayoutEffect(() => {
    const section = ref.current?.parentElement;
    if (!section) return;
    const measure = () => {
      const box = section.getBoundingClientRect();
      const top = box.top + section.clientTop;
      const left = box.left + section.clientLeft;
      const rows: Row[] = [];
      for (const li of section.querySelectorAll<HTMLElement>("ol[data-track-rows] > li")) {
        const r = li.getBoundingClientRect();
        const y = Math.round(r.top - top + RAIL_IN_SLOT);
        const x0 = r.left - left - 8;
        const x1 = r.right - left + 8;
        const row = rows.find((x) => Math.abs(x.y - y) < 4);
        if (row) {
          row.x0 = Math.min(row.x0, x0);
          row.x1 = Math.max(row.x1, x1);
        } else rows.push({ y, x0, x1 });
      }
      rows.sort((a, b) => a.y - b.y);
      setLayout({ width: section.clientWidth, height: section.clientHeight, rows });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(section);
    return () => ro.disconnect();
  }, []);

  let centre: Piece[] = [];
  let rails: string[] = [];
  let through = 0; // centre-line length from entry to exit
  if (layout && layout.rows.length > 0) {
    const R = RADIUS;
    const { width, height, rows } = layout;
    // Centre of the card's left / right border line.
    const edge = (side: TrackSide) => (side === "right" ? width + 0.5 : -0.5);
    // +1 when the bend's line is on the right (the curve's centre is to its left).
    const sign = (side: TrackSide) => (side === "right" ? 1 : -1);
    // The side the extra rows (and the line on to the next route) gather on.
    const spineSide: TrackSide = exit ?? (entry === "left" ? "right" : "left");
    const S = edge(spineSide);
    const s = sign(spineSide);
    const [first, ...rest] = rows;
    const lastRow = rows[rows.length - 1];
    const goesDown = exit != null || rest.length > 0;
    // A row's open end (no bend there): its outermost station slot.
    const openEnd = (row: Row, side: TrackSide) => (side === "right" ? row.x1 : row.x0);
    // Row 1 starts at the entry bend (or its open end).
    const start = entry
      ? edge(entry) - sign(entry) * R
      : openEnd(first, spineSide === "right" ? "left" : "right");
    const end = exit ? height + 1 : lastRow.y - R; // the spine's end

    // Centre-line distances from where the line enters this card: to row 1,
    // and to the spine (row 1 plus its bend). Each bend is a quarter circle.
    const bend = (Math.PI * R) / 2;
    const toRow = entry ? first.y - R + 1 + bend : 0;
    const toSpine = toRow + Math.abs(S - s * R - start) + bend;
    through = toSpine + Math.max(0, end - (first.y + R));

    // o = offset toward each bend's centre (±GAUGE = the two rails, 0 = centre line).
    const build = (o: number): Piece[] => {
      const d: Piece[] = [];
      // Row 1: across to the spine bend.
      if (goesDown) {
        d.push({
          d:
            `M ${start} ${first.y + o} H ${S - s * R} ` +
            `A ${R - o} ${R - o} 0 0 ${s > 0 ? 1 : 0} ${S - s * o} ${first.y + R}`,
          at: toRow,
        });
      } else {
        d.push({ d: `M ${start} ${first.y + o} H ${openEnd(first, spineSide)}`, at: toRow });
      }
      // From the route above: down its side, bending into row 1.
      if (entry) {
        const E = edge(entry);
        const e = sign(entry);
        d.push({
          d:
            `M ${E - e * o} -1 V ${first.y - R} ` +
            `A ${R - o} ${R - o} 0 0 ${e > 0 ? 1 : 0} ${E - e * R} ${first.y - o}`,
          at: 0,
        });
      }
      // Wrapped rows: from their open end, bending up into the spine. The
      // light crosses them in step with row 1.
      for (const row of rest) {
        const from = openEnd(row, spineSide === "right" ? "left" : "right");
        d.push({
          d:
            `M ${from} ${row.y - o} H ${S - s * R} ` +
            `A ${R - o} ${R - o} 0 0 ${s > 0 ? 0 : 1} ${S - s * o} ${row.y - R}`,
          at: toRow + s * (from - start),
        });
      }
      // The spine: down the exit side to the next route (or to the last row).
      if (goesDown && end > first.y + R) {
        d.push({ d: `M ${S - s * o} ${first.y + R} V ${end}`, at: toSpine });
      }
      return d;
    };
    centre = build(0);
    rails = [...build(GAUGE), ...build(-GAUGE)].map((p) => p.d);
  }

  return (
    <svg
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute left-0 top-0 overflow-visible"
      width={layout?.width ?? 0}
      height={layout?.height ?? 0}
      data-track-light={through}
    >
      <g fill="none">
        {centre.map((p, i) => (
          <path key={`s${i}`} d={p.d} stroke={SLEEPER} strokeWidth={14} strokeDasharray="3 11" />
        ))}
        {rails.map((d, i) => (
          <path key={`r${i}`} d={d} stroke={RAIL} strokeWidth={3} />
        ))}
      </g>
      <g className="track-light-path" opacity={0.85} fill="none" strokeWidth={14}>
        {centre.flatMap((p, i) =>
          trackLightDashes(p.at).map((dash, k) => <path key={`l${i}-${k}`} d={p.d} {...dash} />),
        )}
      </g>
    </svg>
  );
}
