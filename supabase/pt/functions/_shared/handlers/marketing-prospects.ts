// County prospecting for the Marketing CRM — served by the admin-update-plan
// router as ?action=marketing-prospects (Supabase's 100-function limit).
//
// Body: { county, minValue, includeIndustrial?, limit? }
// → { county, cad, sourceUrl, fetchedAt, records, excluded }
//
// Reads commercial (Texas state code F1, optionally industrial F2) parcels at
// or above a value straight from the county appraisal district's own public
// parcel layer — the same ArcGIS sources cad-lookup / cad-owner-search use.
// Only counties whose public layer publishes BOTH a value and a property
// class are offered; nothing is estimated or filled in. Government and other
// exempt owners are left out (they don't pay property tax).
//
// Marketing Admin / Super Admin only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders });

type A = Record<string, string | number | null>;
export type Prospect = {
  ownerName: string | null;
  propertyAddress: string;
  city: string | null;
  zip: string | null;
  county: string;
  cad: string;
  accountNumber: string | null;
  stateCode: string | null;
  propertyType: string;
  assessedValue: number | null;
  priorValue: number | null;
  valueYear: number | null;
  mailingAddress: string | null;
};

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const s = (v: unknown) => (v == null ? "" : String(v).trim());
const join = (...p: unknown[]) => p.map(s).filter(Boolean).join(" ").replace(/\s+/g, " ").trim() || null;
const typeOf = (code: string | null) =>
  !code ? "Commercial" : /F2/i.test(code) ? "Industrial" : /F1/i.test(code) ? "Commercial" : `Commercial (${code})`;

type County = {
  cad: string;
  url: string;
  where: (min: number, industrial: boolean) => string;
  out: string;
  order: string;
  map: (a: A) => Omit<Prospect, "county" | "cad">;
};

