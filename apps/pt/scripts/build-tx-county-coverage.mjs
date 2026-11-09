// Rebuilds src/data/tx-county-coverage.json: for every Texas county, which
// software its appraisal district's property search and its tax office's
// payment/statement site run on, plus what the app already covers there.
//
//   node scripts/build-tx-county-coverage.mjs             (all 254 counties)
//   node scripts/build-tx-county-coverage.mjs Bexar Rusk  (just these; merged
//                                                         into the existing file)
//
// Why: most Texas CADs and tax offices run one of a handful of vendor sites
// (esearch/BIS, True Automation, TrueProdigy, …). One adapter per vendor —
// instead of one integration per county — is how the app reaches all 254. This
// census says which vendor each county uses, so adapters are built in order of
// how many counties each unlocks.
//
// Method: starts from each county's appraisal-district and tax-office websites
// in the Comptroller's directory (src/data/tx-cad-directory.json), reads the
// home page and up to MAX_FOLLOW same-site pages that look like "property
// search" / "pay taxes" pages, and collects every link, iframe and form target.
// A vendor is recorded only from a URL actually found on the county's own site
// (kept as evidence). Nothing is inferred: a county whose site links to none of
// the known vendors stays "unknown", with the candidate search/payment hosts
// listed so they can be checked by hand. `hosts` in the summary counts every
// such host across all counties — new vendor families show up there.
// Rerun when adding a vendor adapter, and yearly.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "../src");
const outFile = path.join(src, "data/tx-county-coverage.json");
const directory = JSON.parse(fs.readFileSync(path.join(src, "data/tx-cad-directory.json"), "utf8"));

const only = new Set(process.argv.slice(2).map((s) => s.toLowerCase()));
const CONCURRENCY = 8;
const MAX_FOLLOW = 4;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 CorvusPT-research";

// ── Vendor signatures (matched against full URLs found on the county's site) ──
// Order matters: first match wins for a URL.
const CAD_VENDORS = [
  ["bis-esearch", /\/\/esearch\.|\/\/[^/]*esearch[^/]*\/|bisclient|bisconsultants/i],
  ["true-automation", /trueautomation\.com/i],
  ["trueprodigy", /prodigycad\.com|trueprodigy|\/property-detail\//i],
  ["pritchard-abbott", /pandai\.com/i],
  ["southwest-data", /iswdataclient|southwestdatasolution|swdsweb/i],
  ["capitol-appraisal", /capitol-?appraisal/i],
  ["harris-govern", /harrisgovern|\/\/[^/]*\.?publicaccess\.[^/]+/i],
];
const TAX_VENDORS = [
  ["act-tyler", /acttax\.com|actweb\./i],
  ["true-automation", /trueautomation\.com/i],
  ["bis-esearch", /\/\/esearch\.|bisclient/i],
  ["pritchard-abbott", /pandai\.com/i],
  ["propertytaxpayments", /propertytaxpayments\.net/i],
  ["go2gov", /go2gov\.net/i],
  ["tyler-portal", /tylertech\.cloud|tylerhost\.net|tylertech\.com/i],
  ["certified-payments", /certifiedpayments\.net/i],
  ["govtportal", /govtportal|govpaynet|govpay\.(net|com)/i],
  ["paymentus", /paymentus\.com/i],
  ["point-and-pay", /pointandpay\.com/i],
];

// Sites that render in the browser (Denton's ProdigyCAD) have no vendor
// links in their HTML — only the vendor's name in their scripts. Checked
// only when no link matched; recorded as "(page source)" evidence.
const SOURCE_SIGNS = {
  trueprodigy: /trueprodigy|prodigycad/i,
  "bis-esearch": /bisclient|bis\s*consultants/i,
  "true-automation": /trueautomation/i,
  "harris-govern": /harrisgovern/i,
  "act-tyler": /acttax/i,
};

// what a "property search" / "pay taxes" link looks like — used to pick which
// pages to follow and which unmatched hosts to list as candidates
const CAD_HINT =
  /property\s*search|search|lookup|records?|esearch|propaccess|clientdb|property-detail|account/i;
const TAX_HINT =
  /pay|payment|statement|tax\s*(search|lookup|bill|due)|account|lookup|search|clientdb/i;
const SKIP =
  /civicplus\.com|fema\.gov|\/\/(www\.)?texas\.gov|publicsearch\.us|vote\w*\.(gov|org|com)|facebook|twitter|x\.com|instagram|youtube|linkedin|google\.|apple\.com|microsoft\.com|adobe\.com|mailto:|tel:|comptroller\.texas\.gov|\.(jpg|jpeg|png|gif|svg|css|js|zip|docx?|xlsx?|pdf)($|\?)/i;

// ── What the app already covers (read from the source, not hand-copied) ──
const read = (p) => fs.readFileSync(path.join(src, p), "utf8");
const lower = (s) => s.toLowerCase();
const FULL = new Set(
  [
    ...read("lib/cad-record-url.ts").matchAll(
      /^\s+"([\w ]+?) (?:Central |County )?Appraisal District": "https?:/gm,
    ),
  ].map((m) => lower(m[1])),
);
const deedSrc = read("lib/deed-records.ts");
const DEEDS = new Set(
  [...deedSrc.matchAll(/^\s+(?:"([\w ]+)"|(\w+)):\s*(?:publicSearch\(|\{)/gm)].map((m) =>
    lower(m[1] ?? m[2]),
  ),
);
const ZONING = new Set(
  [...read("lib/city-zoning.ts").matchAll(/^\s+county: "([\w ]+)"/gm)].map((m) => lower(m[1])),
);
const PERMITS = new Set(
  [...read("lib/building-permits.ts").matchAll(/^\s+(\w+): \{\s*\n\s+label:/gm)].map((m) =>
    lower(m[1]),
  ),
);
const plans = JSON.parse(read("data/tx-payment-plans.json"));
const HALF = new Map(Object.values(plans.counties).map((c) => [lower(c.county), c.halfPayment]));

// ── fetching ──
const decode = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/g, "/");
const strip = (s) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

async function fetchPage(url, retry = true) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (r.status === 429 && retry) {
      clearTimeout(t);
      await new Promise((ok) => setTimeout(ok, 8000));
      return fetchPage(url, false);
    }
    const type = r.headers.get("content-type") ?? "";
    const html = r.ok && type.includes("html") ? await r.text() : "";
    return { url: r.url || url, status: r.status, html };
  } catch (e) {
    return { url, status: 0, html: "", error: String(e?.cause?.code ?? e?.name ?? e) };
  } finally {
    clearTimeout(t);
  }
}

async function fetchScript(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal });
    return r.ok ? await r.text() : "";
  } catch {
    return "";
  } finally {
    clearTimeout(t);
  }
}

