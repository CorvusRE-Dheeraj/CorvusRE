// Module 9's plain-language layer over the real analysis: the evidence
// label, the three "Why You May Be Paying Too Much" findings (built from
// this property's own module results and uploaded evidence — never generic
// copy), and the single next step. Pure; no new numbers are invented here.
import type { SavingsAnalysis } from "./savings-analysis";

export type EvidenceStrength = "Strong" | "Limited" | "Missing";

export const EVIDENCE_LABEL: Record<SavingsAnalysis["valuationConfidence"], string> = {
  High: "Strong Evidence",
  Moderate: "Limited Evidence",
  Limited: "Insufficient Information",
};

export type SavingsFinding = {
  key: "comps" | "property" | "documents";
  title: string;
  sentence: string;
  strength: EvidenceStrength;
  module: "comps" | "site" | "improvement" | "zoning" | "evidence";
};

export type FindingsInput = {
  comps: { count: number; median: number; gapPct: number | null; limitedData: boolean } | null;
  site: { factor: string; finding: string; status: string; severity: string }[] | null;
  improvement: { component: string; condition: string; hasPhoto: boolean }[] | null;
  zoning: { matches: string; discrepancy: string | null } | null;
  documents: {
    count: number;
    applied: boolean;
    direction: "lowers" | "raises" | "supports" | "none";
    strength: number;
    kinds: string[];
    indicatedValue: number | null;
  } | null;
};

const money = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
const sentence = (s: string) => {
  const t = s.trim().replace(/\s+/g, " ");
  return /[.!?]$/.test(t) ? t : `${t}.`;
};
const listOf = (items: string[]) =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

function compsFinding(c: FindingsInput["comps"]): SavingsFinding {
  const base = { key: "comps" as const, title: "Comparable Properties", module: "comps" as const };
  if (!c || c.count === 0) {
    return {
      ...base,
      sentence: "No comparable property values are available for this county yet.",
      strength: "Missing",
    };
  }
  const n = `${c.count} nearby comparable propert${c.count === 1 ? "y" : "ies"}`;
  if (c.gapPct != null && c.gapPct > 0) {
    return {
      ...base,
      sentence: `${n} have a median value of ${money(c.median)}, ${c.gapPct}% below your CAD value.`,
      strength: !c.limitedData && c.count >= 5 ? "Strong" : "Limited",
    };
  }
  return {
    ...base,
    sentence: `${n} are valued at or above your CAD value (median ${money(c.median)}), so they don't support a lower value on their own.`,
    strength: "Limited",
  };
}

function propertyFinding(i: FindingsInput): SavingsFinding {
  const base = { key: "property" as const, title: "Property Characteristics" };
  const site = (i.site ?? []).filter(
    (f) => (f.severity === "High" || f.severity === "Moderate") && f.finding,
  );
  const confirmedSite = site.find((f) => f.status === "Confirmed");
  if (confirmedSite) {
    return {
      ...base,
      module: "site",
      sentence: sentence(`${confirmedSite.factor}: ${confirmedSite.finding}`),
      strength: "Strong",
    };
  }
  const shown = (i.improvement ?? []).filter(
    (c) => c.hasPhoto && (c.condition === "Poor" || c.condition === "Fair"),
  );
  if (shown.length > 0) {
    const poor = shown.filter((c) => c.condition === "Poor");
    const pick = poor.length > 0 ? poor : shown;
    return {
      ...base,
      module: "improvement",
      sentence: `Your photos show the ${listOf(pick.map((c) => c.component.toLowerCase()))} in ${pick[0].condition.toLowerCase()} condition.`,
      strength: poor.length > 0 ? "Strong" : "Limited",
    };
  }
  if (i.zoning?.matches === "inconsistent" && i.zoning.discrepancy) {
    return {
      ...base,
      module: "zoning",
      sentence: sentence(
        `The county's classification may not match the property: ${i.zoning.discrepancy}`,
      ),
      strength: "Limited",
    };
  }
  const partialSite = site.find((f) => f.status === "Partial Data");
  if (partialSite) {
    return {
      ...base,
      module: "site",
      sentence: sentence(`${partialSite.factor}: ${partialSite.finding}`),
      strength: "Limited",
    };
  }
  return {
    ...base,
    module: "site",
    sentence: "No land, building-condition or classification issues are documented yet.",
    strength: "Missing",
  };
}

