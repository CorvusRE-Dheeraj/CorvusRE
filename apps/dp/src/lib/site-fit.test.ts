import { describe, expect, it } from "vitest";
import { parseArea, parseFloors, siteFit } from "./site-fit";
import type { SurveyReading } from "./survey-reading";

// the sample plat: 80' x 130', 25' front building line, 7.5' side lines,
// 10' rear utility easement, 5' right drainage easement, no rear setback drawn
const reading = (p: Partial<SurveyReading> = {}): SurveyReading => ({
  quality: "clear",
  isSurvey: true,
  boundary: { shape: "rectangular", description: null, sides: [] },
  lot: { widthFt: 80, depthFt: 130, areaSqFt: 10400, source: null },
  orientation: { northArrow: true, frontFaces: "S", note: null },
  frontage: { street: "Wainsborough Lane", cornerLot: false, secondStreet: null, access: null },
  easements: [
    { type: "utility", side: "rear", widthFt: 10, label: "10' U.E." },
    { type: "drainage", side: "right", widthFt: 5, label: "5' D.E." },
  ],
  noBuildAreas: [],
  setbacks: {
    front: { ft: 25, label: "25' BUILDING LINE" },
    rear: { ft: null, label: null },
    left: { ft: 7.5, label: "7.5' B.L." },
    right: { ft: 7.5, label: "7.5' B.L." },
  },
  envelope: { shown: false, widthFt: null, depthFt: null, areaSqFt: null, note: null },
  existing: [],
  labels: { legalDescription: null, address: null, surveyor: null, date: null, notes: [] },
  confidence: { lot: "high", setbacks: "high", easements: "high", orientation: "high" },
  flags: [],
  ...p,
});

describe("setback-based fit", () => {
  it("asks for missing values first", () => {
    const f = siteFit(reading(), null, { buildingArea: "3000", floors: "1" });
    expect(f.status).toBe("needs_info");
    expect(f.missing).toEqual(["Rear setback"]);
  });
  it("takes the wider of setback and easement on each side", () => {
    const f = siteFit(reading(), { setbacks: { rear: 5 } }, { buildingArea: "3000", floors: "1" });
    expect(f.limits!.rear).toMatchObject({ ft: 10, governedBy: "10' U.E.", setbackFt: 5 });
    expect(f.limits!.right).toMatchObject({ ft: 7.5, governedBy: "Right side setback" });
    expect(f.envelope).toEqual({ widthFt: 65, depthFt: 95, areaSqFt: 6175, pctOfLot: 59 });
  });
  it("judges the footprint: fits, tight, too big — and how many floors would fit", () => {
    const inputs = { setbacks: { rear: 10 } };
    expect(siteFit(reading(), inputs, { buildingArea: "3,000 sf", floors: "1" })).toMatchObject({
      status: "fits",
      usePct: 49,
      coveragePct: 29,
    });
    expect(siteFit(reading(), inputs, { buildingArea: "6000", floors: "1" }).status).toBe("tight");
    const big = siteFit(reading(), inputs, { buildingArea: "15000", floors: "1" });
    expect(big).toMatchObject({ status: "too_big", floorsNeeded: 3 });
    expect(big.notes.join(" ")).toMatch(/fit on 3 floors/);
    expect(siteFit(reading(), inputs, { buildingArea: "15000", floors: "3" }).status).toBe("fits");
  });
  it("keeps the suggested footprint inside the envelope, in its proportions", () => {
    const f = siteFit(reading(), { setbacks: { rear: 10 } }, { buildingArea: "3000", floors: "1" });
    expect(f.suggested!.widthFt).toBeLessThanOrEqual(65);
    expect(f.suggested!.depthFt).toBeLessThanOrEqual(95);
    expect(Math.round(f.suggested!.widthFt * f.suggested!.depthFt)).toBeGreaterThanOrEqual(2990);
  });
  it("reports no room when the limits eat the lot", () => {
    const f = siteFit(
      reading(),
      { lotWidthFt: 14, setbacks: { rear: 10 } },
      { buildingArea: "1000" },
    );
    expect(f.status).toBe("no_room");
    expect(f.notes[0]).toMatch(/use up the full 14' lot width/);
  });
  it("works from manual entry alone, with zero-lot-line sides", () => {
    const f = siteFit(
      null,
      { lotWidthFt: 25, lotDepthFt: 100, setbacks: { front: 15, rear: 10, left: 0, right: 0 } },
      { buildingArea: "3000", floors: "2" },
    );
    expect(f.envelope).toMatchObject({ widthFt: 25, depthFt: 75 });
    expect(f.status).toBe("fits");
  });
  it("warns about easements it couldn't place, irregular lots and narrow envelopes", () => {
    const f = siteFit(
      reading({
        boundary: { shape: "irregular", description: null, sides: [] },
        easements: [{ type: "access", side: "interior", widthFt: 20, label: null }],
      }),
      { lotWidthFt: 30, setbacks: { rear: 10 } },
      { buildingArea: "800" },
    );
    const n = f.notes.join(" ");
    expect(n).toMatch(/isn't along a property line/);
    expect(n).toMatch(/isn't a simple rectangle/);
    expect(n).toMatch(/only 15' across/);
  });
  it("parses brief values", () => {
    expect(parseArea("8,000 sf")).toBe(8000);
    expect(parseArea("about 8k")).toBe(8000);
    expect(parseArea("")).toBeNull();
    expect(parseFloors("2 stories")).toBe(2);
    expect(parseFloors(null)).toBe(1);
  });
});
