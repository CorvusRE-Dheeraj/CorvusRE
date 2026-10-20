// Statewide fallback for property lookup — every Texas county, not just the
// ones cad-lookup has a hand-built integration for. Uses two free public
// sources, no keys:
//   • US Census geocoder: address → point (Texas only)
//   • TxGIO "StratMap Land Parcels (Latest)": the State of Texas's yearly
//     statewide parcel layer, compiled from every appraisal district — owner,
//     situs address, land / improvement / market value, legal description,
//     state land-use code, year built and tax year.
// The state service is display-only (no attribute query), so this uses its
// "identify" operation: every parcel within ~30 m of the geocoded point, then
// the one whose situs house number + street match the address. If none
// matches, the nearby parcels come back as choices — never a guessed record.
import directory from "./tx-cad-directory.json" with { type: "json" };

export const STRATMAP_URL =
  "https://feature.geographic.texas.gov/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer";

export type StatewideRecord = {
  ownerName: string | null;
  propertyAddress: string;
  cad: string;
  accountNumber: string | null;
  propertyType: string | null;
  landValue: number | null;
  improvementValue: number | null;
  totalValue: number | null;
  taxYear: number | null;
  legalDescription: string | null;
  lotSizeAcres: number | null;
  yearBuilt: number | null;
  mailingAddress: string | null;
  /** where the record came from — the app shows "standard coverage" for these */
  dataSource: "statewide";
};

// Texas Comptroller state property-type codes (first letter / letter+digit)
const LAND_USE: Record<string, string> = {
  A: "Single-family residential",
  B: "Multifamily residential",
  C1: "Vacant lot",
  C2: "Colonia lot",
  C: "Vacant lot",
  D1: "Agricultural / open-space land",
  D2: "Farm or ranch improvements",
  D: "Agricultural land",
  E: "Rural land (non-agricultural)",
  F1: "Commercial real property",
  F2: "Industrial real property",
  G: "Oil, gas and minerals",
  J: "Utility",
  L1: "Commercial personal property",
  L2: "Industrial personal property",
  M: "Mobile home",
  O: "Residential inventory",
  S: "Special inventory",
  X: "Exempt",
};
export function landUseLabel(code: string | null): string | null {
  const c = (code ?? "").trim().toUpperCase();
  if (!c) return null;
  const label = LAND_USE[c.slice(0, 2)] ?? LAND_USE[c[0]];
  return label ? `${label} (${c})` : c;
}

