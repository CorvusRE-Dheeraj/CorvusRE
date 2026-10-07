// Normalizers for the paid property-data sources — ATTOM and Regrid — into one
// small shape each, used by the property-sources edge function. Pure (no Deno
// or network), so apps/pt's vitest can test them against sample payloads
// (see src/lib/property-sources.test.ts). Every field is optional in practice:
// coverage varies by county, so a missing value is null, never a guess.
//
// ATTOM Property API — GET https://api.gateway.attomdata.com/propertyapi/v1.0.0/
//   property/expandedprofile?address1=<street>&address2=<city, ST zip>, header
//   `apikey`. Response { status, property: [ {...} ] }.
// Regrid Parcel API v2 — GET https://app.regrid.com/api/v2/parcels/address?
//   query=<address>&token=<token> (or /parcels/point?lat=&lon=). Response
//   { parcels: { type: "FeatureCollection", features: [ { properties: { fields } } ] } }.

export type AttomProperty = {
  attomId: string | null;
  apn: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  propertyType: string | null;
  yearBuilt: number | null;
  buildingSqft: number | null;
  lotSizeAcres: number | null;
  lotSizeSqft: number | null;
  assessedLand: number | null;
  assessedImprovement: number | null;
  assessedTotal: number | null;
  marketTotal: number | null;
  taxAmount: number | null;
  taxYear: number | null;
  ownerName: string | null;
  lastSaleAmount: number | null;
  lastSaleDate: string | null;
};

export type RegridParcel = {
  parcelNumber: string | null;
  ownerName: string | null;
  address: string | null;
  county: string | null;
  landUse: string | null;
  zoning: string | null;
  zoningDescription: string | null;
  lotSizeAcres: number | null;
  lotSizeSqft: number | null;
  landValue: number | null;
  improvementValue: number | null;
  totalValue: number | null;
  lastSaleAmount: number | null;
  lastSaleDate: string | null;
  lat: number | null;
  lng: number | null;
  // Parcel boundary (GeoJSON Polygon/MultiPolygon) — the piece no other source has.
  geometry: { type: string; coordinates: unknown } | null;
  regridPath: string | null;
};

export type SourceStatus = "ok" | "not_configured" | "no_match" | "error";

// deno-lint-ignore no-explicit-any
type Json = any;

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.replace(/[$,]/g, "")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n !== 0 ? n : null;
};
const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  return s ? s : null;
};
const int = (v: unknown): number | null => {
  const n = num(v);
  return n == null ? null : Math.round(n);
};

export function normalizeAttom(payload: Json): AttomProperty | null {
  const p = payload?.property?.[0];
  if (!p) return null;
  const a = p.assessment ?? {};
  const owner = a.owner ?? p.owner ?? {};
  const ownerName =
    str(owner.owner1?.fullname) ??
    str([owner.owner1?.firstnameandmi, owner.owner1?.lastname].filter(Boolean).join(" "));
  const lot = p.lot ?? {};
  // lotsize1 is acres, lotsize2 square feet.
  const acres = num(lot.lotsize1);
  const sqft = num(lot.lotsize2);
  const size = p.building?.size ?? {};
  return {
    attomId: str(p.identifier?.attomId ?? p.identifier?.Id),
    apn: str(p.identifier?.apn),
    address: str(p.address?.oneLine),
    lat: num(p.location?.latitude),
    lng: num(p.location?.longitude),
    propertyType: str(p.summary?.propertyType ?? p.summary?.proptype ?? p.summary?.propclass),
    yearBuilt: int(p.summary?.yearbuilt),
    // ATTOM sends 0 for "not reported", so fall through on zero, not just null.
    buildingSqft: num(size.livingsize) ?? num(size.universalsize) ?? num(size.bldgsize),
    lotSizeAcres: acres,
    lotSizeSqft: sqft,
    assessedLand: num(a.assessed?.assdlandvalue),
    assessedImprovement: num(a.assessed?.assdimprvalue),
    assessedTotal: num(a.assessed?.assdttlvalue),
    marketTotal: num(a.market?.mktttlvalue),
    taxAmount: num(a.tax?.taxamt),
    taxYear: int(a.tax?.taxyear),
    ownerName,
    lastSaleAmount: num(p.sale?.amount?.saleamt ?? p.sale?.saleAmountData?.saleAmt),
    lastSaleDate: str(p.sale?.amount?.salerecdate ?? p.sale?.saleTransDate ?? p.sale?.salesearchdate),
  };
}

