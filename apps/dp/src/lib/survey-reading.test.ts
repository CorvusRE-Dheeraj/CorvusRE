import { describe, expect, it } from "vitest";
import {
  areaMismatch,
  missingSiteValues,
  readingIsUnclear,
  siteValues,
  type SurveyReading,
} from "./survey-reading";

const reading = (p: Partial<SurveyReading> = {}): SurveyReading => ({
  quality: "clear",
  isSurvey: true,
  boundary: { shape: "rectangular", description: null, sides: [] },
  lot: { widthFt: 80, depthFt: 130, areaSqFt: 10400, source: "10,400 SQ. FT." },
  orientation: { northArrow: true, frontFaces: "S", note: null },
  frontage: { street: "Wainsborough Lane", cornerLot: false, secondStreet: null, access: null },
  easements: [],
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

describe("survey reading + user inputs", () => {
  it("uses the survey where the user hasn't entered anything, and the user's value where they have", () => {
    const v = siteValues(reading(), { setbacks: { left: 10 } });
    expect(v.lotWidth).toMatchObject({ value: 80, source: "survey" });
    expect(v.setbacks.front).toMatchObject({
      value: 25,
      source: "survey",
      label: "25' BUILDING LINE",
    });
    expect(v.setbacks.left).toMatchObject({ value: 10, source: "you" });
    expect(v.setbacks.rear).toMatchObject({ value: null, source: null });
  });
  it("lists what's still needed and flags the reading as unclear until it's provided", () => {
    const r = reading();
    expect(missingSiteValues(siteValues(r, null))).toEqual(["Rear setback"]);
    expect(readingIsUnclear(r, siteValues(r, null))).toBe(true);
    const done = siteValues(r, { setbacks: { rear: 10 } });
    expect(missingSiteValues(done)).toEqual([]);
    expect(readingIsUnclear(r, done)).toBe(false);
  });
  it("treats a zero setback typed by the user as a real value", () => {
    const zero = siteValues(reading(), { setbacks: { rear: 0 } });
    expect(zero.setbacks.rear).toMatchObject({ value: 0, source: "you" });
    expect(missingSiteValues(zero)).toEqual([]);
    expect(siteValues(null, { lotWidthFt: 0 }).lotWidth.value).toBe(null);
  });
  it("works with no survey reading at all (manual entry only)", () => {
    const v = siteValues(null, {
      lotWidthFt: 60,
      lotDepthFt: 100,
      setbacks: { front: 20, rear: 10, left: 5, right: 5 },
    });
    expect(missingSiteValues(v)).toEqual([]);
    expect(v.lotArea.value).toBe(6000);
  });
  it("flags poor quality, low confidence and AI flags as unclear", () => {
    const filled = { setbacks: { rear: 10 } };
    for (const p of [
      { quality: "partly_readable" as const },
      {
        confidence: {
          lot: "low" as const,
          setbacks: "high" as const,
          easements: "high" as const,
          orientation: "high" as const,
        },
      },
      { flags: [{ field: "scale", issue: "Scale bar unreadable" }] },
    ])
      expect(readingIsUnclear(reading(p), siteValues(reading(p), filled))).toBe(true);
  });
  it("spots a stated area that doesn't match width × depth", () => {
    expect(areaMismatch(reading())).toBeNull();
    expect(
      areaMismatch(reading({ lot: { widthFt: 80, depthFt: 130, areaSqFt: 9000, source: null } })),
    ).toMatch(/not be a simple rectangle/);
  });
});