const COUNTIES: Record<string, County> = {
  Harris: {
    cad: "Harris Central Appraisal District",
    url: "https://www.gis.hctx.net/arcgis/rest/services/HCAD/Parcels/MapServer/0",
    where: (m, ind) => `(state_class LIKE 'F1%'${ind ? " OR state_class LIKE 'F2%'" : ""}) AND total_appraised_val >= ${m}`,
    out: "owner_name_1,site_str_num,site_str_name,site_str_sfx,site_city,site_zip,state_class,total_appraised_val,acct_num,tax_year,mail_addr_1,mail_addr_2,mail_city,mail_state,mail_zip",
    order: "total_appraised_val DESC",
    map: (a) => ({
      ownerName: s(a.owner_name_1) || null,
      propertyAddress: [join(a.site_str_num, a.site_str_name, a.site_str_sfx), s(a.site_city), join("TX", a.site_zip)].filter(Boolean).join(", "),
      city: s(a.site_city) || null,
      zip: s(a.site_zip).slice(0, 5) || null,
      accountNumber: s(a.acct_num) || null,
      stateCode: s(a.state_class) || null,
      propertyType: typeOf(s(a.state_class)),
      assessedValue: num(a.total_appraised_val),
      priorValue: null,
      valueYear: num(a.tax_year),
      mailingAddress: [join(a.mail_addr_1, a.mail_addr_2), join(a.mail_city, a.mail_state, a.mail_zip)].filter(Boolean).join(", ") || null,
    }),
  },
  Collin: {
    cad: "Collin Central Appraisal District",
    url: "https://services2.arcgis.com/uXyoacYrZTPTKD3R/ArcGIS/rest/services/CCAD_Parcel_Feature_Set/FeatureServer/4",
    // the newest roll may not be valued yet — then the latest values sit in prevVal*
    where: (m, ind) =>
      `propCategoryCode IN ('F1'${ind ? ",'F2'" : ""}) AND (currValAppraised >= ${m} OR (currValAppraised IS NULL AND prevValAppraised >= ${m})) AND propUseCode <> 'EXEMPT'`,
    out: "ownerName,situsConcat,situsCity,situsZip,propCategoryCode,PROP_ID,currValYear,currValAppraised,prevValYear,prevValAppraised,ownerAddrLine1,ownerAddrLine2,ownerAddrCity,ownerAddrState,ownerAddrZip",
    order: "prevValAppraised DESC",
    map: (a) => {
      const cur = num(a.currValAppraised);
      return {
        ownerName: s(a.ownerName) || null,
        propertyAddress: s(a.situsConcat).replace(/\s+,/g, ","),
        city: s(a.situsCity) || null,
        zip: s(a.situsZip).slice(0, 5) || null,
        accountNumber: s(a.PROP_ID) || null,
        stateCode: s(a.propCategoryCode) || null,
        propertyType: typeOf(s(a.propCategoryCode)),
        assessedValue: cur ?? num(a.prevValAppraised),
        priorValue: cur != null ? num(a.prevValAppraised) : null,
        valueYear: cur != null ? num(a.currValYear) : num(a.prevValYear),
        mailingAddress: [join(a.ownerAddrLine1, a.ownerAddrLine2), join(a.ownerAddrCity, a.ownerAddrState, a.ownerAddrZip)].filter(Boolean).join(", ") || null,
      };
    },
  },
  Denton: {
    cad: "Denton Central Appraisal District",
    url: "https://gis.dentoncounty.gov/arcgis/rest/services/Parcels_FC/MapServer/0",
    where: (m, ind) => `(stateCodes LIKE '%F1%'${ind ? " OR stateCodes LIKE '%F2%'" : ""}) AND ownerAppraisedValue >= ${m}`,
    out: "name,situs_full_address,situsCity,situsZip,stateCodes,ownerAppraisedValue,pid,pYear,addrDeliveryLine,addrCity,addrState,addrZip",
    order: "ownerAppraisedValue DESC",
    map: (a) => ({
      ownerName: s(a.name) || null,
      propertyAddress: s(a.situs_full_address),
      city: s(a.situsCity) || null,
      zip: s(a.situsZip).slice(0, 5) || null,
      accountNumber: s(a.pid) || null,
      stateCode: s(a.stateCodes) || null,
      propertyType: typeOf(s(a.stateCodes)),
      assessedValue: num(a.ownerAppraisedValue),
      priorValue: null,
      valueYear: num(a.pYear),
      mailingAddress: [s(a.addrDeliveryLine), join(a.addrCity, a.addrState, a.addrZip)].filter(Boolean).join(", ") || null,
    }),
  },
  "Fort Bend": {
    cad: "Fort Bend Central Appraisal District",
    url: "https://services2.arcgis.com/D4saGHECICkCeoJm/arcgis/rest/services/FBCAD_Public_Data/FeatureServer/0",
    where: (m, ind) =>
      `(Building_SPTB_Code LIKE 'F1%' OR Land_State_Code LIKE 'F1%'${ind ? " OR Building_SPTB_Code LIKE 'F2%' OR Land_State_Code LIKE 'F2%'" : ""}) AND TOTALVALUE >= ${m}`,
    out: "OWNERNAME,SITUS,Land_State_Code,Building_SPTB_Code,TOTALVALUE,PROPNUMBER,OADDR1,OADDR2,OWNERCITY,OWNERSTATE,OWNERZIP",
    order: "TOTALVALUE DESC",
    map: (a) => {
      const situs = s(a.SITUS).replace(/\s+/g, " ");
      const code = s(a.Building_SPTB_Code) || s(a.Land_State_Code);
      return {
        ownerName: s(a.OWNERNAME) || null,
        propertyAddress: situs,
        city: situs.match(/,\s*([^,]+?),?\s+TX/i)?.[1] ?? null,
        zip: situs.match(/(\d{5})\s*$/)?.[1] ?? null,
        accountNumber: s(a.PROPNUMBER) || null,
        stateCode: code || null,
        propertyType: typeOf(code),
        assessedValue: num(a.TOTALVALUE),
        priorValue: null,
        valueYear: null,
        mailingAddress: [join(a.OADDR1, s(a.OADDR2) === s(a.OADDR1) ? null : a.OADDR2), join(a.OWNERCITY, a.OWNERSTATE, a.OWNERZIP)].filter(Boolean).join(", ") || null,
      };
    },
  },
  Williamson: {
    cad: "Williamson Central Appraisal District",
    url: "https://services1.arcgis.com/Xff0bbfp6vwIWmlU/arcgis/rest/services/WCAD_Tax_Parcels/FeatureServer/0",
    // WCAD's own use codes: C* = commercial. No separate industrial class published.
    where: (m) => `USECD LIKE 'C%' AND (CNTASSDVAL >= ${m} OR PRVASSDVAL >= ${m})`,
    out: "OWNERNME1,OWNERNME2,SITEADDRESS,USECD,CNTASSDVAL,PRVASSDVAL,PropertyID,PSTLADDRESS,PSTLCITY,PSTLSTATE,PSTLZIP5",
    order: "PRVASSDVAL DESC",
    map: (a) => {
      const cur = num(a.CNTASSDVAL);
      const site = s(a.SITEADDRESS).replace(/\s+/g, " ");
      return {
        ownerName: join(a.OWNERNME1, a.OWNERNME2 ? `& ${a.OWNERNME2}` : null),
        propertyAddress: site,
        city: site.match(/,\s*([^,]+?),?\s+TX/i)?.[1] ?? null,
        zip: site.match(/(\d{5})\s*$/)?.[1] ?? null,
        accountNumber: s(a.PropertyID) || null,
        stateCode: s(a.USECD) || null,
        propertyType: `Commercial (WCAD ${s(a.USECD)})`,
        assessedValue: cur ?? num(a.PRVASSDVAL),
        priorValue: cur != null ? num(a.PRVASSDVAL) : null,
        valueYear: null,
        mailingAddress: [s(a.PSTLADDRESS), join(a.PSTLCITY, a.PSTLSTATE, a.PSTLZIP5)].filter(Boolean).join(", ") || null,
      };
    },
  },
};
export const PROSPECT_COUNTIES = Object.keys(COUNTIES);

