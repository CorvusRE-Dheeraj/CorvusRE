import { describe, expect, it } from "vitest";
import { pickFemaleVoice } from "./use-speech-output";

// Realistic voice lists as real browsers actually report them, per platform.
const WINDOWS_EDGE = [
  { name: "Microsoft David - English (United States)", lang: "en-US" },
  { name: "Microsoft Zira - English (United States)", lang: "en-US" },
  { name: "Microsoft Mark - English (United States)", lang: "en-US" },
];
const WINDOWS_EDGE_NEURAL = [
  { name: "Microsoft Guy Online (Natural) - English (United States)", lang: "en-US" },
  { name: "Microsoft Jenny Online (Natural) - English (United States)", lang: "en-US" },
  { name: "Microsoft Aria Online (Natural) - English (United States)", lang: "en-US" },
];
const MACOS_SAFARI = [
  { name: "Alex", lang: "en-US" },
  { name: "Samantha", lang: "en-US" },
  { name: "Victoria", lang: "en-US" },
];
const CHROME_GOOGLE = [
  { name: "Google US English", lang: "en-US" },
  { name: "Google UK English Female", lang: "en-GB" },
  { name: "Google UK English Male", lang: "en-GB" },
];
const NON_ENGLISH_ONLY = [
  { name: "Microsoft Hedda - German", lang: "de-DE" },
  { name: "Microsoft Stefan - German", lang: "de-DE" },
];

describe("pickFemaleVoice", () => {
  it("picks Zira over David/Mark on Windows", () => {
    expect(pickFemaleVoice(WINDOWS_EDGE)?.name).toContain("Zira");
  });
  it("picks Jenny or Aria over Guy on Windows' neural voices", () => {
    const picked = pickFemaleVoice(WINDOWS_EDGE_NEURAL)?.name ?? "";
    expect(picked.includes("Jenny") || picked.includes("Aria")).toBe(true);
  });
  it("picks Samantha over Alex on macOS/Safari", () => {
    expect(pickFemaleVoice(MACOS_SAFARI)?.name).toBe("Samantha");
  });
  it("picks the explicitly-labelled Female voice over the Male one on Chrome", () => {
    const picked = pickFemaleVoice(CHROME_GOOGLE);
    expect(picked?.name).toBe("Google UK English Female");
  });
  it("prefers an English voice even when a non-English one is listed first", () => {
    const mixed = [{ name: "Microsoft Hedda - German", lang: "de-DE" }, ...WINDOWS_EDGE];
    expect(pickFemaleVoice(mixed)?.lang).toBe("en-US");
  });
  it("falls back to a non-male voice when nothing matches a known female name", () => {
    // No language matches "en" at all here, so it falls back to the full list — and even
    // though neither name is a known female one, Hedda isn't flagged male either.
    expect(pickFemaleVoice(NON_ENGLISH_ONLY)?.name).toContain("Hedda");
  });
  it("returns null for an empty voice list", () => {
    expect(pickFemaleVoice([])).toBeNull();
  });
});
