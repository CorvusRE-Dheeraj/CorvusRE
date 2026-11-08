import { describe, expect, it } from "vitest";
import {
  parseValueHistory,
  TRUEPRODIGY_OFFICE,
} from "../../../../supabase/pt/functions/_shared/tax-history";

// Real tables (Grayson CAD esearch, Bexar CAD True Automation), 2026-11-08.
const ESEARCH = `<h2>Value History</h2><a>Back to Top</a><table><tr><th>Year</th><th>Improvements</th><th>Land</th><th>Market</th><th>Ag Valuation</th><th>Appraised</th><th>HS Cap Loss</th><th>Assessed</th></tr>
<tr><td>2027</td><td>N/A</td><td>N/A</td><td>N/A</td><td>N/A</td><td>N/A</td><td>N/A</td></tr>
<tr><td>2026</td><td>$1,479,092</td><td>$173,308</td><td>$0</td><td>$1,652,400</td><td>$0</td><td>$1,652,400</td></tr>
<tr><td>2025</td><td>$1,479,092</td><td>$173,308</td><td>$0</td><td>$1,652,400</td><td>$0</td><td>$1,652,400</td></tr>
<tr><td>2024</td><td>$1,281,521</td><td>$173,308</td><td>$0</td><td>$1,454,829</td><td>$0</td><td>$1,454,829</td></tr>
<tr><td>2023</td><td>$1,247,461</td><td>$173,308</td><td>$0</td><td>$1,420,769</td><td>$0</td><td>$1,420,769</td></tr>
<tr><td>2022</td><td>$814,625</td><td>$173,308</td><td>$0</td><td>$987,933</td><td>$0</td><td>$987,933</td></tr>
<tr><td>2021</td><td>$777,051</td><td>$156,176</td><td>$0</td><td>$933,227</td><td>$0</td><td>$933,227</td></tr>
<tr><td>2020</td><td>$777,051</td><td>$156,176</td><td>$0</td><td>$933,227</td><td>$0</td><td>$933,227</td></tr>
</table><h2>Property Deed History</h2><table><tr><td>9/26/2022</td><td>WD</td><td>2022 12345 67890 11111 22222 33333</td></tr></table>`;

const TRUEAUTO = `<td>Value History</td> <table><tr><td>Year</td><td>Improvements</td><td>Land</td><td>Market</td><td>Ag Valuation</td><td>Appraised</td><td>HS Cap</td><td>Assessed</td></tr>
<tr><td>2027</td><td>N/A</td><td>N/A</td><td>N/A</td><td>N/A</td><td>N/A</td><td>N/A</td></tr>
<tr><td>2026</td><td>$1,117,830</td><td>$1,832,170</td><td>0</td><td>2,950,000</td><td>$0</td><td>$2,950,000</td></tr>
<tr><td>2025</td><td>$1,167,830</td><td>$1,832,170</td><td>0</td><td>3,000,000</td><td>$0</td><td>$3,000,000</td></tr>
</table><script>var y = "2024 1 2 3 4 5 6";</script>`;

describe("tax history sources", () => {
  it("reads the esearch Value History table, newest first, at most six years", () => {
    const years = parseValueHistory(ESEARCH);
    expect(years.map((y) => y.year)).toEqual([2026, 2025, 2024, 2023, 2022, 2021]);
    expect(years[0]).toEqual({
      year: 2026,
      marketValue: 1652400,
      appraisedValue: 1652400,
      taxableValue: 1652400,
      rate: null,
      tax: null,
      exact: true,
    });
    expect(years[4].appraisedValue).toBe(987933);
  });

  it("reads the True Automation table and ignores scripts and the N/A year", () => {
    const years = parseValueHistory(TRUEAUTO);
    expect(years.map((y) => y.year)).toEqual([2026, 2025]);
    expect(years[1].marketValue).toBe(3000000);
    expect(years[1].taxableValue).toBe(3000000);
  });

  it("returns nothing for a page without the table", () => {
    expect(parseValueHistory("<html>Property search</html>")).toEqual([]);
  });

  it("knows the TrueProdigy counties", () => {
    expect(Object.keys(TRUEPRODIGY_OFFICE).sort()).toEqual([
      "denton",
      "montgomery",
      "tarrant",
      "travis",
    ]);
  });
});
