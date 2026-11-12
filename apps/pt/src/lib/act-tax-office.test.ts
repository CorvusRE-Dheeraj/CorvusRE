import { describe, expect, it } from "vitest";
import {
  ACT_COUNTIES,
  accountLinks,
  accountsInList,
  accountsInJsonList,
  baseDueByYear,
  isoDate,
  moneyValue,
  parseAccountPage,
  parseJurisdictions,
  parsePayments,
  type TaxOfficeStatement,
} from "../../../../supabase/pt/functions/_shared/act-tax-office";
import { buildPayTaxesRow, officeStatus } from "./pay-taxes";
import { taxOfficeConnected } from "./tax-office-statements";
import type { PropertyRecord } from "./properties";

// Trimmed from the live pages (2026-11-11): Bexar = the newer ACT layout,
// Galveston = the older one.
const BEXAR_DETAIL = `
<label style="font-weight:bold">ALL DATA REFERS TO TAX INFORMATION FOR 2026.</label>
<div>
  <label>Account Number:</label>
  177280090010
</div>
<div><label>Address:</label>
  <br>
  PINNACLE MONTESSORI LLC<br/>18740 WAINSBOROUGH LN<br/>DALLAS,TX 752875525
</div>
<div><label>Property Site Address:</label><br>
  19730 BULVERDE RD</div>
<div><label>Legal Description:</label><br>NCB 17728 BLK 9 LOT 1 1.977AC (THE<br/>PINNACLE MONTESSORI SCHOOL)<br/></div>
<div><label>
    2026 Year Tax Levy:
  </label>
  $71,314.39</div>
<div><label>2026 Year Amount Due:</label> &nbsp; $71,314.39</div>
<div><label>Delinquent After:</label> 02/01/2027</div>
<div><label>Half Payment Option Amount (1/2 of Current Tax Levy):</label>
  &nbsp; $35,657.20 <br> * Deadline November 30, 2026</div>
<div><label>Prior Year(s) Amount Due:</label> $0.00</div>
<div style="color:red;"><label> Total Amount Due:</label> $71,314.39</div>
<div><label> Last Payment Amount Received:</label> $53,303.27</div>
<div><label>Last Payer:</label><br> ALEX FREEMAN</div>
<div><label>Last Payment Date:</label>&nbsp;<br> 09/22/2026</div>
<div style="display: none"><label>Active Lawsuits:</label> None</div>
<a target="_blank" href="http://bexar.trueautomation.com/mapSearch/?cid=110&p=1149803">Show Map</a>
<div><label>Pending Credit Card or eCheck Payments:</label><br>No Payment Pending</div>
<form action="https://magic.collectorsolutions.com/magic-ui/en-US/Login/bexar-county-tax-collector"></form>
<a target="_blank" href="requests/currentstatement/prepare.jsp?can=177280090010&ownerno=0">statement</a>
<div><label>Total Market Value:</label> $3,100,000</div>
<div><label>Land Value:</label> $1,416,640</div>
<div><label>Improvement Value:</label> $1,683,360</div>
<div><label>Capped Value:</label> $0</div>
<div><label>Agricultural Value:</label> $0</div>
<div><label>Exemptions (current year only):</label><br>None</div>
<a href="reports/jurisdictiondetail.jsp?can=177280090010&ownerno=0">Jurisdiction Details</a>
<a href="reports/paymentinfo.jsp?can=177280090010&ownerno=0">Payment History</a>`;

const BEXAR_JURISDICTIONS = `<table><thead><tr><th>Roll Year</th><th>Jurisdiction Name</th></tr></thead><tbody>
<tr><td data-label="Roll Year">2026</td><td data-label="Jurisdiction Name">NORTH EAST ISD</td>
<td data-label="Taxable Value">$3,100,000.00</td><td data-label="Tax Levy">$30,237.40</td>
<td data-label="Remaining Fees">$0.00</td><td data-label="Total Due">$30,237.40</td></tr></tbody></table>`;

