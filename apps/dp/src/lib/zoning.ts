// Zoning classification + feasibility analysis (PRD 1.1.5 / 1.1.6 / 2.1.5).
import type { ProjectIntent, PropertySector } from "./dp-intake";

export type ZoningCategory =
  "residential" | "commercial" | "mixed_use" | "industrial" | "agricultural" | "unknown";

export type ZoningClassification = {
  code: string;
  label: string;
  category: ZoningCategory;
};

const PREFIX_MAP: { test: RegExp; label: string; category: ZoningCategory }[] = [
  { test: /^(sf|r-?\d|rs|rd|rmf|mf|rr|res)/i, label: "Residential", category: "residential" },
  { test: /^(mu|nmu|tod|form|f-?\d)/i, label: "Mixed Use", category: "mixed_use" },
  {
    test: /^(c-?\d|cs|cc|cbd|gr|lr|comm|b-?\d| o-?\d|office|retail)/i,
    label: "Commercial",
    category: "commercial",
  },
  {
    test: /^(li|hi|i-?\d|ip|ind|m-?\d|w\/lo|indust)/i,
    label: "Industrial",
    category: "industrial",
  },
  { test: /^(ag|a-?\d|ra|farm|rural)/i, label: "Agricultural / Rural", category: "agricultural" },
];

export function classifyZoning(raw: string | undefined | null): ZoningClassification {
  const code = (raw ?? "").trim();
  if (!code) return { code: "", label: "Not determined", category: "unknown" };
  for (const { test, label, category } of PREFIX_MAP) {
    if (test.test(code)) return { code, label, category };
  }
  // fall back to keyword scan of the full string
  const lower = code.toLowerCase();
  if (lower.includes("resid")) return { code, label: "Residential", category: "residential" };
  if (lower.includes("commerc") || lower.includes("business"))
    return { code, label: "Commercial", category: "commercial" };
  if (lower.includes("indus")) return { code, label: "Industrial", category: "industrial" };
  if (lower.includes("mixed")) return { code, label: "Mixed Use", category: "mixed_use" };
  if (lower.includes("agri") || lower.includes("rural"))
    return { code, label: "Agricultural / Rural", category: "agricultural" };
  return { code, label: code.toUpperCase(), category: "unknown" };
}

export type FeasibilityStatus = "allowed" | "conditional" | "not_allowed";

export type FeasibilityRisk = {
  title: string;
  plainLanguage: string;
  approval: string;
  addedReviewMonths: [number, number];
  addedCost: string;
};

export type FeasibilityResult = {
  status: FeasibilityStatus;
  confidence: number; // 0..1
  summary: string;
  risks: FeasibilityRisk[];
};

// Which zoning categories comfortably host which project sector.
const SECTOR_FIT: Record<PropertySector, ZoningCategory[]> = {
  commercial: ["commercial", "mixed_use", "industrial"],
  residential: ["residential", "mixed_use", "agricultural"],
};

const CONDITIONAL_FIT: Record<PropertySector, ZoningCategory[]> = {
  commercial: ["agricultural"],
  residential: ["commercial"],
};

const REZONING_RISK: FeasibilityRisk = {
  title: "Proposed use is not permitted under current zoning",
  plainLanguage:
    "The property's zoning does not currently allow what you want to build. You would need to apply to have it rezoned before a building permit can be issued.",
  approval: "Rezoning / zoning change application (Planning Commission + governing body hearings)",
  addedReviewMonths: [3, 6],
  addedCost: "Application + notification + traffic/impact studies — varies by jurisdiction",
};

const CUP_RISK: FeasibilityRisk = {
  title: "Use may be allowed only with a Conditional Use / Specific Use Permit",
  plainLanguage:
    "Your use is not permitted outright in this zone but can often be approved with conditions after a public hearing.",
  approval: "Conditional Use Permit (CUP) or Specific Use Permit (SUP)",
  addedReviewMonths: [2, 4],
  addedCost: "Application fee + notification mailing + possible site-plan conditions",
};

const SITE_DEV_RISK: FeasibilityRisk = {
  title: "Site development / platting required before vertical construction",
  plainLanguage:
    "Because this is undeveloped land, civil infrastructure and a recorded plat generally have to be approved before a building permit.",
  approval: "Subdivision plat + civil / site development permit",
  addedReviewMonths: [2, 5],
  addedCost: "Engineering, survey, and infrastructure design fees",
};

export function analyzeFeasibility(input: {
  intent?: ProjectIntent;
  sector?: PropertySector;
  zoning: ZoningClassification;
}): FeasibilityResult {
  const { intent, zoning } = input;
  const sector = input.sector ?? "commercial";
  const risks: FeasibilityRisk[] = [];

  const knownZoning = zoning.category !== "unknown" && zoning.code !== "";
  let confidence = knownZoning ? 0.8 : 0.4;

  let status: FeasibilityStatus;
  if (!knownZoning) {
    status = "conditional";
    confidence = 0.4;
  } else if (SECTOR_FIT[sector].includes(zoning.category)) {
    status = "allowed";
  } else if (CONDITIONAL_FIT[sector].includes(zoning.category)) {
    status = "conditional";
    risks.push(CUP_RISK);
    confidence -= 0.1;
  } else {
    status = "not_allowed";
    risks.push(REZONING_RISK);
  }

  // Remodeling an existing conforming building rarely triggers a use problem.
  if (intent === "remodeling" && status === "not_allowed") {
    status = "conditional";
    confidence -= 0.05;
  }

  if (
    (intent === "new_construction" || intent === "site_development") &&
    status !== "not_allowed"
  ) {
    risks.push(SITE_DEV_RISK);
  }

  const summary =
    status === "allowed"
      ? `The proposed ${labelIntent(intent)} appears consistent with the property's ${zoning.label} zoning. Standard permitting applies.`
      : status === "conditional"
        ? knownZoning
          ? `The proposed ${labelIntent(intent)} may be achievable in the property's ${zoning.label} zoning but likely needs a discretionary approval or additional review before permitting.`
          : `Zoning could not be confirmed from public data. A CorvusDP specialist will verify the classification; treat this feasibility as preliminary.`
        : `The proposed ${labelIntent(intent)} is not permitted under the property's ${zoning.label} zoning as entered. A rezoning would be required before a building permit.`;

  return {
    status,
    confidence: Math.max(0.2, Math.min(0.95, confidence)),
    summary,
    risks,
  };
}

function labelIntent(intent?: ProjectIntent): string {
  switch (intent) {
    case "new_construction":
      return "new construction";
    case "addition":
      return "building addition";
    case "remodeling":
      return "remodel";
    case "site_development":
      return "site development";
    default:
      return "project";
  }
}

export function statusLabel(s: FeasibilityStatus): string {
  return s === "allowed" ? "Allowed" : s === "conditional" ? "Conditional" : "Not Allowed";
}
