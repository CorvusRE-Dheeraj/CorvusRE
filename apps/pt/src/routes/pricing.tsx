import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { ScrollReveal } from "@/components/ScrollReveal";
import {
  openBillingPortal,
  getMyBilling,
  TIER_LABEL,
  planPriceLines,
  type BillingInterval,
  type PlanValue,
  type Tier,
} from "@/lib/billing";
import { Check, ShieldCheck, CalendarCheck, FileCheck2, Scale } from "lucide-react";
import { BillingIntervalToggle, CommitmentNote } from "@/components/BillingChoice";
import { LaneComparisonTable } from "@/components/ServiceLanes";
import { SERVICE_LANES } from "@/lib/service-lanes";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — CorvusPT" },
      {
        name: "description",
        content:
          "CorvusPT pricing: a free property review, then Owner-Managed at $199/month (you file, with AI) or Corvus-Managed at $299/month (our team files). Pay yearly and save 50% on your first year.",
      },
      { property: "og:title", content: "CorvusPT Pricing" },
      {
        property: "og:description",
        content:
          "Free AI review. Then $199/mo or $299/mo per property — or pay yearly and save 50% on your first year.",
      },
    ],
  }),
  component: Page,
});

// The two paid plans (lib/service-lanes.ts keeps "you file" and "we file"
// as separate lanes). Prices come from @/lib/billing — the same values
// create-checkout-session charges.
const FREE_LANE = SERVICE_LANES.find((l) => l.id === "free_review")!;
const MANAGED_LANE = SERVICE_LANES.find((l) => l.id === "expert_managed")!;

const PLANS: {
  tier: Tier;
  oneLiner: string;
  features: string[];
  cta: { to: string; label: string };
  featured?: boolean;
}[] = [
  {
    tier: "owner_managed",
    oneLiner: "You file. Corvus AI guides every step.",
    features: [
      "All 10 AI analysis modules for your property",
      "Evidence packet and pre-filled county forms",
      "Your deadlines, filing steps and hearing prep",
    ],
    cta: { to: "/dashboard/properties", label: "Choose Owner-Managed" },
    featured: true,
  },
  {
    tier: "corvusrf_managed",
    oneLiner: "Our team files and represents you.",
    features: [
      "Everything in Owner-Managed",
      "We file, negotiate and attend the hearing",
      "Nothing is settled without your approval",
    ],
    cta: { to: MANAGED_LANE.cta.to, label: "Choose Corvus-Managed" },
  },
];

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
  const [interval, setBillingInterval] = useState<BillingInterval>("month");

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
      <div className="container-page pt-16 text-center">
        <span className="badge-soft">Pricing</span>
        <h1 className="mt-3 text-4xl font-semibold md:text-5xl">
          Simple pricing. You stay in control.
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-lg text-muted-foreground">
          Start with a free property review. Then choose who files your protest.
        </p>
        <div className="mt-8 flex justify-center">
          <BillingIntervalToggle value={interval} onChange={setBillingInterval} />
        </div>
      </div>

      <div className="container-page mt-8">
        <div className="mx-auto grid max-w-4xl grid-cols-1 gap-6 md:grid-cols-2">
          {PLANS.map((plan, i) => {
            const price = planPriceLines(plan.tier, interval);
            return (
              <ScrollReveal
                key={plan.tier}
                delay={i * 120}
                className={`card-elev relative flex h-full flex-col overflow-hidden p-7 ${plan.featured ? "ring-2 ring-accent" : ""}`}
              >
                {plan.featured && (
                  <span className="brand-gradient absolute inset-x-0 top-0 h-1.5" />
                )}
                <h2 className="font-serif text-2xl font-semibold">{TIER_LABEL[plan.tier]}</h2>
                <p className="mt-1 text-muted-foreground">{plan.oneLiner}</p>
                <div className="mt-6 flex items-baseline gap-2">
                  <span className="text-6xl font-bold tracking-tight">{price.amount}</span>
                  <span className="text-lg text-muted-foreground">{price.unit}</span>
                </div>
                <p
                  className={`mt-2 text-sm ${interval === "year" ? "font-medium text-success" : "text-muted-foreground"}`}
                >
                  {price.detail}
                </p>
                <ul className="mt-6 space-y-2.5 text-sm">
                  {plan.features.map((f) => (
                    <li key={f} className="flex gap-2.5">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                      {f}
                    </li>
                  ))}
                </ul>
                <div className="mt-7 flex-1" />
                <Link
                  to={plan.cta.to}
                  className={`w-full text-center ${plan.featured ? "btn-accent" : "btn-outline"}`}
                >
                  {plan.cta.label}
                </Link>
              </ScrollReveal>
            );
          })}
        </div>

        <div className="mx-auto mt-6 max-w-4xl space-y-4">
          <p className="text-center text-sm text-muted-foreground">
            Prices are per property, for properties valued under $5M. Each additional property is
            15% off. Over $5M?{" "}
            <Link
              to="/contact"
              className="font-medium text-foreground underline underline-offset-2"
            >
              Talk to us
            </Link>
            .
          </p>
          <CommitmentNote />
          <div className="flex items-start gap-3 rounded-xl border border-accent/30 bg-accent/5 p-4 text-sm">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
            <p>
              <span className="font-semibold">Savings Protection, included with both plans.</span>{" "}
              If CorvusPT doesn&apos;t find any savings for you in 2027, your unused value carries
              forward and your next year of protest support is free.
            </p>
          </div>
          <div className="flex flex-col items-center justify-between gap-3 rounded-xl border border-border p-4 text-sm sm:flex-row">
            <p>
              <span className="font-semibold">Not ready to choose?</span> {FREE_LANE.name} is free —
              see which properties are over-assessed before you pay anything.
            </p>
            <Link to="/" className="btn-outline shrink-0">
              Start Free Review
            </Link>
          </div>
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
              Nothing is accepted on your behalf without your sign-off first — Corvus-Managed
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
            — no card required, screen your whole portfolio.
          </div>
        )}
      </div>
    </div>
  );
}