const BEXAR_PAYMENTS = `<table><tbody>
<tr><td data-label="Receipt Date"><!-- Receipt Date --> 2026-09-22 </td>
<td data-label="Roll Year"> 2025 </td><td data-label="Amount"> $53,303.27 &nbsp; </td>
<td data-label="Description"> Payment </td><td data-label="Payer"> ALEX FREEMAN </td></tr></tbody></table>`;

const GALVESTON_DETAIL = `
<h5 align="center"><b>Unless otherwise noted, all data refers
  to tax information for 2026. All amounts due include penalty.</b></h5>
<h3><b>Account Number:&nbsp; 389480</b></h3>
<h3><b>Long Account Number:&nbsp; 469400000073006</b></h3>
<h3><b>Address:</b> <br>
  SMITH JOHN &amp; JANICE<br>7915 CAROLYN ST<br>SANTA FE, TX  77517-3708 </h3>
<h3> <b>Current Tax Levy: &nbsp;</b>$1,804.94</h3>
<h3> <b>Current Amount Due:&nbsp; </b>$1,804.94</h3>
<h3> <b>Prior Year Amount Due:&nbsp;</b>$0.00</h3>
<h3> <b>Total Amount Due:&nbsp;</b>$1,804.94</h3>
<h3> <b> Last Payment Amount for Current Year Taxes:</b>&nbsp;
  <br>Not Received </h3>
<a href="webpay/cart.jsp?account=389480&ownerno=0" class="payment-btn">Pay</a>
<form id="payHalfForm" method="post" action="webpay/pay_amount.jsp">
  <input type="hidden" name="account" value="389480">
  <input type = "hidden" name = "amount"  value = "902.47">
</form>
<h3><b>Market Value:</b> &nbsp;$516,500 </h3>
<h3><b>Capped Value:</b> $488,777 </h3>
<h3> <b>Exemptions:</b> HOM
O65
 </h3>`;

const GALVESTON_JURISDICTIONS = `<table>
<tr><td><h3>Jurisdictions</h3></td><td><h3>Market Value</h3></td><td><h3>Exemption Value</h3></td>
<td><h3>Taxable Value</h3></td><td><h3>Tax Rate</h3></td><td><h3>Levy</h3></td></tr>
<tr><td><h3>GALVESTON CO</h3></td><td><h3>$516,500</h3></td><td><h3>$185,478.00</h3></td>
<td><h3>$331,022.00</h3></td><td align="center"><h3>0.32106</h3></td><td><h3>$703.66</h3></td></tr>
</table>`;

const GALVESTON_PAYMENTS = `<table>
<tr><td>Receipt Date</td><td>Amount</td><td>Tax Year</td><td>Description</td><td>Payer</td></tr>
<tr><td><h3> 2026-06-25 </h3></td><td><h3> $1,983.89 &nbsp; </h3></td><td><h3> 2025 </h3></td>
<td><h3> Payment </h3></td><td><h3> STEWART TITLE </h3></td><td><a href="#">Reprint Receipt</a></td></tr>
</table>`;

