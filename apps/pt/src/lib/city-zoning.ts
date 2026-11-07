// Official city zoning at a property's point. Zoning in Texas is set by each
// city (counties don't zone), and most cities publish their zoning map as a
// public ArcGIS layer. Each layer below was checked live: it answers a point
// query for a known spot inside that city, and it allows browser requests
// (CORS), so the app reads it directly — no edge function (the project is at
// Supabase's 100-function cap).
//
// A property is checked only against the cities whose map bounds contain its
// point, so there's no need to know the city name first. Outside every listed
// city (unincorporated county land, or a city not listed yet) the result is
// empty — never a guess. Cities are added county by county.

export type CityZoningLayer = {
  city: string;
  county: string;
  // ArcGIS FeatureServer/MapServer layer
  url: string;
  // [xmin, ymin, xmax, ymax], WGS84 — from the layer's own extent
  bbox: [number, number, number, number];
  // first non-empty field wins
  code: string[];
  description?: string[];
  planned?: string[];
  ordinance?: string[];
  link?: string[];
  // the city's public zoning map or zoning page, for the owner to check
  mapUrl?: string;
};

export const CITY_ZONING_LAYERS: CityZoningLayer[] = [
  // ── Collin County ──
  {
    city: "Plano",
    county: "collin",
    url: "https://maps.planogis.org/arcgiswad/rest/services/OpenData/Zoning/FeatureServer/0",
    bbox: [-96.86, 32.997, -96.613, 33.125],
    code: ["ZN"],
    description: ["IMS_ZONE"],
    planned: ["PD"],
    ordinance: ["ORDINANCENUM"],
  },
  {
    city: "McKinney",
    county: "collin",
    url: "https://maps.mckinneytexas.org/mckinney/rest/services/OpenData/Planning_and_Zoning/MapServer/4",
    bbox: [-96.769, 33.122, -96.537, 33.303],
    code: ["ZoningType"],
    ordinance: ["ORD1"],
  },
  {
    city: "Frisco",
    county: "collin",
    url: "https://services6.arcgis.com/OGXLcOSnuy0GwFwi/arcgis/rest/services/FriscoZoning_ODH/FeatureServer/1",
    bbox: [-96.923, 33.081, -96.733, 33.219],
    code: ["ZONING"],
    planned: ["PD"],
    ordinance: ["ORD1"],
  },
  {
    city: "Allen",
    county: "collin",
    url: "https://gismaps.cityofallen.org/arcgis/rest/services/Current_Zoning/MapServer/0",
    bbox: [-96.737, 33.068, -96.608, 33.157],
    code: ["Zoning"],
    description: ["DescLandUse"],
    ordinance: ["ORDINANCE"],
    link: ["OrdURL", "DocURL"],
  },
  {
    city: "Wylie",
    county: "collin",
    url: "https://services7.arcgis.com/6qzfxgiNv7oGnzvU/arcgis/rest/services/Zoning_Districts_EDC/FeatureServer/81",
    bbox: [-96.597, 32.967, -96.488, 33.055],
    code: ["ZONECLASS"],
    description: ["ZONEDESC"],
    ordinance: ["OrdinanceNumber"],
  },
  {
    city: "Celina",
    county: "collin",
    url: "https://services1.arcgis.com/x4nhme9V33KOzAfr/arcgis/rest/services/Zoning_Districts_Open_Data/FeatureServer/12",
    bbox: [-96.894, 33.25, -96.712, 33.406],
    code: ["zoning"],
    ordinance: ["Zoning_Ord"],
    link: ["Link", "PDPage"],
  },
  {
    city: "Murphy",
    county: "collin",
    url: "https://services5.arcgis.com/lt8CbgYaNuFrQ7kB/arcgis/rest/services/Murphy_Zoning/FeatureServer/4",
    bbox: [-96.635, 32.986, -96.595, 33.041],
    code: ["Zone"],
    description: ["MurphyZone", "Description"],
    planned: ["PD"],
    ordinance: ["Ordinance"],
  },
  {
    city: "Richardson",
    county: "collin",
    url: "https://maps.cor.gov/arcgis/rest/services/DevelopmentServices/Zoning/MapServer/1",
    bbox: [-96.77, 32.921, -96.613, 33.007],
    code: ["ZONECLASS"],
    description: ["ZONEDESC"],
    ordinance: ["ORD"],
    link: ["CZOLOC"],
  },
  {
    city: "Sachse",
    county: "collin",
    url: "https://services6.arcgis.com/OSORr24S2Mlvyg30/arcgis/rest/services/Zoning/FeatureServer/0",
    bbox: [-96.614, 32.942, -96.538, 33.005],
    code: ["ZONING"],
    description: ["TYPE"],
    ordinance: ["ORD_NO1"],
    link: ["FILE1"],
  },
  {
    city: "Princeton",
    county: "collin",
    url: "https://services6.arcgis.com/KL1aiRJt0tw3BM7h/arcgis/rest/services/princeton_zoning_districts/FeatureServer/79",
    bbox: [-96.545, 33.101, -96.426, 33.243],
    code: ["Zone"],
    description: ["PD_Name"],
    planned: ["PD_Label"],
    ordinance: ["ORD"],
    link: ["Muni_Code_Link"],
  },
  {
    city: "Anna",
    county: "collin",
    url: "https://services5.arcgis.com/DvFgDXTY4DS4ZXFx/arcgis/rest/services/Zoning_Base_Layer/FeatureServer/0",
    bbox: [-96.64, 33.299, -96.44, 33.389],
    code: ["Zoning_Abbreviation", "INFO001"],
    ordinance: ["SUP_ORD"],
    link: ["OrdinanceLink"],
  },
  // ── Dallas County (Richardson and Sachse are listed above) ──
  {
    city: "Dallas",
    county: "dallas",
    url: "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/Dallas_Zoning/FeatureServer/15",
    bbox: [-97.001, 32.606, -96.464, 33.031],
    code: ["ZONE_DIST", "LONG_ZONE_DIST"],
    description: ["COMMON_NAME"],
    planned: ["PD_NUM"],
    ordinance: ["ORD_NUM"],
  },
  {
    city: "Irving",
    county: "dallas",
    url: "https://services3.arcgis.com/OfsJXUlu8pSkbl7B/arcgis/rest/services/Planning_and_Zoning/FeatureServer/5",
    bbox: [-97.035, 32.771, -96.888, 32.955],
    code: ["BaseDistrict", "District"],
    description: ["Use_"],
    ordinance: ["Ordinance"],
  },
  {
    city: "Garland",
    county: "dallas",
    url: "https://maps2.garlandtx.gov/server1/rest/services/PLANNING/ZONING/MapServer/0",
    bbox: [-96.708, 32.829, -96.53, 32.987],
    code: ["GDC_ZONING", "BASEZONING"],
    ordinance: ["ORD_NO"],
  },
  {
    city: "Carrollton",
    county: "dallas",
    url: "https://maps.cityofcarrollton.com/arcserver/rest/services/Webmaps/Zoning/MapServer/132",
    bbox: [-96.959, 32.917, -96.835, 33.056],
    code: ["Zoning"],
    planned: ["PD_Num"],
    ordinance: ["Ordinance", "Ord1"],
    link: ["Website"],
  },
  {
    city: "Rowlett",
    county: "dallas",
    url: "https://emap.rowlett.com/arcgis/rest/services/OnlineServices/ZoningInfo/MapServer/0",
    bbox: [-96.595, 32.867, -96.5, 32.977],
    code: ["ZoningType"],
    description: ["Zoing_Description"],
  },
  {
    city: "DeSoto",
    county: "dallas",
    url: "https://services8.arcgis.com/QHqdbIhWBJLlMbGN/arcgis/rest/services/Zoning_DeSoto/FeatureServer/0",
    bbox: [-96.909, 32.565, -96.821, 32.648],
    code: ["ZONECLASS", "Zone_Code"],
    description: ["COLOR_CODE"],
  },
  {
    city: "Cedar Hill",
    county: "dallas",
    url: "https://services2.arcgis.com/c4jK8v4C9UDiTgJU/arcgis/rest/services/CHZoning/FeatureServer/0",
    bbox: [-97.021, 32.535, -96.89, 32.64],
    // ZONECLASS is a numeric color class here; ZONEDESC holds the district code
    code: ["ZONEDESC"],
    planned: ["PD_NUM"],
    ordinance: ["ORD_NUM"],
    link: ["ZONELINK"],
  },
  {
    city: "Farmers Branch",
    county: "dallas",
    url: "https://services1.arcgis.com/rrMt0tlqg3eYOL0M/arcgis/rest/services/Zoning_public/FeatureServer/0",
    bbox: [-96.939, 32.895, -96.821, 32.953],
    code: ["ZONECLASS"],
    description: ["ZONEDESC"],
    planned: ["CITYPDDIST"],
  },
  // ── Tarrant County ──
  {
    city: "Fort Worth",
    county: "tarrant",
    url: "https://mapit.fortworthtexas.gov/ags/rest/services/CIVIC/OpenData_Boundaries/MapServer/54",
    bbox: [-97.611, 32.548, -97.03, 33.052],
    code: ["ZONING", "BASE_ZONING"],
    description: ["PD_DESCRIPTION"],
    planned: ["PD"],
    ordinance: ["ORDINANCE_NO"],
    link: ["PD_DOCUMENT"],
  },
  {
    city: "Arlington",
    county: "tarrant",
    url: "https://gis2.arlingtontx.gov/agsext2/rest/services/OpenData/OD_Property/MapServer/3",
    bbox: [-97.235, 32.586, -97.036, 32.819],
    code: ["ZONINGDETAIL", "DISTRICT"],
    description: ["ZONINGDESCRIPTION"],
    ordinance: ["ORDINANCE"],
  },
  {
    city: "Grapevine",
    county: "tarrant",
    url: "https://services.arcgis.com/xSPs49inzz3yMpnd/arcgis/rest/services/Zoning/FeatureServer/0",
    bbox: [-97.13, 32.88, -97.016, 32.995],
    code: ["ZONECODE"],
    description: ["ZONEDESCRIPTION"],
  },
  {
    city: "Keller",
    county: "tarrant",
    url: "https://services2.arcgis.com/7YcJOHUBjYCdeo36/arcgis/rest/services/KEL_Zoning/FeatureServer/6",
    bbox: [-97.267, 32.892, -97.176, 32.979],
    code: ["ZONINGCLASS", "SYMBOL"],
    description: ["ZONINGCONDITION"],
    ordinance: ["Ordinance"],
  },
  {
    city: "Hurst",
    county: "tarrant",
    url: "https://services2.arcgis.com/DYDcFoEIJXAqmt4r/arcgis/rest/services/ZoningOpenData/FeatureServer/0",
    bbox: [-97.212, 32.805, -97.137, 32.889],
    code: ["ZONING"],
  },
  {
    city: "Colleyville",
    county: "tarrant",
    url: "https://services3.arcgis.com/sBPeNRqI2rE8sfwz/arcgis/rest/services/_Zoning_AGO/FeatureServer/0",
    bbox: [-97.187, 32.859, -97.099, 32.924],
    code: ["ZoneCode"],
  },
  {
    city: "North Richland Hills",
    county: "tarrant",
    url: "https://services2.arcgis.com/Dawyq6my74TJ9cCH/arcgis/rest/services/Zoning/FeatureServer/0",
    bbox: [-97.265, 32.808, -97.185, 32.913],
    code: ["TYPE"],
    description: ["DESCR"],
  },
  // ── Denton County (Frisco and Carrollton are listed above) ──
  {
    city: "Lewisville",
    county: "denton",
    url: "https://services2.arcgis.com/kXGqZY4GIOcEYxoF/arcgis/rest/services/Zoning_Feature_view/FeatureServer/0",
    bbox: [-97.046, 32.986, -96.866, 33.1],
    code: ["ZONING_CLASS"],
    description: ["Zoning_Desc"],
    ordinance: ["Ordinance_Number"],
    link: ["Ordinance_Link", "LINK"],
  },
  {
    city: "Flower Mound",
    county: "denton",
    url: "https://gismaps.flower-mound.com/wafmp/rest/services/Trakit/Trakit/MapServer/52",
    bbox: [-97.236, 32.981, -97.026, 33.092],
    code: ["ZONE_DESCRIPTION", "ZONE_CODE"],
    ordinance: ["ORD_NO"],
  },
  {
    city: "Trophy Club",
    county: "denton",
    url: "https://services.arcgis.com/oTsZYNubyv7xK5yP/arcgis/rest/services/TrophyClub_Zoning_Public/FeatureServer/0",
    bbox: [-97.217, 32.985, -97.167, 33.025],
    code: ["DistCode"],
    description: ["District", "Name"],
    ordinance: ["Ordinance"],
  },
  {
    city: "Roanoke",
    county: "denton",
    url: "https://services7.arcgis.com/ZVnoRrwr69yZLQgK/arcgis/rest/services/Zoning_Data_Public_View/FeatureServer/2",
    bbox: [-97.259, 32.987, -97.195, 33.045],
    code: ["ZONE"],
    description: ["ZoneClass", "Description"],
    planned: ["PD_Amend_Num", "PD_Orig_Num"],
    link: ["URL_Link"],
  },
  {
    city: "Sanger",
    county: "denton",
    url: "https://services8.arcgis.com/ovJOFQdikJNb2dMW/arcgis/rest/services/Zoning/FeatureServer/0",
    bbox: [-97.199, 33.326, -97.116, 33.425],
    code: ["Zoning"],
    ordinance: ["Ordinance"],
  },
];

