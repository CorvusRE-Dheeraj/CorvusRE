import { describe, expect, it } from "vitest";
import { wrap } from "./plan-export";

describe("concept sheet text", () => {
  it("wraps on word boundaries without losing words", () => {
    const text = "Placing the building toward the rear keeps the street frontage open for parking and access.";
    const lines = wrap(text, 30);
    expect(lines.every((l) => l.length <= 30)).toBe(true);
    expect(lines.join(" ")).toBe(text);
  });
  it("keeps a single long word on its own line", () => {
    expect(wrap("supercalifragilistic word", 10)).toEqual(["supercalifragilistic", "word"]);
  });
});
