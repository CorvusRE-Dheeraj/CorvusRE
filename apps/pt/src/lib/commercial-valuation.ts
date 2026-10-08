import type { ComparableStats, RankedComp } from "./comps-analysis";
import { impactSummary, type ImpairmentCategory, type Support } from "./impairment-builder";
import type { IncomeApproach } from "./income-approach";

// The six valuation paths a commercial owner (and a commercial appraiser)
// expects to see, each shown separately with its own inputs, math and
// indicated value — never one residential-style comp number for a $7M retail
// center. Every figure is computed from real data the report already has
// (CAD record, comps, user-added sales, the owner's income figures) or an
// input the owner types in; nothing here is invented. Pure, so it's tested.

export type ApproachId = "income" | "sales" | "equity" | "cost" | "land" | "impairments";

export type ApproachStatus = "indicated" | "needs_data" | "supports_cad";

export type ApproachResult = {
  id: ApproachId;
  name: string;
  basis: string; // the legal/appraisal basis in one line
  status: ApproachStatus;
  indicatedValue: number | null;
  // How it was reached, one line per step, for the "show the math" view.
  steps: string[];
  missing: string[]; // what would let this approach indicate a value
};

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (n: number) => `${Math.round(n * 10) / 10}%`;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

// ── Income Approach: NOI → normalized expenses → cap rate → value ─────────

export type IncomeWhatIf = {
  vacancyPct: number | null; // override the owner's figure
  expenseRatioPct: number | null; // normalized expenses as % of EGI
  capRatePct: number | null;
};

export function incomeApproach(
  base: IncomeApproach,
  whatIf: Partial<IncomeWhatIf> = {},
): ApproachResult {
  const name = "Income Approach";
  const basis = "What the property's net operating income supports at a market cap rate.";
  const gpi = base.gpi;
  const vacancyPct = whatIf.vacancyPct ?? base.vacancyPct;
  const capRatePct = whatIf.capRatePct ?? base.capRatePct;
  const missing: string[] = [];
  if (gpi == null) missing.push("Gross potential rent (rent roll or P&L)");
  if (vacancyPct == null) missing.push("Vacancy & collection loss");
  if (base.operatingExpenses == null && whatIf.expenseRatioPct == null)
    missing.push("Operating expenses (P&L or operating statement)");
  if (capRatePct == null || capRatePct <= 0) missing.push("Cap rate (appraisal or market survey)");
  if (gpi == null || vacancyPct == null || capRatePct == null || capRatePct <= 0) {
    return {
      id: "income",
      name,
      basis,
      status: "needs_data",
      indicatedValue: null,
      steps: [],
      missing,
    };
  }
  const vacancyLoss = (gpi * vacancyPct) / 100;
  const egi = gpi - vacancyLoss + base.otherIncome;
  const expenses =
    whatIf.expenseRatioPct != null ? (egi * whatIf.expenseRatioPct) / 100 : base.operatingExpenses;
  if (expenses == null) {
    return {
      id: "income",
      name,
      basis,
      status: "needs_data",
      indicatedValue: null,
      steps: [],
      missing,
    };
  }
  const noi = egi - expenses;
  const value = noi > 0 ? Math.round(noi / (capRatePct / 100)) : null;
  const steps = [
    `Gross potential income ${usd(gpi)}`,
    `− Vacancy & collection ${pct(vacancyPct)} (${usd(vacancyLoss)})`,
    ...(base.otherIncome ? [`+ Other income ${usd(base.otherIncome)}`] : []),
    `= Effective gross income ${usd(egi)}`,
    `− Operating expenses ${usd(expenses)}${egi > 0 ? ` (${pct((expenses / egi) * 100)} of EGI)` : ""}`,
    `= Net operating income ${usd(noi)}`,
    `÷ Cap rate ${pct(capRatePct)}`,
    ...(value != null
      ? [`= Indicated value ${usd(value)}`]
      : ["NOI is not positive — no value indicated"]),
  ];
  return {
    id: "income",
    name,
    basis,
    status: value != null ? "indicated" : "needs_data",
    indicatedValue: value,
    steps,
    missing: [],
  };
}

// ── Sales Comparison: real sales only ──────────────────────────────────────

