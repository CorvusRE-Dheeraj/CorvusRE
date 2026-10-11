import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { ScrollReveal } from "@/components/ScrollReveal";
import {
  openBillingPortal,
  getMyBilling,
  TIER_BRACKET_PRICES,
  VALUE_BRACKETS,
  CUSTOM_TIER,
  LAUNCH_DISCOUNT,
  LAUNCH_DISCOUNT_DEADLINE,
  isLaunchDiscountActive,
  type PlanValue,
} from "@/lib/billing";
import { ShieldCheck, CalendarCheck, FileCheck2, Scale, BadgePercent, Lock } from "lucide-react";
import { LaneComparisonTable } from "@/components/ServiceLanes";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — CorvusPT" },
      {
        name: "description",
        content:
          "CorvusPT pricing in three lanes: a free property review; Owner-Managed CorvusPT at $299/month billed annually, where you file with AI; and Expert/Managed Help (coming soon), where our team files and represents you.",
      },
      { property: "og:title", content: "CorvusPT Pricing" },
      {
        property: "og:description",
        content:
          "Free AI review. Then $299/mo per property, billed annually — 50% off your first year.",
      },
    ],
  }),
  component: Page,
});

// Kept as three separate lanes (lib/service-lanes.ts) — never one plan
// with both "you file" and "we file" in its bullet list.
const FREE_FEATURES = [
  "Your county's official record, matched by AI",
  "Potential savings estimate",
  "A first look at the AI Protest Report",
];
const OWNER_FEATURES = [
  "All 10 premium AI modules unlocked, per property",
  "AI Executive Protest Report + Evidence Builder packet",
  "Your county's filing steps, forms and deadlines",
  "AI hearing-prep guide for your hearing",
];

// Every number on this page reads off @/lib/billing — the same values
// create-checkout-session mirrors and actually charges.
const PLAN_BRACKET = VALUE_BRACKETS[0];
const MONTHLY_PRICE = TIER_BRACKET_PRICES.owner_managed[PLAN_BRACKET.value];
const ANNUAL_PRICE = MONTHLY_PRICE * 12;
const MANAGED_MONTHLY_PRICE = TIER_BRACKET_PRICES.corvusrf_managed[PLAN_BRACKET.value];
const LAUNCH_FIRST_YEAR_PRICE = ANNUAL_PRICE * (1 - LAUNCH_DISCOUNT);

// The deadline is stored as midnight US Central in UTC — format it in that
// zone so it never reads as "Jan 31" for a visitor west of it.
const LAUNCH_DEADLINE_LABEL = LAUNCH_DISCOUNT_DEADLINE.toLocaleDateString("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "America/Chicago",
});

