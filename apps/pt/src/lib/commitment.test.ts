import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { addMonths, cancelDecision } from "./commitment";

const d = (iso: string) => new Date(`${iso}T12:00:00Z`);
const day = (x: Date) => x.toISOString().slice(0, 10);

describe("addMonths", () => {
  it("clamps to the last day of shorter months", () => {
    expect(day(addMonths(d("2027-01-31"), 1))).toBe("2027-02-28");
    expect(day(addMonths(d("2028-01-31"), 1))).toBe("2028-02-29");
    expect(day(addMonths(d("2027-03-15"), 14))).toBe("2028-05-15");
  });
});

describe("cancelDecision — monthly", () => {
  const start = d("2027-01-15");

  it("refuses during the 12-month commitment and month 13, naming when notice opens", () => {
    for (const now of ["2027-01-16", "2027-09-01", "2028-01-14", "2028-02-14"]) {
      const r = cancelDecision("month", start, d(now));
      expect(r.allowed).toBe(false);
      if (!r.allowed) {
        expect(day(r.windowOpens)).toBe("2028-02-15"); // 13 months complete
        expect(day(r.windowCloses)).toBe("2028-03-15"); // month 15 begins
      }
    }
  });

  it("allows notice in month 14, ending 60 days later", () => {
    const r = cancelDecision("month", start, d("2028-02-20"));
    expect(r.allowed).toBe(true);
    if (r.allowed) {
      expect(r.atPeriodEnd).toBe(false);
      expect(day(r.endsAt!)).toBe("2028-04-20");
    }
  });

  it("starts a new 14-month cycle in month 15", () => {
    const r = cancelDecision("month", start, d("2028-03-20"));
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(day(r.windowOpens)).toBe("2029-04-15"); // cycle 2 starts 2028-03-15, +13 months
      expect(day(r.windowCloses)).toBe("2029-05-15");
    }
  });
});

describe("cancelDecision — annual", () => {
  it("always allowed; ends when the paid year ends", () => {
    expect(cancelDecision("year", d("2027-01-15"), d("2027-02-01"))).toEqual({
      allowed: true,
      endsAt: null,
      atPeriodEnd: true,
    });
  });
});

describe("server copy", () => {
  it("matches supabase/pt/functions/_shared/commitment.ts below the header", () => {
    const body = (p: string) =>
      readFileSync(resolve(__dirname, p), "utf8").replace(/^(\/\/.*\r?\n)+/, "");
    expect(body("./commitment.ts")).toBe(
      body("../../../../supabase/pt/functions/_shared/commitment.ts"),
    );
  });
});