// Government and other exempt owners don't pay property tax — never prospects.
const EXEMPT_OWNER =
  /\b(CITY OF|COUNTY|STATE OF|STATE HWY|ISD|INDEPENDENT SCHOOL|SCHOOL DIST|COLLEGE|UNIV|UNIVERSITY|HOSPITAL DIST|CHURCH|DIOCESE|BAPTIST|METHODIST|CATHOLIC|UNITED STATES|USA\b|FEDERAL|HOUSING AUTH|WATER DIST|MUD\b|MUNICIPAL UTIL|DRAINAGE|PORT OF|TRANSIT|AIRPORT AUTH|SPORTS AUTH|TOWN OF|VILLAGE OF)\b/i;

async function fetchLayer(c: County, min: number, industrial: boolean, limit: number, outFields: string) {
  const p = new URLSearchParams({
    where: c.where(min, industrial),
    outFields,
    orderByFields: c.order,
    resultRecordCount: String(limit),
    returnGeometry: "false",
    f: "json",
  });
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 25_000);
  try {
    const res = await fetch(`${c.url}/query?${p}`, { signal: ctl.signal });
    const j = (await res.json()) as { features?: { attributes: A }[]; error?: { message?: string } };
    if (j.error) throw new Error(j.error.message ?? "query failed");
    return j.features ?? [];
  } finally {
    clearTimeout(t);
  }
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: "unauthenticated" }, 401);
    const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: p } = await db.from("profiles").select("is_admin, marketing_admin").eq("id", user.id).single();
    if (!p?.is_admin && !p?.marketing_admin) return json({ error: "not authorized" }, 403);

    const body = (await req.json().catch(() => ({}))) as {
      county?: string;
      minValue?: number;
      includeIndustrial?: boolean;
      limit?: number;
    };
    if (!body.county) return json({ counties: PROSPECT_COUNTIES });
    const c = COUNTIES[body.county];
    if (!c) return json({ error: `County prospecting isn't available for ${body.county} — its public parcel data doesn't publish values and property classes. Import a list or research owners instead.` }, 400);
    const min = Math.max(250_000, Math.round(Number(body.minValue) || 1_000_000));
    const limit = Math.min(500, Math.max(10, Math.round(Number(body.limit) || 200)));
    let features: { attributes: A }[];
    try {
      features = await fetchLayer(c, min, !!body.includeIndustrial, limit, c.out);
    } catch {
      // a layer that rejects one optional field: retry with every field
      features = await fetchLayer(c, min, !!body.includeIndustrial, limit, "*");
    }
    let excluded = 0;
    const seen = new Set<string>();
    const records: Prospect[] = [];
    for (const f of features) {
      const r = { ...c.map(f.attributes), county: body.county, cad: c.cad };
      if (!r.ownerName || EXEMPT_OWNER.test(r.ownerName)) {
        excluded++;
        continue;
      }
      const key = `${r.accountNumber}|${r.ownerName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      records.push(r);
    }
    return json({
      county: body.county,
      cad: c.cad,
      sourceUrl: c.url,
      fetchedAt: new Date().toISOString(),
      minValue: min,
      records,
      excluded,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "County records didn't respond — try again." }, 502);
  }
}
