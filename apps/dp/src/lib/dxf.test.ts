import { describe, expect, it } from "vitest";
import { fromDwgEntities, isBinaryDxf, lengthTextToFeet, parseDxf, summarizeCad } from "./dxf";

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

// Shapes exactly as LibreDWG (@mlightcad/libredwg-web 0.7.17) returns them for
// example_2018.dwg from the LibreDWG test suite, trimmed to the fields we read.
describe("DWG entities (LibreDWG)", () => {
  const sample = [
    {
      type: "LINE",
      layer: "Tavolo 3",
      startPoint: { x: 370.86, y: 730.63, z: 0 },
      endPoint: { x: 450.04, y: 619.22, z: 0 },
    },
    {
      type: "TEXT",
      layer: "Tavolo 3",
      startPoint: { x: 5881.25, y: 1296.9 },
      endPoint: { x: 0, y: 0 },
      text: "teksto simpla",
    },
    {
      type: "MTEXT",
      layer: "Tavolo 3",
      insertionPoint: { x: 6909.32, y: 4954.12, z: 0 },
      text: "Teksto granda.\\PAlia linio.",
    },
    {
      type: "DIMENSION",
      layer: "Tavolo 3",
      insertionPoint: { x: 0, y: 0 },
      name: "*D3",
      text: "",
      measurement: 1504.6794770244742,
    },
    { type: "DIMENSION", layer: "Dims", name: "*D9", text: "1200", measurement: 1504.68 },
    {
      type: "INSERT",
      layer: "Tavolo 3",
      insertionPoint: { x: 3642.14, y: 6066.05, z: 0 },
      name: "bloko",
    },
    {
      type: "LWPOLYLINE",
      layer: "Rooms",
      flag: 1,
      vertices: [
        { x: 0, y: 0 },
        { x: 4000, y: 0 },
        { x: 4000, y: 3000 },
        { x: 0, y: 3000 },
      ],
    },
    { type: "HATCH", layer: "Tavolo 2" },
  ];

  it("summarises like a DXF: units, text, dimensions (blank text = live measurement), areas, blocks", () => {
    const s = summarizeCad(4, fromDwgEntities(sample));
    expect(s.units.name).toBe("Millimeters");
    expect(s.entityCount).toBe(8);
    expect(s.texts.map((t) => t.text)).toEqual(["teksto simpla", "Teksto granda. Alia linio."]);
    expect(s.dimensions).toEqual([
      { layer: "Tavolo 3", measured: 1504.6795, text: null, overridden: false },
      { layer: "Dims", measured: 1504.68, text: "1200", overridden: true },
    ]);
    expect(s.closedAreas).toEqual([{ layer: "Rooms", area: 12_000_000 }]);
    expect(s.blocks).toEqual([{ name: "bloko", count: 1 }]);
    expect(s.layers[0]).toEqual({ name: "Tavolo 3", count: 5 });
    // a dimension's 0,0 insertion point doesn't stretch the extents
    expect(s.extents?.minX).toBe(0);
    expect(s.extents?.maxY).toBe(6066.05);
  });
});
