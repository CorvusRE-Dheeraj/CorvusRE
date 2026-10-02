// The live property-search dropdown (homepage + /intake) used to show two
// separate panels: Google's own plain-text suggestions, and a second CAD
// live-match list below it. Merged into one here per direct product
// decision: whatever the user types — a business name, a real address, a
// typo, "anything" — should resolve to actual CAD-grounded results (parcel
// ID, account number, assessed value) in a SINGLE dropdown, not two.
//
// How it works: fire our own direct cad-lookup preview search AND Google's
// Text Search concurrently. Google resolves things our owner-name search
// structurally can't (a franchise location titled to an unrelated
// landlord/franchisee LLC — confirmed live: "Taco Bell Denton"/"Braum's
// Denton" have zero Denton parcels under either name, no matter the
// spelling, because the county's owner-name field is the LEGAL titleholder,
// not the tenant brand) — Google still knows the real place by its business
// name, same as Google Maps search does. Each of Google's matches is run
// through the exact same CAD lookup, so a business name search still ends
// up as real, parcel-grounded county records whenever any exist, and only
// falls back to nothing when the business genuinely isn't a titleholder
// anywhere nearby.
//
// Text Search (not Autocomplete) specifically — found live chasing a real
// report ("I see 3 Braum's locations in Denton on Google Maps, why does our
// app only find one?"): Autocomplete returned 5 suggestions for "braums
// denton" where only 1 was genuinely in Denton city (the rest were Haltom
// City/Carrollton/Frisco/The Colony); Text Search returned exactly the 2
// real Denton locations, matching Google Maps' own result set precisely.
// It's also simpler — one call already returns a usable address per
// result, no per-candidate Place Details follow-up needed.
//
// This file deliberately has NO dependency on any locally-cached parcel
// table — an earlier version tried pre-indexing county data for speed, but
// the bulk-ingestion cron jobs behind it caused a real Disk IO budget
// incident on the production database and were removed entirely (table,
// ingestion function, and cron jobs). cadLookupPreview below always queries
// live.
import { cadLookupPreview, type CadRecord, type CadLookupResult } from "./cad-lookup";
import { fetchGoogleTextSearch, GOOGLE_API_KEY } from "./google-places";

// Bounded, not exhaustive — each extra candidate is a real CAD lookup, and
// the debounce/MIN_LIVE_SEARCH_LENGTH gating in the caller already limits
// how often this runs at all.
const MAX_GOOGLE_CANDIDATES = 8;
const MAX_RESULTS = 12;

export type UnifiedMatch = {
  record: CadRecord;
  // The Google result's own label (e.g. "Taco Bell") — set only when this
  // record was found by following a Google match to its real address
  // first, not when it came from typing/matching the raw text directly.
  // Lets the dropdown show the business name right next to the CAD-sourced
  // parcel/account info, so a store-name search doesn't just show a bare
  // address the user has no way to recognize as the right one.
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

// includeNearby controls whether the live path's generic "nearby" fallback
// counts as a result at all. Default true for a direct search on the raw
// typed text, where "no exact hit, here are real nearby options" is
// legitimate. Passed false when resolving a Google result's address (see
// unifiedPropertySearch below): a nearby guess has no real connection to
// the one place Google resolved, so it should never borrow that place's
// name — found live, a bare street-name nearby match from an unrelated
// city once got mislabeled with a Google suggestion's specific address.
async function lookupRecords(addressOrName: string, includeNearby = true): Promise<CadRecord[]> {
  return cadLookupPreview(addressOrName)
    .then((res) => recordsFromResult(res, includeNearby))
    .catch(() => [] as CadRecord[]);
}

function dedupeKey(r: CadRecord): string {
  return `${r.cad}:${r.accountNumber ?? r.propertyAddress}`;
}

// A deliberately non-exhaustive allowlist of Texas city names seen in this
// app's own supported-county CAD data. Used to find the actual city word
// anywhere in a free-text query, not just the last one — found live
// ("Braum's Denton west univ dr" grabbed "dr" as the "city," since that WAS
// the last word, so the real city guess "Denton" was never checked at all
// and a wrong Houston result sailed through unfiltered). Only ever adds a
// correct match; a city not in this list just falls back to the previous
// last-word guess, the same behavior as before — never a new exclusion.
const KNOWN_TX_CITIES = new Set([
  "denton", "houston", "dallas", "plano", "frisco", "mckinney", "allen",
  "carrollton", "lewisville", "wylie", "celina", "garland", "mesquite",
  "irving", "arlington", "austin", "sherman", "denison", "conroe", "katy",
  "georgetown", "humble", "spring", "stafford", "aubrey", "porter",
  "crandall", "forney", "montgomery", "euless", "haltomcity", "hurst",
  "bedford", "colleyville", "southlake", "keller", "burleson", "haslet",
  "roanoke", "grapevine",
]);

// Best-effort city guess — prefers a recognized Texas city anywhere in the
// query, falling back to the tail word only when nothing is recognized
// (good enough for the common single-word-city case, "Walmart Denton," and
// never worse than no preference at all when it's wrong for an
// unrecognized or multi-word city).
function guessCityWord(query: string): string {
  const words = query
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z]/g, ""));
  const known = words.find((w) => KNOWN_TX_CITIES.has(w.toLowerCase()));
  if (known) return known;
  return words.length > 1 ? words[words.length - 1] : "";
}

// Address-only on purpose — NOT the record's CAD/county name. Tried
// matching the county too (treating "Denton" as matching any city inside
// Denton County, e.g. Frisco), but direct user correction: typing a city
// name in this search means that city, not its whole county — a real
// Denton, TX resident expects "Denton" to mean the city of Denton, not
// Frisco or The Colony just because they share a CAD.
function matchesCityGuess(record: CadRecord, cityGuess: string): boolean {
  return Boolean(cityGuess) && record.propertyAddress.toUpperCase().includes(cityGuess.toUpperCase());
}

// Resolves whatever the user typed to a merged, deduped list of real CAD
// records — direct matches from the raw typed text, plus matches found by
// following every one of Google's Text Search results to its real address
// first, then filtered to the city actually typed (see matchesCityGuess).
// Never throws: any individual lookup that fails just contributes nothing,
// same as a plain no-match, so one slow/broken source can't blank the
// others.
export async function unifiedPropertySearch(
  query: string,
  signal?: AbortSignal,
): Promise<UnifiedMatch[]> {
  const direct = lookupRecords(query).then((records) => records.map((record) => ({ record })));

  const viaGoogle = GOOGLE_API_KEY
    ? fetchGoogleTextSearch(query, signal)
        .then(async (results) => {
          const candidates = results.slice(0, MAX_GOOGLE_CANDIDATES);
          const matchLists = await Promise.all(
            candidates.map(async ({ label, address }) => {
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
    const inCity = merged.filter((m) => matchesCityGuess(m.record, cityGuess));
    if (inCity.length > 0) return inCity.slice(0, MAX_RESULTS);
  }

  return merged.slice(0, MAX_RESULTS);
}
