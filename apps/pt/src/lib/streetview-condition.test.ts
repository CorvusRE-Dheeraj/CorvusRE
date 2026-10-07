import { describe, expect, it } from "vitest";
import {
  compareConditions,
  sanitizeRating,
  yearsOld,
  type RatedImage,
} from "../../../../supabase/pt/functions/_shared/streetview-condition";
import { directivePhrases } from "../../../../supabase/pt/functions/_shared/advisory-tone";

const img = (key: string, overall: number | null, imageDate = "2025-04"): RatedImage => ({
  key,
  address: `${key} St`,
  imageDate,
  value: null,
  rating: sanitizeRating(
    overall == null
      ? { usable: false }
      : { usable: true, overall, facade: overall, defects: ["cracked paving"] },
  ),
});

describe("sanitizeRating", () => {
  it("clamps ratings to 1-5 and drops everything for an unusable image", () => {
    expect(
      sanitizeRating({ usable: true, overall: 7, facade: 0, roof: "3", defects: ["x", "", 4] }),
    ).toEqual({
      usable: true,
      overall: null,
      facade: null,
      roof: 3,
      paving: null,
      site: null,
      defects: ["x"],
    });
    expect(sanitizeRating({ usable: false, overall: 4, defects: ["x"] }).overall).toBeNull();
    expect(sanitizeRating(null).usable).toBe(false);
  });
});

describe("compareConditions", () => {
  it("finds a subject in visibly worse condition than its comparables", () => {
    const c = compareConditions(
      [img("subject", 2), img("a", 4), img("b", 3), img("c", 4)],
      "2026-10",
    );
    expect(c.finding).toBe("worse");
    expect(c.compsMedian).toBe(4);
    expect(c.gap).toBe(2);
    expect(c.worseThan).toBe(3);
    expect(c.summary).toContain("2/5 against a 4/5 median for 3 comparables");
    expect(directivePhrases(c.summary)).toEqual([]);
  });

  it("calls a one-point-or-less difference similar, and a better subject better", () => {
    expect(
      compareConditions([img("subject", 3), img("a", 3), img("b", 4)], "2026-10").finding,
    ).toBe("similar");
    expect(
      compareConditions([img("subject", 5), img("a", 3), img("b", 3)], "2026-10").finding,
    ).toBe("better");
  });

  it("is inconclusive without a usable subject image or two usable comps", () => {
    expect(
      compareConditions([img("subject", null), img("a", 3), img("b", 3)], "2026-10").finding,
    ).toBe("inconclusive");
    const one = compareConditions([img("subject", 2), img("a", 4), img("b", null)], "2026-10");
    expect(one.finding).toBe("inconclusive");
    expect(one.caveats.some((x) => x.includes("left out"))).toBe(true);
  });

  it("flags imagery older than three years", () => {
    const c = compareConditions(
      [img("subject", 2, "2019-06"), img("a", 4), img("b", 4)],
      "2026-10",
    );
    expect(c.caveats.some((x) => x.includes("more than 3 years old"))).toBe(true);
    expect(yearsOld("2019-06", "2026-10")).toBe(7.3);
    expect(yearsOld(null, "2026-10")).toBeNull();
  });
});
