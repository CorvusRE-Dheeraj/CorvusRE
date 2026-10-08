import {
  classifyPropertyCategory,
  getAssessmentRatioInfo,
  getTaxRateMeta,
} from "./texas-tax-rates";

// Acquisition property-tax forecast: what a buyer's taxes are likely to be
// after closing. Texas appraises at market value as of January 1, and an
// appraisal district that learns of a sale tends to move the next year's
// value toward the price — so a buyer underwriting on the seller's current
// tax bill usually understates the tax line. Three scenarios for the first
// full year of ownership, then growth over the hold:
//   - the district doesn't pick up the sale (the value just trends),
//   - it reappraises to its typical level of market value (the Comptroller
//     ratio-study median for the county and property type),
//   - it goes to the full price.
// A price below the district's value runs the other way: the sale is strong
// protest evidence. Pure, so it's tested.

export type ForecastInput = {
  cad: string | null;
  propertyType: string | null;
  currentValue: number; // the district's current appraised value
  currentTaxYear: number;
  purchasePrice: number;
  closingDate: string; // YYYY-MM-DD
  holdYears: number; // 1-10
  growthPct: number; // expected annual market growth, %
  taxRate?: number | null; // fraction; defaults to the county average
  noi?: number | null; // the buyer's underwritten NOI, before property tax changes
};

export type Scenario = "low" | "likely" | "high";

export type ForecastYear = {
  year: number;
  value: Record<Scenario, number>;
  tax: Record<Scenario, number>;
};

export type Forecast = {
  rate: number;
  rateSource: string;
  ratioPct: number; // district's typical appraisal level used
  ratioSource: string;
  closingYear: {
    year: number;
    tax: number; // the year's full bill on the seller's value
    buyerShare: number; // prorated from closing to December 31
    buyerDays: number;
  };
  sellerTax: number; // the current bill a seller's T-12 reflects
  scenarioBasis: Record<Scenario, string>;
  years: ForecastYear[]; // first full year of ownership onward
  firstYearChange: Record<Scenario, number>; // vs the seller's current bill
  holdTotal: Record<Scenario, number>; // all full years
  noiImpact: { likely: number; likelyPct: number | null } | null;
  belowValue: { pct: number; note: string } | null; // price under the district's value
  assumptions: string[];
};

export const DEFAULT_GROWTH_PCT = 3;
export const DEFAULT_RATIO_PCT = 95;
export const MAX_HOLD = 10;

const round = (n: number) => Math.round(n);
const roundTo = (n: number, step: number) => Math.round(n / step) * step;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

