// Deploy via CLI: `supabase functions deploy cad-comps`.
// No secrets required — same public TrueProdigy API used by cad-lookup's enrichment.
//
// Returns REAL nearby comparable properties for the "Comparable Sales & Market
// Analysis" AI module's map — never fabricated. Only works for the 4 counties on
// the TrueProdigy platform (Denton, Montgomery, Tarrant, Travis; see
// texas_cad_vendor_landscape memory) — Fort Bend/Grayson (BIS Consultants) and the
// other 5 counties have no confirmed equivalent "same subdivision" query today, so
// those return an empty comps list rather than guessing.
//
// Comps are properties sharing the subject's own "asCode" (the county's
// abstract/subdivision code) — a real grouping CADs themselves use, confirmed live
// 2026-07-28 (Denton: asCode "SF0503A" alone returned 936 rows spanning every year
// for every property in that one subdivision). Deduped to one row per property
// (its most recent year), the subject excluded, sorted by how close each comp's
// market value is to the subject's — the dimension that actually matters for a
// property-tax comps argument, not raw distance.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const TRUEPRODIGY_OFFICE_BY_CAD: Record<string, string> = {
  "Denton Central Appraisal District": "Denton",
  "Montgomery Central Appraisal District": "Montgomery",
  "Tarrant Appraisal District": "Tarrant",
  "Travis Central Appraisal District": "Travis",
};

type CompsInput = { cad?: string; accountNumber?: string };

type CompProperty = {
  pid: number;
  address: string;
  latitude: number;
  longitude: number;
  marketValue: number | null;
  ownerName: string | null;
  // Real fields on the same row already being fetched — never a second
  // request. See comps-analysis.ts for how these feed the comparable table
  // (land size / $-per-acre, last transfer date, similarity score) instead
  // of the sale price / building SF / adjustments Texas's non-disclosure law
  // makes unavailable from any free source (see cad-comps deploy comment).
  legalAcreage: number | null;
  landValue: number | null;
  improvementValue: number | null;
  appraisedValue: number | null;
  // The parcel's own most recent deed date — a real transfer date, but
  // never a sale price (Texas doesn't require one to be recorded). Labeled
  // "Last Transfer" in the UI, never "Sale Date", to not imply a price.
  lastTransferDt: string | null;
  // Raw CAD property-type code (e.g. "R", "C") — kept for the same/
  // different-type similarity signal only; never shown untranslated in the
  // UI since a wrong guessed label would be worse than no label.
  propType: string | null;
  // Populated inconsistently by CADs (often null) — shown only when present.
  zoning: string | null;
};

type CompsResult = {
  subject: (CompProperty & { asCode: string }) | null;
  comps: CompProperty[];
};

async function getToken(office: string): Promise<string> {
  const res = await fetch(
    "https://prod-container.trueprodigyapi.com/trueprodigy/cadpublic/auth/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ office }),
    },
  );
  if (!res.ok) throw new Error(`TrueProdigy auth failed for ${office}: ${res.status}`);
  const json = (await res.json()) as { user?: { token?: string } };
  const token = json.user?.token;
  if (!token) throw new Error(`TrueProdigy auth returned no token for ${office}`);
  return token;
}

