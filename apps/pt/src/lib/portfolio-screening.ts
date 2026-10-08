import type { PropertyRecord } from "./properties";
import type { PropertyAiScore } from "./property-scores";
import { bracketForValue, isCustomPricedValue, propertyAnnualPrice } from "./billing";

// Free portfolio screening: an owner adds their properties for free and
// Corvus sorts them into high-priority, moderate and low-priority cases, so
// they only pay to activate the ones worth protesting. A contingency firm
// earns on everything it enrolls; Corvus earns the same per property either
// way, so it can say plainly which ones probably aren't worth it — the
// owner's independent screening intelligence. Pure, so it's tested.

export type ScreeningTier = "high" | "moderate" | "low";

export type ScreenedProperty = {
  property: PropertyRecord;
  tier: ScreeningTier;
  score: number | null;
  savings: number | null; // per year, Corvus's estimate
  planCost: number | null; // the Owner-Managed annual price; null for custom-priced $5M+
  reason: string;
};

export type PortfolioScreening = {
  screened: ScreenedProperty[]; // high first, then by savings
  counts: Record<ScreeningTier, number>;
  highSavings: number; // total estimated annual savings of the high-priority cases
  pending: number; // properties still being scored
};

// A strong county-data case …
export const HIGH_SCORE = 70;
// … whose estimated savings cover the plan at least this many times over.
export const HIGH_SAVINGS_MULTIPLE = 2;
// Below this score the county data doesn't show a clear case.
export const LOW_SCORE = 40;

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function screenProperty(
  property: PropertyRecord,
  score: PropertyAiScore | null,
): ScreenedProperty {
  const s = score?.score ?? null;
  const savings = property.estimatedSavings != null ? Math.max(0, property.estimatedSavings) : null;
  const planCost = isCustomPricedValue(property.totalValue)
    ? null
    : propertyAnnualPrice("owner_managed", bracketForValue(property.totalValue), false);
  const base = { property, score: s, savings, planCost };

  if (!savings) {
    return {
      ...base,
      tier: "low",
      reason: "Corvus doesn't estimate meaningful savings from the county data.",
    };
  }
  if (planCost != null && savings < planCost) {
    return {
      ...base,
      tier: "low",
      reason: `Estimated savings of ~${usd(savings)} a year are below the ${usd(planCost)} plan cost.`,
    };
  }
  if (s != null && s < LOW_SCORE) {
    return {
      ...base,
      tier: "low",
      reason: `The county data shows a weak case (score ${s}/100).`,
    };
  }
  const covers = planCost != null ? savings / planCost : null;
  if (s != null && s >= HIGH_SCORE && (covers == null || covers >= HIGH_SAVINGS_MULTIPLE)) {
    return {
      ...base,
      tier: "high",
      reason: `Strong county-data case (score ${s}/100) with ~${usd(savings)} a year in estimated savings${covers != null ? ` — ${Math.floor(covers * 10) / 10}× the plan cost` : ""}.`,
    };
  }
  return {
    ...base,
    tier: "moderate",
    reason:
      s == null
        ? `~${usd(savings)} a year in estimated savings; the county-data score is still computing.`
        : s >= HIGH_SCORE
          ? `Strong case (score ${s}/100), but ~${usd(savings)} a year is a thinner margin over the plan cost.`
          : `A moderate case (score ${s}/100) with ~${usd(savings)} a year in estimated savings.`,
  };
}

const ORDER: Record<ScreeningTier, number> = { high: 0, moderate: 1, low: 2 };

export function screenPortfolio(
  properties: PropertyRecord[],
  scores: Record<string, PropertyAiScore>,
): PortfolioScreening {
  const screened = properties
    .map((p) => screenProperty(p, scores[p.id] ?? null))
    .sort((a, b) => ORDER[a.tier] - ORDER[b.tier] || (b.savings ?? 0) - (a.savings ?? 0));
  const counts: Record<ScreeningTier, number> = { high: 0, moderate: 0, low: 0 };
  for (const s of screened) counts[s.tier]++;
  return {
    screened,
    counts,
    highSavings: screened
      .filter((s) => s.tier === "high")
      .reduce((sum, s) => sum + (s.savings ?? 0), 0),
    pending: properties.filter((p) => !scores[p.id] && p.estimatedSavings == null).length,
  };
}
