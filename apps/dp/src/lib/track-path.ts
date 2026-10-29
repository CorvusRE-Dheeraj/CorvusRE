// Geometry of the Track Map's continuous track (components/rail.tsx draws it):
// rounded orthogonal rail paths, and where the line runs through the page.
export const MAIN_RAIL = "#6a7987";

export type Pt = [number, number];
export const LINE_GAP = 14; // between side-by-side tracks in a gutter or gap, px
export const GAUGE = 3.75; // centre line → each rail, px
const RADIUS = 14; // centre-line radius of every bend, px

// An orthogonal polyline as an SVG path with rounded bends, shifted `d` px to
// one side (for the two rails; 0 for the centre line). Bends on the inside of
// a turn get a tighter radius, on the outside a wider one, so both rails stay
// parallel round the curve.
export function railPath(points: Pt[], d = 0, r = RADIUS): string {
  const pts = points.filter(
    (p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 0.5,
  );
  if (pts.length < 2) return "";
  const segs = pts.slice(1).map((p, i) => {
    const [dx, dy] = [p[0] - pts[i][0], p[1] - pts[i][1]];
    const len = Math.hypot(dx, dy);
    return { u: [dx / len, dy / len] as Pt, len };
  });
  const normal = (u: Pt): Pt => [-u[1], u[0]];
  const off = (p: Pt, n: Pt): Pt => [p[0] + n[0] * d, p[1] + n[1] * d];
  const f = (p: Pt) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
  let out = `M ${f(off(pts[0], normal(segs[0].u)))}`;
  for (let j = 1; j < pts.length - 1; j++) {
    const a = segs[j - 1];
    const b = segs[j];
    const na = normal(a.u);
    const nb = normal(b.u);
    const turn = na[0] * b.u[0] + na[1] * b.u[1]; // +1: this side is the inside
    if (Math.abs(turn) < 0.5) {
      out += ` L ${f(off(pts[j], na))}`;
      continue;
    }
    const corner: Pt = [pts[j][0] + (na[0] + nb[0]) * d, pts[j][1] + (na[1] + nb[1]) * d];
    const rc = Math.min(r, a.len / 2, b.len / 2);
    const rr = Math.max(0.5, rc - turn * d);
    out += ` L ${f([corner[0] - a.u[0] * rr, corner[1] - a.u[1] * rr])}`;
    out += ` Q ${f(corner)} ${f([corner[0] + b.u[0] * rr, corner[1] + b.u[1] * rr])}`;
  }
  const last = segs[segs.length - 1];
  return `${out} L ${f(off(pts[pts.length - 1], normal(last.u)))}`;
}

export type TrackLine = { points: Pt[]; color: string };

// The whole map's track as continuous lines, from where the page put things.
// Every row of stations is entered at its first station and left after its
// last, like reading the page: the line runs along a row, bends down past the
// card's right edge, crosses back through the band below it and comes down
// into the next row at its first station.
//   main      rail ids of the main-line rows before the branch, in order
//   permits   one per permit: [lane rail id, loop rail id] (inside data-corridor=i)
//   after     the main-line row after the permits rejoin it
//   band(id)  top of a band the line crosses back through: gap-0, gap-1… between
//             main rows, `split` (after the last main row) and `merge` (above
//             `after`)
export function planTrack(
  box: { width: number; pad: number },
  rail: (id: string) => { x0: number; x1: number; y: number } | null,
  corridor: (i: number) => { left: number; right: number; gapTop: number } | null,
  band: (id: string) => number | null,
  plan: { main: string[]; permits: [string, string][]; after: string; colors: string[] },
): TrackLine[] {
  // the gutters beside the map; track k sits k lines further out
  const L = (k: number) => box.pad - 12 - k * LINE_GAP;
  const R = (k: number) => box.width - box.pad + 12 + k * LINE_GAP;

  const rows = plan.main.map(rail);
  const end = rail(plan.after);
  const split = band("split");
  const merge = band("merge");
  const gaps = rows.slice(1).map((_, i) => band(`gap-${i}`));
  if (!rows.length || rows.some((r) => !r) || !end || split == null || merge == null) return [];
  if (gaps.some((g) => g == null)) return [];

  const main: Pt[] = [];
  rows.forEach((row, i) => {
    const r = row!;
    main.push([r.x0, r.y], [r.x1, r.y]);
    const next = rows[i + 1];
    if (next) {
      const y = gaps[i]! + LINE_GAP;
      main.push([R(0), r.y], [R(0), y], [L(0), y], [L(0), next.y]);
    }
  });
  const branch = rows[rows.length - 1]!;
  const n = plan.permits.length;
  const lines: TrackLine[] = [];
  if (!n) {
    const y = merge + LINE_GAP;
    main.push(
      [R(0), branch.y],
      [R(0), y],
      [L(0), y],
      [L(0), end.y],
      [end.x0, end.y],
      [end.x1, end.y],
    );
    return [{ points: main, color: MAIN_RAIL }];
  }
  // Permit i branches off at the right on track n-1-i, crosses back through the
  // split band (later permits higher) to the left gutter on track i, comes in
  // at the start of its lane, bends back inside its card to the start of its
  // review loop, leaves the loop on the right on track n-1-i and crosses back
  // through the merge band to rejoin the main line into the closeout row's
  // first station. Ordered so, no two tracks cross.
  plan.permits.forEach(([laneId, loopId], i) => {
    const lane = rail(laneId);
    const loop = rail(loopId);
    const card = corridor(i);
    if (!lane || !loop || !card) return;
    const k = n - 1 - i;
    const ys = split + LINE_GAP * (1 + k);
    const ym = merge + LINE_GAP * (1 + k);
    const yc = card.gapTop + LINE_GAP;
    lines.push({
      color: plan.colors[i] ?? MAIN_RAIL,
      points: [
        [branch.x1, branch.y],
        [R(k), branch.y],
        [R(k), ys],
        [L(i), ys],
        [L(i), lane.y],
        [lane.x0, lane.y],
        [lane.x1, lane.y],
        [card.right - 10, lane.y],
        [card.right - 10, yc],
        [card.left + 12, yc],
        [card.left + 12, loop.y],
        [loop.x0, loop.y],
        [loop.x1, loop.y],
        [R(k), loop.y],
        [R(k), ym],
        [L(0), ym],
        [L(0), end.y],
        [end.x0, end.y],
      ],
    });
  });
  // on top: the main line up to the branch, and on from where the permits rejoin
  lines.push({ points: main, color: MAIN_RAIL });
  lines.push({
    color: MAIN_RAIL,
    points: [
      [L(0), merge + LINE_GAP * n],
      [L(0), end.y],
      [end.x0, end.y],
      [end.x1, end.y],
    ],
  });
  return lines;
}

// Gutter each side of the map for the track's bends: room for every permit's
// own line plus the main line.
export const trackGutter = (permits: number) => 20 + Math.max(permits, 1) * LINE_GAP;
