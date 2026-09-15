// The one Deno-side copy of the per-property subscription pricing math —
// shared by create-checkout-session (single property, hosted Checkout) and
// bulk-subscribe (many properties, one card, off-session). Mirrors
// src/lib/billing.ts (TIER_BRACKET_PRICES / bracketForValue /
// ADDITIONAL_PROPERTY_DISCOUNT / propertyMonthlyPrice), which a Deno function
// can't import from src/. Keep the three in sync by hand if the numbers move.

export type Tier = "owner_managed" | "corvusrf_managed";
export type Bracket = "under2m" | "mid2m10m" | "over10m";

export const TIER_LABEL: Record<Tier, string> = {
  owner_managed: "Owner-Managed",
  corvusrf_managed: "CorvusPT-Managed",
};

// "over10m" is the capped $10M-$25M bracket — anything above $25M is the
// non-checkout CUSTOM_TIER in billing.ts and never reaches here.
export const BRACKET_LABEL: Record<Bracket, string> = {
  under2m: "$0 - $2M",
  mid2m10m: "$2M - $10M",
  over10m: "$10M - $25M",
};

export const TIER_BRACKET_PRICES: Record<Tier, Record<Bracket, number>> = {
  owner_managed: { under2m: 99, mid2m10m: 299, over10m: 499 },
  corvusrf_managed: { under2m: 199, mid2m10m: 499, over10m: 799 },
};

export const ADDITIONAL_PROPERTY_DISCOUNT = 0.15;

// Same $2M / $10M boundaries as billing.ts's bracketForValue.
export function bracketForValue(value: number | null | undefined): Bracket {
  if (value == null) return "under2m";
  if (value < 2_000_000) return "under2m";
  if (value < 10_000_000) return "mid2m10m";
  return "over10m";
}

export function isTier(v: unknown): v is Tier {
  return v === "owner_managed" || v === "corvusrf_managed";
}

// Whole-cent unit amount for one property's subscription. `isAdditionalInBracket`
// is true once the customer already has (or, within a bulk batch, is already
// getting) another subscription in this same tier+bracket — that one and every
// later one in the bracket takes the 15% discount; the first is full price.
export function unitAmountCents(
  tier: Tier,
  bracket: Bracket,
  isAdditionalInBracket: boolean,
): number {
  const baseCents = Math.round(TIER_BRACKET_PRICES[tier][bracket] * 100);
  return isAdditionalInBracket
    ? Math.round(baseCents * (1 - ADDITIONAL_PROPERTY_DISCOUNT))
    : baseCents;
}

// The Stripe product name for a property's subscription line — leads with the
// address so each line is identifiable in Stripe's hosted billing portal (which
// shows only the product name) when a customer has several. Trimmed to Stripe's
// 250-char product-name limit with margin.
export function subscriptionProductName(
  tier: Tier,
  bracket: Bracket,
  address: string,
  isAdditionalInBracket: boolean,
): string {
  const addr = (address ?? "").trim();
  const planLabel = `${TIER_LABEL[tier]} (${BRACKET_LABEL[bracket]})${
    isAdditionalInBracket ? ", 2nd+ property 15% off" : ""
  }`;
  return (addr ? `${addr} — ${planLabel}` : planLabel).slice(0, 240);
}

// ── BPP (Business Personal Property) — mirrors src/lib/billing.ts's own
// BPP_VALUE_BRACKETS/BPP_TIER_BRACKET_PRICES/bracketForBppValue, which a Deno
// function can't import from src/. Rendered BPP values run far lower than
// real estate, so BPP gets its own bracket boundaries, but the same two
// tiers and the same price points (the tiers are a service-level choice, not
// a property-type one). No 2nd-account discount for BPP yet.
export type BppBracket = "under250k" | "250kTo1m" | "over1m";

export const BPP_BRACKET_LABEL: Record<BppBracket, string> = {
  under250k: "$0 - $250K",
  "250kTo1m": "$250K - $1M",
  over1m: "$1M+",
};

export const BPP_TIER_BRACKET_PRICES: Record<Tier, Record<BppBracket, number>> = {
  owner_managed: { under250k: 99, "250kTo1m": 299, over1m: 499 },
  corvusrf_managed: { under250k: 199, "250kTo1m": 499, over1m: 799 },
};

export function bracketForBppValue(value: number | null | undefined): BppBracket {
  if (value == null) return "under250k";
  if (value < 250_000) return "under250k";
  if (value < 1_000_000) return "250kTo1m";
  return "over1m";
}

export function isBppBracket(v: unknown): v is BppBracket {
  return v === "under250k" || v === "250kTo1m" || v === "over1m";
}

export function bppUnitAmountCents(tier: Tier, bracket: BppBracket): number {
  return Math.round(BPP_TIER_BRACKET_PRICES[tier][bracket] * 100);
}

export function bppSubscriptionProductName(
  tier: Tier,
  bracket: BppBracket,
  businessName: string,
): string {
  const name = (businessName ?? "").trim();
  const planLabel = `${TIER_LABEL[tier]} BPP (${BPP_BRACKET_LABEL[bracket]})`;
  return (name ? `${name} — ${planLabel}` : planLabel).slice(0, 240);
}
