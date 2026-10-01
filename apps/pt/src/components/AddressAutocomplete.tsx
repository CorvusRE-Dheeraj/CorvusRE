import { useEffect, useId, useRef, useState } from "react";
import {
  GOOGLE_API_KEY,
  fetchGoogleSuggestions as fetchGooglePlaceSuggestions,
  fetchGooglePlaceDetails,
  normalizeRoadPrefix,
} from "@/lib/google-places";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onPlaceSelected?: (formattedAddress: string) => void;
  // Fires true right when a Google suggestion is picked and its Place
  // Details follow-up call starts, then false once it settles (success,
  // failure, or abort alike). A Google selection shows an immediate but
  // still-provisional value (the raw, sometimes mid-word-abbreviated
  // Autocomplete prediction text, e.g. "Market Pl Blvd" — the real "Market
  // Place Boulevard" a CAD site's own data expects lands ~1-2s later) before
  // it's upgraded to the real address. Without a way to signal that gap, a
  // caller with its own submit button (e.g. intake.tsx's "Validate address")
  // has no way to know a fast click-through would submit that provisional
  // text instead of waiting for the real one — confirmed live as the same
  // root cause as the CAD-matching bug this two-step value update exists to
  // avoid, just reachable through a race instead of a permanent mismatch.
  // Never fires for a Nominatim selection, which has no such follow-up step.
  onResolving?: (resolving: boolean) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  // When true, this component's own suggestion dropdown never renders —
  // internal search/debounce/state all still run normally, only the `{open
  // && ...}` list is suppressed. Added for callers that show a SECOND
  // dropdown of their own below this input (the live CAD-match list on the
  // homepage and /intake) — confirmed live: both panels floating open at
  // once visually overlap (this one is `position: absolute`, so it floats
  // over whatever comes after it in normal flow, not pushed below it), and
  // once there's a real, verified county match to show, that's strictly
  // more useful than a generic "did you mean this address" text guess.
  suppressSuggestions?: boolean;
};

type Suggestion = {
  id: string;
  label: string;
  // Set only for a Google suggestion — its placeId, used by selectSuggestion()
  // to fetch the zip-inclusive final address via a Place Details call (Google's
  // Autocomplete predictions don't include a postal code, only Place Details
  // does). Absent for a Nominatim suggestion, which already has everything
  // (including postcode) inline, so no follow-up call is needed there.
  googlePlaceId?: string;
};

// Texas bounding box for Nominatim's own `bounded=1` restriction — Google's
// equivalent (TEXAS_RECTANGLE) now lives in lib/google-places.ts alongside
// the Google-specific fetch helpers themselves.
const TEXAS_VIEWBOX = "-106.7,36.5,-93.5,25.8";

// Nominatim's usage policy caps automated use at 1 request/second and asks that
// callers not fire a request per keystroke — the debounce below is what enforces that,
// not just a UX nicety. See https://operations.osmfoundation.org/policies/nominatim/
const DEBOUNCE_MS = 500;
const MIN_QUERY_LENGTH = 5;

type NominatimAddress = {
  house_number?: string;
  road?: string;
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
};

type NominatimResult = {
  place_id: number;
  display_name: string;
  address?: NominatimAddress;
};

// USPS-style street suffix abbreviations, applied so composed addresses stay short
// enough to fit a single-line input (Chromium clips <input> text without an ellipsis —
// text-overflow has no effect there — so an overlong value would render as a silent cut
// off rather than "…").
const STREET_SUFFIXES: Record<string, string> = {
  street: "St",
  avenue: "Ave",
  boulevard: "Blvd",
  drive: "Dr",
  lane: "Ln",
  road: "Rd",
  court: "Ct",
  circle: "Cir",
  place: "Pl",
  parkway: "Pkwy",
  highway: "Hwy",
  trail: "Trl",
  terrace: "Ter",
  square: "Sq",
};

function abbreviateRoad(road: string): string {
  return road.replace(/\b(\w+)\b$/, (word) => STREET_SUFFIXES[word.toLowerCase()] ?? word);
}