export type CityZoning = {
  city: string;
  code: string;
  description: string | null;
  plannedDevelopment: string | null;
  ordinance: string | null;
  link: string | null;
  sourceUrl: string;
};

// Placeholder values cities use for "none" (Frisco writes PD000 / SUP000).
const EMPTY = /^(\s*|null|none|n\/a|pd0+|sup0+|0)$/i;
function pick(attrs: Record<string, unknown>, fields: string[] | undefined): string | null {
  for (const f of fields ?? []) {
    const v = attrs[f];
    if (v == null) continue;
    // Carrollton wraps codes in parentheses: "(SF-12/20)"
    const s = String(v)
      .trim()
      .replace(/^\((.*)\)$/, "$1")
      .trim();
    if (!EMPTY.test(s)) return s;
  }
  return null;
}
const isUrl = (s: string | null) => (s && /^https?:\/\//i.test(s) ? s : null);

export function zoningFromAttributes(
  layer: CityZoningLayer,
  attrs: Record<string, unknown>,
): CityZoning | null {
  const code = pick(attrs, layer.code);
  if (!code) return null;
  const description = pick(attrs, layer.description);
  return {
    city: layer.city,
    code,
    description: description && description !== code ? description : null,
    plannedDevelopment: pick(attrs, layer.planned),
    ordinance: pick(attrs, layer.ordinance),
    link: isUrl(pick(attrs, layer.link)),
    sourceUrl: layer.mapUrl ?? layer.url,
  };
}

export function layersAt(lat: number, lng: number): CityZoningLayer[] {
  return CITY_ZONING_LAYERS.filter(
    ({ bbox: [x0, y0, x1, y1] }) => lng >= x0 && lng <= x1 && lat >= y0 && lat <= y1,
  );
}

async function queryLayer(
  layer: CityZoningLayer,
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<CityZoning[]> {
  const q = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "false",
    f: "json",
  });
  const res = await fetch(`${layer.url}/query?${q}`, { signal });
  if (!res.ok) throw new Error(`${layer.city} zoning map unavailable (${res.status})`);
  const j = (await res.json()) as {
    features?: { attributes?: Record<string, unknown> }[];
    error?: { message?: string };
  };
  if (j.error) throw new Error(`${layer.city} zoning map: ${j.error.message ?? "error"}`);
  const out: CityZoning[] = [];
  for (const f of j.features ?? []) {
    const z = f.attributes ? zoningFromAttributes(layer, f.attributes) : null;
    if (z && !out.some((o) => o.code === z.code)) out.push(z);
  }
  return out;
}

