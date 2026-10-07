import type { PropertyRecord } from "./properties";
import type { PropertyAiScore } from "./property-scores";
import type { CompProperty } from "./cad-comps";
import type { ComparableStats } from "./comps-analysis";
import {
  classifyPropertyCategory,
  getAssessmentRatioInfo,
  getEffectiveTaxRate,
} from "./texas-tax-rates";

// The case preview shown before checkout: "show me you found the case before
// asking me to buy the case." A contingency firm is trusted after it produces
// a result; Corvus asks for payment first, so it shows its work first — the
// official assessment, the preliminary opportunity, the evidence it found,
// the comps and their quality, an estimated range (never false precision),
// the data sources, sample evidence pages, a sample hearing plan, and
// exactly what unlocks. Every line comes from data already on file or
// fetched for free (CAD record, county comps); nothing is invented, and
// anything Corvus doesn't have yet says so. Pure, so it's tested.

export type PreviewInput = {
  property: PropertyRecord;
  score: PropertyAiScore | null;
  comps: { subject: CompProperty | null; comps: CompProperty[] } | null;
  compStats: ComparableStats | null;
  evidenceDocuments: number;
};

export type OpportunityLevel = "potential" | "possible" | "not_yet";

export type EvidenceCategory = {
  label: string;
  found: boolean;
  detail: string;
};

export type CompQuality = "Strong" | "Moderate" | "Limited" | "None";

export type SampleComp = {
  address: string;
  value: number;
  distanceMi: number | null;
  similarity: number | null;
};

export type HearingStep = { title: string; detail: string; locked: boolean };

export type CasePreview = {
  assessment: {
    cad: string | null;
    accountNumber: string | null;
    taxYear: number | null;
    total: number | null;
    land: number | null;
    improvement: number | null;
    priorYear: { year: number; total: number } | null;
    changePct: number | null;
  };
  opportunity: { level: OpportunityLevel; label: string; score: number | null; reasons: string[] };
  evidence: EvidenceCategory[];
  comps: {
    count: number;
    quality: CompQuality;
    qualityBasis: string;
    median: number | null;
    belowSubject: number;
    gapPct: number | null;
    sample: SampleComp[]; // shown in full
    lockedCount: number; // the rest, in the paid report
  };
  savingsRange: { low: number; high: number; basis: string } | null;
  sources: { name: string; used: string }[];
  hearingPlan: HearingStep[];
};

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const roundTo = (n: number, step: number) => Math.round(n / step) * step;

// How wide the savings range is around the point estimate. A comps-based
// estimate rests on real county comparables, so it's narrower than the
// formula estimate built from county-wide protest averages.
export const RANGE_SPREAD = { comps: 0.25, formula: 0.4 } as const;
export const SAMPLE_COMPS = 2;

function opportunity(i: PreviewInput): CasePreview["opportunity"] {
  const s = i.score?.score ?? null;
  const gap = i.compStats?.valuationGapPct ?? null;
  const est = i.property.estimatedSavings ?? 0;
  const level: OpportunityLevel =
    (s != null && s >= 70) || (gap != null && gap >= 10 && est > 0)
      ? "potential"
      : (s != null && s >= 40) || est > 0
        ? "possible"
        : "not_yet";
  return {
    level,
    label:
      level === "potential"
        ? "Corvus identifies a potential protest opportunity"
        : level === "possible"
          ? "Corvus sees a possible opportunity — the full analysis would confirm it"
          : "Corvus hasn't identified a clear opportunity yet",
    score: s,
    reasons: (i.score?.factors ?? []).slice(0, 3),
  };
}

function compQuality(stats: ComparableStats | null, count: number): [CompQuality, string] {
  if (count === 0) return ["None", "No county comparables available for this property yet."];
  const conf = stats?.confidencePct ?? null;
  const near = (stats?.ranked ?? []).filter(
    (c) => c.distanceMi != null && c.distanceMi <= 1,
  ).length;
  if (stats?.limitedData || count < 3)
    return ["Limited", `${count} comparable${count === 1 ? "" : "s"} — fewer than 3 usable.`];
  if (conf != null && conf >= 70 && near >= 3)
    return ["Strong", `${count} comparables, ${near} within a mile; ${conf}% confidence.`];
  return [
    "Moderate",
    `${count} comparables${near ? `, ${near} within a mile` : ""}${conf != null ? `; ${conf}% confidence` : ""}.`,
  ];
}

