import { describe, expect, it } from "vitest";
import {
  decideCarryForward,
  isRenewalDue,
  type TaxBillRow,
} from "../../../../supabase/pt/functions/_shared/tax-carry-forward";

const bill = (tax_year: number | null, amount_due: number | null, created_at = "2027-01-01") =>
  ({ tax_year, amount_due, created_at }) satisfies TaxBillRow;

describe("decideCarryForward", () => {
  it("carries the year forward when the proposed tax is unchanged from the previous year", () => {
    expect(decideCarryForward([bill(2026, 12_400), bill(2027, 12_400)])).toEqual({
      result: "carry_forward",
      latestYear: 2027,
      previousYear: 2026,
      amount: 12_400,
    });
  });

  it("ignores rounding differences of a dollar or less", () => {
    expect(decideCarryForward([bill(2026, 12_400.4), bill(2027, 12_400.9)]).result).toBe(
      "carry_forward",
    );
  });

  it("charges the subscription fee when the proposed tax changed", () => {
    expect(decideCarryForward([bill(2026, 12_400), bill(2027, 11_900)])).toEqual({
      result: "charge",
      reason: "changed",
      latestYear: 2027,
      previousYear: 2026,
    });
  });

  it("charges normally when either year's amount is missing", () => {
    expect(decideCarryForward([])).toMatchObject({ result: "charge", reason: "missing_data" });
    expect(decideCarryForward([bill(2027, 12_400)])).toMatchObject({
      result: "charge",
      reason: "missing_data",
    });
    // A gap year doesn't count as "the previous year".
    expect(decideCarryForward([bill(2025, 12_400), bill(2027, 12_400)])).toMatchObject({
      result: "charge",
      reason: "missing_data",
    });
    expect(decideCarryForward([bill(2026, 12_400), bill(2027, null)])).toMatchObject({
      result: "charge",
      reason: "missing_data",
    });
  });

  it("uses the most recently recorded bill when a year has a corrected re-upload", () => {
    const bills = [
      bill(2026, 12_400),
      bill(2027, 13_000, "2027-01-02"),
      bill(2027, 12_400, "2027-02-10"), // corrected bill, recorded later
    ];
    expect(decideCarryForward(bills).result).toBe("carry_forward");
  });
});

describe("isRenewalDue", () => {
  const now = new Date("2027-10-01T00:00:00Z");
  const days = (n: number) => Math.floor(now.getTime() / 1000) + n * 86_400;

  it("is due within the next 14 days only", () => {
    expect(isRenewalDue(days(13), now)).toBe(true);
    expect(isRenewalDue(days(14), now)).toBe(true);
    expect(isRenewalDue(days(15), now)).toBe(false);
    expect(isRenewalDue(days(-1), now)).toBe(false);
  });
});