export function salesComparisonApproach(
  ranked: RankedComp[],
  subject: { buildingSqft: number | null },
): ApproachResult {
  const name = "Sales Comparison";
  const basis = "What comparable properties actually sold for, per building square foot.";
  const sales = ranked.filter(
    (c) => !c.excluded && c.userAdded && c.salePrice != null && c.salePrice > 0,
  );
  const perSf = sales
    .filter((c) => c.buildingSqft != null && c.buildingSqft > 0)
    .map((c) => (c.salePrice as number) / (c.buildingSqft as number));
  const missing: string[] = [];
  if (sales.length === 0)
    missing.push(
      "Comparable sales — Texas doesn't publish sale prices; add sales you know of (closing statements, broker comps)",
    );
  if (subject.buildingSqft == null) missing.push("Your building's square footage");
  if (perSf.length === 0 || subject.buildingSqft == null) {
    if (sales.length > 0 && perSf.length === 0)
      missing.push("Building square footage for your comparable sales");
    return {
      id: "sales",
      name,
      basis,
      status: "needs_data",
      indicatedValue: null,
      steps: [],
      missing,
    };
  }
  const m = median(perSf) as number;
  const value = Math.round(m * subject.buildingSqft);
  const verified = sales.filter((c) => c.saleVerified).length;
  return {
    id: "sales",
    name,
    basis,
    status: "indicated",
    indicatedValue: value,
    steps: [
      `${perSf.length} sale${perSf.length === 1 ? "" : "s"} with building size (${verified} verified)`,
      `Sale prices per SF: ${perSf.map((v) => `$${Math.round(v)}`).join(", ")}`,
      `Median $${Math.round(m)}/SF × your ${subject.buildingSqft.toLocaleString("en-US")} SF`,
      `= Indicated value ${usd(value)}`,
    ],
    missing: [],
  };
}

// ── Equal & Uniform (Tax Code §41.43(b)(3)) ────────────────────────────────

export function equalUniformApproach(stats: ComparableStats | null): ApproachResult {
  const name = "Equal & Uniform";
  const basis =
    "Texas Tax Code §41.43(b)(3): your value can't exceed the median appraised value of comparable properties, appropriately adjusted.";
  if (!stats || !stats.indicated || stats.limitedData) {
    // Say what was actually found — "add 3 comparables" next to a Market
    // Value module showing 10 nearby properties reads as a contradiction.
    const found = stats?.ranked.filter((c) => !c.userAdded).length ?? 0;
    const withValue =
      stats?.ranked.filter((c) => !c.userAdded && !c.excluded && c.marketValue != null).length ?? 0;
    return {
      id: "equity",
      name,
      basis,
      status: "needs_data",
      indicatedValue: null,
      steps: [],
      missing: [
        found > 0
          ? `At least 3 comparable properties with appraised values — ${found} nearby propert${found === 1 ? "y was" : "ies were"} found, but only ${withValue} ${withValue === 1 ? "has" : "have"} an appraised value on the county's record`
          : "At least 3 comparable properties with appraised values (from the county's records)",
      ],
    };
  }
  const usable = stats.ranked.filter((c) => !c.excluded && !c.userAdded && c.marketValue != null);
  const value = stats.adjustedIndicated?.value ?? stats.indicated.median;
  return {
    id: "equity",
    name,
    basis,
    status: "indicated",
    indicatedValue: value,
    steps: [
      `${usable.length} nearby comparable propert${usable.length === 1 ? "y" : "ies"} from the county's own appraisal roll`,
      `Appraised values ${usd(stats.indicated.min)} – ${usd(stats.indicated.max)}, median ${usd(stats.indicated.median)}`,
      ...(stats.adjustedIndicated
        ? [
            `Adjusted for size: each comp's $/acre applied to your acreage → ${usd(stats.adjustedIndicated.min)} – ${usd(stats.adjustedIndicated.max)}`,
            `= Median adjusted value ${usd(stats.adjustedIndicated.value)}`,
          ]
        : [`= Median appraised value ${usd(value)}`]),
    ],
    missing: [],
  };
}

// ── Cost Approach: land + depreciated replacement cost ─────────────────────

