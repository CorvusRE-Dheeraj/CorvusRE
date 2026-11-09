import { describe, expect, it } from "vitest";
import {
  esearchSite,
  ownerToken,
  parseEsearchDeeds,
  parseEsearchValueHistory,
} from "../../../../supabase/pt/functions/_shared/esearch-record";
import { getCadRecordUrl, isDirectCadRecordUrl } from "./cad-record-url";
import { esearchRecordUrl, isEsearchPropertyId } from "./esearch-sites";

// Real markup: esearch.angelinacad.org/Property/View/74996, 2026-11-08
// (trimmed to the two tables; whitespace as served).
const ANGELINA = `
<div class="panel-heading"><i class="fa fa-bookmark"></i> Property Roll Value History
  <a class="pull-right back-top" href="#top"><i class="fa fa-arrow-up"></i> Back to Top</a></div>
<div class="table-responsive"><table class="table table-striped">
  <tr><th class="table-number">Year</th><th class="table-number">Improvements</th><th class="table-number">Land Market</th>
      <th class="table-number">Ag Valuation</th><th class="table-number">Appraised</th><th class="table-number">HS Cap Loss</th><th class="table-number">Assessed</th></tr>
  <tr><td class="table-number">2026</td><td class="table-number">$26,050</td><td class="table-number">$14,500</td>
      <td class="table-number">$150</td><td class="table-number">$26,200</td><td class="table-number">$0</td><td class="table-number">$26,200</td></tr>
  <tr><td class="table-number">2025</td><td class="table-number">$26,850</td><td class="table-number">$14,500</td>
      <td class="table-number">$150</td><td class="table-number">$27,000</td><td class="table-number">$0</td><td class="table-number">$27,000</td></tr>
</table></div>
<div class="panel-heading"><i class="fa fa-bookmark"></i> Property Deed History
  <a class="pull-right back-top" href="#top"><i class="fa fa-arrow-up"></i> Back to Top</a></div>
<div class="table-responsive"><table class="table table-striped">
  <tr><th class="table-number">Deed Date</th><th>Type</th><th>Description</th><th>Grantor</th><th>Grantee</th>
      <th class="table-number">Volume</th><th class="table-number">Page</th><th class="table-number">Number</th></tr>
  <tr><td class="table-number">8/15/2014</td><td>WDVL</td><td>WARRANTY DEED W/VENDOR&#x27;S LIEN</td>
      <td>SULLIVAN RONALD L ETUX</td><td>MATHIS WILLIAM M</td><td class="table-number"></td><td class="table-number"></td><td class="table-number">00320136</td></tr>
  <tr><td class="table-number">2/4/1994</td><td>SWD</td><td>SPECIAL WD</td><td>GODSEY LEWIS F JR ETUX JUDY</td>
      <td>SULLIVAN RONALD L ETUX</td><td class="table-number">956                 </td><td class="table-number">38                  </td><td class="table-number">52946</td></tr>
  <tr><td class="table-number">11/17/1993</td><td>WD</td><td>WARRANTY DEED</td><td>HAIRGROVE FRANK E ETUX RUTH ANN</td>
      <td>GODSEY LEWIS F JR ETUX JUDY</td><td class="table-number">943</td><td class="table-number">810</td><td class="table-number"></td></tr>
</table></div>`;

// Older layout (Grayson, see tax-history-sources.test.ts): a separate
// "Market" header whose cell every row leaves out — 8 headers, 7 cells.
const GRAYSON = `<h2>Value History</h2><table><tr><th>Year</th><th>Improvements</th><th>Land</th><th>Market</th><th>Ag Valuation</th><th>Appraised</th><th>HS Cap Loss</th><th>Assessed</th></tr>
<tr><td>2027</td><td>N/A</td><td>N/A</td><td>N/A</td><td>N/A</td><td>N/A</td><td>N/A</td></tr>
<tr><td>2026</td><td>$1,479,092</td><td>$173,308</td><td>$0</td><td>$1,652,400</td><td>$0</td><td>$1,652,400</td></tr>
</table>`;

