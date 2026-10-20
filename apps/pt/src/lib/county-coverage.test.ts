import { describe, expect, it } from "vitest";
import {
  isFullCoverageCounty,
  isStandardCoverageCad,
  isStatewideRecord,
  isTexasCounty,
  TEXAS_COUNTY_NAMES,
} from "./county-coverage";
import { getCadRecordUrl } from "./cad-record-url";

describe("county coverage", () => {
  it("knows all 254 Texas counties", () => {
    expect(TEXAS_COUNTY_NAMES).toHaveLength(254);
    expect(isTexasCounty("Hardin County")).toBe(true);
    expect(isTexasCounty("El Paso")).toBe(true);
    expect(isTexasCounty("Denver County")).toBe(false);
  });

  it("tells full from standard coverage", () => {
    expect(isFullCoverageCounty("Nueces County")).toBe(true);
    expect(isFullCoverageCounty("Hardin")).toBe(false);
    expect(isStandardCoverageCad("Hardin Appraisal District")).toBe(true);
    expect(isStandardCoverageCad("El Paso Appraisal District")).toBe(true);
    expect(isStandardCoverageCad("Dallas Central Appraisal District")).toBe(false);
    expect(isStandardCoverageCad("Nueces County Appraisal District")).toBe(false);
    expect(isStandardCoverageCad(null)).toBe(false);
    expect(isStatewideRecord({ dataSource: "statewide" })).toBe(true);
    expect(isStatewideRecord({})).toBe(false);
  });

  it("links a standard-coverage county to its district website", () => {
    const url = getCadRecordUrl({ cad: "Hardin Appraisal District", accountNumber: "1412" });
    expect(url).toMatch(/^https?:\/\//);
  });
});
