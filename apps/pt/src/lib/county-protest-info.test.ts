import { describe, it, expect } from "vitest";
import { COUNTY_PROTEST_INFO, getCountyProtestInfo } from "./county-protest-info";

// The exact 12 `cad` strings supabase/functions/cad-lookup/index.ts actually
// returns today — kept as a literal list (not derived from the lookup
// function itself) so a future county silently missing its protest-info
// entry fails a test here rather than surfacing as a blank guidance panel.
const SUPPORTED_CADS = [
  "Bexar Appraisal District",
  "Collin Central Appraisal District",
  "Dallas Central Appraisal District",
  "Denton Central Appraisal District",
  "Fort Bend Central Appraisal District",
  "Grayson Central Appraisal District",
  "Harris Central Appraisal District",
  "Kaufman Central Appraisal District",
  "Montgomery Central Appraisal District",
  "Tarrant Appraisal District",
  "Travis Central Appraisal District",
  "Williamson Central Appraisal District",
];

describe("COUNTY_PROTEST_INFO", () => {
  it("has a real entry for every currently-supported county", () => {
    for (const cad of SUPPORTED_CADS) {
      expect(COUNTY_PROTEST_INFO[cad], `missing entry for ${cad}`).toBeDefined();
    }
  });

  it("every entry's own cad field matches its key (no copy-paste mismatch)", () => {
    for (const [key, info] of Object.entries(COUNTY_PROTEST_INFO)) {
      expect(info.cad).toBe(key);
    }
  });

  it("every entry has a real sourceUrl and verifiedAt", () => {
    for (const info of Object.values(COUNTY_PROTEST_INFO)) {
      expect(info.sourceUrl).toMatch(/^https?:\/\//);
      expect(info.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("filingMethod always has at least one real way to file, never none", () => {
    for (const [cad, info] of Object.entries(COUNTY_PROTEST_INFO)) {
      const hasSomething =
        info.filingMethod.online != null ||
        info.filingMethod.mail != null ||
        info.filingMethod.inPerson != null;
      expect(hasSomething, `${cad} has no confirmed filing method at all`).toBe(true);
    }
  });

  it("every county has at least a mailing or in-person address as a non-online fallback", () => {
    for (const [cad, info] of Object.entries(COUNTY_PROTEST_INFO)) {
      const hasFallback = info.filingMethod.mail != null || info.filingMethod.inPerson != null;
      expect(hasFallback, `${cad} has no mail/in-person fallback`).toBe(true);
    }
  });
});

describe("getCountyProtestInfo", () => {
  it("returns null for a null/undefined/unknown cad rather than throwing", () => {
    expect(getCountyProtestInfo(null)).toBeNull();
    expect(getCountyProtestInfo(undefined)).toBeNull();
    expect(getCountyProtestInfo("Some Made-Up CAD")).toBeNull();
  });

  it("returns the real entry for a known cad", () => {
    const info = getCountyProtestInfo("Tarrant Appraisal District");
    expect(info?.cad).toBe("Tarrant Appraisal District");
  });
});
