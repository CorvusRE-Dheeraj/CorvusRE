import { HouseIllustration } from "@/assets/illustrations/house";

// Indeterminate circular spinner with a centered icon — used for the "looking
// up your property" moment (property/CAD record search), where we don't have
// a real progress percentage to show, just that work is happening. Not gated
// behind prefers-reduced-motion like the decorative hero/entrance animations
// elsewhere in this app: a spinner communicates active-loading state
// functionally, so freezing it would read as broken/stuck rather than calm.
export function CircularSearchLoader({ className = "h-28 w-28" }: { className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="44" fill="none" stroke="var(--color-border)" strokeWidth="8" />
        <circle
          cx="50"
          cy="50"
          r="44"
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray="180 276"
          className="origin-center animate-spin"
          style={{ animationDuration: "1.4s" }}
        />
      </svg>
      <div className="absolute inset-[14%] grid place-items-center overflow-hidden rounded-full bg-accent/10">
        <HouseIllustration className="h-[85%] w-auto" />
      </div>
    </div>
  );
}
