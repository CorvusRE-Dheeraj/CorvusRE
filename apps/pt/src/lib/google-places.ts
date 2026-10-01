// Shared Google Places (New) helpers — extracted from AddressAutocomplete.tsx
// so the unified property-search panel (unified-search.ts) can resolve a
// typed business name or address to a real place the same proven way that
// component already does, instead of re-implementing (and risking
// re-diverging from) the same request shapes a second time.

export const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

// Texas bounding box — a hard restriction (not just a ranking preference),
// since this app only serves Texas properties.
const TEXAS_RECTANGLE = {
  low: { latitude: 25.8, longitude: -106.7 },
  high: { latitude: 36.5, longitude: -93.5 },
};

// Texas road names are commonly typed/pasted without a space before the
// number ("FM1957", "CR304", "Loop410") — Google (and county CAD systems)
// both need the space ("FM 1957"). Google itself tolerates either form, but
// consistency costs nothing and this was already proven correct.
const TX_ROAD_PREFIX = /\b(FM|RM|CR|SH|US|IH|LP|LOOP|SPUR)(\d)/gi;

export function normalizeRoadPrefix(query: string): string {
  return query.replace(TX_ROAD_PREFIX, "$1 $2");
}

export type GooglePlaceSuggestion = {
  id: string;
  label: string;
  placeId: string;
};

type GooglePlacePrediction = {
  placeId?: string;
  text?: { text?: string };
};
type GoogleAutocompleteResponse = {
  suggestions?: Array<{ placePrediction?: GooglePlacePrediction }>;
};

// Google's Autocomplete predictions read "13158 FM1957, San Antonio, TX, USA"
// — no postal code (only Place Details has that) and a trailing ", USA" this
// app's short postal-style convention doesn't use elsewhere.
function cleanGoogleLabel(text: string): string {
  return text.replace(/,\s*USA$/i, "").trim();
}

// No includedPrimaryTypes filter — deliberately left open rather than
// narrowed to street_address/premise/route. A commercial property is just as
// often searched by business name ("Quality Inn Denton", "Walmart Denton")
// as by its street address, and Google only resolves that name to a real
// place at all under types like "lodging"/"establishment"/
// "point_of_interest", not the address-only types.
export async function fetchGoogleSuggestions(
  query: string,
  signal?: AbortSignal,
): Promise<GooglePlaceSuggestion[]> {
  if (!GOOGLE_API_KEY) return [];
  const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": GOOGLE_API_KEY },
    body: JSON.stringify({
      input: normalizeRoadPrefix(query),
      includedRegionCodes: ["us"],
      locationRestriction: { rectangle: TEXAS_RECTANGLE },
    }),
  });
  if (!res.ok) throw new Error(`Google Places request failed: ${res.status}`);
  const data = (await res.json()) as GoogleAutocompleteResponse;
  return (data.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is GooglePlacePrediction => Boolean(p?.placeId && p.text?.text))
    .map((p) => ({ id: p.placeId!, label: cleanGoogleLabel(p.text!.text!), placeId: p.placeId! }));
}

type GoogleAddressComponent = {
  longText?: string;
  shortText?: string;
  types?: string[];
};

// Built from addressComponents' longText (the un-abbreviated form, e.g.
// "Market Place Boulevard") rather than the pre-abbreviated formattedAddress
// string (e.g. "Market Pl Blvd") — see cad-lookup's own word-boundary-
// anchored LIKE matching, which an abbreviated mid-name word can silently
// defeat. See AddressAutocomplete.tsx's own (longer) history on this if you
// need the full story.
function buildAddressFromComponents(components?: GoogleAddressComponent[]): string | null {
  if (!components) return null;
  const find = (type: string) => components.find((c) => c.types?.includes(type))?.longText;
  const streetNumber = find("street_number");
  const route = find("route");
  if (!route) return null;
  const city = find("locality") || find("postal_town") || find("sublocality");
  const state = components.find((c) => c.types?.includes("administrative_area_level_1"))?.shortText;
  const zip = find("postal_code");
  const line1 = [streetNumber, route].filter(Boolean).join(" ");
  const cityState = [city, state].filter(Boolean).join(", ");
  const tail = [cityState, zip].filter(Boolean).join(" ");
  return [line1, tail].filter(Boolean).join(", ") || null;
}

// Resolves a placeId to its real, zip-inclusive, un-abbreviated address.
// Returns null (never throws) on failure — a caller falls back to the
// Autocomplete label itself rather than losing the candidate entirely.
export async function fetchGooglePlaceDetails(
  placeId: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!GOOGLE_API_KEY) return null;
  try {
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${placeId}?fields=addressComponents,formattedAddress`,
      { signal, headers: { "X-Goog-Api-Key": GOOGLE_API_KEY } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      addressComponents?: GoogleAddressComponent[];
      formattedAddress?: string;
    };
    const built = buildAddressFromComponents(data.addressComponents);
    if (built) return built;
    return data.formattedAddress ? cleanGoogleLabel(data.formattedAddress) : null;
  } catch {
    return null;
  }
}
