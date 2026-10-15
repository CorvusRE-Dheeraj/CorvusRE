import { useLayoutEffect, useRef, useState } from "react";

// The track through one route card of the Track Map, drawn as one SVG so the
// line bends on curves (like real track) instead of meeting at right angles.
//
// Each row of stations has a rail running right. At the card's right border
// a vertical line runs down to the next route; every row curves into it. The
// first row also curves in from above when a route comes before this one.
// Rails are two strokes offset from the centre line, sleepers are a dashed
// wide stroke along it — so both follow the curves.
//
// Rows are measured from the rendered station slots (the grid wraps on
// narrow screens), so the drawing always matches the layout.

const RADIUS = 28; // centre-line radius of every bend, px
const GAUGE = 5.5; // centre line → each rail, px
const RAIL = "#6a7987";
const SLEEPER = "#c4cdd5";
// Rail centre within a slot: the slot's rail band starts 1.1rem down and is 14px tall.
const RAIL_IN_SLOT = 17.6 + 7;

type Row = { y: number; x0: number };
type Layout = { width: number; height: number; rows: Row[] };

export function RouteTrack({ entry, exit }: { entry: boolean; exit: boolean }) {
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
        const row = rows.find((x) => Math.abs(x.y - y) < 4);
        if (row) row.x0 = Math.min(row.x0, r.left - left - 8);
        else rows.push({ y, x0: r.left - left - 8 });
      }
      rows.sort((a, b) => a.y - b.y);
      setLayout({ width: section.clientWidth, height: section.clientHeight, rows });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(section);
    return () => ro.disconnect();
  }, []);

  const paths: string[] = [];
  if (layout && layout.rows.length > 0) {
    const R = RADIUS;
    const bx = layout.width + 0.5; // centre of the card's right border
    const [first, ...rest] = layout.rows;
    const lastRow = layout.rows[layout.rows.length - 1];
    const goesDown = exit || rest.length > 0;
    // o = offset toward each bend's centre (+GAUGE / −GAUGE = the two rails, 0 = centre line).
    const build = (o: number): string[] => {
      const d: string[] = [];
      // Row 1: runs right, then bends down into the right-hand line.
      d.push(
        goesDown
          ? `M ${first.x0} ${first.y + o} H ${bx - R} A ${R - o} ${R - o} 0 0 1 ${bx - o} ${first.y + R}`
          : `M ${first.x0} ${first.y + o} H ${bx - R}`,
      );
      // From the route above: down the right edge, bending left into row 1.
      if (entry)
        d.push(
          `M ${bx - o} -1 V ${first.y - R} A ${R - o} ${R - o} 0 0 1 ${bx - R} ${first.y - o}`,
        );
      // Later rows: run right, then bend up into the right-hand line.
      for (const row of rest)
        d.push(
          `M ${row.x0} ${row.y - o} H ${bx - R} A ${R - o} ${R - o} 0 0 0 ${bx - o} ${row.y - R}`,
        );
      // The right-hand line itself.
      if (goesDown) {
        const end = exit ? layout.height + 1 : lastRow.y - R;
        if (end > first.y + R) d.push(`M ${bx - o} ${first.y + R} V ${end}`);
      }
      return d;
    };
    paths.push(...build(0), ...build(GAUGE), ...build(-GAUGE));
  }
  const centre = layout ? paths.slice(0, paths.length / 3) : [];
  const rails = layout ? paths.slice(paths.length / 3) : [];

  return (
    <svg
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute left-0 top-0 overflow-visible"
      width={layout?.width ?? 0}
      height={layout?.height ?? 0}
    >
      <g fill="none">
        {centre.map((d, i) => (
          <path key={`s${i}`} d={d} stroke={SLEEPER} strokeWidth={14} strokeDasharray="3 11" />
        ))}
        {rails.map((d, i) => (
          <path key={`r${i}`} d={d} stroke={RAIL} strokeWidth={3} />
        ))}
      </g>
    </svg>
  );
}
