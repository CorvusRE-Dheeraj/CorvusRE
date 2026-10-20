import directory from "../data/tx-cad-directory.json";
import { SUPPORTED_COUNTY_NAMES } from "./cad-record-url";
import { countyFromCad } from "./tax-rates-official";

// Two levels of coverage:
//  - "full": the 13 counties with their own appraisal-district integration
//    (SUPPORTED_COUNTY_NAMES) — enrichment, value history, comps, deep links.
//  - "standard": every other Texas county — owner, values, legal description
//    and year built from the State's statewide parcel layer (TxGIO StratMap),
//    found by cad-lookup's statewide fallback.

type DirectoryFile = { counties: Record<string, { county: string }> };

/** All 254 Texas county names ("Hardin", "El Paso", …), sorted. */
export const TEXAS_COUNTY_NAMES: string[] = Object.values(
  (directory as unknown as DirectoryFile).counties,
)
  .map((c) => c.county)
  .sort((a, b) => a.localeCompare(b));

const TEXAS_LOWER = new Set(TEXAS_COUNTY_NAMES.map((c) => c.toLowerCase()));

const bare = (county: string) => county.replace(/\s*County$/i, "").trim();

export function isTexasCounty(county: string | null | undefined): boolean {
  return !!county && TEXAS_LOWER.has(bare(county).toLowerCase());
}

const FULL_LOWER = new Set([...SUPPORTED_COUNTY_NAMES].map((c) => c.toLowerCase()));

export function isFullCoverageCounty(county: string | null | undefined): boolean {
  return !!county && FULL_LOWER.has(bare(county).toLowerCase());
}

/** "Hardin Appraisal District" → true (standard coverage); the 13 full counties → false. */
export function isStandardCoverageCad(cad: string | null | undefined): boolean {
  const county = countyFromCad(cad);
  return !!county && isTexasCounty(county) && !isFullCoverageCounty(county);
}

/** A record that came from the statewide parcel layer (standard coverage). */
export function isStatewideRecord(record: { dataSource?: string | null } | null | undefined) {
  return record?.dataSource === "statewide";
}