// Nominatim's display_name includes every OSM component (neighbourhood, county,
// country, ...) which is too long to read in a single-line input. Compose a short
// US postal-style address instead, e.g. "500 Main St, Houston, TX 77002".
function formatNominatimAddress(r: NominatimResult): string | null {
  const a = r.address;
  if (!a) return r.display_name;
  const line1 = [a.house_number, a.road && abbreviateRoad(a.road)].filter(Boolean).join(" ");
  const city = a.city || a.town || a.village || a.hamlet || a.suburb || "";
  const cityState = [city, a.state === "Texas" ? "TX" : a.state].filter(Boolean).join(", ");
  const tail = [cityState, a.postcode].filter(Boolean).join(" ");
  const formatted = [line1, tail].filter(Boolean).join(", ");
  return formatted || null;
}

async function fetchNominatimSuggestions(
  query: string,
  signal: AbortSignal,
): Promise<Suggestion[]> {
  const params = new URLSearchParams({
    format: "jsonv2",
    addressdetails: "1",
    countrycodes: "us",
    viewbox: TEXAS_VIEWBOX,
    bounded: "1",
    limit: "8",
    q: normalizeRoadPrefix(query),
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { signal });
  if (!res.ok) throw new Error(`Nominatim request failed: ${res.status}`);
  const data = (await res.json()) as NominatimResult[];
  const seenLabels = new Set<string>();
  return data
    .filter((d) => d.address?.state === "Texas")
    .map((d) => ({ id: String(d.place_id), label: formatNominatimAddress(d) }))
    .filter((s): s is Suggestion => Boolean(s.label))
    .filter((s) => {
      // Nominatim frequently returns multiple distinct records (different place_id)
      // for the same physical address once formatAddress trims OSM detail down to a
      // short postal string — dedupe on the displayed label, not the source id.
      const key = s.label.toLowerCase();
      if (seenLabels.has(key)) return false;
      seenLabels.add(key);
      return true;
    });
}

// fetchGoogleSuggestions/fetchGooglePlaceDetails now live in
// lib/google-places.ts (shared with the unified property-search panel) —
// wrapped here only to adapt their return shape to this component's own
// Suggestion type.
async function fetchGoogleSuggestions(query: string, signal: AbortSignal): Promise<Suggestion[]> {
  const results = await fetchGooglePlaceSuggestions(query, signal);
  return results.map((r) => ({ id: r.id, label: r.label, googlePlaceId: r.placeId }));
}

// Wraps a plain <input> with address suggestions — Google Places (New) when
// VITE_GOOGLE_MAPS_API_KEY is configured and the request succeeds, falling
// back automatically to free, keyless Nominatim/OpenStreetMap otherwise
// (unset key, network error, or — expected in some environments — a 403 from
// Google's own website-restriction check on the current domain).
export function AddressAutocomplete({
  value,
  onChange,
  onPlaceSelected,
  onResolving,
  placeholder,
  className,
  ariaLabel,
  suppressSuggestions,
}: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [error, setError] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  // Set right before each onChange() call inside selectSuggestion(), so the
  // value-watching effect below can recognize its own programmatic update and
  // skip re-searching for it. Without this, selecting a suggestion re-opens
  // the dropdown against its own just-selected text, and — worse — the fresh
  // scheduleSearch() call aborts the in-flight Place Details request that
  // same selection just started (both share abortRef), permanently losing
  // the zip/house-number upgrade it was about to deliver. Confirmed live: the
  // Place Details request fired, then got cut off mid-flight by exactly this
  // re-entrant search, leaving the raw (unresolved) label as the final value.
  // Compared against `value` (not consumed/reset like a one-shot flag) so a
  // second onChange call that happens to land on the same string — e.g.
  // Place Details failing and finalLabel falling back to the identical
  // s.label — can't leave this stuck permanently suppressing real edits.
  // Doesn't affect the "external setter" case this effect exists for (voice
  // input etc.) since only selectSuggestion() ever writes to this ref.
  const lastSelfSetValueRef = useRef<string | null>(null);
  // Incremented at the start of every Google selection; each selection
  // captures its own value and checks it still matches after the Place
  // Details await. Without this, picking a second suggestion before the
  // first one's Place Details call finishes lets the stale first call's
  // continuation (its own fetch is aborted, but the .catch(() => null) means
  // execution carries on regardless) overwrite the value the second,
  // already-selected suggestion just set — same underlying "provisional
  // value where a caller expects a final one" class of bug as onResolving
  // above, just triggered by a second selection instead of a fast submit.
  const selectionIdRef = useRef(0);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  // Triggered by any change to the controlled `value` — typing (below) or an
  // external setter like voice input — so suggestions show up either way instead
  // of only reacting to direct keystrokes in this input.
  useEffect(() => {
    if (value === lastSelfSetValueRef.current) return;
    scheduleSearch(value);
  }, [value]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function scheduleSearch(query: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();

    if (query.trim().length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setOpen(false);
      setError(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        let results: Suggestion[];
        if (GOOGLE_API_KEY) {
          try {
            results = await fetchGoogleSuggestions(query, controller.signal);
          } catch (err) {
            if ((err as Error).name === "AbortError") return;
            // Falls back silently to Nominatim rather than surfacing this as
            // a user-facing error — a blocked-referrer 403 (e.g. this domain
            // isn't in the key's website restrictions yet) is an expected,
            // recoverable condition here, not a real failure.
            results = await fetchNominatimSuggestions(query, controller.signal);
          }
        } else {
          results = await fetchNominatimSuggestions(query, controller.signal);
        }
        setSuggestions(results);
        setError(false);
        setOpen(results.length > 0);
        setActiveIndex(-1);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        // Silently console.error-only left this fully invisible to the user —
        // identical to "no results found," so a blocked/failed request (ad
        // blocker, network issue, Nominatim down) looked exactly like there
        // being nothing at this address. Surface it instead so it's at least
        // diagnosable, without blocking typing or manual submission.
        console.error(err);
        setSuggestions([]);
        setError(true);
        setOpen(true);
      }
    }, DEBOUNCE_MS);
  }

  async function selectSuggestion(s: Suggestion) {
    setSuggestions([]);
    setError(false);
    setOpen(false);
    setActiveIndex(-1);

    if (s.googlePlaceId) {
      const mySelectionId = ++selectionIdRef.current;
      lastSelfSetValueRef.current = s.label;
      onChange(s.label);
      onResolving?.(true);
      const controller = new AbortController();
      abortRef.current = controller;
      const detailed = await fetchGooglePlaceDetails(s.googlePlaceId, controller.signal).catch(
        () => null,
      );
      // A newer selection has since taken over — leave the value, resolving
      // state, and onPlaceSelected callback entirely to it; this stale call
      // has nothing left to contribute.
      if (selectionIdRef.current !== mySelectionId) return;
      const finalLabel = detailed ?? s.label;
      lastSelfSetValueRef.current = finalLabel;
      onChange(finalLabel);
      onResolving?.(false);
      onPlaceSelected?.(finalLabel);
      return;
    }

    // Also supersedes any still-pending Google resolution from a previous
    // selection (see the comment on selectionIdRef above) — without this, a
    // Nominatim pick right after a Google one could still get silently
    // overwritten once that stale Google call's Place Details await settles.
    selectionIdRef.current++;
    lastSelfSetValueRef.current = s.label;
    onChange(s.label);
    onResolving?.(false);
    onPlaceSelected?.(s.label);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      selectSuggestion(suggestions[activeIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative flex-1">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          if (suggestions.length > 0 || error) setOpen(true);
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        title={value}
        className={`${className ?? ""} w-full truncate`}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={listboxId}
        autoComplete="off"
      />
      {open && !suppressSuggestions && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-md border border-border bg-background text-sm text-foreground shadow-elev"
        >
          {error && (
            <li role="presentation" className="px-4 py-2 text-muted-foreground">
              Couldn&apos;t load address suggestions right now — you can still type the full address
              and submit.
            </li>
          )}
          {suggestions.map((s, i) => (
            <li key={s.id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={i === activeIndex}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectSuggestion(s)}
                className={`block w-full px-4 py-2 text-left ${
                  i === activeIndex ? "bg-secondary" : "hover:bg-secondary"
                }`}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
