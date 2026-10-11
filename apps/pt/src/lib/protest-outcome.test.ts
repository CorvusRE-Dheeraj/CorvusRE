import { describe, it, expect } from "vitest";
import { protestOutcome } from "./protest-outcome";

describe("protestOutcome", () => {
  it("0% (or no reduction at all): Try again next year, muted", () => {
    expect(protestOutcome(0)).toEqual({
      label: "Try again next year",
      message: "The protest did not result in a reduction.",
      tone: "muted",
    });
    expect(protestOutcome(null).label).toBe("Try again next year");
    expect(protestOutcome(undefined).tone).toBe("muted");
  });

  it("0-5%: Good Protest Outcome", () => {
    expect(protestOutcome(3).label).toBe("Good Protest Outcome");
    expect(protestOutcome(5).label).toBe("Good Protest Outcome");
    expect(protestOutcome(3).tone).toBe("success");
  });

  it("5-10%: Very Good Protest Outcome", () => {
    expect(protestOutcome(7).label).toBe("Very Good Protest Outcome");
    expect(protestOutcome(10).label).toBe("Very Good Protest Outcome");
  });

  it("10-15%: Excellent Protest Outcome", () => {
    expect(protestOutcome(12).label).toBe("Excellent Protest Outcome");
    expect(protestOutcome(15).label).toBe("Excellent Protest Outcome");
  });

  it("15-25%: Exceptional Protest Outcome", () => {
    expect(protestOutcome(20).label).toBe("Exceptional Protest Outcome");
    expect(protestOutcome(25).label).toBe("Exceptional Protest Outcome");
  });

  it("25%+: Outstanding Protest Outcome — the reported 39% case", () => {
    expect(protestOutcome(26).label).toBe("Outstanding Protest Outcome");
    expect(protestOutcome(39)).toEqual({
      label: "Outstanding Protest Outcome",
      message: "A substantial reduction was achieved.",
      tone: "success",
    });
  });
});
