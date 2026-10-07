import { describe, expect, it } from "vitest";
import {
  geoIdFromTaxAccount,
  isBusinessPersonalProperty,
  parseTaxOfficeDetail,
  parseTaxOfficeList,
  taxOfficeQuery,
} from "../../../../supabase/pt/functions/_shared/bexar-tax-office";

// Row markup as bexar.acttax.com's showlist.jsp returns it (Oct 2026).
const row = (account: string, owner: string, legal: string, cad: string) => `
<tr id="account-container" onMouseOver="this.className='hover'" valign="top">
  <td class="else"></td>
  <td class="account-responsive" data-label="Account" style="text-align:center"><!-- Account Number -->
    <a class="account" href='showdetail2.jsp?can=${account}'>
      ${account}
    </a>
  </td>
  <td class="owner-responsive" data-label="Owner"><!-- Owner Name & Address -->
    ${owner}<br>18740 WAINSBOROUGH LN<br>DALLAS, TX  75287-5525
  </td>
  <td class="address-responsive" data-label="Address"><!-- Property Address -->
    19730 BULVERDE RD
  </td>
  <td class="legal legal-responsive" data-label="Legal Description"><!-- Legal Description -->
    ${legal}
  </td>
  <td class="cad cad-responsive" data-label="CAD Reference No."><!-- CAD Reference No. -->
      ${cad}
  </td>
</tr>`;

const LIST = `<table>${row(
  "177280090010",
  "PINNACLE MONTESSORI LLC",
  "NCB 17728 BLK 9 LOT 1 1.977AC (THE<br>PINNACLE MONTESSORI SCHOOL)<br>",
  "1149803",
)}${row(
  "000001151895",
  "PINNACLE MONTESSORI LLC",
  "PINNACLE MONTESSORI CHILDRENS ACADEMY<br>19730 BULVERDE RD<br>FURN FIXT EQPT SUP",
  "1151895",
)}</table>`;

describe("parseTaxOfficeList", () => {
  it("reads each account with its CAD Property ID", () => {
    const accounts = parseTaxOfficeList(LIST);
    expect(accounts.map((a) => [a.taxAccount, a.cadPropertyId, a.owner, a.situs])).toEqual([
      ["177280090010", "1149803", "PINNACLE MONTESSORI LLC", "19730 BULVERDE RD"],
      ["000001151895", "1151895", "PINNACLE MONTESSORI LLC", "19730 BULVERDE RD"],
    ]);
    expect(accounts[1].legal).toContain("FURN FIXT EQPT SUP");
  });
  it("returns nothing for an unrecognized page", () => {
    expect(parseTaxOfficeList("<html>Find Your Property Tax Account</html>")).toEqual([]);
  });
});

describe("parseTaxOfficeDetail", () => {
  it("reads the current values", () => {
    expect(
      parseTaxOfficeDetail(
        "<td>Total Market Value:</td><td>$6,940</td> <td>Land Value:</td><td>$0</td> <td>Improvement Value:</td><td>$6,940</td>",
      ),
    ).toEqual({ marketValue: 6940, landValue: 0, improvementValue: 6940 });
  });
});

describe("account helpers", () => {
  it("spots business personal property", () => {
    const [land, bpp] = parseTaxOfficeList(LIST);
    expect(isBusinessPersonalProperty(land)).toBe(false);
    expect(isBusinessPersonalProperty(bpp)).toBe(true);
  });
  it("formats the Geographic ID, none for BPP", () => {
    expect(geoIdFromTaxAccount("177280090010")).toBe("17728-009-0010");
    expect(geoIdFromTaxAccount("000001151895")).toBeNull();
  });
  it("builds the house number + street word query", () => {
    expect(taxOfficeQuery("19730 BULVERDE RD SAN ANTONIO, TX 78259")).toBe("19730 BULVERDE");
    expect(taxOfficeQuery("11400 W Culebra Rd, San Antonio")).toBe("11400 CULEBRA");
    expect(taxOfficeQuery("BULVERDE RD SAN ANTONIO")).toBeNull();
  });
});