function documentsFinding(d: FindingsInput["documents"]): SavingsFinding {
  const base = {
    key: "documents" as const,
    title: "Supporting Documents",
    module: "evidence" as const,
  };
  if (!d || d.count === 0) {
    return {
      ...base,
      sentence:
        "No valuation documents uploaded yet — an appraisal, repair estimates, income statements or sales records can strengthen the case.",
      strength: "Missing",
    };
  }
  if (!d.applied) {
    return {
      ...base,
      sentence: `Your ${d.count} uploaded file${d.count === 1 ? "" : "s"} don't state a value, repair cost or income figure the analysis can use yet.`,
      strength: "Missing",
    };
  }
  const kinds = listOf(d.kinds.map((k) => k.toLowerCase())) || "documents";
  if (d.direction === "lowers" && d.indicatedValue != null) {
    return {
      ...base,
      sentence: `Your ${kinds} ${d.kinds.length === 1 ? "points" : "point"} to a value of about ${money(d.indicatedValue)}.`,
      strength: d.strength >= 0.6 ? "Strong" : "Limited",
    };
  }
  return {
    ...base,
    sentence: `Your uploaded ${kinds} support a value close to the county's.`,
    strength: "Limited",
  };
}

export function buildSavingsFindings(input: FindingsInput): SavingsFinding[] {
  return [compsFinding(input.comps), propertyFinding(input), documentsFinding(input.documents)];
}

export type SavingsNextStep = {
  kind: "potential" | "more_evidence" | "limited";
  title: string;
  message: string;
  button: string;
  module: "executive" | "evidence" | "comps";
};

export function getSavingsNextStep(
  a: Pick<
    SavingsAnalysis,
    "annualSavings" | "reductionBase" | "valuationConfidence" | "netBenefit" | "uncertainReasons"
  >,
  findings: SavingsFinding[],
): SavingsNextStep {
  const limited: SavingsNextStep = {
    kind: "limited",
    title: "Limited savings opportunity",
    message: "The available analysis does not currently support a meaningful reduction.",
    button: "Review Valuation Details",
    module: "comps",
  };
  if (a.reductionBase <= 0 || a.annualSavings < 1) return limited;
  const anyStrong = findings.some((f) => f.strength === "Strong");
  if (a.valuationConfidence === "Limited" || (!anyStrong && a.uncertainReasons.length > 0)) {
    return {
      kind: "more_evidence",
      title: "More evidence needed",
      message:
        "Upload comparable sales or property-condition information to improve your valuation analysis.",
      button: "Add Supporting Evidence",
      module: "evidence",
    };
  }
  if (a.netBenefit <= 0) {
    return {
      ...limited,
      message:
        "The estimated savings don't currently exceed the cost of a protest under your plan.",
    };
  }
  return {
    kind: "potential",
    title: "Potential savings identified",
    message:
      "Your property may be overvalued. Review the evidence and recommended protest strategy.",
    button: "View Protest Recommendation",
    module: "executive",
  };
}

export const SCENARIO_COPY: Record<"low" | "base" | "high", { title: string; plain: string }> = {
  low: {
    title: "Conservative",
    plain: "If the review panel agrees to only a small change, or none.",
  },
  base: {
    title: "Estimated",
    plain: "If the value is set near the middle of the supporting evidence.",
  },
  high: {
    title: "Higher Savings",
    plain: "If the panel accepts the strongest supported evidence.",
  },
};
