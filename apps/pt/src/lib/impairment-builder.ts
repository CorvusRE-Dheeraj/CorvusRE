import type { Impairment } from "./commercial-valuation";

// The repair / deferred-maintenance impact builder behind the Property-
// Specific Impairments approach. A buyer discounts a property for what it
// costs to fix; an ARB credits that discount in proportion to how well it's
// documented. So each item carries:
//   - a category with a typical Texas commercial cost range, priced by
//     quantity (a starting point — a contractor bid replaces it),
//   - its support: a contractor bid, an inspection report, condition photos
//     or the owner's own estimate,
//   - for short-lived components (roof, HVAC, paving…), the remaining life:
//     a roof with 5 of its 20 years left is 75% used up, so a buyer
//     discounts 75% of its replacement cost — curable physical
//     deterioration — while one that has failed is discounted in full.
// The amount counted toward the value is conservative: documented items in
// full, photo-supported and owner-estimated items at the low end of their
// range. Pure, so it's tested.

export type ImpairmentCategory =
  | "roof"
  | "hvac"
  | "paving"
  | "envelope"
  | "interior"
  | "fire_safety"
  | "elevator"
  | "foundation"
  | "plumbing"
  | "electrical"
  | "ada"
  | "drainage"
  | "environmental"
  | "other";

export type Support = "bid" | "inspection" | "photos" | "estimate";

export type CategorySpec = {
  label: string;
  unit: string | null; // null = priced per job (bid or lump sum)
  unitCost: { low: number; high: number } | null;
  typicalLifeYrs: number | null; // short-lived components only
  example: string;
};

// Typical Texas commercial replacement-cost ranges, 2026. A starting point
// only — the builder labels them as such and a bid or inspection replaces
// them.
export const CATEGORIES: Record<ImpairmentCategory, CategorySpec> = {
  roof: {
    label: "Roof replacement",
    unit: "SF of roof",
    unitCost: { low: 8, high: 14 },
    typicalLifeYrs: 20,
    example: "TPO / built-up roof at end of life",
  },
  hvac: {
    label: "HVAC replacement",
    unit: "tons",
    unitCost: { low: 1_800, high: 3_000 },
    typicalLifeYrs: 15,
    example: "Rooftop units past their service life",
  },
  paving: {
    label: "Parking lot / paving",
    unit: "SF of paving",
    unitCost: { low: 3, high: 7 },
    typicalLifeYrs: 15,
    example: "Mill and overlay, failed asphalt",
  },
  envelope: {
    label: "Facade / building envelope",
    unit: "SF of wall",
    unitCost: { low: 15, high: 40 },
    typicalLifeYrs: null,
    example: "Cracked stucco, failed sealants, water intrusion",
  },
  interior: {
    label: "Interior finishes",
    unit: "SF of floor",
    unitCost: { low: 25, high: 60 },
    typicalLifeYrs: 10,
    example: "Dated or damaged finishes needing replacement",
  },
  fire_safety: {
    label: "Fire / life safety",
    unit: "SF of floor",
    unitCost: { low: 3, high: 7 },
    typicalLifeYrs: null,
    example: "Sprinkler retrofit or alarm replacement",
  },
  elevator: {
    label: "Elevator modernization",
    unit: "elevators",
    unitCost: { low: 80_000, high: 200_000 },
    typicalLifeYrs: 25,
    example: "Controller and machine modernization",
  },
  foundation: {
    label: "Foundation / structural",
    unit: null,
    unitCost: null,
    typicalLifeYrs: null,
    example: "Slab movement, structural repair",
  },
  plumbing: {
    label: "Plumbing",
    unit: null,
    unitCost: null,
    typicalLifeYrs: null,
    example: "Cast-iron drain line replacement",
  },
  electrical: {
    label: "Electrical",
    unit: null,
    unitCost: null,
    typicalLifeYrs: null,
    example: "Service upgrade, panel replacement",
  },
  ada: {
    label: "ADA / code compliance",
    unit: null,
    unitCost: null,
    typicalLifeYrs: null,
    example: "Accessible parking, ramps, restrooms",
  },
  drainage: {
    label: "Drainage / flooding",
    unit: null,
    unitCost: null,
    typicalLifeYrs: null,
    example: "Detention, regrading, flood damage",
  },
  environmental: {
    label: "Environmental",
    unit: null,
    unitCost: null,
    typicalLifeYrs: null,
    example: "Asbestos abatement, Phase II remediation",
  },
  other: {
    label: "Other",
    unit: null,
    unitCost: null,
    typicalLifeYrs: null,
    example: "Any other condition a buyer would price in",
  },
};

