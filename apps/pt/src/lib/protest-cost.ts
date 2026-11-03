// What a protest actually costs this owner, from their real CorvusPT plan —
// the property's own Stripe subscription when there is one, the account's
// plan otherwise — split into annual (recurring), one-time and other
// expenses. Module 9's "Is Filing a Protest Worth It?" reads this instead of
// a flat fee assumption.
import {
  LEGACY_TIER_BRACKET_PRICES,
  TIER_BRACKET_PRICES,
  TIER_LABEL,
  type MySubscription,
  type PlanValue,
  type Tier,
} from "./billing";

export type ProtestCostLine = {
  label: string;
  amount: number;
  kind: "annual" | "one_time" | "additional";
  note?: string;
};

export type ProtestCost = {
  // "subscribed": this property has its own active subscription.
  // "not_subscribed": the cost shown is the plan price if the owner subscribes.
  status: "subscribed" | "not_subscribed" | "beta" | "legacy";
  planLabel: string;
  lines: ProtestCostLine[];
  // null when the plan's cost isn't known (a legacy flat-rate plan).
  total: number | null;
  // One line for the savings assumptions list.
  label: string;
};

const ACTIVE = new Set(["active", "trialing", "past_due"]);
const money = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;

function annualFromSubscription(sub: MySubscription): number | null {
  if (sub.amountCents == null) return null;
  const perPeriod = (sub.amountCents / 100) * Math.max(1, sub.quantity || 1);
  if (sub.interval === "year") return perPeriod;
  if (sub.interval === "month") return perPeriod * 12;
  return null;
}

export function getProtestCost(input: {
  accountPlan: PlanValue | null;
  planTier: Tier | null;
  subscriptionStatus: string | null;
  valueBracket: string | null;
  // This property's subscription as Stripe reports it, when loaded.
  subscription: MySubscription | null;
  // Other one-time expenses the owner entered (appraisal, travel …).
  otherExpenses: number | null;
}): ProtestCost {
  const lines: ProtestCostLine[] = [];
  const other = input.otherExpenses != null && input.otherExpenses > 0 ? input.otherExpenses : 0;
  const withOther = (
    base: Omit<ProtestCost, "total" | "label">,
    baseLabel: string,
  ): ProtestCost => {
    if (other > 0) {
      base.lines.push({
        label: "Other protest expenses (as you entered)",
        amount: other,
        kind: "additional",
      });
    }
    const total = base.lines.reduce((s, l) => s + l.amount, 0);
    return {
      ...base,
      total,
      label:
        other > 0 ? `${baseLabel}, plus ${money(other)} in other expenses you entered` : baseLabel,
    };
  };

  if (input.accountPlan === "beta") {
    lines.push({
      label: "Beta access",
      amount: 0,
      kind: "annual",
      note: "Beta testers don't pay.",
    });
    return withOther({ status: "beta", planLabel: "Beta", lines }, "Beta access ($0)");
  }

  const subscribed =
    input.planTier != null &&
    input.subscriptionStatus != null &&
    ACTIVE.has(input.subscriptionStatus);
  if (subscribed && input.planTier) {
    const tier = input.planTier;
    const fromStripe = input.subscription ? annualFromSubscription(input.subscription) : null;
    const bracket = input.valueBracket ?? "upTo5m";
    const monthly =
      (TIER_BRACKET_PRICES[tier] as Record<string, number>)[bracket] ??
      LEGACY_TIER_BRACKET_PRICES[tier][bracket] ??
      TIER_BRACKET_PRICES[tier].upTo5m;
    const annual = fromStripe ?? monthly * 12;
    const discount = input.subscription?.discountName;
    lines.push({
      label: `${TIER_LABEL[tier]} subscription`,
      amount: annual,
      kind: "annual",
      note: discount
        ? `List price; your "${discount}" discount is applied by Stripe — see Billing for the amount charged.`
        : "Billed once a year for this property; renews unless cancelled.",
    });
    return withOther(
      { status: "subscribed", planLabel: TIER_LABEL[tier], lines },
      `your ${TIER_LABEL[tier]} subscription (${money(annual)} a year)`,
    );
  }

  if (input.accountPlan === "ai_report" || input.accountPlan === "managed_protest") {
    // Pre-2026 plans — their terms aren't stored per property.
    return {
      status: "legacy",
      planLabel: "Legacy plan",
      lines,
      total: other > 0 ? other : null,
      label: "your legacy plan (cost not on file)",
    };
  }

  const annual = TIER_BRACKET_PRICES.owner_managed.upTo5m * 12;
  lines.push({
    label: `${TIER_LABEL.owner_managed} subscription (if you subscribe)`,
    amount: annual,
    kind: "annual",
    note: "List price per property, billed once a year. Any checkout discount is shown at checkout.",
  });
  return withOther(
    { status: "not_subscribed", planLabel: TIER_LABEL.owner_managed, lines },
    `the ${TIER_LABEL.owner_managed} plan's ${money(annual)} yearly price — this property isn't subscribed yet`,
  );
}
