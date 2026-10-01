// Bulk-pulls one county's FULL parcel dataset into public.parcel_search_index,
// a few thousand rows per invocation, resuming across repeated pg_cron ticks
// via parcel_ingest_progress (see schema.sql's own long comment on why: a
// single edge function invocation has only a few minutes of real execution
// time, nowhere near enough to page through Harris's ~1.55M rows in one
// shot). This table only ever backs the FAST, best-effort live-search
// preview — the existing cad-lookup edge function's own live, per-address
// queries stay authoritative for a real "Validate address" submit, so a
// parcel that changed since the last refresh here is never silently stale
// at the moment a filing decision actually depends on it.
//
// Deliberately standalone, not sharing code with cad-lookup/index.ts: that
// file is large, fragile, and extensively live-tuned for exact per-address
// matching — refactoring it to share a module with a bulk-ingest job this
// different in shape risked regressing it for no real benefit. Small
// duplication of each county's URL/outFields/attribute-mapping here is the
// safer trade.
//
// Proof-of-concept scope (2026-10-01): Collin only, to prove the
// ingest -> index -> fast-search pipeline end to end before paginating the
// other 11 counties. Tarrant's ArcGIS layer has no pagination support at
// all (confirmed live: a plain resultRecordCount request 400s with
// "Pagination is not supported") — it'll need an OBJECTID-range chunking
// strategy instead of resultOffset paging, not yet built.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ParcelRow = {
  cad: string;
  account_number: string;
  owner_name: string | null;
  property_address: string;
  property_type: string | null;
  land_value: number | null;
  improvement_value: number | null;
  total_value: number | null;
  tax_year: number | null;
  building_sqft: number | null;
  year_built: number | null;
  building_class: string | null;
  lot_size_acres: number | null;
  lot_size_sqft: number | null;
};

type CountyConfig = {
  cad: string;
  url: string;
  outFields: string;
  pageSize: number;
  mapRow: (attrs: Record<string, string | number | null>) => ParcelRow | null;
};

function parseMoneyField(v: string | number | null): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : null;
}

// Postgres's ON CONFLICT DO UPDATE refuses to touch the same conflict key
// twice within one statement ("command cannot affect row a second time") —
// found live on the very first real multi-page Collin pull, which hit this
// exact error on its second batch. A county's own ArcGIS layer can
// genuinely return the same account_number more than once within a single
// page (seen live: Collin's "CROW-BILLINGSLEY AIR PK LTD" land parcels),
// so this collapses to one row per (cad, account_number) — last one wins —
// before every upsert, rather than trusting the source data has none.
function dedupeByAccount(rows: ParcelRow[]): ParcelRow[] {
  const byKey = new Map<string, ParcelRow>();
  for (const r of rows) byKey.set(`${r.cad}:${r.account_number}`, r);
  return [...byKey.values()];
}

const COLLIN: CountyConfig = {
  cad: "Collin Central Appraisal District",
  url: "https://services2.arcgis.com/uXyoacYrZTPTKD3R/ArcGIS/rest/services/CCAD_Parcel_Feature_Set/FeatureServer/4/query",
  outFields:
    "ownerName,situsConcat,currValLand,currValImprv,currValAppraised,currValYear,prevValLand,prevValImprv,prevValAppraised,prevValYear,PROP_ID,propType,propSubType,propCategoryCode,propYear,imprvMainArea,imprvYearBuilt,imprvClassCd,landSizeAcres,landSizeSqft",
  pageSize: 2000,
  mapRow(attrs) {
    if (attrs.PROP_ID == null) return null;
    return {
      cad: "Collin Central Appraisal District",
      account_number: String(attrs.PROP_ID),
      owner_name: (attrs.ownerName as string) ?? null,
      property_address: (attrs.situsConcat as string) ?? "",
      property_type:
        (attrs.propSubType as string)?.trim() ||
        (attrs.propCategoryCode as string)?.trim() ||
        (attrs.propType as string)?.trim() ||
        null,
      land_value: parseMoneyField(attrs.currValLand) ?? parseMoneyField(attrs.prevValLand),
      improvement_value:
        parseMoneyField(attrs.currValImprv) ?? parseMoneyField(attrs.prevValImprv),
      total_value:
        parseMoneyField(attrs.currValAppraised) ?? parseMoneyField(attrs.prevValAppraised),
      tax_year:
        parseMoneyField(attrs.currValYear) ??
        parseMoneyField(attrs.prevValYear) ??
        parseMoneyField(attrs.propYear),
      building_sqft: parseMoneyField(attrs.imprvMainArea),
      year_built: parseMoneyField(attrs.imprvYearBuilt),
      building_class: (attrs.imprvClassCd as string)?.trim() || null,
      lot_size_acres: parseMoneyField(attrs.landSizeAcres),
      lot_size_sqft: parseMoneyField(attrs.landSizeSqft),
    };
  },
};

