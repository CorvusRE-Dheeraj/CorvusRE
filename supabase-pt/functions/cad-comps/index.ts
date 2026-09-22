// Deploy via CLI: `supabase functions deploy cad-comps`.
// No secrets required — same public TrueProdigy API used by cad-lookup's enrichment.
//
// Returns REAL nearby comparable properties for the "Comparable Sales & Market
// Analysis" AI module's map — never fabricated. Only works for the 4 counties on
// the TrueProdigy platform (Denton, Montgomery, Tarrant, Travis; see
// texas_cad_vendor_landscape memory) — Fort Bend/Grayson (BIS Consultants) and the
// other 5 counties have no confirmed equivalent "same subdivision" query today, so
// those return an empty comps list rather than guessing.
//
// Comps are properties sharing the subject's own "asCode" (the county's
// abstract/subdivision code) — a real grouping CADs themselves use, confirmed live
// 2026-07-28 (Denton: asCode "SF0503A" alone returned 936 rows spanning every year
// for every property in that one subdivision). Deduped to one row per property
// (its most recent year), the subject excluded, then capped to a 5-mile radius
// of the subject (a same-asCode subdivision is usually compact, but not always —
// some span an oddly large or split area, and a same-subdivision property 15
// miles away isn't a real "nearby comp" no matter how it's grouped) before
// sorting by how close each comp's market value is to the subject's — the
// dimension that actually matters for a property-tax comps argument once
// they're all genuinely nearby, not raw distance beyond that cutoff.
const COMPS_RADIUS_MILES = 5;
const EARTH_RADIUS_MILES = 3958.8;

// Haversine, not a flat lat/lon delta — Texas subdivisions span enough
// longitude at these latitudes (~29-33°N) that a naive Euclidean distance on
// raw degrees measurably over/under-counts miles depending on which county
// this runs for.
function milesBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const TRUEPRODIGY_OFFICE_BY_CAD: Record<string, string> = {
  "Denton Central Appraisal District": "Denton",
  "Montgomery Central Appraisal District": "Montgomery",
  "Tarrant Appraisal District": "Tarrant",
  "Travis Central Appraisal District": "Travis",
  // Properties saved under this shorter name never matched
  // the long one above, so every Travis property silently got zero comps.
  "Travis CAD": "Travis",
};

// address/totalValue are only used to find the subject when the saved account
// number isn't the county's own id; totalValue picks between several parcels
// that share one street address (condo units, split lots).
type CompsInput = { cad?: string; accountNumber?: string; address?: string; totalValue?: number };

type CompProperty = {
  pid: number;
  address: string;
  latitude: number;
  longitude: number;
  marketValue: number | null;
  ownerName: string | null;
  // Real fields on the same row already being fetched — never a second
  // request. See comps-analysis.ts for how these feed the comparable table
  // (land size / $-per-acre, last transfer date, similarity score) instead
  // of the sale price / building SF / adjustments Texas's non-disclosure law
  // makes unavailable from any free source (see cad-comps deploy comment).
  legalAcreage: number | null;
  landValue: number | null;
  improvementValue: number | null;
  appraisedValue: number | null;
  // The parcel's own most recent deed date — a real transfer date, but
  // never a sale price (Texas doesn't require one to be recorded). Labeled
  // "Last Transfer" in the UI, never "Sale Date", to not imply a price.
  lastTransferDt: string | null;
  // Raw CAD property-type code (e.g. "R", "C") — kept for the same/
  // different-type similarity signal only; never shown untranslated in the
  // UI since a wrong guessed label would be worse than no label.
  propType: string | null;
  // Populated inconsistently by CADs (often null) — shown only when present.
  zoning: string | null;
};

type CompsResult = {
  subject: (CompProperty & { asCode: string }) | null;
  comps: CompProperty[];
};

async function getToken(office: string): Promise<string> {
  const res = await fetch(
    "https://prod-container.trueprodigyapi.com/trueprodigy/cadpublic/auth/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ office }),
    },
  );
  if (!res.ok) throw new Error(`TrueProdigy auth failed for ${office}: ${res.status}`);
  const json = (await res.json()) as { user?: { token?: string } };
  const token = json.user?.token;
  if (!token) throw new Error(`TrueProdigy auth returned no token for ${office}`);
  return token;
}