function dollars(n: number): string {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

// Marks the two fixed-price plans the Savings Protection callout covers.
function SavingsProtectionChip() {
  return (
    <div className="mt-4 flex items-center gap-1.5 text-xs font-medium text-accent">
      <ShieldCheck className="h-4 w-4" aria-hidden="true" />
      Includes CorvusPT Savings Protection
    </div>
  );
}

// "ai_report" (flat-rate, self-file) and "managed_protest" (contingency, staff-filed)
// are the legacy tiers this pricing overhaul replaced — kept here only to decide
// whether "Manage Billing" should show at all for a grandfathered account.
const SUBSCRIBED_PLANS: PlanValue[] = [
  "owner_managed",
  "corvusrf_managed",
  "ai_report",
  "managed_protest",
];

function Page() {
  const { user } = useAuth();
  const [openingPortal, setOpeningPortal] = useState(false);
  const [currentPlan, setCurrentPlan] = useState<PlanValue | null>(null);
  const launchActive = isLaunchDiscountActive();

  useEffect(() => {
    if (!user) {
      setCurrentPlan(null);
      return;
    }
    getMyBilling(user.id)
      .then((b) => setCurrentPlan(b.plan))
      .catch(() => setCurrentPlan(null));
  }, [user]);

  // Beta access has no Stripe subscription behind it at all (granted at
  // signup — see handle_new_user() in supabase/schema.sql).
  const isBeta = currentPlan === "beta";
  const alreadySubscribed = !!currentPlan && SUBSCRIBED_PLANS.includes(currentPlan);

  async function handleManageBilling() {
    setOpeningPortal(true);
    try {
      await openBillingPortal();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not open billing portal. Please try again.",
      );
      setOpeningPortal(false);
    }
  }

  return (
    <div>
      <div className="container-page pt-16">
        <div className="max-w-3xl">
          <span className="badge-soft">Pricing</span>
          <h1 className="mt-3 text-4xl md:text-5xl font-semibold">
            Three lanes. Pick the one that fits.
          </h1>
        </div>
      </div>

      {/* At the top, above the lanes — the first thing read on the page. */}
      <div className="container-page mt-8">
        <ScrollReveal className="relative overflow-hidden rounded-2xl border-2 border-accent bg-accent/10 p-6 md:p-8 shadow-elev">
          <span className="brand-gradient absolute inset-x-0 top-0 h-1.5" />
          <div className="flex flex-col gap-5 md:flex-row md:items-center">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <ShieldCheck className="h-7 w-7" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-serif text-2xl md:text-3xl font-semibold">
                CorvusPT Savings Protection
              </h2>
              <p className="mt-2 max-w-3xl text-base md:text-lg">
                If CorvusPT does not identify any savings for you during the year 2027, your unused
                value carries forward to the following year —{" "}
                <span className="font-semibold">and your next year protest support is free.</span>
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Included with Owner-Managed CorvusPT and the fixed-price Expert/Managed Help plan.
              </p>
            </div>
          </div>
        </ScrollReveal>
      </div>

      {/* One card per lane (lib/service-lanes.ts). Always visible,
          regardless of sign-in/subscription state — the plain price
          reference. */}
      <div className="container-page mt-10">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <ScrollReveal className="card-elev p-6 flex flex-col h-full">
            <div className="badge-soft self-start">Lane 1</div>
            <h2 className="mt-3 font-serif text-2xl">Free Property Review</h2>
            <div className="mt-2 text-4xl font-semibold">Free</div>
            <p className="mt-1 text-sm text-muted-foreground">No card required · one property</p>
            <p className="mt-4 text-sm">
              Find out whether your property is over-assessed before you pay anything. Nothing is
              filed.
            </p>
            <ul className="mt-4 space-y-2 text-sm">
              {FREE_FEATURES.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  {f}
                </li>
              ))}
            </ul>
            <div className="mt-6 flex-1" />
            <Link to="/" className="w-full btn-outline text-center">
              Start Free Review
            </Link>
          </ScrollReveal>

          <ScrollReveal
            delay={120}
            className="card-elev relative overflow-hidden p-6 flex flex-col h-full ring-2 ring-accent"
          >
            <span className="brand-gradient absolute inset-x-0 top-0 h-1.5" />
            <div className="badge-soft self-start">Lane 2 · You file</div>
            <h2 className="mt-3 font-serif text-2xl">Owner-Managed CorvusPT</h2>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-4xl font-semibold">{dollars(MONTHLY_PRICE)}</span>
              <span className="text-muted-foreground text-sm">/month, per property</span>
            </div>
            <p className="mt-2 text-xl font-semibold">
              {PLAN_BRACKET.label.replace(" - ", "–")} property value
            </p>
            <p className="text-sm text-muted-foreground">
              Billed annually — {dollars(ANNUAL_PRICE)}/year
            </p>
            {launchActive && (
              <div className="mt-4 rounded-lg border border-accent/40 bg-accent/10 p-3 text-sm">
                <div className="flex items-center gap-1.5 font-semibold text-accent">
                  <BadgePercent className="h-4 w-4" aria-hidden="true" />
                  {pct(LAUNCH_DISCOUNT)} off your first year
                </div>
                <p className="mt-1 text-muted-foreground">
                  <span className="line-through">{dollars(ANNUAL_PRICE)}</span>{" "}
                  <span className="font-semibold text-foreground">
                    {dollars(LAUNCH_FIRST_YEAR_PRICE)}
                  </span>{" "}
                  for year one when you sign up before{" "}
                  <span className="font-bold text-foreground">{LAUNCH_DEADLINE_LABEL}</span>.
                </p>
              </div>
            )}
            <p className="mt-4 text-sm">
              <span className="font-semibold">
                You file, you attend the hearing, you talk to the county
              </span>{" "}
              —{" "}
              <span className="font-bold">
                Corvus AI prepares everything and tells you what to do and when.
              </span>
            </p>
            <ul className="mt-4 space-y-2 text-sm">
              {OWNER_FEATURES.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  {f}
                </li>
              ))}
            </ul>
            <SavingsProtectionChip />
            <div className="mt-6 flex-1" />
            <Link to="/dashboard/properties" className="w-full text-center btn-accent">
              Add a Property to Subscribe
            </Link>
            {/* Priority #6 from the Oct 2026 competitive analysis — a
            surprise renewal bill is the most common complaint in this
            industry, so the billing term is stated before checkout. */}
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Charged once a year, renews annually. Cancel renewal anytime from Manage Billing.
            </p>
          </ScrollReveal>

          {/* Expert/Managed Help — upcoming (locked). $5M+ is quoted by the
              team, not through Stripe checkout — so no rate is printed. */}
          <ScrollReveal
            delay={240}
            className="card-elev p-6 flex flex-col h-full ring-2 ring-violet-500/30 opacity-80"
          >
            <div className="flex flex-wrap items-center gap-2">
              <div className="badge-soft">Lane 3 · We file</div>
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
                <Lock className="h-3 w-3" aria-hidden="true" /> Upcoming
              </span>
            </div>
            <h2 className="mt-3 font-serif text-2xl">Expert/Managed Help</h2>
            <p className="mt-2 text-sm">
              <span className="font-semibold">
                CorvusPT&apos;s team files, talks to the county and represents you at the hearing
              </span>
              . Nothing is settled without your approval.
            </p>
            <div className="mt-4 grid gap-3 text-sm">
              <div className="rounded-lg border border-border p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">Fixed price</span>
                  <span className="font-semibold">{dollars(MANAGED_MONTHLY_PRICE)}/mo</span>
                </div>
                <p className="mt-1 text-base font-semibold">
                  {PLAN_BRACKET.label.replace(" - ", "–")} property value
                </p>
                <p className="text-xs text-muted-foreground">
                  Per property, billed annually. Includes Savings Protection.
                </p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{CUSTOM_TIER.label} property value</span>
                  <span className="font-semibold">Custom</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{CUSTOM_TIER.blurb}</p>
              </div>
            </div>
            <div className="mt-6 flex-1" />
            <button
              type="button"
              disabled
              className="w-full btn-outline inline-flex items-center justify-center gap-1.5 cursor-not-allowed opacity-70"
            >
              <Lock className="h-4 w-4" aria-hidden="true" /> Coming soon
            </button>
          </ScrollReveal>
        </div>

        <ScrollReveal className="mt-8">
          <h2 className="font-serif text-2xl font-semibold">Who does what</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The same four questions, answered for each lane.
          </p>
          <div className="mt-4">
            <LaneComparisonTable />
          </div>
        </ScrollReveal>
      </div>

      {/* Added per the Oct 2026 competitive analysis (Priorities #4 and #9):
      these are real, already-built parts of the CorvusPT workflow — the
      pricing page is where a prospect is actively comparing options, so
      it's the right place to say plainly what control they keep and what
      happens if a hearing doesn't go their way. */}
      <div className="container-page mt-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ScrollReveal className="card-elev p-5">
            <CalendarCheck className="h-5 w-5 text-accent" aria-hidden="true" />
            <h3 className="mt-2 font-serif text-base font-semibold">
              You see your own hearing date
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Every case's scheduled date, time, and mode is shown directly in your dashboard —
              never something you find out about after the fact.
            </p>
          </ScrollReveal>
          <ScrollReveal delay={100} className="card-elev p-5">
            <ShieldCheck className="h-5 w-5 text-accent" aria-hidden="true" />
            <h3 className="mt-2 font-serif text-base font-semibold">
              You approve every settlement
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Nothing is accepted on your behalf without your sign-off first — Expert/Managed Help
              includes a real settlement-approval step, not a blanket authorization.
            </p>
          </ScrollReveal>
          <ScrollReveal delay={200} className="card-elev p-5">
            <FileCheck2 className="h-5 w-5 text-accent" aria-hidden="true" />
            <h3 className="mt-2 font-serif text-base font-semibold">You see the evidence filed</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Every comp and document behind your case is in your own case's Evidence section — not
              a black box you have to request access to.
            </p>
          </ScrollReveal>
          <ScrollReveal delay={300} className="card-elev p-5">
            <Scale className="h-5 w-5 text-accent" aria-hidden="true" />
            <h3 className="mt-2 font-serif text-base font-semibold">
              Arbitrations &amp; court appeals automatically tracked
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              If your hearing doesn't go your way, Texas law lets you escalate to binding
              arbitration (Tax Code §41A) or a district court appeal (Tax Code §42) — CorvusPT
              tracks your eligibility, deadlines, and deposits for you.
            </p>
          </ScrollReveal>
        </div>
      </div>

      <div className="container-page pb-16">
        {isBeta ? (
          <div className="mt-8 max-w-xl rounded-lg border border-accent/40 bg-accent/10 p-6">
            <div className="text-3xl font-semibold">$0</div>
            <h2 className="mt-1 font-serif text-xl font-semibold">You have full Beta access 🎉</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Thanks for testing CorvusPT with us — every AI module is unlocked on every property,
              free, for as long as you're in the beta. No card, no subscription to manage.
            </p>
          </div>
        ) : alreadySubscribed ? (
          <div className="mt-8 max-w-3xl rounded-lg border border-border bg-secondary/40 p-4 text-sm">
            <p>Each of your properties has its own real subscription.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link to="/dashboard/properties" className="btn-outline">
                View My Properties
              </Link>
              <button
                onClick={handleManageBilling}
                disabled={openingPortal}
                className="btn-outline disabled:opacity-60"
              >
                {openingPortal ? "Redirecting…" : "Manage Billing"}
              </button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Manage Billing opens Stripe's portal, where every property's subscription is listed
              separately — cancel, update payment method, or view invoices for any one of them
              individually.
            </p>
          </div>
        ) : (
          <div className="mt-8 text-sm text-muted-foreground">
            Just want the free AI review first?{" "}
            <Link to="/" className="font-medium text-accent underline underline-offset-2">
              Start a free review
            </Link>{" "}
            — no card required, one property.
          </div>
        )}
      </div>
    </div>
  );
}
