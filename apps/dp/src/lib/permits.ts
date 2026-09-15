// Permit identification & complexity (PRD 1.1.8 / 1.1.8.A / 2.1.6).
import type { ProjectIntent, PropertySector } from "./dp-intake";

export type PermitCategory =
  "Building" | "Site / Civil" | "Fire" | "Utilities" | "Plat" | "Environmental";

export type PermitItem = {
  id: string;
  name: string;
  category: PermitCategory;
  description: string;
  /** ids of permits that must be approved (or at least submitted) first */
  dependsOn: string[];
  /** true when this permit can be submitted in parallel with its siblings */
  concurrent: boolean;
};

const P = (
  id: string,
  name: string,
  category: PermitCategory,
  description: string,
  dependsOn: string[] = [],
  concurrent = false,
): PermitItem => ({ id, name, category, description, dependsOn, concurrent });

export function identifyPermits(input: {
  intent?: ProjectIntent;
  sector?: PropertySector;
  lotSizeSqft?: number | null;
  floors?: number | null;
}): PermitItem[] {
  const { intent } = input;
  const large = (input.lotSizeSqft ?? 0) >= 43560; // >= 1 acre
  const multiStory = (input.floors ?? 1) >= 2;
  const out: PermitItem[] = [];

  const isGroundUp = intent === "new_construction" || intent === "site_development";

  if (isGroundUp) {
    out.push(
      P(
        "plat",
        "Subdivision / Plat",
        "Plat",
        "Record or amend the plat to establish legal lots, easements, and dedications.",
      ),
    );
    out.push(
      P(
        "site",
        "Site Development Permit",
        "Site / Civil",
        "Grading, drainage, paving, and overall site layout approval.",
        ["plat"],
        true,
      ),
    );
    out.push(
      P(
        "civil",
        "Civil / Infrastructure Permit",
        "Site / Civil",
        "Public water, wastewater, and storm infrastructure construction.",
        ["plat"],
        true,
      ),
    );
    out.push(
      P(
        "grading",
        "Grading / Earthwork Permit",
        "Site / Civil",
        "Earth-moving, cut/fill, and erosion control (SWPPP).",
        ["site"],
        true,
      ),
    );
    out.push(
      P(
        "utility",
        "Utility Service Approval",
        "Utilities",
        "Confirmation of water/wastewater capacity and connection agreements.",
        ["civil"],
      ),
    );
    out.push(
      P(
        "building",
        "Building Permit",
        "Building",
        "Vertical construction — architectural, structural, MEP.",
        ["site"],
      ),
    );
    out.push(
      P(
        "fire",
        "Fire Review",
        "Fire",
        "Fire lanes, hydrants, sprinkler/alarm, and life-safety review.",
        ["site"],
        true,
      ),
    );
  } else if (intent === "addition") {
    out.push(
      P(
        "building",
        "Building Permit (Addition)",
        "Building",
        "Structural addition to an existing building — architectural, structural, MEP for the new area.",
      ),
    );
    out.push(
      P(
        "site",
        "Site Plan Amendment",
        "Site / Civil",
        "Updated parking, access, drainage, and impervious cover for the added area.",
        [],
        true,
      ),
    );
    out.push(
      P(
        "fire",
        "Fire Review",
        "Fire",
        "Updated fire access and suppression review for the enlarged building.",
        ["building"],
        true,
      ),
    );
    out.push(
      P(
        "utility",
        "Utility Capacity Check",
        "Utilities",
        "Verify existing water/sewer/electric service supports the added load.",
        [],
        true,
      ),
    );
  } else {
    // remodeling / interior
    out.push(
      P(
        "building",
        "Building Permit (Remodel)",
        "Building",
        "Interior alterations — architectural, and affected structural / MEP.",
      ),
    );
    out.push(
      P(
        "fire",
        "Fire Review",
        "Fire",
        "Egress, occupancy, and suppression review for the altered space.",
        ["building"],
        true,
      ),
    );
  }

  if (large && isGroundUp) {
    out.push(
      P(
        "env",
        "Environmental / Stormwater Review",
        "Environmental",
        "Floodplain, water-quality, tree, and endangered-species review for larger tracts.",
        ["plat"],
        true,
      ),
    );
  }
  if (multiStory) {
    const b = out.find((p) => p.id === "building");
    if (b)
      b.description +=
        " Multi-story triggers additional structural and fire-rated assembly review.";
  }

  return out;
}

export type ComplexityLevel = "Easy" | "Moderate" | "Complex";

export type ComplexitySummary = {
  permitCount: number;
  dependencyCount: number;
  score: number;
  level: ComplexityLevel;
  estimatedApprovals: number;
  estimatedReviewCycles: number;
};

export function summarizeComplexity(permits: PermitItem[]): ComplexitySummary {
  const permitCount = permits.length;
  const dependencyCount = permits.reduce((n, p) => n + p.dependsOn.length, 0);
  const categories = new Set(permits.map((p) => p.category)).size;
  const score = permitCount * 2 + dependencyCount + categories;

  const level: ComplexityLevel = score <= 7 ? "Easy" : score <= 16 ? "Moderate" : "Complex";
  return {
    permitCount,
    dependencyCount,
    score,
    level,
    estimatedApprovals: permitCount,
    estimatedReviewCycles: level === "Easy" ? 1 : level === "Moderate" ? 2 : 3,
  };
}

export function groupByCategory(permits: PermitItem[]): Record<string, PermitItem[]> {
  return permits.reduce<Record<string, PermitItem[]>>((acc, p) => {
    (acc[p.category] ??= []).push(p);
    return acc;
  }, {});
}
