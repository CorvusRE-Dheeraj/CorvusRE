import { describe, expect, it } from "vitest";
import {
  normalizeAttom,
  normalizeAttomComps,
  normalizeRegrid,
  splitAddressForAttom,
} from "../../../../supabase/pt/functions/_shared/property-sources";

// Shapes follow the vendors' documented responses: ATTOM Property API
// expandedprofile ({ status, property: [...] }, assessment.assessed/market/tax)
// and Regrid Parcel API v2 ({ parcels: FeatureCollection }, properties.fields).
const attomPayload = {
  status: { code: 0, msg: "SuccessWithResult", total: 1 },
  property: [
    {
      identifier: { attomId: 184713191, apn: "00000123456000000", fips: "48113" },
      address: { oneLine: "123 MAIN ST, DALLAS, TX 75201" },
      location: { latitude: "32.7801", longitude: "-96.8003" },
      summary: { propertyType: "COMMERCIAL", yearbuilt: 1998 },
      building: { size: { livingsize: 0, universalsize: 24500 } },
      lot: { lotsize1: 1.25, lotsize2: 54450 },
      assessment: {
        assessed: { assdttlvalue: 4200000, assdlandvalue: 1200000, assdimprvalue: 3000000 },
        market: { mktttlvalue: 4200000 },
        tax: { taxamt: 92400.55, taxyear: 2025 },
        owner: { owner1: { fullname: "MAIN STREET HOLDINGS LLC" } },
      },
      sale: { amount: { saleamt: 3100000, salerecdate: "2019-06-14" } },
    },
  ],
};

const regridPayload = {
  parcels: {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-96.8, 32.78],
              [-96.79, 32.78],
              [-96.79, 32.79],
              [-96.8, 32.78],
            ],
          ],
        },
        properties: {
          headline: "123 Main St",
          path: "/us/tx/dallas/dallas/123456",
          fields: {
            parcelnumb: "00000123456000000",
            owner: "MAIN STREET HOLDINGS LLC",
            address: "123 MAIN ST",
            county: "dallas",
            usedesc: "Office",
            zoning: "CA-1(A)",
            zoning_description: "Central Area",
            ll_gisacre: 1.247,
            ll_gissqft: 54325,
            parval: "4200000",
            landval: 1200000,
            improvval: 3000000,
            lat: "32.7801",
            lon: "-96.8003",
          },
        },
      },
    ],
  },
};

describe("normalizeAttom", () => {
  it("maps the documented expandedprofile fields", () => {
    const a = normalizeAttom(attomPayload)!;
    expect(a).toMatchObject({
      attomId: "184713191",
      apn: "00000123456000000",
      lat: 32.7801,
      lng: -96.8003,
      yearBuilt: 1998,
      // livingsize 0 means "not reported", so it falls through to universalsize.
      buildingSqft: 24500,
      lotSizeAcres: 1.25,
      assessedTotal: 4200000,
      assessedLand: 1200000,
      assessedImprovement: 3000000,
      taxAmount: 92400.55,
      taxYear: 2025,
      ownerName: "MAIN STREET HOLDINGS LLC",
      lastSaleAmount: 3100000,
      lastSaleDate: "2019-06-14",
    });
  });

  it("returns null when ATTOM found nothing", () => {
    expect(normalizeAttom({ status: { total: 0 }, property: [] })).toBeNull();
    expect(normalizeAttom(null)).toBeNull();
  });
});

describe("normalizeRegrid", () => {
  it("reads properties.fields and keeps the parcel boundary", () => {
    const r = normalizeRegrid(regridPayload)!;
    expect(r).toMatchObject({
      parcelNumber: "00000123456000000",
      ownerName: "MAIN STREET HOLDINGS LLC",
      landUse: "Office",
      zoning: "CA-1(A)",
      zoningDescription: "Central Area",
      lotSizeAcres: 1.247,
      totalValue: 4200000,
      regridPath: "/us/tx/dallas/dallas/123456",
    });
    expect(r.geometry?.type).toBe("Polygon");
  });

  it("returns null for an empty FeatureCollection", () => {
    expect(normalizeRegrid({ parcels: { type: "FeatureCollection", features: [] } })).toBeNull();
  });
});

describe("normalizeAttomComps", () => {
  // Nested MISMO-style shape, deliberately at an arbitrary depth — the parser
  // finds comparables and fields by name, not a fixed path.
  const payload = {
    RESPONSE_GROUP: {
      RESPONSE: {
        RESPONSE_DATA: {
          PROPERTY_INFORMATION_RESPONSE_ext: {
            SUBJECT_PROPERTY_ext: { PROPERTY: { "@_StreetAddress": "123 MAIN ST" } },
            COMPARABLE_PROPERTY_ext: [
              {
                "@_StreetAddress": "200 ELM ST",
                "@_City": "DALLAS",
                "@DistanceFromSubjectPropertyMilesCount": "0.8",
                SALES_HISTORY: {
                  "@PropertySalesAmount": "3100000",
                  "@PropertySalesDate": "2025-03-14",
                },
                STRUCTURE: {
                  "@GrossLivingAreaSquareFeetCount": "24000",
                  STRUCTURE_ANALYSIS: { "@PropertyStructureBuiltYear": "2001" },
                },
              },
              {
                // No disclosed price (common in Texas) — dropped.
                "@_StreetAddress": "300 OAK ST",
                SALES_HISTORY: { "@PropertySalesAmount": "0" },
              },
            ],
          },
        },
      },
    },
  };

  it("keeps comparables with a real sale price and computes $/SF", () => {
    const comps = normalizeAttomComps(payload);
    expect(comps).toHaveLength(1);
    expect(comps[0]).toMatchObject({
      address: "200 ELM ST, DALLAS",
      saleAmount: 3_100_000,
      saleDate: "2025-03-14",
      buildingSqft: 24_000,
      yearBuilt: 2001,
      distanceMiles: 0.8,
    });
    expect(comps[0].pricePerSqft).toBeCloseTo(129.17, 2);
  });

  it("returns nothing for an empty or unexpected response", () => {
    expect(normalizeAttomComps({})).toEqual([]);
    expect(normalizeAttomComps(null)).toEqual([]);
  });
});

describe("splitAddressForAttom", () => {
  it("splits the street line from the city/state/zip line", () => {
    expect(splitAddressForAttom("123 Main St, Dallas, TX 75201")).toEqual({
      address1: "123 Main St",
      address2: "Dallas, TX 75201",
    });
    expect(splitAddressForAttom("123 Main St")).toBeNull();
  });
});
