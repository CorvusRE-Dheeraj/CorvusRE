import { describe, expect, it } from "vitest";
import {
  access,
  analysisSummaryLines,
  compass,
  fitPlane,
  floodplain,
  grading,
  tripEstimate,
  type FloodZone,
  type RoadHit,
  type SiteAnalysisRaw,
} from "./site-analysis";

const raw = (p: Partial<SiteAnalysisRaw> = {}): SiteAnalysisRaw => ({
  fetchedAt: "2026-10-20T12:00:00Z",
  address: "1 Test St, Dallas, TX",
  geocode: { x: -96.8, y: 32.9, matched: "1 TEST ST" },
  flood: null,
  elevation: null,
  roads: null,
  errors: {},
  ...p,
});
const Z = (zone: string, subtype: string | null = null, sfha = /^A|^V/.test(zone)): FloodZone => ({
  zone,
  subtype,
  sfha,
  bfe: null,
});
const flood = (atPoint: FloodZone[], nearby: FloodZone[] | null = atPoint) =>
  raw({ flood: { atPoint, nearby, panel: { number: "48113C0195K", effective: "2014-07-07" } } });

describe("floodplain", () => {
  it("reads the real cases we probed", () => {
    expect(floodplain(flood([Z("AE", "FLOODWAY")]))).toMatchObject({
      status: "floodway",
      inFloodplain: true,
    });
    expect(floodplain(flood([Z("AE")]))).toMatchObject({
      status: "sfha",
      inFloodplain: true,
      zone: "AE",
    });
    expect(floodplain(flood([Z("X", "0.2 PCT ANNUAL CHANCE FLOOD HAZARD")]))).toMatchObject({
      status: "moderate",
      inFloodplain: false,
    });
    expect(floodplain(flood([Z("X", "AREA OF MINIMAL FLOOD HAZARD")]))).toMatchObject({
      status: "minimal",
      inFloodplain: false,
      nearFloodplain: false,
    });
  });
  it("warns when a floodplain is close but not at the point", () => {
    expect(
      floodplain(flood([Z("X", "AREA OF MINIMAL FLOOD HAZARD")], [Z("X"), Z("AE")]))!
        .nearFloodplain,
    ).toBe(true);
  });
  it("names the base flood elevation when FEMA has one", () => {
    const r = floodplain(flood([{ zone: "AE", subtype: null, sfha: true, bfe: 512 }]))!;
    expect(r.requirements.join(" ")).toMatch(/base flood elevation \(512 ft\)/);
  });
  it("handles Zone D, no map and no data", () => {
    expect(floodplain(flood([Z("D")]))!.status).toBe("undetermined");
    expect(floodplain(flood([]))!.status).toBe("unknown");
    expect(floodplain(raw())).toBeNull();
  });
});

describe("grading", () => {
  // a plane falling 4 ft per 100 ft toward the east, sampled on a 3×3 grid 100 ft apart
  const grid = (b: number, c: number, noise = 0) =>
    [-1, 0, 1].flatMap((j) =>
      [-1, 0, 1].map((i) => ({
        dx: i * 100,
        dy: j * 100,
        ft: 700 + b * i * 100 + c * j * 100 + (i === 0 && j === 0 ? noise : 0),
      })),
    );
  it("fits a plane exactly", () => {
    const p = fitPlane(grid(-0.04, 0.01));
    expect(p.b).toBeCloseTo(-0.04);
    expect(p.c).toBeCloseTo(0.01);
  });
  it("reports slope, downhill direction and class", () => {
    const g = grading(
      raw({ elevation: { sideFt: 200, assumedLot: false, points: grid(-0.04, 0) } }),
    )!;
    expect(g).toMatchObject({ slopePct: 4, downhill: "east", grade: "moderate", reliefFt: 8 });
    expect(
      grading(raw({ elevation: { sideFt: 200, assumedLot: false, points: grid(0, 0.005) } })),
    ).toMatchObject({ grade: "very_flat", downhill: "south" });
    expect(
      grading(raw({ elevation: { sideFt: 200, assumedLot: false, points: grid(0.1, 0.1) } }))!
        .grade,
    ).toBe("very_steep");
  });
  it("flags uneven ground (a ditch or ridge)", () => {
    const g = grading(
      raw({ elevation: { sideFt: 200, assumedLot: false, points: grid(-0.02, 0, -4) } }),
    )!;
    expect(g.unevenFt).toBeGreaterThanOrEqual(2);
    expect(g.notes.join(" ")).toMatch(/uneven/);
  });
  it("compass directions", () => {
    expect([compass(0), compass(90), compass(225), compass(-45)]).toEqual([
      "north",
      "east",
      "southwest",
      "northwest",
    ]);
  });
});

