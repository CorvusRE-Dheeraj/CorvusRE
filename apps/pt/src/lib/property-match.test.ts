import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: {} }));

import { addressMatchKey, isSameProperty } from "./properties";

describe("addressMatchKey", () => {
  it("normalizes case, suffixes, punctuation and the USA tail", () => {
    expect(addressMatchKey("601 RIDGECREST RD, FORNEY TX 75126")).toBe("601 RIDGECREST RD|75126");
    expect(addressMatchKey("601 Ridgecrest Road, Forney, TX 75126, USA")).toBe(
      "601 RIDGECREST RD|75126",
    );
  });
  it("can't key an address without a house number", () => {
    expect(addressMatchKey("Bulverde Rd, San Antonio, TX 78259")).toBeNull();
  });
});

describe("isSameProperty", () => {
  it("matches the same address typed differently", () => {
    expect(
      isSameProperty(
        { address: "601 RIDGECREST RD, FORNEY TX 75126", cad: "Kaufman", accountNumber: "221261" },
        { address: "601 Ridgecrest Road, Forney, TX 75126", cad: null, accountNumber: null },
      ),
    ).toBe(true);
  });
  it("matches the same account across CAD name spellings and leading zeros", () => {
    expect(
      isSameProperty(
        { address: "Account #221261 — Kaufman", cad: "Kaufman CAD", accountNumber: "0221261" },
        { address: "601 Ridgecrest Rd, Forney, TX 75126", cad: "Kaufman", accountNumber: "221261" },
      ),
    ).toBe(true);
  });
  it("keeps two accounts at one address apart", () => {
    expect(
      isSameProperty(
        {
          address: "19730 Bulverde Rd, San Antonio, TX 78259",
          cad: "Bexar",
          accountNumber: "1151895",
        },
        {
          address: "19730 Bulverde Rd, San Antonio, TX 78259",
          cad: "Bexar",
          accountNumber: "1149803",
        },
      ),
    ).toBe(false);
  });
  it("doesn't match a different zip", () => {
    expect(
      isSameProperty(
        { address: "100 Main St, Dallas, TX 75201" },
        { address: "100 Main St, Frisco, TX 75034" },
      ),
    ).toBe(false);
  });
});