describe("ACT tax office pages", () => {
  it("reads every field of the newer layout (Bexar)", () => {
    const p = parseAccountPage(BEXAR_DETAIL);
    expect(p).toMatchObject({
      taxAccount: "177280090010",
      taxYear: 2026,
      ownerLines: ["PINNACLE MONTESSORI LLC", "18740 WAINSBOROUGH LN", "DALLAS,TX 752875525"],
      siteAddress: "19730 BULVERDE RD",
      legal: "NCB 17728 BLK 9 LOT 1 1.977AC (THE PINNACLE MONTESSORI SCHOOL)",
      levy: 71314.39,
      yearAmountDue: 71314.39,
      delinquentAfter: "2027-02-01",
      halfPaymentAmount: 35657.2,
      halfPaymentDeadline: "2026-11-30",
      priorYearsDue: 0,
      totalDue: 71314.39,
      lastPaymentAmount: 53303.27,
      lastPayer: "ALEX FREEMAN",
      lastPaymentDate: "2026-09-22",
      pendingPayments: "No Payment Pending",
      marketValue: 3100000,
      landValue: 1416640,
      improvementValue: 1683360,
      cappedValue: 0,
      agValue: 0,
      exemptions: null,
      // a hidden block (display:none) isn't shown on the county's page either
      lawsuits: null,
    });
  });

  it("reads the older layout (Galveston), half payment from its button", () => {
    const p = parseAccountPage(GALVESTON_DETAIL);
    expect(p).toMatchObject({
      taxAccount: "389480",
      longAccount: "469400000073006",
      taxYear: 2026,
      ownerLines: ["SMITH JOHN & JANICE", "7915 CAROLYN ST", "SANTA FE, TX 77517-3708"],
      levy: 1804.94,
      yearAmountDue: 1804.94,
      priorYearsDue: 0,
      totalDue: 1804.94,
      lastPaymentAmount: null,
      halfPaymentAmount: 902.47,
      marketValue: 516500,
      cappedValue: 488777,
      exemptions: "HOM O65",
    });
  });

  it("reads jurisdiction and payment tables in both layouts", () => {
    expect(parseJurisdictions(BEXAR_JURISDICTIONS)).toEqual([
      {
        year: 2026,
        name: "NORTH EAST ISD",
        taxableValue: 3100000,
        rate: null,
        levy: 30237.4,
        totalDue: 30237.4,
      },
    ]);
    expect(parseJurisdictions(GALVESTON_JURISDICTIONS)).toEqual([
      {
        year: null,
        name: "GALVESTON CO",
        taxableValue: 331022,
        rate: 0.32106,
        levy: 703.66,
        totalDue: null,
      },
    ]);
    expect(parsePayments(BEXAR_PAYMENTS)).toEqual([
      {
        date: "2026-09-22",
        rollYear: 2025,
        amount: 53303.27,
        description: "Payment",
        payer: "ALEX FREEMAN",
      },
    ]);
    expect(parsePayments(GALVESTON_PAYMENTS)).toEqual([
      {
        date: "2026-06-25",
        rollYear: 2025,
        amount: 1983.89,
        description: "Payment",
        payer: "STEWART TITLE",
      },
    ]);
  });

  it("builds the county's own links from the account page", () => {
    const base = ACT_COUNTIES.bexar.base;
    const l = accountLinks(base, "177280090010", BEXAR_DETAIL);
    expect(l.account).toBe(`${base}/showdetail2.jsp?can=177280090010&ownerno=0`);
    expect(l.statement).toBe(
      `${base}/requests/currentstatement/prepare.jsp?can=177280090010&ownerno=0`,
    );
    expect(l.paymentHistory).toBe(`${base}/reports/paymentinfo.jsp?can=177280090010&ownerno=0`);
    expect(l.autoPay).toMatch(/collectorsolutions/);
    expect(l.map).toMatch(/p=1149803$/);
    expect(accountLinks(ACT_COUNTIES.galveston.base, "389480", GALVESTON_DETAIL).pay).toBe(
      `${ACT_COUNTIES.galveston.base}/webpay/cart.jsp?account=389480&ownerno=0`,
    );
  });

  it("picks the account whose row names the CAD ID", () => {
    const list = `<tr><td><a href="showdetail2.jsp?can=111">x</a></td><td>999</td></tr>
      <tr><td><a href="showdetail2.jsp?can=177280090010">y</a></td><td>1149803</td></tr>`;
    expect(accountsInList(list, "1149803")[0]).toBe("177280090010");
  });

  it("parses money and dates", () => {
    expect(moneyValue("$1,234.50")).toBe(1234.5);
    expect(moneyValue("Not Received")).toBeNull();
    expect(isoDate("November 30, 2026")).toBe("2026-11-30");
    expect(isoDate("02/01/2027")).toBe("2027-02-01");
  });
});

