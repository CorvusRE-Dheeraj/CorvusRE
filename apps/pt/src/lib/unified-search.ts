// The live property-search dropdown (homepage + /intake) used to show two
// separate panels: Google's own plain-text suggestions, and a second CAD
// live-match list below it. Merged into one here per direct product
// decision: whatever the user types — a business name, a real address, a
// typo, "anything" — should resolve to actual CAD-grounded results (parcel
// ID, account number, assessed value) in a SINGLE dropdown, not two.
//
// How it works: fire our own direct cad-lookup preview search AND Google's
// Places Autocomplete concurrently. Google resolves things our owner-name
// search structurally can't (a franchise location titled to an unrelated
// landlord/franchisee LLC — confirmed live: "Taco Bell Denton"/"Braum's
// Denton" have zero Denton parcels under either name, no matter the
// spelling, because the county's owner-name field is the LEGAL titleholder,
// not the tenant brand) — Google still knows the real place by its business
// name, same as Google Maps search does. Each of Google's top few
// suggestions gets resolved to a real address (Place Details) and THEN run
// through the exact same CAD lookup, so a business name search still ends
// up as a real, parcel-grounded county record whenever one exists, and only
// falls back to nothing when the business genuinely isn't a titleholder
// anywhere nearby.
import { cadLookupPreview, type CadRecord, type CadLookupResult } from "./cad-lookup";
import { fetchGoogleSuggestions, fetchGooglePlaceDetails, GOOGLE_API_KEY } from "./google-places";
import { parcelIndexSearch } from "./parcel-index-search";

// Bounded, not exhaustive — each extra candidate is a real Place Details call
// plus a real CAD lookup, and the debounce/MIN_LIVE_SEARCH_LENGTH gating in
// the caller already limits how often this runs at all. Raised 4 -> 8 after
// a real report ("Taco Bell Denton" surfacing only scattered non-Denton
// matches): Google's own ranking doesn't reliably put the city-matching
// suggestion in the first few slots, so a narrow cap could drop it before
// it's ever resolved/checked at all — the city-preference sort below only
// helps with candidates that were actually fetched.
const MAX_GOOGLE_CANDIDATES = 8;
const MAX_RESULTS = 12;

export type UnifiedMatch = {
  record: CadRecord;
  // The Google suggestion's own label (e.g. "Taco Bell, 123 N I-35,
  // Denton, TX") — set only when this record was found by following a
  // Google suggestion to its real address first, not when it came from
  // typing/matching the raw text directly. Lets the dropdown show the
  // business name right next to the CAD-sourced parcel/account info, so a
  // store-name search doesn't just show a bare address the user has no way
  // to recognize as the right one.
  googleLabel?: string;
};

// includeNearby=false drops the live path's "nearby" fallback (any real
// parcel sharing a bare street name/core word, any city) entirely, keeping
// only an exact or "multiple" match — see its one caller below for why.
function recordsFromResult(res: CadLookupResult, includeNearby: boolean): CadRecord[] {
  if (res.matched === true) return [res.record];
  if (res.matched === "multiple") return res.options;
  return includeNearby ? res.nearby : [];
}

// Fast local index first (milliseconds, once a county's been ingested —
// see parcel-index-search.ts); only falls back to the slow, live
// cad-lookup sweep (several seconds, bounded by PREVIEW_QUERY_TIMEOUT_MS)
// when the index has nothing — a county not yet backfilled, or a genuinely
// stale/missing row. Never regresses coverage, only adds speed where the
// index already has data.
//
// includeNearby controls whether the live path's generic "nearby" fallback
// counts as a result at all. Default true for a direct search on the raw
// typed text, where "no exact hit, here are real nearby options" is
// legitimate. Passed false when resolving a Google suggestion's address
// (see unifiedPropertySearch below): found live ("1895 W University Drive,
// Frisco" resolved via Google, but Denton — where Frisco actually is —
// isn't in the fast index yet) that the live path's nearby fallback for a
// bare "University Dr" match pulled in five unrelated Kaufman County
// parcels on a DIFFERENT University Dr in Forney, and every one of them got
// stamped with the Google suggestion's own specific label ("1895
// University Drive, Frisco, TX") even though none of them are actually
// that address — a nearby guess has no real connection to the one place
// Google resolved, so it should never borrow that place's name.
async function lookupRecords(addressOrName: string, includeNearby = true): Promise<CadRecord[]> {
  const indexed = await parcelIndexSearch(addressOrName).catch(() => [] as CadRecord[]);
  if (indexed.length > 0) return indexed;
  return cadLookupPreview(addressOrName)
    .then((res) => recordsFromResult(res, includeNearby))
    .catch(() => [] as CadRecord[]);
}

