// Rebuilds src/data/tx-tax-rates.json from the Texas Comptroller's official
// "Tax Rates and Levies" downloads (https://comptroller.texas.gov/taxes/property-tax/rates/),
// published each year under Tax Code §5.091. Run once a year when the new
// year's files are posted:
//
//   npm i --no-save xlsx@0.18.5
//   node scripts/build-tx-tax-rates.mjs 2025
//
// Keeps only what a property lookup can use without knowing the property's exact
// taxing units: each county's own rate, the cities in it (by name), and the school
// districts headquartered in it. Taxing-unit IDs are CCC-NNN-TT, where CCC is the
// county number and TT the unit type: 00 county, 02 school district, 03 city.
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const year = Number(process.argv[2]);
if (!year) throw new Error("Usage: node scripts/build-tx-tax-rates.mjs <year>");

const base = "https://comptroller.texas.gov/taxes/property-tax/docs";

async function sheetRows(file) {
  const res = await fetch(`${base}/${file}`);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const wb = XLSX.read(new Uint8Array(await res.arrayBuffer()), { type: "array" });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
}

const norm = (s) =>
  String(s)
    .replace(/\*+/g, "")
    .replace(/^City of\s+/i, "")
    .trim()
    .toLowerCase();

// County names keyed by county number, from the county file ("COUNTY ID", "COUNTY NAME").
const countyRows = await sheetRows(`${year}-county-rates-levies.xlsx`);
const header = countyRows.findIndex((r) => r.includes("COUNTY ID"));
const idCol = countyRows[header].indexOf("COUNTY ID");
const nameCol = countyRows[header].indexOf("COUNTY NAME");
const counties = {};
for (const r of countyRows.slice(header + 1)) {
  const code = String(r[idCol]).padStart(3, "0");
  if (/^\d{3}$/.test(code) && r[nameCol]) {
    counties[code] = { name: String(r[nameCol]).trim(), countyRate: null, cities: {}, isds: [] };
  }
}

// Every taxing unit's total rate (per $100 of taxable value).
const totalRows = await sheetRows(`${year}-total-rates-levies.xlsx`);
for (const [name, id, rate] of totalRows) {
  const m = /^(\d{3})-\d{3}-(\d{2})$/.exec(String(id).trim());
  if (!m || typeof rate !== "number") continue;
  const c = counties[m[1]];
  if (!c) continue;
  if (m[2] === "00") c.countyRate = rate;
  else if (m[2] === "03") c.cities[norm(name)] = rate;
  else if (m[2] === "02") c.isds.push([String(name).replace(/\*+/g, "").trim(), rate]);
}

const out = {
  year,
  source: `${base}/${year}-total-rates-levies.xlsx`,
  ratesPer: 100,
  counties,
};
writeFileSync(new URL("../src/data/tx-tax-rates.json", import.meta.url), JSON.stringify(out));
console.log(`Wrote ${Object.keys(counties).length} counties for ${year}.`);