export function normalizeRegrid(payload: Json): RegridParcel | null {
  const f = payload?.parcels?.features?.[0];
  const fields = f?.properties?.fields;
  if (!fields) return null;
  const geometry =
    f.geometry && typeof f.geometry.type === "string"
      ? { type: f.geometry.type as string, coordinates: f.geometry.coordinates }
      : null;
  return {
    parcelNumber: str(fields.parcelnumb),
    ownerName: str(fields.owner),
    address: str(fields.address) ?? str(f.properties.headline),
    county: str(fields.county),
    landUse: str(fields.usedesc) ?? str(fields.lbcs_activity_desc),
    zoning: str(fields.zoning),
    zoningDescription: str(fields.zoning_description),
    lotSizeAcres: num(fields.ll_gisacre ?? fields.gisacre),
    lotSizeSqft: num(fields.ll_gissqft ?? fields.sqft),
    landValue: num(fields.landval),
    improvementValue: num(fields.improvval),
    totalValue: num(fields.parval),
    lastSaleAmount: num(fields.saleprice),
    lastSaleDate: str(fields.saledate),
    lat: num(fields.lat),
    lng: num(fields.lon),
    geometry,
    regridPath: str(f.properties.path),
  };
}

// One recent comparable SALE from ATTOM's sales comparables
// (GET /propertyapi/v1.0.0/salescomparables/address/{street}/{citystatezip}).
// Texas doesn't require sale prices to be disclosed, so ATTOM's Texas coverage is
// thinner than other states' — a comp without a real price is dropped.
export type AttomComp = {
  address: string;
  saleAmount: number;
  saleDate: string | null;
  buildingSqft: number | null;
  yearBuilt: number | null;
  distanceMiles: number | null;
  pricePerSqft: number | null;
};

// The comparables response nests MISMO-style objects ("@_StreetAddress",
// "SALES_HISTORY", "@PropertySalesAmount"…) whose exact depth isn't published, so
// each comparable is found by its key name and its fields by name pattern, at any
// depth, rather than by a fixed path.
function findArrays(node: Json, keyPattern: RegExp, out: Json[][] = []): Json[][] {
  if (!node || typeof node !== "object") return out;
  for (const [k, v] of Object.entries(node)) {
    if (keyPattern.test(k)) out.push(Array.isArray(v) ? v : [v]);
    else findArrays(v, keyPattern, out);
  }
  return out;
}

function findValue(node: Json, keyPattern: RegExp, depth = 0): unknown {
  if (!node || typeof node !== "object" || depth > 6) return undefined;
  for (const [k, v] of Object.entries(node)) {
    if (keyPattern.test(k) && (typeof v === "string" || typeof v === "number")) return v;
  }
  for (const v of Object.values(node)) {
    if (v && typeof v === "object") {
      const found = findValue(v, keyPattern, depth + 1);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

export function normalizeAttomComps(payload: Json): AttomComp[] {
  const comps: AttomComp[] = [];
  for (const arr of findArrays(payload, /^COMPARABLE_PROPERTY(_ext)?$/i)) {
    for (const c of arr) {
      const saleAmount = num(findValue(c, /^@?(Property)?Sales?Amount$|^saleamt$/i));
      if (saleAmount == null) continue;
      const street = str(findValue(c, /^@_StreetAddress$|^line1$|^oneLine$/i));
      if (!street) continue;
      const city = str(findValue(c, /^@_City$|^locality$/i));
      const sqft = num(findValue(c, /GrossLivingArea|LivingArea|livingsize|universalsize|BuildingArea/i));
      comps.push({
        address: [street, city].filter(Boolean).join(", "),
        saleAmount,
        saleDate: str(findValue(c, /^@?(Property)?Sales?Date$|^salerecdate$|RecordingDate/i)),
        buildingSqft: sqft,
        // MISMO spells it "…StructureBuiltYear"; other shapes "yearBuilt".
        yearBuilt: int(findValue(c, /YearBuilt|BuiltYear/i)),
        distanceMiles: num(findValue(c, /Distance/i)),
        pricePerSqft: sqft ? Math.round((saleAmount / sqft) * 100) / 100 : null,
      });
    }
  }
  return comps.slice(0, 10);
}

// ATTOM wants the street line and the "city, ST zip" line separately.
export function splitAddressForAttom(address: string): { address1: string; address2: string } | null {
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  return { address1: parts[0], address2: parts.slice(1).join(", ") };
}