export type CostInputs = {
  landValue: number | null; // CAD land value
  buildingSqft: number | null;
  yearBuilt: number | null;
  costPerSqft: number | null; // replacement cost new, $/SF — owner input
  economicLifeYears: number; // typical 40-50 for commercial buildings
  currentYear: number;
};

export function costApproach(i: CostInputs): ApproachResult {
  const name = "Cost Approach";
  const basis =
    "Land value plus what it would cost to rebuild the improvements today, less depreciation.";
  const missing: string[] = [];
  if (i.landValue == null) missing.push("Land value");
  if (i.buildingSqft == null) missing.push("Building square footage");
  if (i.yearBuilt == null) missing.push("Year built");
  if (i.costPerSqft == null || i.costPerSqft <= 0)
    missing.push(
      "Replacement cost per SF (a contractor estimate or cost manual, e.g. Marshall & Swift)",
    );
  if (missing.length > 0) {
    return {
      id: "cost",
      name,
      basis,
      status: "needs_data",
      indicatedValue: null,
      steps: [],
      missing,
    };
  }
  const sqft = i.buildingSqft as number;
  const rcn = sqft * (i.costPerSqft as number);
  const age = Math.max(0, i.currentYear - (i.yearBuilt as number));
  const depreciationPct = Math.min(100, (age / i.economicLifeYears) * 100);
  const depreciated = rcn * (1 - depreciationPct / 100);
  const value = Math.round((i.landValue as number) + depreciated);
  return {
    id: "cost",
    name,
    basis,
    status: "indicated",
    indicatedValue: value,
    steps: [
      `Replacement cost new: ${sqft.toLocaleString("en-US")} SF × $${i.costPerSqft}/SF = ${usd(rcn)}`,
      `− Physical depreciation: ${age} yrs of a ${i.economicLifeYears}-yr life = ${pct(depreciationPct)} (${usd(rcn - depreciated)})`,
      `= Depreciated improvements ${usd(depreciated)}`,
      `+ Land ${usd(i.landValue as number)}`,
      `= Indicated value ${usd(value)}`,
    ],
    missing: [],
  };
}

// ── Land / Improvement analysis ────────────────────────────────────────────

export type LandImprovementInputs = {
  landValue: number | null;
  improvementValue: number | null;
  totalValue: number | null;
  acres: number | null;
  buildingSqft: number | null;
  comps: RankedComp[];
};

export type LandImprovement = ApproachResult & {
  landSharePct: number | null;
  landPerAcre: number | null;
  compLandPerAcre: number | null;
  improvementPerSqft: number | null;
};

export function landImprovementAnalysis(i: LandImprovementInputs): LandImprovement {
  const name = "Land / Improvement Analysis";
  const basis = "Whether the county's land and building values each hold up on their own.";
  const landPerAcre = i.landValue != null && i.acres ? i.landValue / i.acres : null;
  const compRates = i.comps
    .filter(
      (c) =>
        !c.excluded &&
        c.landValue != null &&
        c.landValue > 0 &&
        c.legalAcreage &&
        c.legalAcreage > 0,
    )
    .map((c) => (c.landValue as number) / (c.legalAcreage as number));
  const compLandPerAcre = compRates.length >= 3 ? median(compRates) : null;
  const landSharePct =
    i.landValue != null && i.totalValue
      ? Math.round((i.landValue / i.totalValue) * 1000) / 10
      : null;
  const improvementPerSqft =
    i.improvementValue != null && i.buildingSqft ? i.improvementValue / i.buildingSqft : null;
  const missing: string[] = [];
  if (i.landValue == null || i.improvementValue == null)
    missing.push("The county's land / improvement split");
  if (!i.acres) missing.push("Lot size");
  if (compLandPerAcre == null) missing.push("Land values for at least 3 nearby comparable parcels");

  const steps: string[] = [];
  if (i.landValue != null && i.improvementValue != null) {
    steps.push(
      `County split: land ${usd(i.landValue)}${landSharePct != null ? ` (${pct(landSharePct)})` : ""} + improvements ${usd(i.improvementValue)}`,
    );
  }
  if (landPerAcre != null) steps.push(`Your land: ${usd(landPerAcre)}/acre`);
  if (compLandPerAcre != null)
    steps.push(`Nearby land (median of ${compRates.length}): ${usd(compLandPerAcre)}/acre`);
  if (improvementPerSqft != null)
    steps.push(`Your improvements: $${Math.round(improvementPerSqft)}/SF`);

  let indicatedValue: number | null = null;
  let status: ApproachStatus = "needs_data";
  if (landPerAcre != null && compLandPerAcre != null && i.acres && i.improvementValue != null) {
    if (landPerAcre > compLandPerAcre) {
      const landAtMarket = compLandPerAcre * i.acres;
      indicatedValue = Math.round(landAtMarket + i.improvementValue);
      status = "indicated";
      steps.push(
        `Land at the nearby rate: ${usd(compLandPerAcre)} × ${Math.round(i.acres * 100) / 100} ac = ${usd(landAtMarket)}`,
        `+ Improvements as assessed ${usd(i.improvementValue)}`,
        `= Indicated value ${usd(indicatedValue)}`,
      );
    } else {
      status = "supports_cad";
      steps.push("Your land is assessed at or below the nearby rate — no land argument here.");
    }
  }
  return {
    id: "land",
    name,
    basis,
    status,
    indicatedValue,
    steps,
    missing: status === "needs_data" ? missing : [],
    landSharePct,
    landPerAcre,
    compLandPerAcre,
    improvementPerSqft,
  };
}

