import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  getMyBilling,
  openBillingPortal,
  listMySubscriptions,
  syncMySubscriptions,
  cancelPropertySubscription,
  resumePropertySubscription,
  cancelBppSubscription,
  resumeBppSubscription,
  formatMoney,
  TIER_BRACKET_PRICES,
  VALUE_BRACKETS,
  BPP_TIER_BRACKET_PRICES,
  BPP_VALUE_BRACKETS,
  type PlanValue,
  type MySubscription,
} from "@/lib/billing";
import { listProperties, type PropertyRecord } from "@/lib/properties";
import { listBppAccounts, type BppAccountRecord } from "@/lib/bpp-accounts";
import { PaymentsModeChip } from "@/components/PaymentsModeChip";
import { PageHero } from "@/components/PageHero";
import { CreditCard as HeroBillingIcon } from "lucide-react";
import { PageSkeleton } from "@/components/PageSkeleton";

export const Route = createFileRoute("/dashboard/_layout/billing")({
  component: Billing,
});

const TIER_LABEL: Record<string, string> = {
  owner_managed: "Owner-Managed",
  corvusrf_managed: "CorvusPT-Managed",
};

const BRACKET_LABEL: Record<string, string> = Object.fromEntries(
  [...VALUE_BRACKETS, ...BPP_VALUE_BRACKETS].map((b) => [b.value, b.label]),
);

// A subscription's list price (pre-discount), looked up from whichever
// bracket table its bracket string actually belongs to — property brackets
// and BPP brackets are differently-shaped strings, so this can't just be one
// Record lookup the way TIER_BRACKET_PRICES alone was.
function listPriceCents(tier: string, bracket: string): number | null {
  const propertyPrices = TIER_BRACKET_PRICES[tier as keyof typeof TIER_BRACKET_PRICES];
  if (propertyPrices && bracket in propertyPrices) {
    return propertyPrices[bracket as keyof typeof propertyPrices] * 100;
  }
  const bppPrices = BPP_TIER_BRACKET_PRICES[tier as keyof typeof BPP_TIER_BRACKET_PRICES];
  if (bppPrices && bracket in bppPrices) {
    return bppPrices[bracket as keyof typeof bppPrices] * 100;
  }
  return null;
}

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Past due",
  unpaid: "Unpaid",
  incomplete: "Incomplete",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function money(cents: number | null): string {
  if (cents == null) return "—";
  return `$${formatMoney(Math.round(cents) / 100)}`;
}

