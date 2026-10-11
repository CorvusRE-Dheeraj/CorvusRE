import { compLine, reconcileSnapshot, type PropertyBaseSnapshot } from "./property-base-data";
import { formatFactValue, type ReconciledFact } from "./property-reconcile";

// "Sources as per steps": which reconciled base-data facts each AI Report module
// is handed (as authoritativeFacts — see buildRecord in ai-report-modules). The
// base-data pipeline gathers county, Regrid, ATTOM and Texas Comptroller data
// into one reconciled record; this routes the slice each module's job needs, with
// every value tagged by its source and a note wherever sources disagree, so the
// module reasons from the same record instead of only the bare CAD values.
//
//   Modules 1-2 (health, strategy): valuation, assessment, tax, sales history
//   Comparable sales (comps):        sales, $/SF basis (size, lot, use)
//   Modules 4-7 (site, improvement, zoning, income): the physical, use and
//                                    tax facts each one argues from
//   Module 8 (evidence), Module 10 (executive): everything, so the checklist
//                                    and the case report can cite it

const VALUATION = [
  "totalValue",
  "landValue",
  "improvementValue",
  "taxYear",
  "annualTax",
  "lastSaleDate",
  "lastSaleAmount",
  "landUse",
];

const FACTS_BY_MODULE: Record<string, string[] | "all"> = {
  health: VALUATION,
  strategy: [...VALUATION, "buildingSqft", "yearBuilt", "zoning"],
  comps: [
    "lastSaleDate",
    "lastSaleAmount",
    "buildingSqft",
    "lotAcres",
    "landUse",
    "totalValue",
    "yearBuilt",
  ],
  site: ["lotAcres", "landUse", "zoning"],
  improvement: ["buildingSqft", "yearBuilt", "landUse", "improvementValue"],
  zoning: ["zoning", "landUse", "lotAcres", "owner"],
  income: ["buildingSqft", "annualTax", "totalValue", "landUse"],
  evidence: "all",
  executive: "all",
};

// Modules whose arguments turn on the tax rate (savings math, income expenses).
const TAX_RATE_MODULES = new Set(["health", "strategy", "income", "evidence", "executive"]);

function line(f: ReconciledFact): string {
  const base = `${f.label}: ${formatFactValue(f.unit, f.value)} (per ${f.source})`;
  if (!f.conflict) return base;
  const others = f.values
    .slice(1)
    .map((v) => `${formatFactValue(f.unit, v.value)} per ${v.source}`)
    .join("; ");
  return `${base} — sources disagree (${others}); say which value you relied on and why.`;
}

export function moduleSourceFacts(
  moduleId: string,
  snapshot: PropertyBaseSnapshot | null | undefined,
): string[] {
  if (!snapshot) return [];
  const wanted = FACTS_BY_MODULE[moduleId];
  if (!wanted) return [];

  const rec = reconcileSnapshot(snapshot);
  const facts = rec.facts.filter(
    (f) => f.value != null && (wanted === "all" || wanted.includes(f.key)),
  );
  const out = facts.map(line);

  // $/SF on the assessed value — the basis comps are compared on.
  if (moduleId === "comps" || wanted === "all") {
    const total = rec.facts.find((f) => f.key === "totalValue");
    const sqft = rec.facts.find((f) => f.key === "buildingSqft");
    if (typeof total?.value === "number" && typeof sqft?.value === "number" && sqft.value > 0) {
      out.push(
        `Assessed value per building SF: $${(total.value / sqft.value).toFixed(2)} ` +
          `(${total.source} value ÷ ${sqft.source} area).`,
      );
    }
  }

  if (rec.taxRate && TAX_RATE_MODULES.has(moduleId)) {
    const pct = `${(rec.taxRate.rate * 100).toFixed(3).replace(/\.?0+$/, "")}%`;
    out.push(
      rec.taxRate.kind === "actual"
        ? `Effective tax rate: ${pct} (ATTOM billed tax ÷ assessed value${rec.taxRate.taxYear ? `, ${rec.taxRate.taxYear}` : ""}).`
        : `Known tax rate: at least ${pct} (Texas Comptroller ${rec.taxRate.year}) — ${rec.taxRate.note}`,
    );
  }

  // Real recorded sale prices — what the Comparable Sales step needs and the
  // county's assessed-value comps can't give (Texas doesn't disclose sale prices).
  const comps = snapshot.attomComps ?? [];
  if (comps.length > 0 && (moduleId === "comps" || moduleId === "strategy" || wanted === "all")) {
    out.push(`Recent comparable SALES with real prices (ATTOM, ${comps.length}):`);
    for (const c of comps) out.push(`Comparable sale: ${compLine(c)}.`);
    const psf = comps
      .map((c) => c.pricePerSqft)
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);
    if (psf.length > 0) {
      const mid = Math.floor(psf.length / 2);
      const median = psf.length % 2 ? psf[mid] : (psf[mid - 1] + psf[mid]) / 2;
      out.push(
        `Comparable sales median price per SF: $${median.toFixed(2)} (range $${psf[0].toFixed(2)}–$${psf[psf.length - 1].toFixed(2)}, ${psf.length} sales with building area).`,
      );
    }
  }

  if (
    (moduleId === "site" || moduleId === "zoning" || wanted === "all") &&
    snapshot.regrid?.geometry
  ) {
    out.push("Parcel boundary is on file (Regrid parcel record).");
  }

  return out;
}
