// One entry point for every county tax office CorvusPT reads: picks the
// reader for the county (ACT's hosted sites, Harris's own site, …) and
// returns the same TaxOfficeStatement either way. property-tax-history
// ({"kind":"statement"}) calls fetchCountyTaxStatement; the app asks
// isTaxOfficeConnected which counties to read. Adding a county system = a
// reader file + an entry in READERS.

import {
  ACT_COUNTIES,
  fetchActStatement,
  type TaxOfficeStatement,
} from "./act-tax-office.ts";
import { fetchHarrisStatement } from "./harris-tax-office.ts";
import { fetchTravisStatement } from "./travis-tax-office.ts";

type Reader = (
  county: string,
  cadId: string,
  timeoutMs: number,
) => Promise<TaxOfficeStatement | null>;

const READERS: Record<string, Reader> = {
  harris: (_c, id, t) => fetchHarrisStatement(id, t),
  travis: (_c, id, t) => fetchTravisStatement(id, t),
};

const key = (county: string) => county.trim().toLowerCase();

// Counties whose tax office search sits behind a bot check (Cloudflare
// Turnstile: Tarrant, Denton; Imperva/Incapsula: Collin) — checked
// 2026-11-11. CorvusPT doesn't try to get past those; their amounts come
// from the appraisal district (tax-history.ts) or the owner's statement.
export const BOT_PROTECTED_COUNTIES = ["collin", "denton", "tarrant"];

export function isTaxOfficeBlocked(county: string | null | undefined): boolean {
  return !!county && BOT_PROTECTED_COUNTIES.includes(key(county));
}

export function isTaxOfficeConnected(
  county: string | null | undefined,
): boolean {
  if (!county) return false;
  const k = key(county);
  return k in READERS || k in ACT_COUNTIES;
}

// Every connected county, lower case.
export function connectedCounties(): string[] {
  return [
    ...new Set([...Object.keys(ACT_COUNTIES), ...Object.keys(READERS)]),
  ].sort();
}

export function fetchCountyTaxStatement(
  county: string,
  cadId: string,
  timeoutMs: number,
): Promise<TaxOfficeStatement | null> {
  const k = key(county);
  const reader = READERS[k];
  if (reader) return reader(k, cadId, timeoutMs);
  if (k in ACT_COUNTIES) return fetchActStatement(k, cadId, timeoutMs);
  return Promise.resolve(null);
}