const clean = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return !s || /^null$/i.test(s) ? null : s;
};
const num = (v: unknown): number | null => {
  const n = Number(clean(v)?.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const titleCase = (s: string) =>
  s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

type DirFile = {
  counties: Record<
    string,
    { county: string; appraisalDistrict: { name: string } | null }
  >;
};
/** The official appraisal-district name for a county ("HARDIN" → "Hardin Appraisal District"). */
export function districtName(county: string, source?: string | null): string {
  const want = county.trim().toLowerCase();
  // the parcel's own SOURCE ("EL PASO APPRAISAL DISTRICT") is the most reliable name
  if (source && /district/i.test(source)) {
    return titleCase(source).replace(/\bCad\b/g, "CAD");
  }
  const hit = Object.values((directory as unknown as DirFile).counties).find((
    c,
  ) => c.county.toLowerCase() === want);
  const name = hit?.appraisalDistrict?.name;
  // some directory rows say just "Appraisal District" — name it after the county then
  return name && name.toLowerCase() !== "appraisal district"
    ? name
    : `${titleCase(county)} Appraisal District`;
}

/** "7205 GOLDEN LN , SILSBEE, TX 77656" → "7205 Golden Ln, Silsbee, TX 77656" */
export function tidyAddress(raw: string | null): string | null {
  if (!raw) return null;
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p && !/^null$/i.test(p));
  if (!parts.length) return null;
  return parts
    .map((
      p,
      i,
    ) => (i === parts.length - 1
      ? p.replace(/\b([a-z]{2})(\s+\d{5})/i, (_, s, z) => s.toUpperCase() + z)
      : titleCase(p))
    )
    .join(", ")
    .replace(/\bTx\b/g, "TX");
}

export function toRecord(a: Record<string, unknown>): StatewideRecord | null {
  const address = tidyAddress(clean(a.SITUS_ADDR));
  const county = clean(a.COUNTY);
  if (!address || !county) return null;
  const market = num(a.MKT_VALUE);
  const area = num(a.LEGAL_AREA);
  const unit = (clean(a.LGL_AREA_UNIT) ?? "").toLowerCase();
  const built = num(a.YEAR_BUILT);
  return {
    ownerName: clean(a.OWNER_NAME),
    propertyAddress: address,
    cad: districtName(county, clean(a.SOURCE)),
    accountNumber: clean(a.PROP_ID) ?? clean(a.GEO_ID),
    propertyType: landUseLabel(clean(a.STAT_LAND_USE)) ?? clean(a.LOC_LAND_USE),
    landValue: num(a.LAND_VALUE),
    improvementValue: num(a.IMP_VALUE),
    // 0 usually means an exempt parcel or a value the district didn't publish — don't show $0 as a real value
    totalValue: market && market > 0 ? market : null,
    taxYear: num(a.TAX_YEAR),
    legalDescription: clean(a.LEGAL_DESC),
    lotSizeAcres: area && (!unit || unit.startsWith("ac")) ? area : null,
    yearBuilt: built && built > 1700 && built <= new Date().getFullYear() + 1
      ? built
      : null,
    mailingAddress: tidyAddress(clean(a.MAIL_ADDR)),
    dataSource: "statewide",
  };
}

/** Pulls "1461" and "red bud" out of "1461 N Red Bud Ln, Round Rock, TX". */
export function addressKey(
  address: string,
): { house: string; words: string[] } | null {
  const m = address.trim().match(/^(\d+[a-z]?)\s+(.+?)(?:,|$)/i);
  if (!m) return null;
  const words = m[2]
    .toLowerCase()
    .replace(/[.#]/g, " ")
    .split(/\s+/)
    .filter((w) =>
      w &&
      !/^(n|s|e|w|ne|nw|se|sw|north|south|east|west|st|street|rd|road|dr|drive|ln|lane|ave|avenue|blvd|ct|court|cir|circle|pkwy|hwy|trl|trail|way|pl|place|apt|unit|ste|suite)$/
        .test(w) &&
      !/^\d+$/.test(w)
    );
  return { house: m[1].toLowerCase(), words };
}
export function situsMatches(
  record: StatewideRecord,
  key: { house: string; words: string[] },
): boolean {
  const a = record.propertyAddress.toLowerCase();
  if (!new RegExp(`^${key.house}\\b`).test(a)) return false;
  return key.words.length === 0 || key.words.some((w) => a.includes(w));
}

async function getJson<T>(url: string, ms: number): Promise<T> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal });
    if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
    return (await r.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

export type StatewideResult =
  | { matched: true; record: StatewideRecord }
  | { matched: "multiple"; options: StatewideRecord[] }
  | { matched: false; nearby: StatewideRecord[] };

/** Address → statewide parcel record (or choices). null = not in Texas / not found. */
export async function statewideLookup(
  address: string,
  ms = 9000,
): Promise<StatewideResult | null> {
  const q = /\b(TX|Texas)\b/i.test(address) ? address : `${address}, TX`;
  type Geo = {
    result?: {
      addressMatches?: {
        matchedAddress: string;
        coordinates: { x: number; y: number };
      }[];
    };
  };
  const g = await getJson<Geo>(
    `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${
      encodeURIComponent(q)
    }&benchmark=Public_AR_Current&format=json`,
    ms,
  );
  const m = g.result?.addressMatches?.find((x) =>
    /,\s*TX,?\s*\d{5}/.test(x.matchedAddress)
  );
  if (!m) return null;
  const { x, y } = m.coordinates;
  // ~0.6 m per pixel, 50 px tolerance ≈ 30 m — the geocoded point sits on the street, the parcel behind it
  const ext = [x - 0.0018, y - 0.0018, x + 0.0018, y + 0.0018].join(",");
  type Identify = { results?: { attributes: Record<string, unknown> }[] };
  const id = await getJson<Identify>(
    `${STRATMAP_URL}/identify?geometry=${x},${y}&geometryType=esriGeometryPoint&sr=4326&layers=all:0&tolerance=50&mapExtent=${ext}&imageDisplay=600,600,96&returnGeometry=false&f=json`,
    ms,
  );
  const records = (id.results ?? []).map((r) => toRecord(r.attributes)).filter((
    r,
  ): r is StatewideRecord => !!r);
  // one row per account
  const unique = [
    ...new Map(records.map((r) => [r.accountNumber ?? r.propertyAddress, r]))
      .values(),
  ];
  if (!unique.length) return { matched: false, nearby: [] };
  const key = addressKey(address) ?? addressKey(m.matchedAddress);
  const hits = key ? unique.filter((r) => situsMatches(r, key)) : [];
  if (hits.length === 1) return { matched: true, record: hits[0] };
  if (hits.length > 1) {
    return { matched: "multiple", options: hits.slice(0, 8) };
  }
  return { matched: false, nearby: unique.slice(0, 6) };
}