// ACT's newer design (Montgomery, Nueces, Kleberg …): label and value in
// separate blocks, hidden blocks marked data-if="false", results as JSON.
const MODERN_DETAIL = `
<div data-if="false" class="alert">This account is currently paying taxes in Quarter Installments.</div>
<ul><li class="list-group-item"><span class="fw-bold">Account Number:</span>
  <strong class="badge">65600201400</strong></li>
<li class="list-group-item"><div class="fw-bold mb-1">Mailing Address:</div>
  <p class="mb-0">NESMITH DARLENE K & JOHN O<br>408 PINEWOOD DR<br>CONROE,TX 773859670</p></li>
<li class="list-group-item"><div class="fw-bold mb-1">Property Site Address:</div><p>408 PINEWOOD DR</p></li></ul>
<div class="card-header"><a href="./reports/jurisdiction-details.jsp?can=65600201400&ownerno=0">Jurisdictions Collected:<strong>*</strong></a></div>
<div class="card-body">MONTGOMERY COUNTY<br>CONROE ISD</div>
<ul><li><span>Current Year Levy:</span> <span>$171.69</span>
<span>Current Year Due:</span> <span>$0.00</span>
<span>Prior Year Due:</span> <span>$0.00</span>
<span>Total Amount Due:</span> <span>$0.00</span></li>
<li><span>Total Due for 2026 &amp; Prior Years:</span> <span>$0.00</span></li>
<li><span>Pending Internet Payments:</span> <span>No payment pending</span></li>
<li><span>Market Value:</span> <span>$107,786</span></li></ul>
<a href="reports/payment-info.jsp?can=65600201400&ownerno=0">Payment Information for 2026 and Prior Year Taxes</a>
<a href="javascript:createReport('statements/current-statements.jsp')">Print a Current Tax Statement</a>`;

// El Paso (city tax office collecting for the county): its own wording.
const EL_PASO_DETAIL = `<table><tr><td>Account No.:</td><td>R24699902800100</td></tr>
<tr><td>Prop. Id. No.:</td><td>290417</td></tr>
<tr><td>Current Taxes (Levy):</td><td>$9,419.34</td></tr>
<tr><td>Current Year Amount Due:</td><td>$9,419.34</td></tr>
<tr><td>Market Value:</td><td>$528,779</td></tr>
<tr><td>Last Payment Date:</td><td>07-20-2026</td></tr>
<tr><td>Pending Credit/Debit or e-Check Payments:</td><td>No Payment Pending</td></tr></table>
<a href='reports/future_taxselect.jsp?can=R24699902800100&ownerno=0&taxYear=2026'>Click Here</a>`;

describe("ACT pages — newer design and county wording", () => {
  it("reads the newer design, skipping hidden blocks", () => {
    expect(parseAccountPage(MODERN_DETAIL)).toMatchObject({
      taxAccount: "65600201400",
      taxYear: 2026,
      ownerLines: ["NESMITH DARLENE K & JOHN O", "408 PINEWOOD DR", "CONROE,TX 773859670"],
      siteAddress: "408 PINEWOOD DR",
      levy: 171.69,
      yearAmountDue: 0,
      priorYearsDue: 0,
      totalDue: 0,
      pendingPayments: "No payment pending",
      marketValue: 107786,
    });
    const l = accountLinks(
      ACT_COUNTIES.montgomery.base,
      "65600201400",
      MODERN_DETAIL,
      "account-details.jsp",
    );
    expect(l.account).toBe(
      `${ACT_COUNTIES.montgomery.base}/account-details.jsp?can=65600201400&ownerno=0`,
    );
    expect(l.paymentHistory).toMatch(/reports\/payment-info\.jsp\?can=65600201400/);
    expect(l.statement).toBeNull(); // a javascript: link isn't a page
  });

  it("reads El Paso's wording", () => {
    expect(parseAccountPage(EL_PASO_DETAIL)).toMatchObject({
      taxAccount: "R24699902800100",
      taxYear: 2026,
      levy: 9419.34,
      yearAmountDue: 9419.34,
      marketValue: 528779,
      lastPaymentDate: "2026-07-20",
      pendingPayments: "No Payment Pending",
    });
  });

  it("finds the account in the JSON result list, either variable name", () => {
    const list = (name: string) =>
      `<script>${name} = {"status":"success","data":{"criteria":"R109220","matches":2,"accounts":[{"can":"111","aprdistacc":"R555"},{"can":"65600201400","aprdistacc":"R109220"}]}};\n</script>`;
    expect(accountsInJsonList(list("var searchResults"), "109220")[0]).toBe("65600201400");
    expect(accountsInJsonList(list("const result"), "R109220")[0]).toBe("65600201400");
  });

  it("reads the base tax still due per year (Fort Bend)", () => {
    const html = `<table><tr><td>Year</td><td>Base Tax Due</td><td>Total Due</td></tr>
      <tr><td> 2026 </td><td></td><td>$4,519.21</td><td>$0.00</td><td>$4,519.21</td></tr>
      <tr><td>2025</td><td>$0.00</td><td>$0.00</td></tr></table>`;
    expect([...baseDueByYear(html)]).toEqual([
      [2026, 4519.21],
      [2025, 0],
    ]);
  });
});

