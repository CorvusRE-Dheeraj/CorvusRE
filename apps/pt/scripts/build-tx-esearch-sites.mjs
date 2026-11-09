// Rebuilds src/data/tx-esearch-sites.json (and its copy in
// supabase/pt/functions/_shared/): the Texas appraisal districts whose public
// record site is BIS Consultants' "esearch" — {origin}/Property/View/{propId} —
// each one VERIFIED live, not assumed.
//
//   node scripts/build-tx-esearch-sites.mjs             (every candidate county)
//   node scripts/build-tx-esearch-sites.mjs Bell Rusk   (just these; merged in)
//
// Candidates come from the county coverage census (tx-county-coverage.json):
// the esearch site it found linked from the CAD's own website; for a BIS
// county where it found none, esearch.<the CAD's own domain> is tried.
//
// Verification, per county: take real parcels from the State's statewide
// parcel layer (TxGIO StratMap — the same source cad-lookup's statewide
// fallback uses) around the appraisal district's own office address, open
// {origin}/Property/View/{PROP_ID} for each, and accept the county only if the
// page answers without a session and shows that parcel's owner. That proves
// the State's PROP_ID is this site's property ID — so the app can link straight
// to the record and read its Value History / Deed History tables. Rerun yearly
// (sites move) and after the census is rebuilt.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "../src");
const outFiles = [
  path.join(src, "data/tx-esearch-sites.json"),
  path.join(here, "../../../supabase/pt/functions/_shared/tx-esearch-sites.json"),
];
const directory = JSON.parse(fs.readFileSync(path.join(src, "data/tx-cad-directory.json"), "utf8"));
const census = JSON.parse(fs.readFileSync(path.join(src, "data/tx-county-coverage.json"), "utf8"));

const only = new Set(process.argv.slice(2).map((s) => s.toLowerCase()));
const CONCURRENCY = 6;
const TRIES = 4; // parcels tried per county
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 CorvusPT-research";
const STRATMAP =
  "https://feature.geographic.texas.gov/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer";

const hostOf = (u) => new URL(u).hostname.replace(/^www\./, "");
const text = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

async function get(url, json = false) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA },
      redirect: "follow",
      signal: ctrl.signal,
    });
    return {
      status: r.status,
      url: r.url,
      body: r.ok ? (json ? await r.json() : await r.text()) : null,
    };
  } catch (e) {
    return { status: 0, url, body: null, error: String(e?.cause?.code ?? e?.name ?? e) };
  } finally {
    clearTimeout(t);
  }
}

// the CAD's esearch origin: linked from its own site (census), else a guess
// that verification will accept or reject
function candidateOrigin(entry, dir) {
  for (const e of entry?.cad?.evidence ?? []) {
    const u = e.url.split(" ")[0];
    try {
      if (/esearch/i.test(new URL(u).hostname)) return { origin: new URL(u).origin, how: "linked" };
    } catch {
      // not a URL
    }
  }
  const site = dir.appraisalDistrict?.website;
  if (!site) return null;
  return { origin: `https://esearch.${hostOf(site)}`, how: "guessed" };
}

async function geocode(address) {
  if (!address || /p\.?\s*o\.?\s*box/i.test(address)) return null;
  const r = await get(
    `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`,
    true,
  );
  return r.body?.result?.addressMatches?.[0]?.coordinates ?? null;
}

// Census TIGERweb: the county's internal point (always inside the county)
async function countyPoint(county) {
  const where = encodeURIComponent(`STATE='48' AND BASENAME='${county.replace(/'/g, "''")}'`);
  const r = await get(
    `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query?where=${where}&outFields=INTPTLAT,INTPTLON&returnGeometry=false&f=json`,
    true,
  );
  const a = r.body?.features?.[0]?.attributes;
  return a ? { x: Number(a.INTPTLON), y: Number(a.INTPTLAT) } : null;
}

async function parcelsNear({ x, y }, county) {
  const ext = [x - 0.004, y - 0.004, x + 0.004, y + 0.004].join(",");
  const r = await get(
    `${STRATMAP}/identify?geometry=${x},${y}&geometryType=esriGeometryPoint&sr=4326&layers=all:0&tolerance=120&mapExtent=${ext}&imageDisplay=600,600,96&returnGeometry=false&f=json`,
    true,
  );
  const seen = new Set();
  return (r.body?.results ?? [])
    .map((x) => x.attributes)
    .filter((a) => {
      const id = String(a.PROP_ID ?? "").trim();
      const owner = String(a.OWNER_NAME ?? "").trim();
      const ok =
        // numeric, or with a one-letter prefix ("R71735" — Lubbock, Erath, Fort Bend)
        /^[A-Z]?\d+$/i.test(id) &&
        owner &&
        !/^null$/i.test(owner) &&
        String(a.COUNTY ?? "").toLowerCase() === county.toLowerCase() &&
        !seen.has(id);
      seen.add(id);
      return ok;
    });
}

