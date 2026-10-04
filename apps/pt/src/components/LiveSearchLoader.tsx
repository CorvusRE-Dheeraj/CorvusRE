import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { SUPPORTED_COUNTY_NAMES } from "@/lib/cad-record-url";
import { guessLikelyCountyName } from "@/lib/unified-search";

// Rotates through the real counties this app actually searches in parallel
// (see cad-lookup's own county fan-out) — not decorative filler text, an
// honest reflection of what's really happening while the unified live
// property-search dropdown waits on a response. Used only as the fallback
// when `query` doesn't confidently name one of them (see below) — found
// live ("searching Collin County" shown for a typed "walmart dallas" read
// as random/wrong, since cycling through all 13 names has no connection to
// what's actually happening for THIS search).
const COUNTIES = Array.from(SUPPORTED_COUNTY_NAMES);
const ROTATE_MS = 900;

// `query` — the text actually being searched right now. When it confidently
// names one of the cities cad-lookup's own CITY_TO_COUNTY_HINT recognizes
// (guessLikelyCountyName mirrors that same mapping, client-side, for
// display only), the real likely county is shown directly and held still —
// more accurate AND calmer than cycling, since the backend is now actually
// trying that one county first (see cad-lookup/index.ts's
// countyQueryFromQueryText). Falls back to the honest "don't know yet"
// cycling animation when the query doesn't name a recognized city.
export function LiveSearchLoader({
  className = "",
  query = "",
}: {
  className?: string;
  query?: string;
}) {
  const likelyCounty = guessLikelyCountyName(query);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (likelyCounty) return; // nothing to rotate — already showing the real one
    const id = setInterval(() => setI((n) => (n + 1) % COUNTIES.length), ROTATE_MS);
    return () => clearInterval(id);
  }, [likelyCounty]);

  const label = likelyCounty
    ? `Searching ${likelyCounty} County records…`
    : `Searching ${COUNTIES[i]} County records…`;

  return (
    <div className={`flex items-center gap-3 text-sm text-muted-foreground ${className}`}>
      <span className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center">
        {/* Outward-pulsing rings — same radiate-ring utility as the homepage
        hero, reused rather than a third pulse style invented just for this. */}
        <span
          className="radiate-ring absolute h-7 w-7 rounded-full border-2 border-accent/40"
          style={{ animationDuration: "1.3s" }}
        />
        <span
          className="radiate-ring absolute h-7 w-7 rounded-full border-2 border-accent/25"
          style={{ animationDuration: "1.3s", animationDelay: "0.4s" }}
        />
        {/* A continuously rotating partial arc on top of the pulses — the
        "actively scanning" motion the old static two-ring version lacked.
        Plain Tailwind animate-spin, no new keyframe needed. */}
        <span className="absolute h-7 w-7 animate-spin rounded-full border-2 border-transparent border-t-accent border-r-accent/60" />
        <span className="relative flex h-4 w-4 items-center justify-center rounded-full bg-accent/15">
          <Search className="h-2.5 w-2.5 text-accent" aria-hidden="true" />
        </span>
      </span>
      <span key={likelyCounty ?? i} className="list-item-enter font-medium">
        {label}
      </span>
    </div>
  );
}