function parseNum(v: unknown): number | null {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function toCompProperty(row: Record<string, unknown>): CompProperty | null {
  const lat = parseNum(row.latitude);
  const lon = parseNum(row.longitude);
  const pid = parseNum(row.pid);
  if (lat == null || lon == null || pid == null) return null;
  return {
    pid,
    address: (row.fullSitus as string) || (row.streetPrimary as string) || "",
    latitude: lat,
    longitude: lon,
    marketValue: parseNum(row.marketValue),
    ownerName: (row.name as string) || null,
    legalAcreage: parseNum(row.legalAcreage),
    landValue: parseNum(row.landValue),
    improvementValue: parseNum(row.improvementValue),
    appraisedValue: parseNum(row.appraisedValue),
    lastTransferDt: str(row.deedDt),
    propType: str(row.propType),
    zoning: str(row.zoning),
  };
}

// One property appears once per tax year it has a record for — keep only each
// pid's best row so a subdivision with 900+ historical rows collapses to one pin
// per real property. "Best" is the latest year that actually HAS a market value —
// the true latest pYear present is often next year's not-yet-assessed placeholder
// row (confirmed live: pid 740576's own "2027" row has every value field null),
// so picking by raw year alone would silently produce valueless comps.
function dedupeBestYear(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const byPid = new Map<number, Record<string, unknown>>();
  for (const row of rows) {
    const pid = parseNum(row.pid);
    if (pid == null) continue;
    const year = parseNum(row.pYear) ?? 0;
    const hasValue = parseNum(row.marketValue) != null;
    const score = (hasValue ? 1_000_000 : 0) + year;
    const existing = byPid.get(pid);
    if (!existing) {
      byPid.set(pid, row);
      continue;
    }
    const existingHasValue = parseNum(existing.marketValue) != null;
    const existingScore = (existingHasValue ? 1_000_000 : 0) + (parseNum(existing.pYear) ?? 0);
    if (score > existingScore) byPid.set(pid, row);
  }
  return [...byPid.values()];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const input = (await req.json()) as CompsInput;
    const office = input.cad ? TRUEPRODIGY_OFFICE_BY_CAD[input.cad] : undefined;
    const emptyResult: CompsResult = { subject: null, comps: [] };

    if (!office || !input.accountNumber) {
      return new Response(JSON.stringify(emptyResult), { status: 200, headers: corsHeaders });
    }
    const subjectPid = parseInt(input.accountNumber, 10);
    if (!Number.isFinite(subjectPid)) {
      return new Response(JSON.stringify(emptyResult), { status: 200, headers: corsHeaders });
    }

    const token = await getToken(office);
    const headers = { "Content-Type": "application/json", Authorization: token };

    const subjectRes = await fetch(
      "https://prod-container.trueprodigyapi.com/public/property/search",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ pid: { operator: "=", value: String(subjectPid) } }),
      },
    );
    if (!subjectRes.ok) {
      return new Response(JSON.stringify(emptyResult), { status: 200, headers: corsHeaders });
    }
    const subjectJson = (await subjectRes.json()) as { results?: Array<Record<string, unknown>> };
    const subjectRows = subjectJson.results ?? [];
    if (subjectRows.length === 0) {
      return new Response(JSON.stringify(emptyResult), { status: 200, headers: corsHeaders });
    }
    const [subjectBest] = dedupeBestYear(subjectRows);
    const asCode = subjectBest?.asCode as string | undefined;
    const subjectProp = subjectBest ? toCompProperty(subjectBest) : null;
    if (!asCode || !subjectProp) {
      return new Response(JSON.stringify(emptyResult), { status: 200, headers: corsHeaders });
    }

    const compsRes = await fetch(
      "https://prod-container.trueprodigyapi.com/public/property/search",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ asCode: { operator: "=", value: asCode } }),
      },
    );
    const compsJson = compsRes.ok
      ? ((await compsRes.json()) as { results?: Array<Record<string, unknown>> })
      : {};
    const dedupedRows = dedupeBestYear(compsJson.results ?? []);

    const comps = dedupedRows
      .filter((row) => parseNum(row.pid) !== subjectPid)
      .map(toCompProperty)
      .filter((c): c is CompProperty => c !== null)
      .sort((a, b) => {
        const subjectValue = subjectProp.marketValue ?? 0;
        const da = a.marketValue == null ? Infinity : Math.abs(a.marketValue - subjectValue);
        const db = b.marketValue == null ? Infinity : Math.abs(b.marketValue - subjectValue);
        return da - db;
      })
      .slice(0, 10);

    const result: CompsResult = { subject: { ...subjectProp, asCode }, comps };
    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
