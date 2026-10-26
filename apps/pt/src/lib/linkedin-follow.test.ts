import { describe, expect, it } from "vitest";
import { shouldAskToFollow } from "./linkedin-follow";

const now = new Date("2026-10-26T12:00:00Z");

describe("shouldAskToFollow", () => {
  it("asks someone who hasn't followed or snoozed", () => {
    expect(shouldAskToFollow({ followedAt: null, snoozedUntil: null }, now)).toBe(true);
  });
  it("never asks again after Follow", () => {
    expect(shouldAskToFollow({ followedAt: "2026-10-01T00:00:00Z", snoozedUntil: null }, now)).toBe(
      false,
    );
  });
  it("waits out 'Maybe later', then asks again", () => {
    expect(shouldAskToFollow({ followedAt: null, snoozedUntil: "2026-11-09T12:00:00Z" }, now)).toBe(
      false,
    );
    expect(shouldAskToFollow({ followedAt: null, snoozedUntil: "2026-10-26T11:00:00Z" }, now)).toBe(
      true,
    );
  });
});
