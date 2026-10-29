import { describe, expect, it } from "vitest";
import { planTrack, railPath, trackGutter, type Pt, type TrackLine } from "./track-path";

// A wide page: main rows, then three permit cards (lane + loop), then closeout.
const W = 1200;
const pad = trackGutter(3);
const rails: Record<string, { x0: number; x1: number; y: number }> = {
  "route-1": { x0: 120, x1: 1080, y: 100 },
  "route-2": { x0: 120, x1: 1080, y: 400 },
  "route-3": { x0: 120, x1: 1080, y: 700 },
  "station-18": { x0: 430, x1: 770, y: 1000 },
  "lane-0": { x0: 140, x1: 1060, y: 1300 },
  "loop-0": { x0: 140, x1: 1060, y: 1500 },
  "lane-1": { x0: 140, x1: 1060, y: 1900 },
  "loop-1": { x0: 140, x1: 1060, y: 2100 },
  "lane-2": { x0: 140, x1: 1060, y: 2500 },
  "loop-2": { x0: 140, x1: 1060, y: 2700 },
  "route-6": { x0: 120, x1: 1080, y: 3100 },
};
const cards = [0, 1, 2].map((i) => ({
  left: 116,
  right: 1084,
  gapTop: rails[`lane-${i}`].y + 120,
}));
const plan = {
  main: ["route-1", "route-2", "route-3", "station-18"],
  permits: [0, 1, 2].map((i) => [`lane-${i}`, `loop-${i}`] as [string, string]),
  after: "route-6",
  colors: ["#2563eb", "#7c3aed", "#f97316"],
};
const lines = planTrack(
  { width: W, pad },
  (id) => rails[id] ?? null,
  (i) => cards[i] ?? null,
  plan,
);

const segments = (l: TrackLine) => l.points.slice(1).map((p, i) => [l.points[i], p] as [Pt, Pt]);
// do two axis-aligned segments touch? (shared endpoints and overlaps on the
// same line count as touching too — the caller decides what's allowed)
function cross(a: [Pt, Pt], b: [Pt, Pt]) {
  const [ax0, ax1] = [Math.min(a[0][0], a[1][0]), Math.max(a[0][0], a[1][0])];
  const [ay0, ay1] = [Math.min(a[0][1], a[1][1]), Math.max(a[0][1], a[1][1])];
  const [bx0, bx1] = [Math.min(b[0][0], b[1][0]), Math.max(b[0][0], b[1][0])];
  const [by0, by1] = [Math.min(b[0][1], b[1][1]), Math.max(b[0][1], b[1][1])];
  const aVert = ax0 === ax1;
  const bVert = bx0 === bx1;
  if (aVert === bVert) return false; // parallel pieces: shared track, not a crossing
  const [v, h] = aVert
    ? [
        [ax0, ay0, ay1],
        [by0, bx0, bx1],
      ]
    : [
        [bx0, by0, by1],
        [ay0, ax0, ax1],
      ];
  // strictly inside both: a real crossing (meeting at a bend or an end isn't)
  return v[0] > h[1] && v[0] < h[2] && h[0] > v[1] && h[0] < v[2];
}

describe("planTrack", () => {
  it("draws the main line, one line per permit, and the main line on after they rejoin", () => {
    expect(lines).toHaveLength(5);
    expect(lines.slice(0, 3).map((l) => l.color)).toEqual(plan.colors);
  });

  it("every line is one unbroken path of straight runs", () => {
    for (const l of lines)
      for (const [a, b] of segments(l)) expect(a[0] === b[0] || a[1] === b[1]).toBe(true);
  });

  it("the main line snakes down like the original track: right, left, right, then into station 18", () => {
    const main = lines[3].points;
    expect(main[0]).toEqual([120, 100]); // starts at station 1
    const turns = main.filter(([x]) => x < 120 || x > 1080).map(([x]) => (x > 1080 ? "R" : "L"));
    expect(turns.join("")).toBe("RRLLRR");
    expect(main.at(-1)).toEqual([430, 1000]); // leaves station 18 at its left end, where it branches
  });

  it("each permit's line leaves the branch, runs through its lane and loop, and joins closeout", () => {
    lines.slice(0, 3).forEach((l, i) => {
      expect(l.points[0]).toEqual([430, 1000]);
      const ys = l.points.map(([, y]) => y);
      expect(ys).toContain(rails[`lane-${i}`].y);
      expect(ys).toContain(rails[`loop-${i}`].y);
      expect(l.points.at(-1)).toEqual([1080, 3100]);
    });
  });

  it("no two permit tracks cross", () => {
    const permitLines = lines.slice(0, 3);
    for (let i = 0; i < permitLines.length; i++)
      for (let j = i + 1; j < permitLines.length; j++)
        for (const a of segments(permitLines[i]))
          for (const b of segments(permitLines[j])) expect(cross(a, b)).toBe(false);
  });

  it("with no permits the main line runs straight on to closeout", () => {
    const only = planTrack(
      { width: W, pad },
      (id) => rails[id] ?? null,
      () => null,
      { ...plan, permits: [], colors: [] },
    );
    expect(only).toHaveLength(1);
    expect(only[0].points.at(-1)).toEqual([1080, 3100]);
  });
});

describe("railPath", () => {
  it("rounds bends and keeps both rails parallel round them", () => {
    const pts: Pt[] = [
      [0, 0],
      [100, 0],
      [100, 100],
    ];
    expect(railPath(pts)).toMatch(
      /^M 0\.0 0\.0 L 86\.0 0\.0 Q 100\.0 0\.0 100\.0 14\.0 L 100\.0 100\.0$/,
    );
    // the inside rail bends tighter than the outside one
    expect(railPath(pts, 3.75)).toContain("Q 96.3 3.8");
    expect(railPath(pts, -3.75)).toContain("Q 103.8 -3.8");
  });
});
