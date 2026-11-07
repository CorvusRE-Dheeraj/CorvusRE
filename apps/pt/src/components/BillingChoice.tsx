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

/** The commitment in plain words, folded away until someone wants it. */
export function CommitmentNote({ className = "" }: { className?: string }) {
  return (
    <details
      className={`group rounded-xl border border-border bg-secondary/30 px-4 py-3 text-sm ${className}`}
    >
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
