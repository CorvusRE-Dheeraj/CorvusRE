// Rebuilds src/data/tx-cad-directory.json from the Texas Comptroller's official
// property tax county directory (https://comptroller.texas.gov/taxes/property-tax/county-directory/)
// — one page per county with its appraisal district and tax assessor-collector
// contacts. Run when the directory changes (it notes "Last Updated" per county):
//
//   node scripts/build-tx-cad-directory.mjs
//
// Fetches politely (one page at a time). Only facts printed on each page are
// kept; anything a page doesn't list is null.
import { writeFileSync } from "node:fs";

const BASE = "https://comptroller.texas.gov/taxes/property-tax/county-directory/";

const decode = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "–");
const text = (html) =>
  decode(html.replace(/<br\s*\/?>/gi, ", ").replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();

// One labeled field inside a block: <strong>Phone:</strong> ... <br />
function field(block, label) {
  const m = new RegExp(`<strong>${label}:</strong>([\\s\\S]*?)(<br|</p>)`, "i").exec(block);
  const v = m ? text(m[1]) : "";
  return v || null;
}
function href(block, label) {
  const m = new RegExp(`<strong>${label}:</strong>\\s*<a href="([^"]+)"`, "i").exec(block);
  return m ? decode(m[1]).trim() : null;
}
// <h4>Mailing Address</h4><p>...</p>
function addressAfter(block, heading) {
  const m = new RegExp(`<h4>\\s*${heading}\\s*</h4>\\s*<p>([\\s\\S]*?)</p>`, "i").exec(block);
  const v = m ? text(m[1]).replace(/,\s*,/g, ",").replace(/,\s*$/, "") : "";
  return v || null;
}

function office(block) {
  if (!block) return null;
  return {
    phone: field(block, "Phone"),
    email: href(block, "Email")?.replace(/^mailto:/i, "") ?? null,
    website: href(block, "Website"),
    mailingAddress: addressAfter(block, "Mailing Address"),
    streetAddress: addressAfter(block, "Street Address"),
  };
}

const index = await (await fetch(BASE)).text();
const links = [...index.matchAll(/<li><a href="([a-z]+)\.php">(\d{3}) ([^<]+)<\/a><\/li>/g)].map(
  ([, slug, code, name]) => ({ slug, code, name: decode(name).trim() }),
);
if (links.length < 250) throw new Error(`Expected ~254 counties, found ${links.length}`);

const counties = {};
for (const { slug, code, name } of links) {
  const html = await (await fetch(`${BASE}${slug}.php`)).text();
  const cadName =
    /<meta name="description" content="([^"]+?) information\.?"/i.exec(html)?.[1] ?? null;
  // The page has two columns: the appraisal district, then the tax assessor-collector.
  const columns = html.split(/<div class="medium-6 small-12 columns">/).slice(1);
  const cadBlock = columns.find((c) => /<h3>\s*Appraisal District\s*<\/h3>/i.test(c));
  const taxBlock = columns.find((c) => /<h3>\s*Tax Assessor/i.test(c));
  counties[code] = {
    county: name,
    slug,
    appraisalDistrict: cadName ? { name: decode(cadName), ...office(cadBlock) } : null,
    taxOffice: office(taxBlock),
  };
  await new Promise((r) => setTimeout(r, 150));
}

const json = JSON.stringify({
  source: BASE,
  builtAt: new Date().toISOString().slice(0, 10),
  counties,
});
writeFileSync(new URL("../src/data/tx-cad-directory.json", import.meta.url), json);
// The edge functions get their own copy (only supabase/functions is deployed) —
// retrieve-county-procedures uses it as the allowlist of official sites to read.
writeFileSync(
  new URL("../../../supabase/pt/functions/_shared/tx-cad-directory.json", import.meta.url),
  json,
);
console.log(`Wrote ${Object.keys(counties).length} counties.`);
