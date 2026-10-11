import { describe, expect, it } from "vitest";
import { cadEvidenceRequestLetter } from "./cad-evidence-request";
import { CORVUSPT_COUNTY_EMAIL } from "./county-email";

const base = {
  cadName: "Denton Central Appraisal District",
  address: "2214 Emery St, Denton, TX 76201",
  accountNumber: "730758",
  taxYear: 2026,
  ownerName: "Owner LLC",
  today: new Date("2026-10-07T12:00:00"),
};

describe("cadEvidenceRequestLetter", () => {
  it("asks for §41.461 evidence and copies CorvusPT for an owner-managed case", () => {
    const letter = cadEvidenceRequestLetter({
      ...base,
      replyEmail: "owner@example.com",
      copyEmail: CORVUSPT_COUNTY_EMAIL,
    });
    expect(letter).toContain("Texas Property Tax Code §41.461");
    expect(letter).toContain(
      `Please send it to owner@example.com, copying ${CORVUSPT_COUNTY_EMAIL},`,
    );
  });

  it("sends a managed case's reply straight to CorvusPT without repeating it", () => {
    const letter = cadEvidenceRequestLetter({
      ...base,
      replyEmail: CORVUSPT_COUNTY_EMAIL,
      copyEmail: CORVUSPT_COUNTY_EMAIL,
    });
    expect(letter).toContain(`Please send it to ${CORVUSPT_COUNTY_EMAIL}, or to the mailing`);
  });
});
