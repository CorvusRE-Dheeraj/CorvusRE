import { useEffect, useState } from "react";
import { SUPPORTED_COUNTY_NAMES } from "@/lib/cad-record-url";

// Rotates through the real counties this app actually searches in parallel
// (see cad-lookup's own county fan-out) — not decorative filler text, an
// honest reflection of what's really happening while the unified live
// property-search dropdown waits on a response. Replaces the old static
// "Checking county records…" line, flagged as flat/unexciting next to the
// rest of this app's animated homepage. Reuses the existing radiate-ring
// (homepage hero) and list-item-enter (cascading list entrances) animation
// utilities from styles.css rather than inventing a third style.
const COUNTIES = Array.from(SUPPORTED_COUNTY_NAMES);
const ROTATE_MS = 700;

export function LiveSearchLoader({ className = "" }: { className?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % COUNTIES.length), ROTATE_MS);
    return () => clearInterval(id);
  }, []);
  return (
    <div className={`flex items-center gap-2.5 text-sm text-muted-foreground ${className}`}>
      <span className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center">
        <span
          className="radiate-ring absolute h-5 w-5 rounded-full border-2 border-accent/50"
          style={{ animationDuration: "1.1s" }}
        />
        <span
          className="radiate-ring absolute h-5 w-5 rounded-full border-2 border-accent/30"
          style={{ animationDuration: "1.1s", animationDelay: "0.35s" }}
        />
        <span className="relative h-2.5 w-2.5 rounded-full bg-accent" />
      </span>
      <span key={i} className="list-item-enter">
        Searching {COUNTIES[i]} County records…
      </span>
    </div>
  );
}