// county sites are often listed as http:// (or https:// with a broken cert):
// try the listed URL, then the other scheme
async function fetchHome(website) {
  const first = await fetchPage(website);
  if (first.html) return first;
  const alt = website.startsWith("https:")
    ? website.replace(/^https:/, "http:")
    : website.replace(/^http:/, "https:");
  const second = await fetchPage(alt);
  return second.html ? second : first;
}

// every link / iframe / form target / scripted redirect on a page, with its label
function targets(html, base) {
  const out = [];
  const add = (raw, label) => {
    try {
      const u = new URL(decode(raw.trim()), base);
      if (!/^https?:$/.test(u.protocol)) return;
      u.hash = "";
      out.push({ url: u.href, label: label ?? "" });
    } catch {
      // not a URL
    }
  };
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi))
    add(m[1], strip(m[2]));
  for (const m of html.matchAll(/<(?:iframe|frame)\b[^>]*src\s*=\s*["']([^"']+)["']/gi))
    add(m[1], "iframe");
  for (const m of html.matchAll(/<form\b[^>]*action\s*=\s*["']([^"']+)["']/gi)) add(m[1], "form");
  for (const m of html.matchAll(
    /(?:window\.)?location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)["']/gi,
  ))
    add(m[1], "script");
  return out;
}

const hostOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
// "esearch.kaufman-cad.org" and "kaufman-cad.org" are the same site
const siteOf = (h) => h.split(".").slice(-2).join(".");

/** Read a county site and classify which vendor its search/payment links go to. */
async function survey(website, vendors, hint) {
  if (!website)
    return { website: null, reached: false, vendor: "no-website", evidence: [], candidates: [] };
  const home = await fetchHome(website);
  if (!home.html)
    return {
      website,
      reached: false,
      status: home.status,
      error: home.error ?? null,
      vendor: "unreachable",
      evidence: [],
      candidates: [],
    };

  const homeSite = siteOf(hostOf(home.url));
  const found = targets(home.html, home.url);
  const sources = [{ url: home.url, html: home.html }];
  // the home page itself may already be the vendor site (esearch.fbcad.org)
  found.push({ url: home.url, label: "home" });

  // follow a few same-site pages that look like the search / payment page
  const follow = [
    ...new Set(
      found
        .filter(
          (t) =>
            siteOf(hostOf(t.url)) === homeSite &&
            !SKIP.test(t.url) &&
            hint.test(`${t.label} ${t.url}`),
        )
        .map((t) => t.url),
    ),
  ].slice(0, MAX_FOLLOW);
  for (const url of follow) {
    const page = await fetchPage(url);
    if (page.html) {
      found.push(...targets(page.html, page.url), { url: page.url, label: "followed" });
      sources.push({ url: page.url, html: page.html });
    }
  }

  const hits = new Map(); // vendor -> evidence urls
  const candidates = new Set();
  for (const t of found) {
    if (SKIP.test(t.url)) continue;
    const v = vendors.find(([, re]) => re.test(t.url));
    if (v) {
      if (!hits.has(v[0])) hits.set(v[0], new Set());
      hits.get(v[0]).add(t.url);
    } else if (siteOf(hostOf(t.url)) !== homeSite && hint.test(`${t.label} ${t.url}`)) {
      candidates.add(hostOf(t.url));
    }
  }
  if (hits.size === 0) {
    const known = new Set(vendors.map(([v]) => v));
    // A browser-rendered app (a handful of links at most): its vendor shows
    // only in its own main script bundle — read that too.
    if (targets(home.html, home.url).length < 5) {
      const bundles = [...home.html.matchAll(/<script\b[^>]*src\s*=\s*["']([^"']+)["']/gi)]
        .map((m) => new URL(decode(m[1]), home.url).href)
        .filter((u) => siteOf(hostOf(u)) === homeSite && /(index|main|app)[.-][\w.]*\.js/i.test(u))
        .slice(0, 2);
      for (const url of bundles) {
        const js = await fetchScript(url);
        if (js) sources.push({ url, html: js });
      }
    }
    for (const [v, re] of Object.entries(SOURCE_SIGNS)) {
      if (!known.has(v)) continue;
      const page = sources.find((s) => re.test(s.html));
      if (page) hits.set(v, new Set([`${page.url} (page source)`]));
    }
  }
  const ranked = [...hits.entries()].sort((a, b) => b[1].size - a[1].size);
  return {
    website: home.url,
    reached: true,
    vendor: ranked[0]?.[0] ?? "unknown",
    // more than one vendor linked (e.g. CAD search + a separate payment portal)
    otherVendors: ranked.slice(1).map(([v]) => v),
    evidence: ranked.flatMap(([v, urls]) =>
      [...urls].slice(0, 3).map((url) => ({ vendor: v, url })),
    ),
    candidates: [...candidates].slice(0, 10),
  };
}

