import data from "../data/tx-esearch-sites.json";
import { countyFromCad } from "./tax-rates-official";

// Appraisal districts whose public record site is BIS Consultants' "esearch"
// ({origin}/Property/View/{propId}), each VERIFIED live by
// scripts/build-tx-esearch-sites.mjs: the State parcel layer's PROP_ID — the
// account number a statewide ("standard coverage") record carries — opened
// that county's record page and showed the right owner. 101 counties on
// 2026-11-08. Same file as supabase/pt/functions/_shared/tx-esearch-sites.json.

type Site = { county: string; origin: string };
const SITES = (data as unknown as { sites: Record<string, Site> }).sites;
const BY_COUNTY = new Map(Object.values(SITES).map((s) => [s.county.toLowerCase(), s.origin]));

/** "Angelina County Appraisal District" → "https://esearch.angelinacad.org", else null. */
export function esearchOriginForCad(cad: string | null | undefined): string | null {
  const county = countyFromCad(cad);
  return county ? (BY_COUNTY.get(county) ?? null) : null;
}

/**
 * The State's PROP_ID ("74996", "R71735") — not its dashed GEO_ID, which a
 * statewide record falls back to when PROP_ID is missing and which esearch
 * can't open.
 */
export function isEsearchPropertyId(id: string | null | undefined): id is string {
  return !!id && /^[A-Z]?\d+$/i.test(id.trim());
}

export function esearchRecordUrl(
  cad: string | null | undefined,
  accountNumber: string | null | undefined,
): string | null {
  const origin = esearchOriginForCad(cad);
  return origin && isEsearchPropertyId(accountNumber)
    ? `${origin}/Property/View/${encodeURIComponent(accountNumber.trim())}`
    : null;
}

export const ESEARCH_COUNTY_COUNT = BY_COUNTY.size;