export function casePreview(i: PreviewInput): CasePreview {
  const p = i.property;
  const history = [...(p.valueHistory ?? [])]
    .map((h) => ({ year: h.year, total: h.appraisedValue ?? h.marketValue ?? null }))
    .filter((h): h is { year: number; total: number } => h.total != null && h.total > 0)
    .sort((a, b) => b.year - a.year);
  const prior = history.find((h) => p.taxYear == null || h.year < p.taxYear) ?? null;
  const changePct =
    prior && p.totalValue
      ? Math.round(((p.totalValue - prior.total) / prior.total) * 1000) / 10
      : null;

  // Comps.
  const stats = i.compStats;
  const ranked = stats?.ranked ?? [];
  const raw = i.comps?.comps ?? [];
  const usable = ranked.length > 0 ? ranked : raw;
  const count = usable.filter((c) => (c.marketValue ?? 0) > 0).length;
  const [quality, qualityBasis] = compQuality(stats, count);
  const subjectValue = p.totalValue ?? null;
  const belowSubject =
    subjectValue != null
      ? usable.filter((c) => c.marketValue != null && c.marketValue < subjectValue).length
      : 0;
  const sample: SampleComp[] = [...ranked]
    .filter((c) => c.marketValue != null)
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, SAMPLE_COMPS)
    .map((c) => ({
      address: c.address,
      value: c.marketValue as number,
      distanceMi: c.distanceMi != null ? Math.round(c.distanceMi * 10) / 10 : null,
      similarity: c.similarity ?? null,
    }));

  // Savings: a range around the estimate, never a single precise figure.
  const est = p.estimatedSavings;
  const basis = p.savingsBasis === "comps" ? "comps" : "formula";
  const spread = RANGE_SPREAD[basis];
  const savingsRange =
    est != null && est > 0
      ? {
          low: roundTo(est * (1 - spread), 100),
          high: roundTo(est * (1 + spread), 100),
          basis:
            basis === "comps"
              ? "From county comparables — the full valuation narrows it"
              : "From county protest outcomes and tax rates — the full valuation narrows it",
        }
      : null;

  // Evidence categories found.
  const category = classifyPropertyCategory(p.propertyType);
  const ratio = getAssessmentRatioInfo(p.cad, category);
  const evidence: EvidenceCategory[] = [
    {
      label: "Official appraisal record",
      found: p.totalValue != null,
      detail:
        p.totalValue != null
          ? `${p.cad ?? "County"} ${p.taxYear ?? ""} value ${usd(p.totalValue)}`.replace("  ", " ")
          : "Not matched yet",
    },
    {
      label: "Value history",
      found: prior != null,
      detail:
        prior != null
          ? `${history.length + (history.some((h) => h.year === p.taxYear) ? 0 : 1)} years on record${changePct != null ? `; ${changePct > 0 ? "+" : ""}${changePct}% vs ${prior?.year}` : ""}`
          : "Not published for this county",
    },
    {
      label: "Equal & uniform comparables",
      found: count > 0,
      detail:
        count > 0 ? `${count} county-appraised comparables` : "Not available for this county yet",
    },
    {
      label: "Land vs. improvement split",
      found: p.landValue != null && p.improvementValue != null,
      detail:
        p.landValue != null && p.improvementValue != null && p.totalValue
          ? `Land is ${Math.round((p.landValue / p.totalValue) * 100)}% of the value`
          : "Not split in the county record",
    },
    {
      label: "State ratio study",
      found: ratio != null,
      detail: ratio
        ? `Comptroller median ratio ${ratio.medianPct}%${ratio.codOverCeiling > 0 ? `; uniformity ${ratio.cod} COD, above the standard` : ""}`
        : "No county study for this property type",
    },
    {
      label: "Your documents",
      found: i.evidenceDocuments > 0,
      detail:
        i.evidenceDocuments > 0
          ? `${i.evidenceDocuments} uploaded`
          : "None yet — rent roll, P&L, photos and repair bids add support",
    },
  ];

  // Data sources actually used for this preview.
  const rate = getEffectiveTaxRate(p.cad);
  const sources: CasePreview["sources"] = [
    {
      name: `${p.cad ?? "County appraisal district"} appraisal roll`,
      used: `Account ${p.accountNumber ?? "—"}${p.taxYear ? `, tax year ${p.taxYear}` : ""}`,
    },
    ...(count > 0
      ? [{ name: "County comparable parcels", used: `${count} appraised properties nearby` }]
      : []),
    ...(ratio
      ? [{ name: "Texas Comptroller Property Value Study", used: "Median ratio and uniformity" }]
      : []),
    {
      name: "Texas effective tax rates",
      used: `${Math.round(rate * 10000) / 100}% applied to estimate savings`,
    },
    ...(p.savingsBasis === "formula"
      ? [{ name: "Published protest outcomes", used: "County and property-type reduction rates" }]
      : []),
  ];

  // A sample hearing plan: the structure in full, the first steps filled in
  // from what was found, the rest unlocked by the paid report.
  const lead =
    count >= 3 && (stats?.valuationGapPct ?? 0) > 0
      ? "Equal & uniform comparison"
      : changePct != null && changePct > 10
        ? "The year-over-year increase"
        : ratio && ratio.codOverCeiling > 0
          ? "County appraisal uniformity"
          : "Market value evidence";
  const hearingPlan: HearingStep[] = [
    {
      title: "Opening — the value in question",
      detail: `${p.cad ?? "The district"}'s ${usd(p.totalValue ?? 0)}${savingsRange ? `, against the range Corvus estimates the evidence supports` : ""}.`,
      locked: false,
    },
    {
      title: `Argument Corvus rates first: ${lead}`,
      detail:
        lead === "Equal & uniform comparison"
          ? `${belowSubject} of ${count} comparables are appraised below this property${stats?.valuationGapPct != null ? `; this property is appraised ${stats.valuationGapPct}% above their median` : ""} (Tax Code §41.43(b)(3)).`
          : lead === "The year-over-year increase"
            ? `The value rose ${changePct}% from ${prior?.year}.`
            : lead === "County appraisal uniformity"
              ? `The state's ratio study shows uneven appraisal for this property type in ${p.cad}.`
              : "Built from the valuation approaches in the full report.",
      locked: false,
    },
    {
      title: "Supporting arguments",
      detail: "Income, sales, land and condition approaches.",
      locked: true,
    },
    {
      title: "Likely district responses",
      detail: "And the evidence that answers each.",
      locked: true,
    },
    {
      title: "Exhibits and order of presentation",
      detail: "Mapped to the evidence packet.",
      locked: true,
    },
    {
      title: "Settlement considerations",
      detail: "Corvus's estimated outcome range.",
      locked: true,
    },
  ];

  return {
    assessment: {
      cad: p.cad,
      accountNumber: p.accountNumber,
      taxYear: p.taxYear,
      total: p.totalValue,
      land: p.landValue,
      improvement: p.improvementValue,
      priorYear: prior,
      changePct,
    },
    opportunity: opportunity(i),
    evidence,
    comps: {
      count,
      quality,
      qualityBasis,
      median: stats?.indicated?.median ?? null,
      belowSubject,
      gapPct: stats?.valuationGapPct ?? null,
      sample,
      lockedCount: Math.max(0, count - sample.length),
    },
    savingsRange,
    sources,
    hearingPlan,
  };
}

