import { describe, expect, it } from "vitest";
import { isBinaryDxf, lengthTextToFeet, parseDxf } from "./dxf";

const dxf = (units: number, entities: string[][]) =>
  [
    ["0", "SECTION"],
    ["2", "HEADER"],
    ["9", "$INSUNITS"],
    ["70", String(units)],
    ["0", "ENDSEC"],
    ["0", "SECTION"],
    ["2", "ENTITIES"],
    ...entities,
    ["0", "ENDSEC"],
    ["0", "EOF"],
  ]
    .flat()
    .join("\n");

describe("lengthTextToFeet", () => {
  it("reads feet-inches, inches and metric", () => {
    expect(lengthTextToFeet(`12'-6"`)).toBeCloseTo(12.5);
    expect(lengthTextToFeet(`25'`)).toBe(25);
    expect(lengthTextToFeet(`36"`)).toBe(3);
    expect(lengthTextToFeet(`3' 4 1/2"`)).toBeCloseTo(3.375);
    expect(lengthTextToFeet("3 m")).toBeCloseTo(9.84252);
    expect(lengthTextToFeet("VARIES")).toBeNull();
  });
});

describe("parseDxf", () => {
  it("reads units, layers, text, closed areas and dimensions", () => {
    const s = parseDxf(
      dxf(2, [
        [
          "0",
          "LWPOLYLINE",
          "8",
          "BLDG",
          "90",
          "4",
          "70",
          "1",
          "10",
          "0",
          "20",
          "0",
          "10",
          "50",
          "20",
          "0",
          "10",
          "50",
          "20",
          "40",
          "10",
          "0",
          "20",
          "40",
        ],
        ["0", "TEXT", "8", "ANNO", "10", "5", "20", "5", "1", "OFFICE 101"],
        ["0", "MTEXT", "8", "ANNO", "10", "5", "20", "5", "1", "{\\fArial;TYPE V-B}\\PSPRINKLERED"],
        ["0", "DIMENSION", "8", "DIM", "42", "25.0", "1", "<>"],
        ["0", "DIMENSION", "8", "DIM", "42", "20.0", "1", `25'-0"`],
        ["0", "DIMENSION", "8", "DIM", "42", "10.0", "1", `10'-0"`],
      ]),
    );
    expect(s.units.name).toBe("Feet");
    expect(s.entityCount).toBe(6);
    expect(s.closedAreas).toEqual([{ layer: "BLDG", area: 2000 }]);
    expect(s.texts.map((t) => t.text)).toEqual(["OFFICE 101", "TYPE V-B SPRINKLERED"]);
    expect(s.dimensions.map((d) => d.overridden)).toEqual([false, true, false]);
    expect(s.warnings.join(" ")).toMatch(/1 dimension shows text that doesn't match/);
    expect(s.extents).toEqual({ minX: 0, minY: 0, maxX: 50, maxY: 40 });
  });

  it("compares inch drawings against feet-inch text", () => {
    const s = parseDxf(dxf(1, [["0", "DIMENSION", "8", "D", "42", "150", "1", `12'-6"`]]));
    expect(s.dimensions[0].overridden).toBe(false);
  });

  it("warns when the drawing has no units", () => {
    const s = parseDxf(
      dxf(0, [["0", "LINE", "8", "0", "10", "0", "20", "0", "11", "1", "21", "1"]]),
    );
    expect(s.units.toFeet).toBeNull();
    expect(s.warnings[0]).toMatch(/no units/);
  });

  it("spots binary DXF", () => {
    expect(isBinaryDxf("AutoCAD Binary DXF\r\n")).toBe(true);
    expect(isBinaryDxf("  0\nSECTION")).toBe(false);
  });
});
