import { invokeEdgeFunction } from "./edge-functions";

export type SiteGisResult = {
  floodZone: { zone: string; label: string; inSFHA: boolean } | null;
  elevationFt: number | null;
  // Real distance (miles) to the nearest major highway / rail line, via
  // OpenStreetMap's Overpass API — null whenever nothing real was found
  // within the search radius, or the (free, best-effort, sometimes slow)
  // lookup didn't come back in time. Never a fabricated/estimated distance.
  nearestHighwayMi: number | null;
  nearestRailMi: number | null;
};

// Real point-in-place site facts (FEMA flood zone + USGS elevation +
// OSM highway/rail proximity) for a property's exact lat/lng — see
// supabase/functions/site-gis/index.ts for the upstream sources and why
// this proxies through an edge function instead of calling them directly
// from the browser. Only ever called once a real lat/lng exists (see
// loadSiteGis() in ai-report.tsx) — there is no fallback geocoding here,
// matching getComps()'s same honest-gap posture.
//
// Speed: these are facts about a fixed point that don't change week to week,
// but the lookup takes ~15-20 s (USGS elevation alone answers in 12-15 s, and
// public Overpass servers are often at capacity) and the AI Report's Site
// module waits for it on every visit. So each answer is kept in this browser
// per location: a full answer for 90 days, a partial one (a source timed out)
// for a day, so a missing fact is retried soon rather than locked in.
const CACHE_PREFIX = "corvuspt.siteGis.v1.";
const FULL_MS = 90 * 24 * 60 * 60 * 1000;
const PARTIAL_MS = 24 * 60 * 60 * 1000;

export function isCompleteSiteGis(r: SiteGisResult): boolean {
  return (
    r.floodZone != null &&
    r.elevationFt != null &&
    (r.nearestHighwayMi != null || r.nearestRailMi != null)
  );
}

function cacheKey(lat: number, lng: number) {
  return `${CACHE_PREFIX}${lat.toFixed(5)},${lng.toFixed(5)}`;
}

export function readCachedSiteGis(
  lat: number,
  lng: number,
  now = Date.now(),
): SiteGisResult | null {
  try {
    const raw = localStorage.getItem(cacheKey(lat, lng));
    if (!raw) return null;
    const { at, data } = JSON.parse(raw) as { at: number; data: SiteGisResult };
    const ttl = isCompleteSiteGis(data) ? FULL_MS : PARTIAL_MS;
    return now - at < ttl ? data : null;
  } catch {
    return null;
  }
}

function writeCachedSiteGis(lat: number, lng: number, data: SiteGisResult) {
  try {
    localStorage.setItem(cacheKey(lat, lng), JSON.stringify({ at: Date.now(), data }));
  } catch {
    // storage blocked or full — next visit simply looks it up again
  }
}

export async function getSiteGis(input: { lat: number; lng: number }): Promise<SiteGisResult> {
  const cached = readCachedSiteGis(input.lat, input.lng);
  if (cached) return cached;
  const data = await invokeEdgeFunction<SiteGisResult>("site-gis", input);
  writeCachedSiteGis(input.lat, input.lng, data);
  return data;
}