// What a purchase unlocks for this property, in the order the owner meets it.
export const UNLOCKS: { title: string; detail: string }[] = [
  {
    title: "All 10 AI report modules",
    detail:
      "Modules 4–10 join the free 1–3: site and improvement condition, zoning, income & P&L, the Evidence Builder, tax savings & ROI, and the Executive Protest Report.",
  },
  {
    title: "Full commercial valuation",
    detail:
      "Six approaches — equity, income, sales, land, impairments and cost — reconciled to one supportable range.",
  },
  {
    title: "Every comparable",
    detail:
      "The full comp set with similarity scores, adjustments and the ones Corvus suggests excluding.",
  },
  {
    title: "Evidence Builder packet",
    detail: "The complete PDF evidence packet for the hearing, built from your property's data.",
  },
  {
    title: "Filing steps, forms and deadlines",
    detail:
      "Your county's Notice of Protest pre-filled, its accepted filing methods and every deadline tracked.",
  },
  {
    title: "Hearing plan and prep guide",
    detail: "The full plan above, plus the district-evidence response once its packet arrives.",
  },
  {
    title: "Protest Intelligence",
    detail: "Offer comparison, ARB value analysis and post-hearing appeal economics.",
  },
  { title: "CorvusPT Savings Protection", detail: "Included with the annual plan." },
];
