import { describe, expect, it } from "vitest";
import { siteFit } from "./site-fit";
import { makeOption, siteKey, stallsNeeded, validateLayout, type Layout } from "./schematic";

// manual site: 80' x 130', front 25, rear 10, sides 7.5 → envelope x 7.5–72.5, y 25–120
const fit = siteFit(
  null,
  { lotWidthFt: 80, lotDepthFt: 130, setbacks: { front: 25, rear: 10, left: 7.5, right: 7.5 } },
  { buildingArea: "4000", floors: "1" },
);
const layout = (p: Partial<Layout> = {}): Layout => ({
  title: "Test",
  building: [{ x: 10, y: 30, w: 50, d: 80 }],
  parking: null,
  driveway: { x: 60, w: 20, toY: 40 },
  entrance: "front",
  openSpace: [],
  rationale: "",
  assumptions: [],
  ...p,
});

describe("schematic validation", () => {
  it("keeps a building that's already inside the setbacks as it is", () => {
    const v = validateLayout(layout(), fit, "commercial");
    expect(v.building).toEqual([{ x: 10, y: 30, w: 50, d: 80 }]);
    expect(v.adjustments).toEqual([]);
    expect(v.metrics).toMatchObject({ footprintSqFt: 4000, coveragePct: 38, stallsNeeded: 14 });
  });
  it("pulls a building that crosses a setback back inside the envelope", () => {
    const v = validateLayout(layout({ building: [{ x: 0, y: 0, w: 60, d: 60 }] }), fit);
    const b = v.building[0];
    expect(b.x).toBeGreaterThanOrEqual(7.5);
    expect(b.y).toBeGreaterThanOrEqual(25);
    expect(b.x + b.w).toBeLessThanOrEqual(72.5);
    expect(b.y + b.d).toBeLessThanOrEqual(120);
    expect(v.adjustments).toContain("Moved the building fully inside the setbacks.");
  });
  it("falls back to a fitting footprint when the AI's building is unusable", () => {
    const v = validateLayout(layout({ building: [{ x: 200, y: 200, w: 10, d: 10 }] }), fit);
    expect(v.building).toHaveLength(1);
    expect(v.building[0].y).toBe(25);
    expect(v.adjustments[0]).toMatch(/largest footprint that does/);
  });
  it("counts an L-shape's overlap once", () => {
    const v = validateLayout(
      layout({
        building: [
          { x: 10, y: 30, w: 40, d: 40 },
          { x: 10, y: 30, w: 20, d: 80 },
        ],
      }),
      fit,
    );
    expect(v.metrics.footprintSqFt).toBe(1600 + 1600 - 800);
  });
  it("trims parking off the building and counts stalls", () => {
    const v = validateLayout(
      layout({
        building: [{ x: 10, y: 30, w: 60, d: 40 }],
        parking: { x: 0, y: 50, w: 80, d: 80 },
      }),
      fit,
    );
    expect(v.parking).toEqual({ x: 0, y: 70, w: 80, d: 60 });
    expect(v.metrics.stalls).toBe(Math.floor(4800 / 325));
    expect(v.adjustments[0]).toMatch(/Trimmed the parking/);
  });
  it("says when parking reaches into a setback (allowed in many codes, but worth checking)", () => {
    const front = validateLayout(
      layout({
        building: [{ x: 10, y: 60, w: 50, d: 50 }],
        parking: { x: 10, y: 2, w: 60, d: 50 },
      }),
      fit,
    );
    expect(front.adjustments.join(" ")).toMatch(/Parking reaches into the front \(25′\) setback/);
    const inside = validateLayout(
      layout({
        building: [{ x: 10, y: 30, w: 50, d: 40 }],
        parking: { x: 10, y: 75, w: 60, d: 40 },
      }),
      fit,
    );
    expect(inside.adjustments).toEqual([]);
  });
  it("keeps the driveway on the lot and starting at the street", () => {
    const v = validateLayout(layout({ driveway: { x: 75, w: 40, toY: 0 } }), fit);
    expect(v.driveway).toEqual({ x: 50, w: 30, toY: 25 });
  });
  it("needs parking only for non-residential programs", () => {
    expect(stallsNeeded("commercial", 6000)).toBe(20);
    expect(stallsNeeded("residential", 3000)).toBeNull();
  });
  it("marks the option with the site it was fitted to", () => {
    const o = makeOption(layout(), fit, "commercial", null);
    expect(o.siteKey).toBe(siteKey(fit));
    const changed = siteFit(
      null,
      { lotWidthFt: 80, lotDepthFt: 130, setbacks: { front: 30, rear: 10, left: 7.5, right: 7.5 } },
      { buildingArea: "4000" },
    );
    expect(siteKey(changed)).not.toBe(o.siteKey);
  });
});
