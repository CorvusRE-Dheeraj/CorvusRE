// Deploy via CLI: `supabase functions deploy zoning-lookup --no-verify-jwt`
// (anonymous visitors run the permitting wizard before they have an account).
//
// Looks up the zoning for a Texas street address from the city's own public
// zoning map. No paid data provider and no API keys:
//  1. The US Census geocoder turns the address into a point AND tells us the
//     incorporated city it really sits in (postal city names often differ
//     from city limits).
//  2. Houston has no zoning; land outside any city has no zoning either
//     (Texas counties can't zone) — both are real answers, not blanks.
//  3. Otherwise, if we know that city's zoning map service, ask it which
//     zoning district covers the point.
//
// Geocoded points sit on or near the street line, which can fall in the
// right-of-way (streets carry no zoning), so the map query widens a few
// metres at a time until it finds the parcel's district.

import { corsHeaders, jsonError, preflight } from "../_shared/cors.ts";

type CitySource = {
  /** Census place base name, e.g. "Frisco" */
  name: string;
  /** ArcGIS layer URL (…/MapServer/N or …/FeatureServer/N) */
  layer: string;
  /** Attribute(s) holding the district code, first non-empty wins */
  code: string[];
  /** Attribute holding a plain-English district name, if the city publishes one */
  description?: string;
  /** Attribute(s) naming a planned development / special use on the parcel */
  extras?: { field: string; label: string }[];
  /** Public map people can check it on */
  mapUrl: string;
};

// Fort Worth publishes zoning (mapit.fortworthtexas.gov), but its server refuses
// connections from cloud hosts, so it can't be read from here.
const CITIES: CitySource[] = [
  {
    name: "Dallas",
    layer:
      "https://gis.dallascityhall.com/arcgis/rest/services/sdc_public/Zoning/MapServer/15",
    code: ["LONG_ZONE_DIST", "ZONE_DIST"],
    extras: [{ field: "PD_NUM", label: "PD" }],
    mapUrl:
      "https://dallascitydev.maps.arcgis.com/apps/webappviewer/index.html",
  },
  {
    name: "Austin",
    layer:
      "https://services.arcgis.com/0L95CJ0VTaxqcmED/ArcGIS/rest/services/PLANNINGCADASTRE_zoning_small_map_scale/FeatureServer/0",
    code: ["ZONING_ZTYPE", "ZONING_BASE"],
    mapUrl: "https://maps.austintexas.gov/GIS/PropertyProfile/",
  },
  {
    name: "Plano",
    layer:
      "https://maps.planogis.org/arcgiswad/rest/services/OpenData/Zoning/MapServer/0",
    code: ["ZN"],
    description: "IMS_ZONE",
    extras: [
      { field: "PD", label: "PD" },
      { field: "S", label: "Specific Use Permit" },
    ],
    mapUrl: "https://maps.planogis.org/",
  },
  {
    name: "Frisco",
    layer:
      "https://maps.friscotexas.gov/gis/rest/services/Public/External_Planning_and_Zoning/MapServer/32",
    code: ["ZONE_"],
    extras: [
      { field: "PD", label: "PD" },
      { field: "SUP", label: "Specific Use Permit" },
    ],
    mapUrl: "https://www.friscotexas.gov/1010/Interactive-Maps",
  },
  {
    name: "McKinney",
    layer:
      "https://maps.mckinneytexas.org/mckinney/rest/services/MapServices/Zoning/MapServer/0",
    code: ["ZoningType"],
    extras: [{ field: "SUP", label: "Specific Use Permit" }],
    mapUrl: "https://maps.mckinneytexas.org/",
  },
  {
    name: "Celina",
    layer:
      "https://services1.arcgis.com/x4nhme9V33KOzAfr/arcgis/rest/services/Zoning_Districts_Open_Data/FeatureServer/12",
    code: ["zoning"],
    mapUrl: "https://www.celina-tx.gov/1291/Planned-Developments",
  },
];

/** Cities with no zoning ordinance at all. */
const NO_ZONING_CITIES = ["Houston"];

const SEARCH_RADII_M = [0, 10, 20, 35];
const TIMEOUT_MS = 12000;

type Result =
  | {
      status: "found";
      code: string;
      description: string | null;
      extras: string[];
      nearby: string[];
      city: string;
      source: string;
      mapUrl: string;
    }
  | { status: "no_zoning"; city: string | null; reason: string }
  | { status: "not_covered"; city: string; reason: string }
  | { status: "not_found"; city: string | null; reason: string };

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return res.json();
}

type Geo = { x: number; y: number; place: string | null };

