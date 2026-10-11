import { Search } from "lucide-react";
import { guessLikelyCountyName } from "@/lib/unified-search";

// `query` — the text actually being searched right now. When it confidently
// names one of the cities cad-lookup's own CITY_TO_COUNTY_HINT recognizes
// (guessLikelyCountyName mirrors that same mapping, client-side, for
// display only), the real likely county is shown. Otherwise the label stays
// county-neutral: it used to cycle through every supported county's name,
// which read as a wrong guess — "Searching Harris County records…" under a
// Fair Oaks Ranch (Bexar) address, reported 2026-10-08.
export function LiveSearchLoader({
  className = "",
  query = "",
}: {
  className?: string;
  query?: string;
}) {
  const likelyCounty = guessLikelyCountyName(query);
  const label = likelyCounty
    ? `Searching ${likelyCounty} County records…`
    : "Searching Texas county records…";

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
        "actively scanning" motion. Plain Tailwind animate-spin. */}
        <span className="absolute h-7 w-7 animate-spin rounded-full border-2 border-transparent border-t-accent border-r-accent/60" />
        <span className="relative flex h-4 w-4 items-center justify-center rounded-full bg-accent/15">
          <Search className="h-2.5 w-2.5 text-accent" aria-hidden="true" />
        </span>
      </span>
      <span key={likelyCounty ?? "any"} className="list-item-enter font-medium">
        {label}
      </span>
    </div>
  );
}
