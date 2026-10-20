import { describe, expect, it } from "vitest";
import { planToImage, type Placement } from "./survey-image";

const img = { width: 1000, height: 1000 };
const lot = { widthFt: 80, depthFt: 130 };
// lot outline at x 200–400, y 100–500 on a 1000×1000 image
const at = (streetEdge: Placement["streetEdge"]) =>
  planToImage({ page: 1, box: [100, 200, 500, 400], streetEdge }, img, lot);

describe("plan → survey image", () => {
  it("street at the bottom: front-left corner is bottom-left", () => {
    const m = at("bottom");
    expect(m(0, 0)).toEqual([200, 500]);
    expect(m(80, 130)).toEqual([400, 100]);
  });
  it("street at the top: rotated 180° (front-left is top-right)", () => {
    const m = at("top");
    expect(m(0, 0)).toEqual([400, 100]);
    expect(m(80, 130)).toEqual([200, 500]);
  });
  it("street on the left: front-left is top-left, depth runs to the right", () => {
    const m = at("left");
    expect(m(0, 0)).toEqual([200, 100]);
    expect(m(0, 130)).toEqual([400, 100]);
    expect(m(80, 0)).toEqual([200, 500]);
  });
  it("street on the right: front-left is bottom-right", () => {
    const m = at("right");
    expect(m(0, 0)).toEqual([400, 500]);
    expect(m(0, 130)).toEqual([200, 500]);
    expect(m(80, 0)).toEqual([400, 100]);
  });
  it("never mirrors: walking front-left → front-right → rear-right turns the same way", () => {
    for (const e of ["bottom", "top", "left", "right"] as const) {
      const m = at(e);
      const [a, b, c] = [m(0, 0), m(80, 0), m(80, 130)];
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      expect(Math.sign(cross)).toBe(Math.sign(-1)); // counter-clockwise on screen for every edge
    }
  });
});