export const SUPPORT_LABEL: Record<Support, string> = {
  bid: "Contractor bid",
  inspection: "Inspection report",
  photos: "Condition photos",
  estimate: "Owner estimate",
};

// What an item's cost is worth to the argument: documented in full,
// otherwise the conservative low end.
export const SUPPORT_CREDIT: Record<Support, "full" | "low"> = {
  bid: "full",
  inspection: "full",
  photos: "low",
  estimate: "low",
};

const roundTo = (n: number, step: number) => Math.round(n / step) * step;

export function estimateRange(
  category: ImpairmentCategory,
  quantity: number | null,
): { low: number; high: number } | null {
  const spec = CATEGORIES[category];
  if (!spec.unitCost || !quantity || quantity <= 0) return null;
  return {
    low: roundTo(quantity * spec.unitCost.low, 100),
    high: roundTo(quantity * spec.unitCost.high, 100),
  };
}

// Share of a short-lived component that is used up, 0-1. Failed or needing
// replacement now (no remaining life) = 1.
export function usedUpShare(category: ImpairmentCategory | undefined, remainingLifeYrs?: number) {
  const life = category ? CATEGORIES[category].typicalLifeYrs : null;
  if (!life || remainingLifeYrs == null || remainingLifeYrs <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - remainingLifeYrs / life));
}

// The amount an item takes off the value. Items saved before the builder
// (no support recorded) keep counting their owner-entered figure in full.
export function countedAmount(x: Impairment): number {
  const share = usedUpShare(x.category, x.remainingLifeYrs);
  const base =
    x.support && SUPPORT_CREDIT[x.support] === "low" && x.costLow != null
      ? x.costLow
      : x.costToCure;
  return Math.max(0, Math.round(base * share));
}

export type ImpactSummary = {
  total: number; // counted toward the value
  documented: number; // the part backed by bids or inspection reports
  documentedShare: number; // 0-1
  strength: "Strong" | "Moderate" | "Weak" | "None";
  byItem: { id: string; counted: number; note: string }[];
};

export function impactSummary(items: Impairment[]): ImpactSummary {
  const byItem = items.map((x) => {
    const counted = countedAmount(x);
    const share = usedUpShare(x.category, x.remainingLifeYrs);
    const notes = [
      x.support ? SUPPORT_LABEL[x.support] : "Your figure",
      x.support && SUPPORT_CREDIT[x.support] === "low" && x.costLow != null
        ? "low end of the range"
        : null,
      share < 1 ? `${Math.round(share * 100)}% of its life used` : null,
    ].filter(Boolean);
    return { id: x.id, counted, note: notes.join(" · ") };
  });
  const total = byItem.reduce((s, x) => s + x.counted, 0);
  const documented = items.reduce(
    (s, x, i) => s + (x.support && SUPPORT_CREDIT[x.support] === "full" ? byItem[i].counted : 0),
    0,
  );
  const documentedShare = total > 0 ? documented / total : 0;
  return {
    total,
    documented,
    documentedShare,
    strength:
      total <= 0
        ? "None"
        : documentedShare >= 0.7
          ? "Strong"
          : documentedShare >= 0.3
            ? "Moderate"
            : "Weak",
    byItem,
  };
}

// Repair bids already read from the owner's uploaded documents (the
// extract-evidence-value reading's costToCure) that aren't in the builder yet.
export function importableBids(
  docs: { id: string; fileName: string; costToCure: number | null; kind: string | null }[],
  items: Impairment[],
): { id: string; fileName: string; costToCure: number }[] {
  const have = new Set(items.map((x) => x.documentId).filter(Boolean));
  return docs
    .filter((d) => d.costToCure != null && d.costToCure > 0 && !have.has(d.id))
    .map((d) => ({ id: d.id, fileName: d.fileName, costToCure: d.costToCure as number }));
}
