import { describe, it, expect } from "vitest";
import { identifyPermits, summarizeComplexity, groupByCategory } from "./permits";

describe("identifyPermits", () => {
  it("returns a plat + site + building chain for ground-up construction", () => {
    const permits = identifyPermits({ intent: "new_construction", sector: "commercial" });
    const ids = permits.map((p) => p.id);
    expect(ids).toContain("plat");
    expect(ids).toContain("site");
    expect(ids).toContain("building");
    const building = permits.find((p) => p.id === "building")!;
    expect(building.dependsOn).toContain("site");
  });

  it("is lighter for an interior remodel", () => {
    const permits = identifyPermits({ intent: "remodeling", sector: "commercial" });
    expect(permits.length).toBeLessThan(4);
    expect(permits.map((p) => p.id)).not.toContain("plat");
  });

  it("adds an environmental review only for large ground-up tracts", () => {
    const small = identifyPermits({ intent: "new_construction", lotSizeSqft: 20000 });
    const large = identifyPermits({ intent: "new_construction", lotSizeSqft: 200000 });
    expect(small.map((p) => p.id)).not.toContain("env");
    expect(large.map((p) => p.id)).toContain("env");
  });

  it("notes extra structural review for multi-story", () => {
    const permits = identifyPermits({ intent: "new_construction", floors: 4 });
    expect(permits.find((p) => p.id === "building")!.description).toMatch(/multi-story/i);
  });
});

describe("summarizeComplexity", () => {
  it("scores a remodel as Easy and a full ground-up as Moderate/Complex", () => {
    const remodel = summarizeComplexity(identifyPermits({ intent: "remodeling" }));
    const groundUp = summarizeComplexity(
      identifyPermits({ intent: "new_construction", lotSizeSqft: 200000, floors: 3 }),
    );
    expect(remodel.level).toBe("Easy");
    expect(["Moderate", "Complex"]).toContain(groundUp.level);
    expect(groundUp.estimatedReviewCycles).toBeGreaterThanOrEqual(remodel.estimatedReviewCycles);
  });
});

describe("groupByCategory", () => {
  it("buckets permits by their category", () => {
    const grouped = groupByCategory(identifyPermits({ intent: "new_construction" }));
    expect(Object.keys(grouped)).toContain("Building");
    expect(Object.keys(grouped)).toContain("Site / Civil");
  });
});