// ── Property-specific impairments ──────────────────────────────────────────

export type Impairment = {
  id: string;
  label: string;
  costToCure: number; // the bid / report total, or the high end of an estimate
  // Set by the impact builder (impairment-builder.ts); absent on items saved
  // before it, which count their figure in full.
  category?: ImpairmentCategory;
  support?: Support;
  quantity?: number;
  costLow?: number; // low end of an estimated range
  remainingLifeYrs?: number; // short-lived components
  documentId?: string; // the uploaded bid / report it came from
  documentName?: string;
};

export function impairmentsApproach(
  baseValue: number | null,
  items: Impairment[],
  knownConditions: string[],
): ApproachResult {
  const name = "Property-Specific Impairments";
  const basis =
    "Conditions a buyer would discount for — deferred maintenance, flood exposure, access, functional problems.";
  const impact = impactSummary(items);
  const total = impact.total;
  const steps = [
    ...knownConditions.map((c) => `Flagged in your report: ${c}`),
    ...items.map(
      (x, i) => `${x.label}: −${usd(impact.byItem[i].counted)} (${impact.byItem[i].note})`,
    ),
  ];
  if (baseValue == null || total <= 0) {
    return {
      id: "impairments",
      name,
      basis,
      status: "needs_data",
      indicatedValue: null,
      steps,
      missing: ["Cost-to-cure for each impairment (contractor bids, inspection reports)"],
    };
  }
  const value = Math.round(baseValue - total);
  steps.push(`County value ${usd(baseValue)} − impairments ${usd(total)} = ${usd(value)}`);
  if (impact.documented < total)
    steps.push(
      `${usd(impact.documented)} of the ${usd(total)} is backed by bids or inspection reports — the rest is credited at the low end of its estimate.`,
    );
  return {
    id: "impairments",
    name,
    basis,
    status: "indicated",
    indicatedValue: value,
    steps,
    missing: [],
  };
}

// ── Reconciliation ─────────────────────────────────────────────────────────

export type Reconciliation = {
  cadValue: number | null;
  indicated: { id: ApproachId; name: string; value: number }[];
  lowest: { id: ApproachId; name: string; value: number } | null;
  // How many approaches indicate a value below the county's.
  belowCad: number;
};

export function reconcile(results: ApproachResult[], cadValue: number | null): Reconciliation {
  const indicated = results
    .filter((r) => r.status === "indicated" && r.indicatedValue != null && r.indicatedValue > 0)
    .map((r) => ({ id: r.id, name: r.name, value: r.indicatedValue as number }));
  const lowest = indicated.length ? indicated.reduce((a, b) => (b.value < a.value ? b : a)) : null;
  return {
    cadValue,
    indicated,
    lowest,
    belowCad: cadValue == null ? 0 : indicated.filter((x) => x.value < cadValue).length,
  };
}