const COUNTIES: Record<string, CountyConfig> = {
  collin: COLLIN,
};

// How many pages this one invocation pulls before returning — bounded well
// under any platform execution-time limit. 15 pages * 2000 rows = 30,000
// rows per tick; a pg_cron schedule re-invokes this repeatedly until
// next_offset catches up to total_count.
const PAGES_PER_INVOCATION = 15;

async function fetchPage(
  cfg: CountyConfig,
  offset: number,
): Promise<Array<{ attributes: Record<string, string | number | null> }>> {
  const url =
    `${cfg.url}?where=${encodeURIComponent("1=1")}` +
    `&outFields=${cfg.outFields}&resultOffset=${offset}&resultRecordCount=${cfg.pageSize}` +
    "&returnGeometry=false&f=json";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${cfg.cad} bulk query failed: ${res.status}`);
  const json = (await res.json()) as {
    features?: Array<{ attributes: Record<string, string | number | null> }>;
    error?: { message?: string };
  };
  if (json.error) throw new Error(`${cfg.cad} bulk query error: ${json.error.message}`);
  return json.features ?? [];
}

async function upsertRows(rows: ParcelRow[]): Promise<void> {
  if (rows.length === 0) return;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/parcel_search_index?on_conflict=cad,account_number`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upsert failed: ${res.status} ${text.slice(0, 500)}`);
  }
}

async function getProgress(cad: string): Promise<{ next_offset: number; total_count: number | null }> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/parcel_ingest_progress?cad=eq.${encodeURIComponent(cad)}&select=next_offset,total_count`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  const rows = (await res.json()) as Array<{ next_offset: number; total_count: number | null }>;
  return rows[0] ?? { next_offset: 0, total_count: null };
}

async function setProgress(
  cad: string,
  fields: Partial<{
    next_offset: number;
    total_count: number;
    last_run_at: string;
    done_through_at: string | null;
    last_error: string | null;
  }>,
): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/parcel_ingest_progress?on_conflict=cad`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify([{ cad, ...fields }]),
  });
}

async function getCount(cfg: CountyConfig): Promise<number> {
  const url = `${cfg.url}?where=${encodeURIComponent("1=1")}&returnCountOnly=true&f=json`;
  const res = await fetch(url);
  const json = (await res.json()) as { count?: number };
  return json.count ?? 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const key = (body.county as string) ?? "collin";
    const cfg = COUNTIES[key];
    if (!cfg) {
      return new Response(JSON.stringify({ error: `Unknown county "${key}"` }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const progress = await getProgress(cfg.cad);
    let { next_offset: offset, total_count: totalCount } = progress;
    if (totalCount == null) {
      totalCount = await getCount(cfg);
    }

    let pulled = 0;
    let upserted = 0;
    for (let i = 0; i < PAGES_PER_INVOCATION; i++) {
      if (offset >= totalCount) break;
      const features = await fetchPage(cfg, offset);
      if (features.length === 0) break;
      const rows = dedupeByAccount(
        features
          .map((f) => cfg.mapRow(f.attributes))
          .filter((r): r is ParcelRow => r !== null && r.property_address.trim() !== ""),
      );
      await upsertRows(rows);
      pulled += features.length;
      upserted += rows.length;
      offset += features.length;
      if (features.length < cfg.pageSize) break; // last real page, even if short of totalCount
    }

    const done = offset >= totalCount;
    await setProgress(cfg.cad, {
      next_offset: done ? 0 : offset, // loop back to 0 next run once a full pass completes
      total_count: totalCount,
      last_run_at: new Date().toISOString(),
      done_through_at: done ? new Date().toISOString() : null,
      last_error: null,
    });

    return new Response(
      JSON.stringify({ cad: cfg.cad, offset, totalCount, pulled, upserted, done }),
      { status: 200, headers: corsHeaders },
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
