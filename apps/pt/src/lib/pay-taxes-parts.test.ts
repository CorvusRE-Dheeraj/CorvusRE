import { describe, expect, it } from "vitest";
import {
  accountForCounty,
  countiesIn,
  countyParts,
} from "../../../../supabase/pt/functions/_shared/multi-county";
import { expandByCounty, sourceIdOf } from "./pay-taxes-parts";
import type { PropertyRecord } from "./properties";

describe("two-county properties", () => {
  it("finds the counties a property pays taxes in", () => {
    expect(countiesIn("Bexar County, Kendall County")).toEqual(["Bexar", "Kendall"]);
    expect(countiesIn("Bexar , Kendall County")).toEqual(["Bexar", "Kendall"]);
    expect(countiesIn("Bexar Appraisal District")).toEqual(["Bexar"]);
    // a school district isn't a second county
    expect(countiesIn("Dallas County, Garland ISD")).toEqual(["Dallas"]);
  });

  it("picks each county's account out of the notes", () => {
    const a = "1313473 (Bexar County) 306657 (Kendall County)";
    expect(accountForCounty(a, "Bexar")).toBe("1313473");
    expect(accountForCounty(a, "Kendall")).toBe("306657");
    const b = "447170 - Comal County 1334687 - Bexar county";
    expect(accountForCounty(b, "Comal")).toBe("447170");
    expect(accountForCounty(b, "Bexar")).toBe("1334687");
    expect(accountForCounty("1149803", "Bexar")).toBe("1149803");
    expect(accountForCounty("1199177 (old)", "Bexar")).toBe("1199177 (old)");
    expect(accountForCounty(b, "Travis")).toBeNull();
    expect(countyParts("Bexar County", "1149803")).toEqual([]);
  });

  it("shows one Pay Taxes entry per county", () => {
    const p = {
      id: "p1",
      address: "28324 Leslie Pfeiffer Dr, Fair Oaks Ranch, TX",
      cad: "Bexar County, Kendall County",
      accountNumber: "1313473 (Bexar County) 306657 (Kendall County)",
      totalValue: 5_000_000,
    } as unknown as PropertyRecord;
    const parts = expandByCounty(p);
    expect(parts.map((x) => [x.id, x.cad, x.accountNumber, x.totalValue])).toEqual([
      ["p1~Bexar", "Bexar County", "1313473", null],
      ["p1~Kendall", "Kendall County", "306657", null],
    ]);
    expect(parts.every((x) => sourceIdOf(x) === "p1")).toBe(true);
    // an ordinary property stays one entry, unchanged
    const one = expandByCounty({ ...p, cad: "Bexar County", accountNumber: "1149803" });
    expect(one).toHaveLength(1);
    expect(one[0].id).toBe("p1");
  });

  it("splits when only the account notes name the second county", () => {
    expect(countyParts("Comal County", "447170 - Comal County 1334687 - Bexar county")).toEqual([
      { county: "Comal", accountNumber: "447170" },
      { county: "Bexar", accountNumber: "1334687" },
    ]);
    expect(countyParts("Bexar County", "123456 (Bexar County) 98765 - Fort Bend County")).toEqual([
      { county: "Bexar", accountNumber: "123456" },
      { county: "Fort Bend", accountNumber: "98765" },
    ]);
    // a plain account, or a district named after the county, is not a split
    expect(countyParts("Harris County", "0441230000012")).toEqual([]);
    expect(countyParts("Harris County", "Harris County MUD 5")).toEqual([]);
  });
});