export type CityZoningResult = {
  // every district the point falls in (usually one; a base district plus an
  // overlapping one is possible)
  matches: CityZoning[];
  // true when at least one listed city's bounds contained the point
  covered: boolean;
  // cities whose map couldn't be read right now
  failed: string[];
};

const cache = new Map<string, Promise<CityZoningResult>>();

// Cached per point so the zoning module's input and the zoning card share one
// lookup per page.
export function lookupCityZoning(lat: number, lng: number): Promise<CityZoningResult> {
  const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const layers = layersAt(lat, lng);
      const settled = await Promise.allSettled(
        layers.map((l) => queryLayer(l, lat, lng, AbortSignal.timeout(12_000))),
      );
      const matches: CityZoning[] = [];
      const failed: string[] = [];
      settled.forEach((s, i) => {
        if (s.status === "fulfilled") matches.push(...s.value);
        else failed.push(layers[i].city);
      });
      return { matches, covered: layers.length > 0, failed };
    })();
    cache.set(key, p);
    // a failed read can be retried on the next page load
    p.then((r) => r.failed.length && cache.delete(key)).catch(() => cache.delete(key));
  }
  return p;
}

// One line for the AI zoning module's input (zoningData.cadZoning).
export function zoningLabel(z: CityZoning): string {
  return [
    `${z.code}${z.description ? ` (${z.description})` : ""}`,
    z.plannedDevelopment
      ? /^pd/i.test(z.plannedDevelopment)
        ? z.plannedDevelopment
        : `PD ${z.plannedDevelopment}`
      : null,
    `City of ${z.city} zoning map`,
  ]
    .filter(Boolean)
    .join(" · ");
}
