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

// Bounded, not exhaustive — each extra candidate is a real Place Details call
// plus a real CAD lookup, and the debounce/MIN_LIVE_SEARCH_LENGTH gating in
// the caller already limits how often this runs at all.
const MAX_GOOGLE_CANDIDATES = 4;
const MAX_RESULTS = 12;

function recordsFromResult(res: CadLookupResult): CadRecord[] {
  if (res.matched === true) return [res.record];
  if (res.matched === "multiple") return res.options;
  return res.nearby;
}

function dedupeKey(r: CadRecord): string {
  return `${r.cad}:${r.accountNumber ?? r.propertyAddress}`;
}

// Resolves whatever the user typed to a merged, deduped list of real CAD
// records — direct matches from the raw typed text, plus matches found by
// following Google's own top suggestions to their real address first.
// Never throws: any individual lookup that fails just contributes nothing,
// same as a plain no-match, so one slow/broken source can't blank the
// others.
export async function unifiedPropertySearch(
  query: string,
  signal?: AbortSignal,
): Promise<CadRecord[]> {
  const direct = cadLookupPreview(query)
    .then(recordsFromResult)
    .catch(() => [] as CadRecord[]);

  const viaGoogle = GOOGLE_API_KEY
    ? fetchGoogleSuggestions(query, signal)
        .then(async (suggestions) => {
          const candidates = suggestions.slice(0, MAX_GOOGLE_CANDIDATES);
          const addresses = await Promise.all(
            candidates.map((s) => fetchGooglePlaceDetails(s.placeId, signal).catch(() => null)),
          );
          const uniqueAddresses = [
            ...new Set(addresses.filter((a): a is string => Boolean(a))),
          ];
          const recordLists = await Promise.all(
            uniqueAddresses.map((addr) =>
              cadLookupPreview(addr)
                .then(recordsFromResult)
                .catch(() => [] as CadRecord[]),
            ),
          );
          return recordLists.flat();
        })
        .catch(() => [] as CadRecord[])
    : Promise.resolve([] as CadRecord[]);

  const [directRecords, googleRecords] = await Promise.all([direct, viaGoogle]);

  const seen = new Set<string>();
  const merged: CadRecord[] = [];
  // Direct results first — a match on the raw typed text (a real address, or
  // our own owner-name search) is at least as precise as a Google-mediated
  // one, so it's preferred when both find the same record (dedupe keeps the
  // first occurrence).
  for (const r of [...directRecords, ...googleRecords]) {
    const key = dedupeKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(r);
  }
  return merged.slice(0, MAX_RESULTS);
}
