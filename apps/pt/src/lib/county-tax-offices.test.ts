import { describe, expect, it } from "vitest";
import {
  harrisAccount,
  parseHarrisReceipts,
  parseHarrisStatement,
} from "../../../../supabase/pt/functions/_shared/harris-tax-office";
import {
  parseTravisDue,
  parseTravisReceipts,
  parseTravisUnits,
} from "../../../../supabase/pt/functions/_shared/travis-tax-office";
import {
  connectedCounties,
  isTaxOfficeConnected,
} from "../../../../supabase/pt/functions/_shared/tax-office";

// Trimmed from hctax.net's TaxStatement page (2026-11-11).
const HARRIS_STATEMENT = `
<table class="values"><tr><td class="Subtitle">Account Number</td><td class="Subtitle">Current As Of:</td><td class="Subtitle">Assessed Owner</td></tr>
<tr><td class="Subtitle-Account"><b>135-024-003-0002 </b></td><td scope="row">November 09, 2026</td>
<td scope="row">SMITH JOHN <br />20414 KITTREDGE DR <br />HUMBLE TX 77338-1550 <br /> <br /></td></tr></table>
<table class="values"><tr><td class="Subtitle">Property Description</td><td class="Subtitle">Appraised Values</td><td class="Subtitle" id="notes">Notes/Exemptions</td></tr>
<tr><td scope="row">20414 KITTREDGE DR 77338<br />LT 2 BLK 3 <br />DEERBROOK ESTATES SEC 7 <br /></td>
<td scope="row"><table class="subtable">
<tr><td scope="row">Land - Market Value:</td><td scope="row">40,425 </td></tr>
<tr><td scope="row">Impr - Market Value:</td><td scope="row">228,977 </td></tr>
<tr><td scope="row">Total Market Value:</td><td scope="row">269,402 </td></tr>
<tr><td scope="row">Less Capped Mkt Value:</td><td scope="row">0 </td></tr>
</table></td>
<td scope="row">HOMESTEAD, VET<br />Our records indicate that your statement has been requested by a mortgage company.</td></tr></table>
<table class="jurdetails"><thead><tr><th scope="col">Taxing Jurisdiction</th><th>Exemption</th><th>Taxable Value</th><th>Tax Rate</th><th>Taxes</th></tr></thead>
<tbody><tr><td scope="row">Harris County</td><td scope="row">65,880</td><td scope="row">203,522</td><td scope="row">0.417500</td><td class="num">$849.70</td></tr>
<tr><td scope="row">Lone Star College System</td><td>33,552</td><td>235,850</td><td>0.105800</td><td class="num">$249.53</td></tr></tbody></table>
<table><tr><td>Total 2026 Taxes Due by January 31, 2027:</td><td>$1,099.23</td></tr>
<tr><td>Payments applied to 2026 taxes:</td><td>$500.00</td></tr>
<tr><td>Total Current Taxes Due:</td><td>$599.23</td></tr>
<tr><td>Prior year(s) taxes due (if any):</td><td>- $0.00</td></tr>
<tr><td>Total Amount Due For January 2027:</td><td>$599.23</td></tr></table>`;

describe("Harris County Tax Office", () => {
  it("reads the statement", () => {
    expect(parseHarrisStatement(HARRIS_STATEMENT)).toMatchObject({
      source: "harris",
      taxAccount: "1350240030002",
      ownerLines: ["SMITH JOHN", "20414 KITTREDGE DR", "HUMBLE TX 77338-1550"],
      siteAddress: "20414 KITTREDGE DR 77338",
      legal: "LT 2 BLK 3 DEERBROOK ESTATES SEC 7",
      landValue: 40425,
      improvementValue: 228977,
      marketValue: 269402,
      cappedValue: 0,
      exemptions: "HOMESTEAD, VET",
      taxYear: 2026,
      levy: 1099.23,
      yearAmountDue: 599.23,
      delinquentAfter: "2027-02-01",
      priorYearsDue: 0,
      totalDue: 599.23,
      jurisdictions: [
        { name: "Harris County", taxableValue: 203522, rate: 0.4175, levy: 849.7 },
        { name: "Lone Star College System", taxableValue: 235850, rate: 0.1058, levy: 249.53 },
      ],
    });
  });

  it("reads receipt dates and normalizes the account", () => {
    expect(
      parseHarrisReceipts(
        "<div>Tax Receipts</div><div>(By Calendar Year)</div><div>2025</div><div>Dec 31, 2025</div><div>2024</div><div>Dec 26, 2024</div>",
      ),
    ).toEqual([
      { date: "2025-12-31", rollYear: 2025, amount: null, description: "Payment", payer: null },
      { date: "2024-12-26", rollYear: 2024, amount: null, description: "Payment", payer: null },
    ]);
    expect(harrisAccount("135-024-003-0002")).toBe("1350240030002");
    expect(harrisAccount("12")).toBeNull();
  });
});

describe("Travis County Tax Office (go2gov)", () => {
  it("reads amounts due, taxing units and receipts", () => {
    expect(
      parseTravisDue(
        "<table><tr><td>Tax Year</td><td>Base Due</td><td>Penalty /Interest</td><td>Total</td></tr><tr><td>2026</td><td>7400.38</td><td>$0.00</td><td>$0.00</td><td>$7,400.38</td></tr></table>",
      ),
    ).toEqual([{ year: 2026, baseDue: 7400.38, total: 7400.38 }]);
    expect(
      parseTravisUnits(
        "<table><tr><td>AUSTIN ISD</td><td>$847,000.00</td><td>$622,000.00</td><td>$1,530.73</td><td>$0.00</td><td>$0.00</td><td>$1,530.73</td></tr><tr><td>Total</td><td>$7,400.38</td><td>$0.00</td><td>$0.00</td><td>$7,400.38</td><td></td></tr></table>",
      ),
    ).toEqual([
      { name: "AUSTIN ISD", assessed: 847000, taxable: 622000, baseDue: 1530.73, total: 1530.73 },
    ]);
    expect(
      parseTravisReceipts(
        "<table><tr><td>Receipt</td><td>Tax Year</td><td>Payment Date</td><td>Payment Amount</td></tr><tr><td>15285623</td><td>2025</td><td>12/17/2025</td><td>7127.42</td></tr></table>",
      ),
    ).toEqual([
      {
        date: "2025-12-17",
        rollYear: 2025,
        amount: 7127.42,
        description: "Receipt 15285623",
        payer: null,
      },
    ]);
  });
});

describe("connected counties", () => {
  it("lists ACT counties plus Harris and Travis", () => {
    expect(isTaxOfficeConnected("Harris")).toBe(true);
    expect(isTaxOfficeConnected("travis")).toBe(true);
    expect(isTaxOfficeConnected("Bexar")).toBe(true);
    // behind a bot check — not read
    expect(isTaxOfficeConnected("Tarrant")).toBe(false);
    expect(isTaxOfficeConnected("Webb")).toBe(false);
    expect(connectedCounties()).toHaveLength(29);
  });
});