function Billing() {
  const { user } = useAuth();
  const [plan, setPlan] = useState<PlanValue | null>(null);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [bppAccounts, setBppAccounts] = useState<BppAccountRecord[]>([]);
  const [subs, setSubs] = useState<MySubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [subsError, setSubsError] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([getMyBilling(user.id), listProperties(user.id), listBppAccounts(user.id)])
      .then(([b, props, bpp]) => {
        setPlan(b.plan);
        setProperties(props);
        setBppAccounts(bpp);
      })
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
    // Stripe read, kept separate: a slow/failed Stripe call shouldn't hold up
    // the plan + property list, and its own failure just hides the money
    // detail (amount/renewal/card) rather than blanking the page.
    listMySubscriptions()
      .then(setSubs)
      .catch((err) => {
        console.error(err);
        setSubsError(true);
      });
    // Fire-and-forget: reconcile the property rows from Stripe so a missed
    // webhook doesn't leave other pages (Properties, AI Report) showing a paid
    // property as unpaid. This page reads Stripe directly above, so it doesn't
    // need the result itself.
    syncMySubscriptions().catch((err) => console.error("Subscription reconcile failed:", err));
  }, [user]);

  async function handleManage() {
    setOpeningPortal(true);
    try {
      await openBillingPortal({ newTab: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open billing portal.");
    } finally {
      setOpeningPortal(false);
    }
  }

  // Defensive: the portal now opens in a new tab so this page no longer
  // navigates away, but keep clearing any in-flight state on pageshow in case
  // a bfcache restore ever freezes it on.
  useEffect(() => {
    const onShow = () => {
      setOpeningPortal(false);
      setBusyId(null);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  // Same immediate cancel the Properties/BPP Accounts page uses (cancel-
  // property-subscription/cancel-bpp-subscription end the Stripe subscription
  // now, not at period end) — keyed by the subscription's own propertyId or
  // bppAccountId, so it only ever works for a subscription still linked to a
  // live subject. On success drop it from the list; the list-my-subscriptions
  // filter would exclude it on the next load anyway.
  async function handleCancel(s: MySubscription, label: string) {
    if (!s.propertyId && !s.bppAccountId) return;
    const subjectWord = s.bppAccountId ? "BPP account" : "property";
    const ok = window.confirm(
      `Cancel the subscription for ${label}? It ends immediately — you'll lose paid AI Report ` +
        `access and the ability to request a new protest filing for this ${subjectWord}.`,
    );
    if (!ok) return;
    setBusyId(s.id);
    try {
      if (s.bppAccountId) await cancelBppSubscription(s.bppAccountId);
      else await cancelPropertySubscription(s.propertyId!);
      toast.success("Subscription canceled.");
      setSubs((prev) => prev.filter((x) => x.id !== s.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not cancel this subscription.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleResume(s: MySubscription) {
    if (!s.propertyId && !s.bppAccountId) return;
    setBusyId(s.id);
    try {
      if (s.bppAccountId) await resumeBppSubscription(s.bppAccountId);
      else await resumePropertySubscription(s.propertyId!);
      toast.success("Subscription resumed — it will keep renewing as normal.");
      setSubs((prev) =>
        prev.map((x) => (x.id === s.id ? { ...x, cancelAtPeriodEnd: false, cancelAt: null } : x)),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not resume this subscription.");
    } finally {
      setBusyId(null);
    }
  }

  const isBeta = plan === "beta";
  const propsById = new Map(properties.map((p) => [p.id, p]));
  const bppById = new Map(bppAccounts.map((a) => [a.id, a]));

  // A subscription set to cancel is still billed until its period end, but it
  // isn't part of the ongoing monthly commitment — keep it out of the running
  // total (it still appears in the list below, with its own end date).
  const billingSubs = subs.filter((s) => !s.cancelAtPeriodEnd);
  const monthlyTotalCents = billingSubs.reduce((sum, s) => sum + (s.amountCents ?? 0), 0);
  const nextChargeIso =
    billingSubs
      .map((s) => s.currentPeriodEnd)
      .filter((d): d is string => !!d)
      .sort()[0] ?? null;

  return (
    // Centered, not left-stuck — same fix as Settings (_layout.settings.tsx):
    // each branch below used to carry its own independent max-w-2xl with no
    // mx-auto, which pinned a form-width column to the left edge and left a
    // large dead zone of empty space on wider screens.
    <div className="mx-auto max-w-2xl">
      <PageHero
        icon={HeroBillingIcon}
        title="Billing"
        tone="indigo"
        badges={<PaymentsModeChip />}
        subtitle="Your CorvusPT subscriptions, by property and BPP account."
      />

      {loading ? (
        <PageSkeleton />
      ) : isBeta ? (
        <div className="card-elev mt-6 p-6">
          <div className="text-muted-foreground text-xs uppercase tracking-wide">Current plan</div>
          <div className="mt-1 font-serif text-2xl font-semibold">Beta</div>
          <p className="text-muted-foreground mt-2 text-sm">
            Every AI module is unlocked on every property, free, for as long as you're in the beta —
            no subscriptions to manage.
          </p>
        </div>
      ) : subs.length === 0 ? (
        <div className="card-elev mt-6 p-6">
          <p className="text-muted-foreground text-sm">
            {subsError
              ? "Couldn't load your subscriptions just now. Try again shortly, or open the billing portal."
              : "You don't have any paid subscriptions yet."}
          </p>
          <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap">
            <Link
              to="/dashboard/properties"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-outline"
            >
              Manage Properties
            </Link>
            <Link
              to="/pricing"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary btn-primary-hover"
            >
              See Pricing
            </Link>
          </div>
        </div>
      ) : (
        <div className="mt-6 grid gap-6">
          {/* Portfolio summary */}
          <div className="card-elev p-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <div className="text-muted-foreground text-xs uppercase tracking-wide">Active</div>
                <div className="mt-1 font-serif text-2xl font-semibold">{billingSubs.length}</div>
                <div className="text-muted-foreground text-xs">
                  subscription{billingSubs.length === 1 ? "" : "s"}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs uppercase tracking-wide">
                  Monthly total
                </div>
                <div className="mt-1 font-serif text-2xl font-semibold">
                  {money(monthlyTotalCents)}
                </div>
                <div className="text-muted-foreground text-xs">across all subscriptions</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs uppercase tracking-wide">
                  Next charge
                </div>
                <div className="mt-1 font-serif text-2xl font-semibold">
                  {fmtDate(nextChargeIso)}
                </div>
                <div className="text-muted-foreground text-xs">earliest renewal</div>
              </div>
            </div>
            <div className="mt-5 grid gap-2 sm:flex sm:flex-wrap">
              <button
                onClick={handleManage}
                disabled={openingPortal}
                className="btn-outline disabled:opacity-60"
              >
                {openingPortal ? "Opening…" : "Payment method & invoices"}
              </button>
              <Link
                to="/dashboard/properties"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-outline"
              >
                Manage Properties
              </Link>
              <Link
                to="/dashboard/bpp-accounts"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-outline"
              >
                Manage BPP Accounts
              </Link>
              <Link
                to="/pricing"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary btn-primary-hover"
              >
                Compare Plans
              </Link>
            </div>
            {subsError && (
              <p className="text-warning-foreground mt-3 text-xs">
                Some billing details couldn't be loaded from Stripe just now — amounts and dates may
                be missing.
              </p>
            )}
          </div>

          {/* One card per real subscription */}
          <ul className="grid gap-3">
            {subs.map((s) => {
              const prop = s.propertyId ? propsById.get(s.propertyId) : undefined;
              const bpp = s.bppAccountId ? bppById.get(s.bppAccountId) : undefined;
              const tierLabel = s.tier ? (TIER_LABEL[s.tier] ?? s.tier) : null;
              const bracketLabel = s.bracket ? (BRACKET_LABEL[s.bracket] ?? null) : null;
              const listCents = s.tier && s.bracket ? listPriceCents(s.tier, s.bracket) : null;
              const discounted =
                listCents != null && s.amountCents != null && s.amountCents < listCents - 1;
              const heading =
                prop?.address ??
                bpp?.businessName ??
                s.productName ??
                (tierLabel
                  ? `${tierLabel} subscription`
                  : bpp
                    ? "BPP subscription"
                    : "Property subscription");
              const meta = [
                tierLabel,
                bracketLabel,
                prop?.accountNumber && `Acct ${prop.accountNumber}`,
                bpp?.accountNumber && `Acct ${bpp.accountNumber}`,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={s.id} className="card-elev p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium">{heading}</div>
                      {meta && <div className="text-muted-foreground text-xs">{meta}</div>}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-semibold">
                        {money(s.amountCents)}
                        <span className="text-muted-foreground text-xs font-normal">/mo</span>
                      </div>
                      {discounted && (
                        <div className="text-accent text-[11px]">2nd-property discount applied</div>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span
                      className={`badge-soft ${
                        s.cancelAtPeriodEnd ? "bg-secondary text-muted-foreground" : ""
                      }`}
                    >
                      {s.cancelAtPeriodEnd ? "Canceling" : (STATUS_LABEL[s.status] ?? s.status)}
                    </span>
                    <span className="text-muted-foreground">
                      {s.cancelAtPeriodEnd
                        ? `Ends ${fmtDate(s.cancelAt ?? s.currentPeriodEnd)}`
                        : s.currentPeriodEnd
                          ? `Renews ${fmtDate(s.currentPeriodEnd)}`
                          : ""}
                      {s.card && ` · ${s.card.brand} ···· ${s.card.last4}`}
                    </span>
                  </div>

                  {s.cancelAtPeriodEnd && (
                    <p className="text-muted-foreground mt-2 text-[11px]">
                      You've already canceled this. It stays active until{" "}
                      {fmtDate(s.cancelAt ?? s.currentPeriodEnd)}, then ends on its own — no further
                      charges. It'll drop off this list once that date passes.
                    </p>
                  )}

                  <div className="border-border mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                    {prop || bpp ? (
                      s.cancelAtPeriodEnd ? (
                        <button
                          onClick={() => handleResume(s)}
                          disabled={busyId === s.id}
                          className="btn-outline py-1.5 text-sm disabled:opacity-60"
                        >
                          {busyId === s.id ? "Resuming…" : "Resume subscription"}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleCancel(s, heading)}
                          disabled={busyId === s.id}
                          className="btn-outline text-warning-foreground py-1.5 text-sm disabled:opacity-60"
                        >
                          {busyId === s.id ? "Canceling…" : "Cancel subscription"}
                        </button>
                      )
                    ) : (
                      <>
                        <span className="text-muted-foreground text-[11px]">
                          Not linked to a current property or BPP account — it may have been
                          deleted.
                        </span>
                        <button
                          onClick={handleManage}
                          disabled={openingPortal}
                          className="btn-outline py-1.5 text-sm disabled:opacity-60"
                        >
                          {openingPortal
                            ? "Opening…"
                            : s.cancelAtPeriodEnd
                              ? "View in billing portal"
                              : "Cancel in billing portal"}
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
