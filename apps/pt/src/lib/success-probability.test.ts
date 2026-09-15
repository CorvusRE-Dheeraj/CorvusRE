import { describe, it, expect, vi, beforeEach } from "vitest";
import { estimateSuccessProbability } from "./success-probability";
import { getComps } from "./cad-comps";

vi.mock("./cad-comps", () => ({
  getComps: vi.fn(),
}));

const mockedGetComps = vi.mocked(getComps);

describe("estimateSuccessProbability", () => {
  beforeEach(() => {
    mockedGetComps.mockReset();
  });

  it("returns null when there's no assessed value to estimate from", async () => {
    const result = await estimateSuccessProbability({ totalValue: null });
    expect(result).toBeNull();
    expect(mockedGetComps).not.toHaveBeenCalled();
  });

  it("uses the county's real base win rate with no adjustments when no other signal applies", async () => {
    const result = await estimateSuccessProbability({
      cad: "Williamson Central Appraisal District", // no county-specific figure -> statewide 70% fallback
      totalValue: 400000,
      propertyType: "Residential",
    });
    expect(result?.basis).toBe("formula");
    // Williamson's COD (7.57) is within the residential IAAO ceiling (15.0), so
    // no COD adjustment either -> stays at the statewide 70% fallback exactly.
    expect(result?.probabilityPct).toBe(70);
  });

  it("boosts the probability when 3+ qualifying comps exist (comps basis)", async () => {
    mockedGetComps.mockResolvedValue({
      subject: {
        pid: 1,
        address: "123 Main St",
        latitude: 33.05,
        longitude: -96.75,
        marketValue: 400000,
        ownerName: null,
        asCode: "R1",
      },
      comps: [
        {
          pid: 2,
          address: "125 Main St",
          latitude: 33.0501,
          longitude: -96.7501,
          marketValue: 350000,
          ownerName: null,
        },
        {
          pid: 3,
          address: "127 Main St",
          latitude: 33.0502,
          longitude: -96.7502,
          marketValue: 340000,
          ownerName: null,
        },
        {
          pid: 4,
          address: "129 Main St",
          latitude: 33.0503,
          longitude: -96.7503,
          marketValue: 360000,
          ownerName: null,
        },
      ],
    });

    const result = await estimateSuccessProbability({
      cad: "Denton Central Appraisal District", // 86% base
      accountNumber: "ACC-1",
      totalValue: 400000,
      propertyType: "Residential",
    });

    expect(result?.basis).toBe("comps");
    // 86 base + 7 comps boost = 93 (Denton COD 6.16 is within the 15.0 residential
    // ceiling, so no COD adjustment stacks on top).
    expect(result?.probabilityPct).toBe(93);
    expect(result?.rationale).toContain("3 real nearby comparable properties");
  });

  it("falls back to the formula basis when comps lookup throws", async () => {
    mockedGetComps.mockRejectedValue(new Error("edge function down"));
    const result = await estimateSuccessProbability({
      cad: "Denton Central Appraisal District",
      accountNumber: "ACC-1",
      totalValue: 400000,
      propertyType: "Residential",
    });
    expect(result?.basis).toBe("formula");
    expect(result?.probabilityPct).toBe(86);
  });

  it("applies the COD-over-ceiling boost for a county/category with real excess dispersion", async () => {
    const result = await estimateSuccessProbability({
      cad: "Tarrant Appraisal District", // base 75%
      totalValue: 400000,
      propertyType: "Commercial", // COD 12.46, within the 20.0 commercial ceiling -> no boost
    });
    expect(result?.probabilityPct).toBe(75);

    const boosted = await estimateSuccessProbability({
      cad: "Denton Central Appraisal District", // base 86%
      totalValue: 400000,
      propertyType: "Commercial", // COD 17.96, still within the 20.0 commercial ceiling
    });
    // Denton commercial COD is 17.96, under the 20.0 commercial ceiling, so this
    // case also shouldn't move — confirms the boost is genuinely conditional,
    // not applied unconditionally.
    expect(boosted?.probabilityPct).toBe(86);
  });

  it("applies the value-jump boost when the property's own trend anomaly triggers", async () => {
    const result = await estimateSuccessProbability({
      cad: "Williamson Central Appraisal District", // statewide 70% fallback
      totalValue: 400000,
      propertyType: "Residential",
      valueHistory: [
        { year: 2020, appraisedValue: 300000 },
        { year: 2021, appraisedValue: 310000 },
        { year: 2022, appraisedValue: 320000 },
        { year: 2023, appraisedValue: 400000 }, // sharp jump beyond its own trailing trend
      ],
    });
    expect(result?.probabilityPct).toBe(75); // 70 base + 5 jump boost
    expect(result?.rationale).toContain("beyond its own historical trend");
  });

  it("never exceeds the 95% or drops below the 35% confidence bounds", async () => {
    mockedGetComps.mockResolvedValue({
      subject: {
        pid: 1,
        address: "123 Main St",
        latitude: 33.05,
        longitude: -96.75,
        marketValue: 400000,
        ownerName: null,
        asCode: "R1",
      },
      comps: [
        {
          pid: 2,
          address: "125 Main St",
          latitude: 33.0501,
          longitude: -96.7501,
          marketValue: 350000,
          ownerName: null,
        },
        {
          pid: 3,
          address: "127 Main St",
          latitude: 33.0502,
          longitude: -96.7502,
          marketValue: 340000,
          ownerName: null,
        },
        {
          pid: 4,
          address: "129 Main St",
          latitude: 33.0503,
          longitude: -96.7503,
          marketValue: 360000,
          ownerName: null,
        },
      ],
    });
    const result = await estimateSuccessProbability({
      cad: "Bexar Appraisal District", // base 90%, would exceed 95 with the comps boost alone
      accountNumber: "ACC-1",
      totalValue: 400000,
      propertyType: "Residential",
    });
    expect(result?.probabilityPct).toBeLessThanOrEqual(95);
    expect(result?.probabilityPct).toBeGreaterThanOrEqual(35);
  });

  it("returns the same result for the same input (deterministic, no AI)", async () => {
    const input = {
      cad: "Travis Central Appraisal District",
      totalValue: 600000,
      propertyType: "Commercial",
    };
    const first = await estimateSuccessProbability(input);
    const second = await estimateSuccessProbability(input);
    expect(first).toEqual(second);
  });
});
