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

// The whole map's track as continuous lines, from where the page put things —
// laid like the original route track: the main line snakes down the page,
// each row's line leaving by one side, bending down round the card and coming
// into the next row from that same side (right, left, right…).
//   main      rail ids of the main-line rows before the branch, in order
//   permits   one per permit: [lane rail id, loop rail id] (inside data-corridor=i)
//   after     the main-line row after the permits rejoin it
export function planTrack(
  box: { width: number; pad: number },
  rail: (id: string) => { x0: number; x1: number; y: number } | null,
  corridor: (i: number) => { left: number; right: number; gapTop: number } | null,
  plan: { main: string[]; permits: [string, string][]; after: string; colors: string[] },
): TrackLine[] {
  type Side = "left" | "right";
  const other = (s: Side): Side => (s === "left" ? "right" : "left");
  // the gutters beside the map; track k sits k lines further out
  const G = (s: Side, k: number) =>
    s === "left" ? box.pad - 12 - k * LINE_GAP : box.width - box.pad + 12 + k * LINE_GAP;
  const at = (r: { x0: number; x1: number }, s: Side) => (s === "left" ? r.x0 : r.x1);

  const rows = plan.main.map(rail);
  const end = rail(plan.after);
  if (!rows.length || rows.some((r) => !r) || !end) return [];
  const main: Pt[] = [];
  let side: Side = "left"; // the side the line comes in from
  rows.forEach((row, i) => {
    const r = row!;
    main.push([at(r, side), r.y], [at(r, other(side)), r.y]);
    side = other(side);
    const next = rows[i + 1];
    if (next) main.push([G(side, 0), r.y], [G(side, 0), next.y]);
  });
  const branch = rows[rows.length - 1]!;
  const S = side; // the permits branch off on this side…
  const O = other(S); // …and rejoin on the other
  const n = plan.permits.length;
  const lines: TrackLine[] = [];
  if (!n) {
    main.push([G(S, 0), branch.y], [G(S, 0), end.y], [at(end, S), end.y], [at(end, O), end.y]);
    return [{ points: main, color: MAIN_RAIL }];
  }
  // Permit i leaves the branch down the gutter on track i, runs along its lane,
  // bends back inside its card into its review loop, and rejoins the main line
  // down the far gutter on track n-1-i. Ordered so, no two permit tracks cross.
  plan.permits.forEach(([laneId, loopId], i) => {
    const lane = rail(laneId);
    const loop = rail(loopId);
    const card = corridor(i);
    if (!lane || !loop || !card) return;
    const yc = card.gapTop + LINE_GAP;
    const near = S === "left" ? card.left + 12 : card.right - 12;
    const far = S === "left" ? card.right - 10 : card.left + 10;
    const k = n - 1 - i;
    lines.push({
      color: plan.colors[i] ?? MAIN_RAIL,
      points: [
        [at(branch, S), branch.y],
        [G(S, i), branch.y],
        [G(S, i), lane.y],
        [at(lane, S), lane.y],
        [at(lane, O), lane.y],
        [far, lane.y],
        [far, yc],
        [near, yc],
        [near, loop.y],
        [at(loop, S), loop.y],
        [at(loop, O), loop.y],
        [G(O, k), loop.y],
        [G(O, k), end.y],
        [at(end, O), end.y],
      ],
    });
  });
  // on top: the main line up to the branch, and on from where the permits rejoin
  lines.push({ points: main, color: MAIN_RAIL });
  lines.push({
    color: MAIN_RAIL,
    points: [
      [G(O, n - 1), end.y],
      [at(end, O), end.y],
      [at(end, S), end.y],
    ],
  });
  return lines;
}

// Gutter each side of the map for the track's bends: room for every permit's
// own line plus the main line.
export const trackGutter = (permits: number) => 20 + Math.max(permits, 1) * LINE_GAP;