describe("parseEsearchValueHistory", () => {
  it("reads the 'Land Market' layout as land, adding market = land + improvements", () => {
    expect(parseEsearchValueHistory(ANGELINA)).toEqual([
      {
        year: 2026,
        landValue: 14500,
        improvementValue: 26050,
        marketValue: 40550,
        appraisedValue: 26200,
      },
      {
        year: 2025,
        landValue: 14500,
        improvementValue: 26850,
        marketValue: 41350,
        appraisedValue: 27000,
      },
    ]);
  });

  it("maps the older layout by the cells rows actually have (no shift into HS Cap Loss)", () => {
    const rows = parseEsearchValueHistory(GRAYSON);
    expect(rows.map((r) => r.year)).toEqual([2026]); // the all-N/A 2027 row is skipped
    const [y] = rows;
    expect(y).toEqual({
      year: 2026,
      landValue: 173308,
      improvementValue: 1479092,
      marketValue: 1652400,
      appraisedValue: 1652400,
    });
  });

  it("returns nothing for a page without the table", () => {
    expect(parseEsearchValueHistory("<h1>Property not found</h1>")).toEqual([]);
  });
});

describe("parseEsearchDeeds", () => {
  it("reads every deed with ISO dates, seller/buyer and the instrument number", () => {
    const deeds = parseEsearchDeeds(ANGELINA);
    expect(deeds).toHaveLength(3);
    expect(deeds[0]).toEqual({
      date: "2014-08-15",
      type: "WDVL",
      description: "WARRANTY DEED W/VENDOR'S LIEN",
      seller: "SULLIVAN RONALD L ETUX",
      buyer: "MATHIS WILLIAM M",
      instrumentNum: "00320136",
    });
    expect(deeds[1].date).toBe("1994-02-04");
  });

  it("falls back to volume / page for older deeds with no instrument number", () => {
    expect(parseEsearchDeeds(ANGELINA)[2].instrumentNum).toBe("Vol 943, Pg 810");
  });

  it("returns nothing without a deed table", () => {
    expect(parseEsearchDeeds(GRAYSON)).toEqual([]);
  });
});

describe("ownerToken", () => {
  it("skips filler words", () => {
    expect(ownerToken("THE MATHIS WILLIAM M EST")).toBe("MATHIS");
    expect(ownerToken(null)).toBeNull();
  });
});

describe("verified esearch sites", () => {
  it("knows Angelina, not a county that failed verification", () => {
    expect(esearchSite("Angelina")?.origin).toBe("https://esearch.angelinacad.org");
    expect(esearchSite("Lubbock")).toBeNull();
  });

  it("only the State's PROP_ID opens a record — not its dashed GEO_ID", () => {
    expect(isEsearchPropertyId("74996")).toBe(true);
    expect(isEsearchPropertyId("R71735")).toBe(true);
    expect(isEsearchPropertyId("0680-028C-013-001-04")).toBe(false);
    expect(
      esearchRecordUrl("Angelina County Appraisal District", "0680-028C-013-001-04"),
    ).toBeNull();
  });
});

describe("getCadRecordUrl — standard-coverage esearch counties", () => {
  const cad = "Angelina County Appraisal District";

  it("links straight to the record by the State's PROP_ID", () => {
    expect(getCadRecordUrl({ cad, accountNumber: "74996" })).toBe(
      "https://esearch.angelinacad.org/Property/View/74996",
    );
    expect(isDirectCadRecordUrl(cad, "74996")).toBe(true);
  });

  it("falls back to the district's site (and an honest label) for a GEO_ID", () => {
    expect(getCadRecordUrl({ cad, accountNumber: "0680-028C-013-001-04" })).not.toContain(
      "/Property/View/",
    );
    expect(isDirectCadRecordUrl(cad, "0680-028C-013-001-04")).toBe(false);
  });

  it("leaves a county that failed verification on its homepage", () => {
    const url = getCadRecordUrl({
      cad: "Lubbock Central Appraisal District",
      accountNumber: "R71735",
    });
    expect(url).not.toContain("/Property/View/");
  });
});