describe("ingress / egress and TIA", () => {
  const road = (
    name: string,
    mtfcc: string,
    distanceM: number,
    bearingDeg: number,
    aliases: string[] = [],
  ): RoadHit => ({
    name,
    aliases,
    mtfcc,
    layer: "",
    distanceM,
    bearingDeg,
  });
  it("Preston Rd (State Hwy 289): TxDOT access permit", () => {
    const a = access(
      raw({
        roads: [
          road("Preston Rd", "S1200", 6.4, 274, ["State Hwy 289"]),
          road("Tavel Cir", "S1400", 74.8, 0),
        ],
      }),
      {},
    )!;
    expect(a.frontage.map((r) => r.name)).toEqual(["Preston Rd"]);
    expect(a.txdot).toBe(true);
    expect(a.notes.join(" ")).toMatch(/TxDOT access permit/);
    expect(a.cornerLot).toBe(false);
  });
  it("corner lot: two frontages at an angle, driveway on the local street", () => {
    const a = access(
      raw({ roads: [road("FM 1960", "S1400", 8, 180), road("Oak St", "S1400", 12, 270)] }),
      {},
    )!;
    expect(a.cornerLot).toBe(true);
    expect(a.txdot).toBe(true); // "FM 1960" is a state farm-to-market road even when classed local
    expect(a.notes.join(" ")).toMatch(/lower-classed street \(Oak St\)/);
  });
  it("estimates trips and the TIA call", () => {
    expect(
      tripEstimate({ sector: "commercial", subcategory: "retail", buildingAreaSqFt: 40000 }),
    ).toMatchObject({ pm: 136, daily: 1480 });
    const roads = [road("Main St", "S1400", 6, 180)];
    expect(
      access(raw({ roads }), {
        sector: "commercial",
        subcategory: "retail",
        buildingAreaSqFt: 40000,
      })!.tia,
    ).toBe("likely");
    expect(
      access(raw({ roads }), {
        sector: "commercial",
        subcategory: "office",
        buildingAreaSqFt: 40000,
      })!.tia,
    ).toBe("possible");
    expect(
      access(raw({ roads }), {
        sector: "commercial",
        subcategory: "office",
        buildingAreaSqFt: 8000,
      })!.tia,
    ).toBe("unlikely");
    expect(access(raw({ roads }), { sector: "commercial" })!.tia).toBe("needs_info");
    expect(
      tripEstimate({ sector: "residential", buildingAreaSqFt: 3000, floors: 2 }),
    ).toMatchObject({ pm: 1, basis: "one single-family home" });
    expect(tripEstimate({ sector: "residential", buildingAreaSqFt: 120000, floors: 4 })!.pm).toBe(
      47,
    );
  });
  it("summary text covers all three analyses", () => {
    const t = analysisSummaryLines(
      raw({
        flood: { atPoint: [Z("AE")], nearby: [Z("AE")], panel: null },
        elevation: {
          sideFt: 200,
          assumedLot: true,
          points: [-1, 0, 1].flatMap((j) =>
            [-1, 0, 1].map((i) => ({ dx: i * 100, dy: j * 100, ft: 700 - i * 2 })),
          ),
        },
        roads: [road("Main St", "S1400", 6, 180)],
      }),
      { sector: "commercial", subcategory: "retail", buildingAreaSqFt: 5000 },
    ).join("\n");
    expect(t).toMatch(/SITE GRADING[\s\S]*2% slope, falling to the east/);
    expect(t).toMatch(/FLOODPLAIN[\s\S]*Zone AE/);
    expect(t).toMatch(/INGRESS & EGRESS[\s\S]*Main St[\s\S]*Traffic Impact Analysis: unlikely/);
  });
});