async function geocode(address: string): Promise<Geo | null> {
  const qs = new URLSearchParams({
    address,
    benchmark: "Public_AR_Current",
    vintage: "Current_Current",
    layers: "Incorporated Places",
    format: "json",
  });
  const data = (await getJson(
    `https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?${qs}`,
  )) as {
    result?: {
      addressMatches?: {
        coordinates: { x: number; y: number };
        geographies?: Record<string, { BASENAME?: string }[]>;
      }[];
    };
  };
  const m = data.result?.addressMatches?.[0];
  if (!m) return null;
  const place = m.geographies?.["Incorporated Places"]?.[0]?.BASENAME ?? null;
  return { x: m.coordinates.x, y: m.coordinates.y, place };
}

const clean = (v: unknown) =>
  typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();

async function queryCity(src: CitySource, g: Geo): Promise<Result | null> {
  for (const radius of SEARCH_RADII_M) {
    const qs = new URLSearchParams({
      geometry: `${g.x},${g.y}`,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: "*",
      returnGeometry: "false",
      f: "json",
    });
    if (radius > 0) {
      qs.set("distance", String(radius));
      qs.set("units", "esriSRUnit_Meter");
    }
    const data = (await getJson(`${src.layer}/query?${qs}`)) as {
      features?: { attributes: Record<string, unknown> }[];
      error?: { message?: string };
    };
    if (data.error) throw new Error(data.error.message ?? "map query failed");
    const rows = (data.features ?? []).map((f) => f.attributes);
    const codeOf = (a: Record<string, unknown>) =>
      src.code.map((k) => clean(a[k])).find((v) => v) ?? "";
    const coded = rows.filter((a) => codeOf(a));
    if (coded.length === 0) continue;
    // The district covering most of the search area wins; the rest are "nearby".
    const counts = new Map<string, number>();
    for (const a of coded)
      counts.set(codeOf(a), (counts.get(codeOf(a)) ?? 0) + 1);
    const [code] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const row = coded.find((a) => codeOf(a) === code)!;
    const extras = (src.extras ?? [])
      .map(({ field, label }) => {
        const v = clean(row[field]);
        if (!v || /^(no|none|n\/a|0|sup000)$/i.test(v)) return "";
        return v.toUpperCase().startsWith(label.toUpperCase())
          ? v
          : `${label} ${v}`;
      })
      .filter(Boolean);
    return {
      status: "found",
      code,
      description: src.description ? clean(row[src.description]) || null : null,
      extras,
      nearby: [...counts.keys()].filter((c) => c !== code),
      city: src.name,
      source: `City of ${src.name} zoning map`,
      mapUrl: src.mapUrl,
    };
  }
  return null;
}

async function lookup(address: string): Promise<Result> {
  const g = await geocode(address);
  if (!g) {
    return {
      status: "not_found",
      city: null,
      reason:
        "We couldn't place this address on the map to look up its zoning.",
    };
  }
  if (!g.place) {
    return {
      status: "no_zoning",
      city: null,
      reason:
        "This address is outside any city's limits. Texas counties don't zone land, so there is no zoning district — but a nearby city's extraterritorial jurisdiction (ETJ) may still apply its subdivision rules.",
    };
  }
  if (NO_ZONING_CITIES.includes(g.place)) {
    return {
      status: "no_zoning",
      city: g.place,
      reason: `${g.place} has no zoning ordinance. Land use is governed by deed restrictions and the city's development rules instead.`,
    };
  }
  const src = CITIES.find(
    (c) => c.name.toLowerCase() === g.place!.toLowerCase(),
  );
  if (!src) {
    return {
      status: "not_covered",
      city: g.place,
      reason: `We don't read the City of ${g.place}'s zoning map yet — confirm the zoning with its planning department.`,
    };
  }
  try {
    const hit = await queryCity(src, g);
    if (hit) return hit;
    return {
      status: "not_found",
      city: src.name,
      reason: `The City of ${src.name}'s zoning map has no district at this address.`,
    };
  } catch (err) {
    console.error(`zoning-lookup ${src.name}:`, err);
    return {
      status: "not_found",
      city: src.name,
      reason: `The City of ${src.name}'s zoning map didn't respond — try again, or confirm with its planning department.`,
    };
  }
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return jsonError("POST only", 405);
  let address = "";
  try {
    const body = (await req.json()) as { address?: unknown };
    address =
      typeof body.address === "string" ? body.address.trim().slice(0, 300) : "";
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  if (address.length < 6) return jsonError("address is required", 400);
  try {
    return new Response(JSON.stringify(await lookup(address)), {
      headers: corsHeaders,
    });
  } catch (err) {
    console.error("zoning-lookup failed:", err);
    return new Response(
      JSON.stringify({
        status: "not_found",
        city: null,
        reason: "The zoning lookup service is unavailable right now.",
      }),
      { headers: corsHeaders },
    );
  }
});