describe("Pay Taxes with the tax office's account", () => {
  const prop: PropertyRecord = {
    id: "p1",
    address: "19730 Bulverde Rd",
    cad: "Bexar County",
    accountNumber: "1149803",
    ownerName: null,
    propertyType: "Commercial",
    landValue: null,
    improvementValue: null,
    totalValue: null,
    taxYear: 2026,
    protestDeadline: null,
    paymentDueDate: null,
    taxAmountDue: null,
    paidAt: null,
    estimatedSavings: null,
    savingsBasis: null,
    createdAt: "2026-01-01T00:00:00Z",
    valueHistory: null,
  };
  const office = {
    ...parseAccountPage(BEXAR_DETAIL),
    county: "Bexar",
    cadPropertyId: "1149803",
    jurisdictions: [],
    payments: [],
    links: accountLinks(ACT_COUNTIES.bexar.base, "177280090010", BEXAR_DETAIL),
  } satisfies TaxOfficeStatement;
  const row = (o: TaxOfficeStatement | null) =>
    buildPayTaxesRow({
      property: prop,
      bills: [],
      plans: [],
      settings: [],
      protests: [],
      todayIso: "2026-11-11",
      taxOffice: o,
    });

  it("uses the county's levy instead of an estimate — even with no value saved", () => {
    expect(row(null).totalTax).toBeNull();
    const r = row(office);
    expect(r.totalTax).toBe(71314.39);
    expect(r.totalTaxBasis).toBe("county");
    expect(r.totalTaxIsEstimate).toBe(false);
    expect(r.outstanding).toBe(71314.39);
    expect(r.amountPaid).toBe(0);
    expect(r.delinquency).toBe("2027-02-01");
    expect(r.dueDate).toBe("2027-02-01"); // Jan 31, 2027 is a Sunday
    expect(r.verified).toBe(true);
  });

  it("reads paid / partial / overdue from what the county says is left", () => {
    expect(officeStatus({ ...office, yearAmountDue: 0 }, "2026-11-11", "2027-02-01")).toBe("paid");
    expect(officeStatus({ ...office, yearAmountDue: 35657.19 }, "2026-11-11", "2027-02-01")).toBe(
      "partial",
    );
    expect(officeStatus(office, "2027-02-02", "2027-02-01")).toBe("overdue");
    expect(row({ ...office, yearAmountDue: 35657.19 }).amountPaid).toBe(35657.2);
  });

  it("knows which counties are connected", () => {
    expect(taxOfficeConnected("Bexar Appraisal District")).toBe(true);
    expect(taxOfficeConnected("Bexar County")).toBe(true);
    expect(taxOfficeConnected("Fort Bend Central Appraisal District")).toBe(true);
    expect(taxOfficeConnected("Tarrant Appraisal District")).toBe(false);
  });
});
