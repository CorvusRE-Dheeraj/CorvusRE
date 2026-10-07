// Official Texas tax rates for a property, from the Comptroller's annual "Tax
// Rates and Levies" data (src/data/tx-tax-rates.json, rebuilt yearly by
// scripts/build-tx-tax-rates.mjs). Rates there are per $100 of taxable value;
// everything returned here is a fraction (0.0215 = 2.15%).
//
// What's exact vs. not: the county's own rate and (when the address's city is a
// city in that county) the city's rate are the real adopted rates. Which school
// district — and which MUD/college/hospital district — a property sits in isn't
// known from the address alone, so the school district is given as the range
// across districts based in the county, and the other districts aren't counted.

export type OfficialTaxRates = {
  year: number;
  sourceUrl: string;
  county: { name: string; rate: number };
  city: { name: string; rate: number } | null;
  schoolDistricts: { count: number; min: number; max: number } | null;
  // county + city — the part of the combined rate that's known for certain.
  knownRate: number;
};

type CountyEntry = {
  name: string;
  countyRate: number | null;
  cities: Record<string, number>;
  isds: [string, number][];
};
export type RatesFile = {
  year: number;
  source: string;
  ratesPer: number;
  counties: Record<string, CountyEntry>;
};

// "Dallas Central Appraisal District" -> "dallas"
export function countyFromCad(cad: string | null | undefined): string | null {
  if (!cad) return null;
  const name = cad
    .replace(/\b(central\s+)?appraisal\s+district\b/i, "")
    .replace(/\bcounty\b/i, "")
    .trim()
    .toLowerCase();
  return name || null;
}

// "19730 Bulverde Rd, San Antonio, TX 78259" -> "san antonio"
export function cityFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const parts = address
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const stateIdx = parts.findIndex((p) => /^(TX|Texas)\b/i.test(p));
  const city =
    stateIdx > 0 ? parts[stateIdx - 1] : parts.length >= 3 ? parts[parts.length - 2] : null;
  return city ? city.toLowerCase().replace(/^city of\s+/, "") : null;
}

let cache: Promise<RatesFile> | null = null;
function loadRates(): Promise<RatesFile> {
  // Lazy: ~60 KB of data only the base-data fetch needs.
  cache ??= import("../data/tx-tax-rates.json").then(
    (m) => (m.default ?? m) as unknown as RatesFile,
  );
  return cache;
}

export function lookupInRates(
  data: RatesFile,
  cad: string | null | undefined,
  address: string | null | undefined,
): OfficialTaxRates | null {
  const countyName = countyFromCad(cad);
  if (!countyName) return null;
  const county = Object.values(data.counties).find((c) => c.name.toLowerCase() === countyName);
  if (!county || county.countyRate == null) return null;
  const per = data.ratesPer;
  const cityName = cityFromAddress(address);
  const cityRate = cityName != null ? county.cities[cityName] : undefined;
  const isdRates = county.isds.map(([, r]) => r).filter((r) => r > 0);
  const city =
    cityName != null && cityRate != null
      ? { name: cityName.replace(/\b\w/g, (ch) => ch.toUpperCase()), rate: cityRate / per }
      : null;
  return {
    year: data.year,
    sourceUrl: data.source,
    county: { name: county.name, rate: county.countyRate / per },
    city,
    schoolDistricts:
      isdRates.length > 0
        ? {
            count: isdRates.length,
            min: Math.min(...isdRates) / per,
            max: Math.max(...isdRates) / per,
          }
        : null,
    knownRate: county.countyRate / per + (city?.rate ?? 0),
  };
}

export async function lookupOfficialTaxRates(
  cad: string | null | undefined,
  address: string | null | undefined,
): Promise<OfficialTaxRates | null> {
  try {
    return lookupInRates(await loadRates(), cad, address);
  } catch {
    return null;
  }
}
