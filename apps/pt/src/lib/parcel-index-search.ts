// Reads from the locally-indexed copy of county parcel data
// (public.parcel_search_index, built by the ingest-cad-parcels edge
// function — see schema.sql's own long comment) instead of live-querying up
// to 12 real government ArcGIS endpoints per keystroke. Confirmed live: the
// indexed query's own EXPLAIN ANALYZE measured 1.28ms server-side, vs. a
// measured 4.48s for an equivalent live preview search through cad-lookup —
// this is the fix for the "ours is very, very slow" complaint, once a
// county has actually been ingested.
//
// Best-effort PREVIEW source only: it can be stale (refreshed on a
// schedule, not real-time) and doesn't carry every enrichment field a full
// CadRecord has (legal description, deeds, value history, per-county
// structure detail — all left undefined/null here, which CadRecord's own
// optional fields already tolerate). unified-search.ts falls back to the
// slow live path whenever this returns nothing (a county not yet
// ingested), and selecting a suggestion always re-fetches the complete,
// authoritative record by account number before committing to it — see
// selectLiveMatch in routes/index.tsx and routes/intake.tsx.
import { supabase } from "./supabase";
import type { CadRecord } from "./cad-lookup";

const SEARCH_COLUMNS =
  "cad, account_number, owner_name, property_address, property_type, land_value, improvement_value, total_value, tax_year";

type ParcelIndexRow = {
  cad: string;
  account_number: string;
  owner_name: string | null;
  property_address: string;
  property_type: string | null;
  land_value: string | number | null;
  improvement_value: string | number | null;
  total_value: string | number | null;
  tax_year: number | null;
};

function num(v: string | number | null): number | null {
  return v == null ? null : Number(v);
}

function toCadRecord(r: ParcelIndexRow): CadRecord {
  return {
    cad: r.cad,
    accountNumber: r.account_number,
    ownerName: r.owner_name,
    propertyAddress: r.property_address,
    propertyType: r.property_type,
    landValue: num(r.land_value),
    improvementValue: num(r.improvement_value),
    totalValue: num(r.total_value),
    taxYear: r.tax_year,
  };
}

// Two separate ilike() calls (address, owner) rather than one PostgREST
// .or() string — .or()'s own comma/paren syntax would need escaping the
// user's raw typed text to use safely, and ilike()'s plain pattern argument
// needs none.
export async function parcelIndexSearch(query: string, limit = 20): Promise<CadRecord[]> {
  const q = query.trim();
  if (!q) return [];
  const pattern = `%${q}%`;
  const [byAddress, byOwner] = await Promise.all([
    supabase
      .from("parcel_search_index")
      .select(SEARCH_COLUMNS)
      .ilike("property_address", pattern)
      .limit(limit),
    supabase.from("parcel_search_index").select(SEARCH_COLUMNS).ilike("owner_name", pattern).limit(limit),
  ]);
  const rows = [...(byAddress.data ?? []), ...(byOwner.data ?? [])] as ParcelIndexRow[];
  const seen = new Set<string>();
  const merged: CadRecord[] = [];
  for (const r of rows) {
    const key = `${r.cad}:${r.account_number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(toCadRecord(r));
  }
  return merged.slice(0, limit);
}
