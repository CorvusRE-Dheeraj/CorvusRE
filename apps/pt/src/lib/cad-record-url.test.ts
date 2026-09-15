import { describe, it, expect } from "vitest";
import { getCadRecordUrl, isDirectCadRecordUrl, CAD_SEARCH_HOMEPAGE } from "./cad-record-url";

describe("getCadRecordUrl", () => {
  it("returns Bexar's real deep-link pattern", () => {
    expect(getCadRecordUrl({ cad: "Bexar Appraisal District", accountNumber: "12345" })).toBe(
      "https://bexar.trueautomation.com/clientdb/Property.aspx?cid=110&prop_id=12345",
    );
  });

  it("returns Dallas's real deep-link pattern", () => {
    expect(
      getCadRecordUrl({ cad: "Dallas Central Appraisal District", accountNumber: "1149803" }),
    ).toBe("https://www.dallascad.org/AcctDetailCom.aspx?ID=1149803");
  });

  it("returns the real ProdigyCAD deep-link pattern for Denton/Tarrant/Montgomery/Travis", () => {
    expect(
      getCadRecordUrl({ cad: "Denton Central Appraisal District", accountNumber: "34086" }),
    ).toBe("https://www.dentoncad.com/property-detail/34086");
    expect(getCadRecordUrl({ cad: "Tarrant Appraisal District", accountNumber: "41054806" })).toBe(
      "https://tarrant.prodigycad.com/property-detail/41054806",
    );
    expect(
      getCadRecordUrl({ cad: "Montgomery Central Appraisal District", accountNumber: "167662" }),
    ).toBe("https://mcad-tx.org/property-detail/167662");
    expect(
      getCadRecordUrl({ cad: "Travis Central Appraisal District", accountNumber: "230964" }),
    ).toBe("https://travis.prodigycad.com/property-detail/230964");
  });

  it("returns the real BIS Consultants deep-link pattern for Grayson and Kaufman", () => {
    expect(
      getCadRecordUrl({ cad: "Grayson Central Appraisal District", accountNumber: "142547" }),
    ).toBe("https://esearch.graysonappraisal.org/Property/View/142547");
    expect(
      getCadRecordUrl({ cad: "Kaufman Central Appraisal District", accountNumber: "6505" }),
    ).toBe("https://esearch.kaufman-cad.org/Property/View/6505");
  });

  it("returns Williamson's real deep-link pattern", () => {
    expect(
      getCadRecordUrl({ cad: "Williamson Central Appraisal District", accountNumber: "R010784" }),
    ).toBe("https://search.wcad.org/Property-Detail/PropertyQuickRefID/R010784");
  });

  it("returns Fort Bend's real deep-link pattern, but only once enrichment has supplied bisPropertyId", () => {
    // accountNumber alone (BIS's geoId, from the primary ArcGIS match) is NOT
    // enough — Fort Bend's own detail page needs BIS's separate numeric
    // propertyId, only available once enrichBIS has run. See getCadRecordUrl's
    // own comment.
    expect(
      getCadRecordUrl({
        cad: "Fort Bend Central Appraisal District",
        accountNumber: "0062-00-000-4026-907",
        bisPropertyId: "R504849",
      }),
    ).toBe("https://esearch.fbcad.org/Property/View/R504849");
    expect(
      getCadRecordUrl({
        cad: "Fort Bend Central Appraisal District",
        accountNumber: "0062-00-000-4026-907",
      }),
    ).toBe(CAD_SEARCH_HOMEPAGE["Fort Bend Central Appraisal District"]);
  });

  it("falls back to the search homepage for every other supported county", () => {
    expect(
      getCadRecordUrl({ cad: "Collin Central Appraisal District", accountNumber: "999" }),
    ).toBe(CAD_SEARCH_HOMEPAGE["Collin Central Appraisal District"]);
    expect(
      getCadRecordUrl({ cad: "Harris Central Appraisal District", accountNumber: "999" }),
    ).toBe(CAD_SEARCH_HOMEPAGE["Harris Central Appraisal District"]);
  });

  it("falls back to the search homepage (or null) when there's no account number, even for a direct-link county", () => {
    expect(getCadRecordUrl({ cad: "Denton Central Appraisal District", accountNumber: null })).toBe(
      CAD_SEARCH_HOMEPAGE["Denton Central Appraisal District"],
    );
    expect(getCadRecordUrl({ cad: "Not A Real CAD", accountNumber: null })).toBeNull();
  });
});

describe("isDirectCadRecordUrl", () => {
  it("is true for every county with a real verified deep link", () => {
    for (const cad of [
      "Bexar Appraisal District",
      "Dallas Central Appraisal District",
      "Denton Central Appraisal District",
      "Tarrant Appraisal District",
      "Montgomery Central Appraisal District",
      "Travis Central Appraisal District",
      "Grayson Central Appraisal District",
      "Kaufman Central Appraisal District",
      "Williamson Central Appraisal District",
    ]) {
      expect(isDirectCadRecordUrl(cad)).toBe(true);
    }
  });

  it("is false for counties still on the generic search-homepage fallback", () => {
    expect(isDirectCadRecordUrl("Collin Central Appraisal District")).toBe(false);
    expect(isDirectCadRecordUrl("Harris Central Appraisal District")).toBe(false);
    expect(isDirectCadRecordUrl("Fort Bend Central Appraisal District")).toBe(false);
  });
});
