import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";

// A property's tax history by year, from the appraisal district — see
// supabase/pt/functions/property-tax-history. Collin comes from Collin CAD's
// certified rolls on the Texas Open Data Portal (value × each taxing unit's
// adopted rate); Denton/Montgomery/Tarrant/Travis from the CADs' TrueProdigy
// API; esearch / True Automation counties from the record page's Value
// History table; other counties from AI reading the CAD's own record page.

export type TaxHistoryYear = {
  year: number;
  marketValue: number | null;
  appraisedValue: number | null;
  taxableValue: number | null;
  rate: number | null; // combined, per $100
  tax: number | null;
  exact: boolean;
  units?: { code: string; name: string; rate: number }[];
};

export type TaxHistory = {
  propertyId: string;
  accountNumber: string | null;
  years: TaxHistoryYear[]; // newest first
  source: "collin_open_data" | "cad_api" | "cad_page" | "none";
  sourceUrl: string | null;
  retrievedAt: string;
};

export const TAX_HISTORY_SOURCE_LABEL: Record<TaxHistory["source"], string> = {
  collin_open_data: "Collin CAD certified values × each taxing unit's adopted rate",
  cad_api: "The appraisal district's public property data (values by year)",
  cad_page: "The appraisal district's property record",
  none: "",
};

const FRESH_MS = 30 * 24 * 60 * 60 * 1000;
const EMPTY_FRESH_MS = 24 * 60 * 60 * 1000;

type Row = {
  property_id: string;
  account_number: string | null;
  years: TaxHistoryYear[] | null;
  source: string;
  source_url: string | null;
  retrieved_at: string;
};

const fromRow = (r: Row): TaxHistory => ({
  propertyId: r.property_id,
  accountNumber: r.account_number,
  years: Array.isArray(r.years) ? r.years : [],
  source:
    r.source === "collin_open_data" || r.source === "cad_api" || r.source === "cad_page"
      ? r.source
      : ("none" as const),
  sourceUrl: r.source_url,
  retrievedAt: r.retrieved_at,
});

export async function listTaxHistory(propertyIds: string[]): Promise<Map<string, TaxHistory>> {
  const out = new Map<string, TaxHistory>();
  if (propertyIds.length === 0) return out;
  const { data, error } = await supabase
    .from("property_tax_history")
    .select("property_id, account_number, years, source, source_url, retrieved_at")
    .in("property_id", propertyIds);
  if (error || !data) return out;
  for (const r of data as Row[]) out.set(r.property_id, fromRow(r));
  return out;
}

// Cached and still current for this account number?
export function isFresh(
  h: TaxHistory | undefined,
  accountNumber: string | null,
  now = Date.now(),
): boolean {
  // an empty result (site down, or a source not connected yet) is retried
  // after a day rather than held for a month
  const maxAge = h && h.years.length === 0 ? EMPTY_FRESH_MS : FRESH_MS;
  return (
    !!h && h.accountNumber === accountNumber && now - new Date(h.retrievedAt).getTime() < maxAge
  );
}

export async function fetchTaxHistory(
  propertyId: string,
  cadUrl: string | null,
  accountNumber: string | null,
): Promise<TaxHistory> {
  const r = await invokeEdgeFunction<{
    years: TaxHistoryYear[];
    source: TaxHistory["source"];
    sourceUrl: string | null;
    retrievedAt: string;
  }>("property-tax-history", { propertyId, cadUrl });
  return { propertyId, accountNumber, ...r, years: r.years ?? [] };
}

// The calculated tax for one tax year, when the history has it.
export function historyTaxFor(h: TaxHistory | undefined, year: number): TaxHistoryYear | null {
  return h?.years.find((y) => y.year === year && y.tax != null) ?? null;
}