function parseNum(v: unknown): number | null {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function toCompProperty(row: Record<string, unknown>): CompProperty | null {
  const lat = parseNum(row.latitude);
  const lon = parseNum(row.longitude);
  const pid = parseNum(row.pid);
  if (lat == null || lon == null || pid == null) return null;
  return {
    pid,
    address: (row.fullSitus as string) || (row.streetPrimary as string) || "",
    latitude: lat,
    longitude: lon,
    marketValue: parseNum(row.marketValue),
    ownerName: (row.name as string) || null,
    legalAcreage: parseNum(row.legalAcreage),
    landValue: parseNum(row.landValue),
    improvementValue: parseNum(row.improvementValue),
    appraisedValue: parseNum(row.appraisedValue),
    lastTransferDt: str(row.deedDt),
    propType: str(row.propType),
    zoning: str(row.zoning),
  };
}

// One property appears once per tax year it has a record for — keep only each
// pid's best row so a subdivision with 900+ historical rows collapses to one pin
// per real property. "Best" is the latest year that actually HAS a market value —
// the true latest pYear present is often next year's not-yet-assessed placeholder
// row (confirmed live: pid 740576's own "2027" row has every value field null),
// so picking by raw year alone would silently produce valueless comps.
function dedupeBestYear(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const byPid = new Map<number, Record<string, unknown>>();
  for (const row of rows) {
    const pid = parseNum(row.pid);
    if (pid == null) continue;
    const year = parseNum(row.pYear) ?? 0;
    const hasValue = parseNum(row.marketValue) != null;
    const score = (hasValue ? 1_000_000 : 0) + year;
    const existing = byPid.get(pid);
    if (!existing) {
      byPid.set(pid, row);
      continue;
    }
    const existingHasValue = parseNum(existing.marketValue) != null;
    const existingScore = (existingHasValue ? 1_000_000 : 0) + (parseNum(existing.pYear) ?? 0);
    if (score > existingScore) byPid.set(pid, row);
  }
  return [...byPid.values()];
}

// ── Spatial comps: counties whose public parcel layer can be queried by
// location. TrueProdigy's "same subdivision" grouping (above) only exists for
// four counties; for the rest, the county's own ArcGIS parcel layer already
// carries value/category/acreage AND geometry, so "nearby comparable
// properties" is a real spatial query: same property category, comparable
// value, within a radius of the subject that widens 1 → 2.5 → 5 miles only as
// far as it has to to find enough real parcels.
type SpatialConfig = {
  url: string;
  idField: string;
  idMode: "numeric" | "quoted";
  addressField: string;
  categoryField: string;
  // SQL for the parcel's assessed value, tolerant of the current tax year
  // still being mid-reappraisal (null) — same fallback cad-lookup uses.
  valueSql: string;
  outFields: string;
  map: (a: Record<string, unknown>) => {
    pid: unknown;
    address: unknown;
    owner: unknown;
    value: number | null;
    land: number | null;
    improvement: number | null;
    acres: number | null;
    category: string | null;
  };
};

const COLLIN_SPATIAL: SpatialConfig = {
  url: "https://services2.arcgis.com/uXyoacYrZTPTKD3R/ArcGIS/rest/services/CCAD_Parcel_Feature_Set/FeatureServer/4/query",
  idField: "PROP_ID",
  idMode: "numeric",
  addressField: "situsConcat",
  categoryField: "propCategoryCode",
  valueSql: "COALESCE(currValAppraised,prevValAppraised)",
  outFields:
    "PROP_ID,situsConcat,ownerName,propCategoryCode,landSizeAcres,currValAppraised,prevValAppraised,currValLand,prevValLand,currValImprv,prevValImprv",
  map: (a) => ({
    pid: a.PROP_ID,
    address: a.situsConcat,
    owner: a.ownerName,
    value: parseNum(a.currValAppraised) ?? parseNum(a.prevValAppraised),
    land: parseNum(a.currValLand) ?? parseNum(a.prevValLand),
    improvement: parseNum(a.currValImprv) ?? parseNum(a.prevValImprv),
    acres: parseNum(a.landSizeAcres),
    category: str(a.propCategoryCode),
  }),
};

const SPATIAL_BY_CAD: Record<string, SpatialConfig> = {
  "Collin Central Appraisal District": COLLIN_SPATIAL,
  // Older saved rows use the short name — same county.
  "Collin CAD": COLLIN_SPATIAL,
};

const RADII_MILES = [1, 2.5, COMPS_RADIUS_MILES];
const ENOUGH_COMPS = 10;
const SPATIAL_FETCH_LIMIT = 300;

type ArcgisFeature = {
  attributes: Record<string, unknown>;
  geometry?: { rings?: number[][][] };
};

async function arcgisQuery(url: string, params: Record<string, string>): Promise<ArcgisFeature[]> {
  const qs = new URLSearchParams({ f: "json", outSR: "4326", ...params });
  const res = await fetch(`${url}?${qs.toString()}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`parcel layer ${res.status}`);
  const json = (await res.json()) as { features?: ArcgisFeature[]; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? "parcel layer error");
  return json.features ?? [];
}

// Vertex average of the largest ring — plenty accurate at parcel scale for a
// map pin and a miles-level distance filter.
function centroidOf(g: ArcgisFeature["geometry"]): { lat: number; lon: number } | null {
  const rings = g?.rings;
  if (!rings || rings.length === 0) return null;
  const ring = rings.reduce((big, r) => (r.length > big.length ? r : big), rings[0]);
  if (ring.length === 0) return null;
  const lon = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

function escapeSql(s: string): string {
  return s.replace(/'/g, "''");
}

function idClause(cfg: SpatialConfig, op: "=" | "<>", id: string): string {
  return cfg.idMode === "numeric"
    ? `${cfg.idField}${op}${id}`
    : `${cfg.idField}${op}'${escapeSql(id)}'`;
}

async function spatialComps(cfg: SpatialConfig, input: CompsInput): Promise<CompsResult> {
  const empty: CompsResult = { subject: null, comps: [] };
  const outFields = cfg.outFields;

  // Subject: by account number when it's the county's own numeric id, else by
  // street address (saved rows sometimes carry a geo-style account like
  // "24-0158-GR-0001" instead).
  let where: string | null = null;
  const acct = input.accountNumber?.trim() ?? "";
  if (/^\d+$/.test(acct)) {
    where = idClause(cfg, "=", acct);
  } else if (input.address) {
    const street = input.address.split(",")[0].trim().toUpperCase();
    if (/^\d+\s+\S+/.test(street)) where = `${cfg.addressField} LIKE '${escapeSql(street)}%'`;
  }
  if (!where) return empty;

  const subjRows = await arcgisQuery(cfg.url, {
    where,
    outFields,
    returnGeometry: "true",
    resultRecordCount: "25",
  });
  const cityHint = input.address?.split(",")[1]?.trim().toUpperCase();
  const inCity = cityHint
    ? subjRows.filter((r) =>
        String(r.attributes[cfg.addressField] ?? "")
          .toUpperCase()
          .includes(cityHint),
      )
    : [];
  const candidates = inCity.length > 0 ? inCity : subjRows;
  const target = typeof input.totalValue === "number" && input.totalValue > 0 ? input.totalValue : null;
  const subjFeature = target
    ? candidates.reduce<ArcgisFeature | undefined>((best, r) => {
        const v = cfg.map(r.attributes).value;
        const bv = best ? cfg.map(best.attributes).value : null;
        const d = v == null ? Infinity : Math.abs(v - target);
        const bd = bv == null ? Infinity : Math.abs(bv - target);
        return !best || d < bd ? r : best;
      }, undefined)
    : candidates[0];
  if (!subjFeature) return empty;
  const at = centroidOf(subjFeature.geometry);
  if (!at) return empty;

  const sMap = cfg.map(subjFeature.attributes);
  const toComp = (f: ArcgisFeature): CompProperty | null => {
    const c = centroidOf(f.geometry);
    const m = cfg.map(f.attributes);
    const pid = parseNum(m.pid);
    if (!c || pid == null) return null;
    return {
      pid,
      address: str(m.address) ?? "",
      latitude: c.lat,
      longitude: c.lon,
      marketValue: m.value,
      ownerName: str(m.owner),
      legalAcreage: m.acres,
      landValue: m.land,
      improvementValue: m.improvement,
      appraisedValue: m.value,
      lastTransferDt: null,
      propType: m.category,
      zoning: null,
    };
  };
  const subjectProp = toComp(subjFeature);
  if (!subjectProp) return empty;

  const conds: string[] = [];
  if (sMap.pid != null) conds.push(idClause(cfg, "<>", String(sMap.pid)));
  if (sMap.category) conds.push(`${cfg.categoryField}='${escapeSql(sMap.category)}'`);
  if (sMap.value) {
    conds.push(
      `${cfg.valueSql} BETWEEN ${Math.round(sMap.value * 0.5)} AND ${Math.round(sMap.value * 2)}`,
    );
  } else {
    conds.push(`${cfg.valueSql} > 0`);
  }

  let comps: CompProperty[] = [];
  for (const radius of RADII_MILES) {
    const rows = await arcgisQuery(cfg.url, {
      where: conds.join(" AND "),
      outFields,
      returnGeometry: "true",
      geometry: `${at.lon},${at.lat}`,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      distance: String(radius),
      units: "esriSRUnit_StatuteMile",
      resultRecordCount: String(SPATIAL_FETCH_LIMIT),
    });
    comps = rows
      .map(toComp)
      .filter((c): c is CompProperty => c !== null)
      .filter((c) => milesBetween(at.lat, at.lon, c.latitude, c.longitude) <= COMPS_RADIUS_MILES);
    if (comps.length >= ENOUGH_COMPS) break;
  }

  const sv = subjectProp.marketValue ?? 0;
  comps.sort((a, b) => {
    const da = a.marketValue == null ? Infinity : Math.abs(a.marketValue - sv);
    const db = b.marketValue == null ? Infinity : Math.abs(b.marketValue - sv);
    return da - db;
  });
  return { subject: { ...subjectProp, asCode: "" }, comps: comps.slice(0, 10) };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const input = (await req.json()) as CompsInput;
    const office = input.cad ? TRUEPRODIGY_OFFICE_BY_CAD[input.cad] : undefined;
    const emptyResult: CompsResult = { subject: null, comps: [] };

    const spatialCfg = input.cad ? SPATIAL_BY_CAD[input.cad] : undefined;
    if (!office && spatialCfg) {
      const result = await spatialComps(spatialCfg, input);
      return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders });
    }

    if (!office || !input.accountNumber) {
      return new Response(JSON.stringify(emptyResult), { status: 200, headers: corsHeaders });
    }
    const subjectPid = parseInt(input.accountNumber, 10);
    if (!Number.isFinite(subjectPid)) {
      return new Response(JSON.stringify(emptyResult), { status: 200, headers: corsHeaders });
    }

    const token = await getToken(office);
    const headers = { "Content-Type": "application/json", Authorization: token };

    const subjectRes = await fetch(
      "https://prod-container.trueprodigyapi.com/public/property/search",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ pid: { operator: "=", value: String(subjectPid) } }),
      },
    );
    if (!subjectRes.ok) {
      return new Response(JSON.stringify(emptyResult), { status: 200, headers: corsHeaders });
    }
    const subjectJson = (await subjectRes.json()) as { results?: Array<Record<string, unknown>> };
    const subjectRows = subjectJson.results ?? [];
    if (subjectRows.length === 0) {
      return new Response(JSON.stringify(emptyResult), { status: 200, headers: corsHeaders });
    }
    const [subjectBest] = dedupeBestYear(subjectRows);
    const asCode = subjectBest?.asCode as string | undefined;
    const subjectProp = subjectBest ? toCompProperty(subjectBest) : null;
    if (!asCode || !subjectProp) {
      return new Response(JSON.stringify(emptyResult), { status: 200, headers: corsHeaders });
    }

    const compsRes = await fetch(
      "https://prod-container.trueprodigyapi.com/public/property/search",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ asCode: { operator: "=", value: asCode } }),
      },
    );
    const compsJson = compsRes.ok
      ? ((await compsRes.json()) as { results?: Array<Record<string, unknown>> })
      : {};
    const dedupedRows = dedupeBestYear(compsJson.results ?? []);

    const comps = dedupedRows
      .filter((row) => parseNum(row.pid) !== subjectPid)
      .map(toCompProperty)
      .filter((c): c is CompProperty => c !== null)
      .filter(
        (c) =>
          milesBetween(subjectProp.latitude, subjectProp.longitude, c.latitude, c.longitude) <=
          COMPS_RADIUS_MILES,
      )
      .sort((a, b) => {
        const subjectValue = subjectProp.marketValue ?? 0;
        const da = a.marketValue == null ? Infinity : Math.abs(a.marketValue - subjectValue);
        const db = b.marketValue == null ? Infinity : Math.abs(b.marketValue - subjectValue);
        return da - db;
      })
      .slice(0, 10);

    const result: CompsResult = { subject: { ...subjectProp, asCode }, comps };
    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