async function surveyCounty(c) {
  const key = lower(c.county);
  const [cad, taxOffice] = await Promise.all([
    survey(c.appraisalDistrict?.website ?? null, CAD_VENDORS, CAD_HINT),
    survey(c.taxOffice?.website ?? null, TAX_VENDORS, TAX_HINT),
  ]);
  return {
    county: c.county,
    cad,
    taxOffice,
    app: {
      fullIntegration: FULL.has(key),
      deedSearchLink: DEEDS.has(key),
      cityZoning: ZONING.has(key),
      buildingPermits: PERMITS.has(key),
      halfPaymentPlan: HALF.get(key) ?? "unknown",
    },
  };
}

async function run() {
  const all = Object.values(directory.counties).sort((a, b) => a.county.localeCompare(b.county));
  const todo = only.size ? all.filter((c) => only.has(lower(c.county))) : all;
  const previous =
    only.size && fs.existsSync(outFile)
      ? JSON.parse(fs.readFileSync(outFile, "utf8")).counties
      : {};
  const results = { ...previous };

  let i = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (i < todo.length) {
        const c = todo[i++];
        results[c.slug] = await surveyCounty(c);
        done++;
        const r = results[c.slug];
        console.log(
          `[${String(done).padStart(3)}/${todo.length}] ${c.county.padEnd(14)} CAD: ${r.cad.vendor.padEnd(17)} tax: ${r.taxOffice.vendor}`,
        );
      }
    }),
  );

  const counties = Object.fromEntries(
    Object.entries(results).sort(([a], [b]) => a.localeCompare(b)),
  );
  const list = Object.values(counties);
  const tally = (pick) =>
    Object.fromEntries(
      Object.entries(
        list.reduce((acc, c) => ((acc[pick(c)] = (acc[pick(c)] ?? 0) + 1), acc), {}),
      ).sort((a, b) => b[1] - a[1]),
    );
  const hostTally = (pick) =>
    Object.fromEntries(
      Object.entries(
        list.reduce((acc, c) => {
          for (const h of new Set(pick(c))) acc[h] = (acc[h] ?? 0) + 1;
          return acc;
        }, {}),
      )
        .filter(([, n]) => n >= 2) // a host on 2+ county sites hints at a shared vendor
        .sort((a, b) => b[1] - a[1]),
    );

  const summary = {
    counties: list.length,
    cadVendors: tally((c) => c.cad.vendor),
    taxOfficeVendors: tally((c) => c.taxOffice.vendor),
    app: {
      fullIntegration: list.filter((c) => c.app.fullIntegration).length,
      deedSearchLink: list.filter((c) => c.app.deedSearchLink).length,
      cityZoning: list.filter((c) => c.app.cityZoning).length,
      buildingPermits: list.filter((c) => c.app.buildingPermits).length,
      halfPaymentPlanKnown: list.filter((c) => c.app.halfPaymentPlan !== "unknown").length,
    },
    // unmatched hosts linked from 2+ counties' sites — likely vendors not in
    // the signature lists yet
    unmatchedCadHosts: hostTally((c) => c.cad.candidates),
    unmatchedTaxHosts: hostTally((c) => c.taxOffice.candidates),
  };

  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        source: directory.source,
        builtAt: new Date().toISOString().slice(0, 10),
        summary,
        counties,
      },
      null,
      1,
    ) + "\n",
  );
  console.log("\n" + JSON.stringify(summary, null, 2));
  console.log(`\nwrote ${path.relative(process.cwd(), outFile)}`);
}

run();