export function acquisitionForecast(i: ForecastInput): Forecast {
  const meta = getTaxRateMeta(i.cad);
  const rate = i.taxRate && i.taxRate > 0 ? i.taxRate : meta.rate;
  const ratio = getAssessmentRatioInfo(i.cad, classifyPropertyCategory(i.propertyType));
  // The study's median is stored as a ratio (1.07 = appraised at 107% of sale
  // prices). A district above 100% still can't be assumed to appraise above the
  // price a buyer just paid, so it's capped there.
  const ratioPct = ratio ? Math.min(100, Math.round(ratio.medianPct * 100)) : DEFAULT_RATIO_PCT;
  const g = i.growthPct / 100;
  const hold = Math.max(1, Math.min(MAX_HOLD, Math.round(i.holdYears)));

  const closeYear = Number(i.closingDate.slice(0, 4));
  const yearEnd = `${closeYear}-12-31`;
  const yearDays = daysBetween(`${closeYear}-01-01`, yearEnd) + 1;
  const buyerDays = Math.max(0, daysBetween(i.closingDate, yearEnd) + 1);
  // The closing year's value is the January 1 value — the seller's.
  const yearsToClose = Math.max(0, closeYear - i.currentTaxYear);
  const closingValue = i.currentValue * (1 + g) ** yearsToClose;
  const closingTax = round(closingValue * rate);
  const sellerTax = round(i.currentValue * rate);

  // First full year of ownership: January 1 after closing.
  const trend = i.currentValue * (1 + g) ** (yearsToClose + 1);
  const reassessed = i.purchasePrice * (ratioPct / 100);
  const above = i.purchasePrice >= i.currentValue;
  const base: Record<Scenario, number> = above
    ? {
        low: trend,
        likely: Math.max(trend, reassessed),
        high: Math.max(trend, reassessed, i.purchasePrice),
      }
    : {
        low: Math.min(reassessed, i.purchasePrice),
        likely: i.purchasePrice,
        high: Math.max(trend, i.purchasePrice),
      };
  const scenarioBasis: Record<Scenario, string> = above
    ? {
        low: "The district doesn't pick up the sale — the value just trends",
        likely: `The district reappraises to its typical ${ratioPct}% of market value`,
        high: "The district appraises at the full price",
      }
    : {
        low: `A protest using the sale lands at the district's typical ${ratioPct}% of the price`,
        likely: "A protest using the sale brings the value to the price",
        high: "The district keeps trending its current value",
      };

  const years: ForecastYear[] = [];
  for (let n = 0; n < hold; n++) {
    const f = (1 + g) ** n;
    const value = {
      low: roundTo(base.low * f, 1000),
      likely: roundTo(base.likely * f, 1000),
      high: roundTo(base.high * f, 1000),
    };
    years.push({
      year: closeYear + 1 + n,
      value,
      tax: {
        low: round(value.low * rate),
        likely: round(value.likely * rate),
        high: round(value.high * rate),
      },
    });
  }
  const first = years[0];
  const firstYearChange = {
    low: first.tax.low - sellerTax,
    likely: first.tax.likely - sellerTax,
    high: first.tax.high - sellerTax,
  };
  const sum = (s: Scenario) => years.reduce((t, y) => t + y.tax[s], 0);
  const belowPct = above
    ? 0
    : Math.round(((i.currentValue - i.purchasePrice) / i.currentValue) * 1000) / 10;

  return {
    rate,
    rateSource: i.taxRate && i.taxRate > 0 ? "Your rate" : meta.source,
    ratioPct,
    ratioSource: ratio
      ? "Texas Comptroller property value study (county, property type)"
      : `No county study for this property type — a typical ${DEFAULT_RATIO_PCT}% is used`,
    closingYear: {
      year: closeYear,
      tax: closingTax,
      buyerShare: round((closingTax * buyerDays) / yearDays),
      buyerDays,
    },
    sellerTax,
    scenarioBasis,
    years,
    firstYearChange,
    holdTotal: { low: sum("low"), likely: sum("likely"), high: sum("high") },
    noiImpact:
      i.noi != null && i.noi > 0
        ? {
            likely: i.noi - firstYearChange.likely,
            likelyPct: Math.round((-firstYearChange.likely / i.noi) * 1000) / 10,
          }
        : null,
    belowValue: above
      ? null
      : {
          pct: belowPct,
          note: `The price is ${belowPct}% below the district's ${usd(i.currentValue)}. An arm's-length sale near January 1 is among the strongest evidence of market value, so a protest after closing may be worth considering.`,
        },
    assumptions: [
      `Tax rate ${Math.round(rate * 10000) / 100}% of value (${i.taxRate && i.taxRate > 0 ? "your rate" : meta.source}). Actual rates vary by taxing unit and change each year.`,
      "Values are as of January 1; the closing year's bill stays on the seller's value and is prorated at closing.",
      `Market growth ${i.growthPct}% a year after the first full year.`,
      "No exemptions. Texas's temporary 20% cap on non-homestead property under $5M only applies after a year of ownership, so it isn't applied to a buyer's first year.",
      "An estimate to support underwriting, not an appraisal or a guarantee of any outcome.",
    ],
  };
}
