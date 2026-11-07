import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CITY_ZONING_LAYERS,
  layersAt,
  lookupCityZoning,
  zoningFromAttributes,
  zoningLabel,
} from "./city-zoning";
import { clerkRecordsFor, ownerSearchName } from "./deed-records";

const layer = (city: string) => CITY_ZONING_LAYERS.find((l) => l.city === city)!;

describe("city zoning", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("every layer is a well-formed ArcGIS layer with a sane Texas bbox", () => {
    for (const l of CITY_ZONING_LAYERS) {
      expect(l.url).toMatch(/^https:\/\/.+\/(FeatureServer|MapServer)\/\d+$/);
      const [x0, y0, x1, y1] = l.bbox;
      expect(x0).toBeLessThan(x1);
      expect(y0).toBeLessThan(y1);
      expect(x0).toBeGreaterThan(-107);
      expect(x1).toBeLessThan(-93);
      expect(y0).toBeGreaterThan(25);
      expect(y1).toBeLessThan(37);
      expect(l.code.length).toBeGreaterThan(0);
    }
  });

  it("picks only the cities whose bounds contain the point", () => {
    // downtown McKinney
    const cities = layersAt(33.1976, -96.6153).map((l) => l.city);
    expect(cities).toContain("McKinney");
    expect(cities).not.toContain("Wylie");
    // far west Texas — nothing listed
    expect(layersAt(31.76, -106.48)).toEqual([]);
  });

  it("reads codes, skips placeholder values, keeps only real links", () => {
    const z = zoningFromAttributes(layer("Frisco"), {
      ZONING: "SF-7",
      PD: "PD000",
      SUP: "SUP000",
      ORD1: " ",
    });
    expect(z).toEqual({
      city: "Frisco",
      code: "SF-7",
      description: null,
      plannedDevelopment: null,
      ordinance: null,
      link: null,
      sourceUrl: layer("Frisco").url,
    });
    const a = zoningFromAttributes(layer("Allen"), {
      Zoning: "DD",
      DescLandUse: "DOWNTOWN DISTRICT",
      ORDINANCE: "4068-2-24",
      OrdURL: "https://publicrecords.cityofallen.org/x",
    });
    expect(a?.description).toBe("DOWNTOWN DISTRICT");
    expect(a?.link).toBe("https://publicrecords.cityofallen.org/x");
    expect(zoningLabel(a!)).toBe("DD (DOWNTOWN DISTRICT) · City of Allen zoning map");
    expect(zoningFromAttributes(layer("Allen"), { Zoning: " " })).toBeNull();
    // "PD" is a real district (Planned Development), not a placeholder
    expect(zoningFromAttributes(layer("Richardson"), { ZONECLASS: "PD" })?.code).toBe("PD");
  });

  it("queries the matching city by point and reports failures", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("mckinneytexas"))
        return new Response(JSON.stringify({ features: [{ attributes: { ZoningType: "MTC" } }] }));
      return new Response("down", { status: 503 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await lookupCityZoning(33.1976, -96.6153);
    expect(r.covered).toBe(true);
    expect(r.matches.map((m) => `${m.city}:${m.code}`)).toEqual(["McKinney:MTC"]);
    const url = String(
      (fetchMock.mock.calls as unknown[][]).find((c) => String(c[0]).includes("mckinney"))![0],
    );
    expect(url).toContain("geometry=-96.6153%2C33.1976");
    expect(url).toContain("inSR=4326");
    const outside = await lookupCityZoning(31.76, -106.48);
    expect(outside).toEqual({ matches: [], covered: false, failed: [] });
  });
});

describe("deed records", () => {
  it("links to the county clerk search with a clean owner name", () => {
    const c = clerkRecordsFor("Collin Central Appraisal District")!;
    expect(c.clerk).toBe("Collin County Clerk");
    expect(c.searchUrl("SMITH JOHN")).toBe(
      "https://collin.tx.publicsearch.us/results?department=RP&searchType=quickSearch&searchValue=SMITH%20JOHN",
    );
    expect(clerkRecordsFor("Loving County Appraisal District")).toBeNull();
  });

  it("strips co-owners and et ux wording", () => {
    expect(ownerSearchName("SMITH JOHN & JANE")).toBe("SMITH JOHN");
    expect(ownerSearchName("DOE RICHARD ET UX")).toBe("DOE RICHARD");
    expect(ownerSearchName("ACME HOLDINGS LLC")).toBe("ACME HOLDINGS LLC");
    expect(ownerSearchName(" ")).toBeNull();
  });
});
