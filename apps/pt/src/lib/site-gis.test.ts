// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("./edge-functions", () => ({ invokeEdgeFunction: (...a: unknown[]) => invoke(...a) }));

import { getSiteGis, isCompleteSiteGis, readCachedSiteGis, type SiteGisResult } from "./site-gis";

const full: SiteGisResult = {
  floodZone: { zone: "X", label: "Minimal", inSFHA: false },
  elevationFt: 430,
  nearestHighwayMi: 0.4,
  nearestRailMi: null,
};
const partial: SiteGisResult = { ...full, nearestHighwayMi: null, nearestRailMi: null };

beforeEach(() => {
  localStorage.clear();
  invoke.mockReset();
});

describe("getSiteGis cache", () => {
  it("asks once, then answers the same location from the browser", async () => {
    invoke.mockResolvedValue(full);
    expect(await getSiteGis({ lat: 32.78744, lng: -96.79753 })).toEqual(full);
    expect(await getSiteGis({ lat: 32.78744, lng: -96.79753 })).toEqual(full);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("keeps a full answer 90 days but a partial one only a day", () => {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    localStorage.setItem(
      "corvuspt.siteGis.v1.1.00000,2.00000",
      JSON.stringify({ at: now - 30 * day, data: full }),
    );
    localStorage.setItem(
      "corvuspt.siteGis.v1.3.00000,4.00000",
      JSON.stringify({ at: now - 2 * day, data: partial }),
    );
    expect(readCachedSiteGis(1, 2, now)).toEqual(full);
    expect(readCachedSiteGis(3, 4, now)).toBeNull();
  });

  it("treats a missing flood zone, elevation or both distances as partial", () => {
    expect(isCompleteSiteGis(full)).toBe(true);
    expect(isCompleteSiteGis(partial)).toBe(false);
    expect(isCompleteSiteGis({ ...full, elevationFt: null })).toBe(false);
  });

  it("a different location is looked up separately", async () => {
    invoke.mockResolvedValue(full);
    await getSiteGis({ lat: 1, lng: 2 });
    await getSiteGis({ lat: 1.001, lng: 2 });
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