function dedupeKey(r: CadRecord): string {
  return `${r.cad}:${r.accountNumber ?? r.propertyAddress}`;
}

// Best-effort city guess from the tail of the query — just enough to rank
// "the Denton one" above "a same-named store somewhere else in Texas" when
// both are among the candidates. Deliberately simple (last word only, same
// as the edge function's own parseNameQuery fallback): good enough for the
// overwhelmingly common single-word-city case ("Walmart Denton"), and never
// worse than no preference at all when it's wrong for a multi-word city.
function guessCityWord(query: string): string {
  const words = query.trim().split(/\s+/);
  return words.length > 1 ? words[words.length - 1] : "";
}

function matchesCityGuess(address: string, cityGuess: string): boolean {
  return Boolean(cityGuess) && address.toUpperCase().includes(cityGuess.toUpperCase());
}

// Resolves whatever the user typed to a merged, deduped list of real CAD
// records — direct matches from the raw typed text, plus matches found by
// following Google's own top suggestions to their real address first, then
// sorted so whichever result sits in the city the user actually typed comes
// first (found live: without this, "Taco Bell Denton" could surface real
// Taco Bell locations scattered anywhere in Texas with no Denton one
// visible among them, since Google's own ranking doesn't favor a literal
// city word in the input as strongly as this app needs). Never throws: any
// individual lookup that fails just contributes nothing, same as a plain
// no-match, so one slow/broken source can't blank the others.
export async function unifiedPropertySearch(
  query: string,
  signal?: AbortSignal,
): Promise<UnifiedMatch[]> {
  const direct = lookupRecords(query).then((records) => records.map((record) => ({ record })));

  const viaGoogle = GOOGLE_API_KEY
    ? fetchGoogleSuggestions(query, signal)
        .then(async (suggestions) => {
          const candidates = suggestions.slice(0, MAX_GOOGLE_CANDIDATES);
          const resolved = await Promise.all(
            candidates.map(async (s) => ({
              label: s.label,
              address: await fetchGooglePlaceDetails(s.placeId, signal).catch(() => null),
            })),
          );
          const matchLists = await Promise.all(
            resolved
              .filter((r): r is { label: string; address: string } => Boolean(r.address))
              .map(async ({ label, address }) => {
                const records = await lookupRecords(address, false);
                return records.map((record) => ({ record, googleLabel: label }));
              }),
          );
          return matchLists.flat();
        })
        .catch(() => [] as UnifiedMatch[])
    : Promise.resolve([] as UnifiedMatch[]);

  const [directMatches, googleMatches] = await Promise.all([direct, viaGoogle]);

  const seen = new Set<string>();
  const merged: UnifiedMatch[] = [];
  // Direct results first — a match on the raw typed text (a real address, or
  // our own owner-name search) is at least as precise as a Google-mediated
  // one, so it's preferred when both find the same record (dedupe keeps the
  // first occurrence).
  for (const m of [...directMatches, ...googleMatches]) {
    const key = dedupeKey(m.record);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(m);
  }

  // Filter to the typed city, not just sort it first — found live
  // ("walmart denton" showing real Denton matches on top, but also real
  // Plano/Celina ones trailing below): once there ARE matches in the city
  // actually typed, the rest are noise, not a helpful runner-up, and they
  // can crowd a real same-city match out of the dropdown's own top-6
  // display cap. Only falls back to the unfiltered list when the typed
  // city genuinely has zero matches among everything found.
  const cityGuess = guessCityWord(query);
  if (cityGuess) {
    const inCity = merged.filter((m) => matchesCityGuess(m.record.propertyAddress, cityGuess));
    if (inCity.length > 0) return inCity.slice(0, MAX_RESULTS);
  }

  return merged.slice(0, MAX_RESULTS);
}