// first word of the owner name long enough to be distinctive ("SMITH")
const ownerToken = (owner) =>
  String(owner)
    .toUpperCase()
    .split(/[^A-Z]+/)
    .find(
      (w) => w.length >= 3 && !/^(THE|AND|LLC|INC|EST|ETAL|ETUX|TRUST|CITY|COUNTY|OF)$/.test(w),
    );

async function verify(dir, entry) {
  const cand = candidateOrigin(entry, dir);
  if (!cand) return { county: dir.county, verified: false, reason: "no candidate site" };

  // sample points: the district's office, the tax office, then the county's
  // own interior point (Census) — whichever first has State parcels with a PROP_ID
  let parcels = [];
  for (const where of [
    dir.appraisalDistrict?.streetAddress,
    dir.taxOffice?.streetAddress,
    "centroid",
  ]) {
    const point = where === "centroid" ? await countyPoint(dir.county) : await geocode(where);
    if (!point) continue;
    parcels = (await parcelsNear(point, dir.county)).slice(0, TRIES);
    if (parcels.length) break;
  }
  if (!parcels.length)
    return {
      county: dir.county,
      origin: cand.origin,
      verified: false,
      reason: "no state parcels with PROP_ID found",
    };

  const tried = [];
  for (const p of parcels) {
    const id = String(p.PROP_ID).trim();
    const token = ownerToken(p.OWNER_NAME);
    const r = await get(`${cand.origin}/Property/View/${id}`);
    const t = r.body ? text(r.body).toUpperCase() : "";
    const result = {
      propId: id,
      status: r.status,
      ownerShown: !!token && t.includes(token),
      valueHistory: /VALUE HISTORY/.test(t),
      deedHistory: /DEED HISTORY/.test(t),
    };
    tried.push(result);
    if (result.ownerShown && result.valueHistory) {
      const finalOrigin = r.url ? new URL(r.url).origin : cand.origin;
      return {
        county: dir.county,
        origin: finalOrigin,
        found: cand.how,
        verified: true,
        sampleId: id,
        deedHistory: result.deedHistory,
        // property-tax-history reads a record page only on the CAD's own
        // domain (or a subdomain) — false means it must allow this host too
        onCadDomain: dir.appraisalDistrict?.website
          ? hostOf(finalOrigin).endsWith(hostOf(dir.appraisalDistrict.website))
          : false,
      };
    }
    if (r.status === 0 || r.status >= 500) break; // site down — don't hammer it
  }
  return {
    county: dir.county,
    origin: cand.origin,
    found: cand.how,
    verified: false,
    reason: "record page didn't match",
    tried,
  };
}

async function run() {
  const isBis = (slug) => census.counties[slug]?.cad?.vendor === "bis-esearch";
  const all = Object.values(directory.counties)
    .filter((c) => isBis(c.slug) || candidateOrigin(census.counties[c.slug], c)?.how === "linked")
    .sort((a, b) => a.county.localeCompare(b.county));
  const todo = only.size ? all.filter((c) => only.has(c.county.toLowerCase())) : all;

  const previous = fs.existsSync(outFiles[0])
    ? JSON.parse(fs.readFileSync(outFiles[0], "utf8"))
    : null;
  const sites = only.size && previous ? { ...previous.sites } : {};
  const failed = only.size && previous ? { ...previous.notVerified } : {};

  let i = 0;
  let n = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (i < todo.length) {
        const c = todo[i++];
        const r = await verify(c, census.counties[c.slug]);
        n++;
        if (r.verified) {
          const { county, verified: _v, ...rest } = r;
          sites[c.slug] = { county, ...rest };
          delete failed[c.slug];
        } else {
          failed[c.slug] = r;
          delete sites[c.slug];
        }
        console.log(
          `[${String(n).padStart(3)}/${todo.length}] ${c.county.padEnd(14)} ${r.verified ? "OK " : "-- "} ${r.origin ?? ""} ${r.verified ? (r.deedHistory ? "deeds" : "no deeds") : r.reason}`,
        );
      }
    }),
  );

  const sort = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  const out = {
    source: "Verified live against TxGIO StratMap parcels by scripts/build-tx-esearch-sites.mjs",
    builtAt: new Date().toISOString().slice(0, 10),
    sites: sort(sites),
    notVerified: sort(failed),
  };
  const json = JSON.stringify(out, null, 1) + "\n";
  for (const f of outFiles) fs.writeFileSync(f, json);
  const list = Object.values(out.sites);
  console.log(
    `\nverified ${list.length} (deed history on ${list.filter((s) => s.deedHistory).length}, off the CAD's domain ${list.filter((s) => !s.onCadDomain).length}); not verified ${Object.keys(out.notVerified).length}`,
  );
}

run();
