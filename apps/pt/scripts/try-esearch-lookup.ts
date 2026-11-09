// Try the statewide lookup + esearch record page for any Texas address,
// locally, with the same code the cad-lookup edge function runs — no deploy.
//
//   npx deno run -A apps/pt/scripts/try-esearch-lookup.ts "6734 FM 326, Lufkin, TX 75901"
//
// Prints what the app would show: the State's record, the direct record link,
// and the deed / value history read from the county's own esearch page.
import { statewideLookup } from "../../../supabase/pt/functions/_shared/statewide-parcels.ts";
import { esearchSite, fetchEsearchRecord } from "../../../supabase/pt/functions/_shared/esearch-record.ts";

const address = Deno.args.join(" ").trim();
if (!address) {
  console.log('Usage: npx deno run -A apps/pt/scripts/try-esearch-lookup.ts "<street, city, TX zip>"');
  Deno.exit(1);
}

const r = await statewideLookup(address);
if (!r) {
  console.log("Not found in the State parcel layer (address not geocoded, or not in Texas).");
  Deno.exit(0);
}
if (r.matched !== true) {
  const list = r.matched === "multiple" ? r.options : r.nearby;
  console.log(`No single match (${r.matched === "multiple" ? "several accounts" : "nearby parcels only"}):`);
  for (const o of list) console.log(`  ${o.propertyAddress} — ${o.ownerName} (#${o.accountNumber})`);
  Deno.exit(0);
}

const rec = r.record;
const county = rec.cad.replace(/\s*(central\s+|county\s+)?appraisal district$/i, "").replace(/\s+cad$/i, "").trim();
console.log(`Address:  ${rec.propertyAddress}`);
console.log(`Owner:    ${rec.ownerName}`);
console.log(`District: ${rec.cad}  (account #${rec.accountNumber})`);
console.log(`Value:    ${rec.totalValue?.toLocaleString() ?? "—"} (${rec.taxYear ?? "?"})`);

const site = esearchSite(county);
if (!site) {
  console.log(`\n${county} is not one of the verified esearch counties — the app links to the district's website only.`);
  Deno.exit(0);
}
if (!rec.accountNumber || !/^[A-Z]?\d+$/i.test(rec.accountNumber)) {
  console.log(`\nAccount number "${rec.accountNumber}" isn't an esearch property ID — no direct link.`);
  Deno.exit(0);
}

const link = `${site.origin}/Property/View/${rec.accountNumber}`;
console.log(`Record:   ${link}`);
const page = await fetchEsearchRecord(site.origin, rec.accountNumber, rec.ownerName, 15000);
if (!page) {
  console.log("\nThe record page couldn't be read or didn't show this owner — nothing attached.");
  Deno.exit(0);
}
console.log(`\nValue history (${page.valueHistory.length} years):`);
for (const y of page.valueHistory)
  console.log(`  ${y.year}  land ${y.landValue?.toLocaleString() ?? "—"}  impr ${y.improvementValue?.toLocaleString() ?? "—"}  market ${y.marketValue?.toLocaleString() ?? "—"}  appraised ${y.appraisedValue?.toLocaleString() ?? "—"}`);
console.log(`\nDeed history (${page.deeds.length}):`);
for (const d of page.deeds)
  console.log(`  ${d.date ?? "—"}  ${d.description ?? d.type ?? ""}  ${d.seller ?? "—"} → ${d.buyer ?? "—"}  #${d.instrumentNum ?? "—"}`);
