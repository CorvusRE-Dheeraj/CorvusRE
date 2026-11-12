import { ChevronDown, Info } from "lucide-react";
import { type BillingInterval } from "@/lib/billing";

/** Monthly / Yearly switch shown above the plan cards. */
export function BillingIntervalToggle({
  value,
  onChange,
}: {
  value: BillingInterval;
  onChange: (v: BillingInterval) => void;
}) {
  const option = (v: BillingInterval, label: string, badge?: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={value === v}
      onClick={() => onChange(v)}
      className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
        value === v
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
      {badge && (
        <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">
          {badge}
        </span>
      )}
    </button>
  );
  return (
    <div
      role="radiogroup"
      aria-label="How you'd like to pay"
      className="inline-flex rounded-full border border-border bg-secondary/60 p-1"
    >
      {option("month", "Pay monthly")}
      {option("year", "Pay yearly", "Save 50%")}
    </div>
  );
}

// The subscription commitment, worded by the owner (Nov 2026). Shown in full —
// never folded away — wherever someone picks a plan before paying, and on
// Stripe's payment page (create-checkout-session custom_text).
export const SUBSCRIPTION_TERMS = [
  "All subscriptions require a mandatory 12-month commitment. You may choose to pay the full subscription fee upfront or in 12 monthly installments.",
  "By selecting monthly payments, you agree to the full 12-month subscription term. Your saved credit card will be automatically charged each month for 12 consecutive months. Monthly payments are an installment option and do not constitute a month-to-month subscription.",
] as const;
export const EARLY_CANCELLATION_NOTE =
  "Early cancellation is not permitted, and the full 12-month subscription commitment remains payable regardless of the selected payment frequency.";

/** The 12-month commitment, always visible, before payment. */
export function SubscriptionTermsNotice({ className = "" }: { className?: string }) {
  return (
    <div
      role="note"
      aria-label="12-Month Subscription Commitment"
      className={`rounded-xl border border-warning/50 bg-warning/10 px-4 py-3 text-xs leading-relaxed text-foreground ${className}`}
    >
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
        12-Month Subscription Commitment
      </p>
      {SUBSCRIPTION_TERMS.map((t) => (
        <p key={t} className="mt-2">
          {t}
        </p>
      ))}
      <p className="mt-2">
        <span className="font-semibold">Please note:</span> {EARLY_CANCELLATION_NOTE}
      </p>
    </div>
  );
}

/** The commitment terms, then how the plan runs (folded away until wanted). */
export function CommitmentNote({ className = "" }: { className?: string }) {
  return (
    <div className={`space-y-3 ${className}`}>
      <SubscriptionTermsNotice />
      <CommitmentDetails />
    </div>
  );
}

function CommitmentDetails() {
  return (
    <details className="group rounded-xl border border-border bg-secondary/30 px-4 py-3 text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium">
        <Info className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        How your plan works
        <ChevronDown
          className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <ul className="mt-3 space-y-2 text-muted-foreground">
        <li>
          <span className="font-medium text-foreground">Monthly:</span> your plan runs for 12 months
          to start. Once 13 months are complete, you can cancel with 60 days&apos; notice. If you
          stay, your next 12 months begin in month 15.
        </li>
        <li>
          <span className="font-medium text-foreground">Yearly:</span> one payment covers 12 months,
          at half price for your first year. It renews each year, and you can turn renewal off at
          any time.
        </li>
      </ul>
    </details>
  );
}
