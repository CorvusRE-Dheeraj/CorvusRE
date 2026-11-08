import { countyFromCad as baseCounty } from "./tax-rates-official";

// "Collin CAD" as well as "Collin Central Appraisal District".
const countyFromCad = (cad: string | null | undefined) =>
  baseCounty(cad?.replace(/\s+cad\s*$/i, ""));

// Building permits for a property, from the appraisal district's own published
// data. Collin CAD publishes every building permit it recorded in the last
// three years on the Texas Open Data Portal ("Collin CAD Building Permits",
// data.texas.gov 82ee-gbj5), keyed by the CAD property ID — the account number
// CorvusPT stores. Public, keyless and CORS-open, so it's read straight from the
// browser (no edge function). Other counties don't publish permits as open data
// yet; permitsSupported() says which do.

export const PERMIT_SOURCES: Record<string, { label: string; dataset: string; url: string }> = {
  collin: {
    label: "Collin CAD building permits (Texas Open Data Portal)",
    dataset: "82ee-gbj5",
    url: "https://data.texas.gov/d/82ee-gbj5",
  },
};

export type BuildingPermit = {
  id: string;
  number: string | null;
  type: string | null;
  subtype: string | null;
  issuedAt: string | null;
  issuedBy: string | null;
  issuedTo: string | null;
  value: number | null;
  buildingArea: number | null;
  comments: string | null;
};

export function permitsSupported(cad: string | null | undefined): boolean {
  const c = countyFromCad(cad);
  return !!c && c in PERMIT_SOURCES;
}

const num = (v: unknown) => {
  const n = v == null || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
};
const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function permitFromRow(r: Record<string, unknown>): BuildingPermit {
  return {
    id: String(r.permitid ?? r.permitnum ?? ""),
    number: txt(r.permitnum),
    type: txt(r.permittypedescr),
    subtype: txt(r.permitsubtypedescr),
    issuedAt: txt(r.permitissueddate)?.slice(0, 10) ?? null,
    issuedBy: txt(r.permitissuedby),
    issuedTo: txt(r.permitissuedto) ?? txt(r.permitbuildername),
    value: num(r.permitvalue),
    buildingArea: num(r.permitbldgarea),
    comments: txt(r.permitcomments),
  };
}

// Collin's permit data is keyed by the numeric CAD property ID; anything
// else (a map-style ID like "24-0158-GR-0001") can't be looked up there.
export function permitAccountOk(accountNumber: string | null | undefined): boolean {
  return /^\d+$/.test(accountNumber?.trim() ?? "");
}

// Newest first; null when the county has no open permit data.
export async function loadBuildingPermits(
  cad: string | null | undefined,
  accountNumber: string | null | undefined,
  signal?: AbortSignal,
): Promise<BuildingPermit[] | null> {
  const county = countyFromCad(cad);
  const src = county ? PERMIT_SOURCES[county] : undefined;
  const acct = accountNumber?.trim();
  if (!src || !acct || !permitAccountOk(acct)) return null;
  const url =
    `https://data.texas.gov/resource/${src.dataset}.json?propid=${encodeURIComponent(acct)}` +
    `&$order=${encodeURIComponent("permitissueddate DESC")}&$limit=100`;
  const res = await fetch(url, { signal, headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Permit data unavailable (${res.status})`);
  const rows = (await res.json()) as Record<string, unknown>[];
  return rows.map(permitFromRow);
}

// Permits that typically add value the appraisal district picks up (new
// construction, additions, finish-out, remodels, pools, accessory buildings).
const VALUE_ADDING = /new construction|addition|finish out|remodel|pool|spa|accessory/i;
export function isValueAdding(p: Pick<BuildingPermit, "type" | "subtype">): boolean {
  return VALUE_ADDING.test(`${p.type ?? ""} ${p.subtype ?? ""}`);
}
