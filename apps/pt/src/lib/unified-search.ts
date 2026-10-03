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
// up as real, parcel-grounded county records whenever any exist.
//
// Text Search (not Autocomplete) specifically — found live chasing a real
// report ("I see 3 Braum's locations in Denton on Google Maps, why does our
// app only find one?"): Autocomplete returned 5 suggestions for "braums
// denton" where only 1 was genuinely in Denton city (the rest were Haltom
// City/Carrollton/Frisco/The Colony); Text Search returned exactly the 2
// real Denton locations, matching Google Maps' own result set precisely.
// Re-confirmed chasing a later "I want to see ALL the addresses, like
// Google Maps" report: Autocomplete's own locality text is genuinely
// ambiguous between a real city and the county it sits in ("Main Street,
// Frisco, Denton, TX, USA" — is "Denton" the city or county here? Only
// Place Details' structured addressComponents says for sure, and that's a
// second network call per candidate), while Text Search's
// addressComponents gives a clean, authoritative locality directly — one
// call, no per-candidate follow-up.
//
// SHOW EVERY GOOGLE MATCH, not just the ones that resolve to a CAD record —
// the single biggest fix from that "I want to see all the addresses"
// report. The old version only ever contributed a row for a Google
// candidate whose CAD lookup actually succeeded, so any real place Google
// knows about but our CAD data doesn't (outside a supported county, a
// lookup timeout, a county with no situs on file) silently vanished from
// the dropdown — a user typing a real address they could see on Google
// Maps would see nothing. Now every Google match becomes a row the moment
// it's found (cadStatus "pending"), and is enriched in place — never
// re-ordered, same row object — once its CAD lookup resolves, to either
// "found" (full parcel/account/value line) or "none" (still a real,
// selectable address; selecting it just runs the normal manual
// address-resolution flow the way typing a full address and hitting
// "Don't see your address?" already does).
//
// This file deliberately has NO dependency on any locally-cached parcel
// table — an earlier version tried pre-indexing county data for speed, but
// the bulk-ingestion cron jobs behind it caused a real Disk IO budget
// incident on the production database and were removed entirely (table,
// ingestion function, and cron jobs). cadLookupPreview below always queries
// live.
//
// STREAMING, not atomic: each individual government CAD endpoint genuinely
// takes several seconds (confirmed live — Denton alone is ~6.5s per
// lookup), and a business-name search fires one of these per Google
// candidate, so waiting for the slowest one before showing anything meant
// a real ~7s blank dropdown. unifiedPropertySearch takes an onUpdate
// callback instead of returning one final array — it's invoked every time
// a new sub-search resolves OR a new Google candidate is first found, each
// time with the full current best list, and the returned promise resolves
// once every sub-search is done (or the hard SEARCH_TIMEOUT_MS ceiling is
// hit, whichever first — anything still pending past that point is
// discarded, not awaited further).
import { cadLookupPreview, type CadRecord, type CadLookupResult } from "./cad-lookup";
import { fetchGoogleTextSearch, GOOGLE_API_KEY } from "./google-places";

// Google Text Search itself returns up to ~20 for a loosely-matched query —
// bounded well below that (each candidate fires its own real CAD lookup),
// but raised from the old 8 specifically to surface more of what Google
// Maps itself would show, per direct "I want to see ALL the addresses"
// product ask.
const MAX_GOOGLE_CANDIDATES = 15;
const MAX_RESULTS = 20;

export type CadStatus = "pending" | "found" | "none";

export type UnifiedMatch = {
  // Stable row identity — a Google candidate's own place id (falls back to
  // its address when Google omits one, which happens rarely), or the CAD
  // record's own key for a direct-search row. Never changes once assigned,
  // so a row can be enriched in place without jumping position in the list
  // as slower candidates resolve around it.
  id: string;
  // Best address known right now — Google's resolved address until/unless
  // a CAD record attaches, at which point the CAD situs address (more
  // authoritative) takes over.
  address: string;
  // The Google result's own label (e.g. "Taco Bell") — set only when this
  // record was found by following a Google match to its real address
  // first, not when it came from typing/matching the raw text directly.
  googleLabel?: string;
  record?: CadRecord;
  cadStatus: CadStatus;
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
// legitimate. Passed false when resolving a Google result's address: a
// nearby guess has no real connection to the one place Google resolved, so
// it should never borrow that place's name — found live, a bare
// street-name nearby match from an unrelated city once got mislabeled with
// a Google suggestion's specific address.
async function lookupRecords(addressOrName: string, includeNearby = true): Promise<CadRecord[]> {
  return cadLookupPreview(addressOrName)
    .then((res) => recordsFromResult(res, includeNearby))
    .catch(() => [] as CadRecord[]);
}

function cadKey(r: CadRecord): string {
  return `cad:${r.cad}:${r.accountNumber ?? r.propertyAddress}`;
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
// Frisco or The Colony just because they share a CAD. Works off
// match.address directly so it applies the same way whether the row is
// already CAD-grounded or still a pending/none Google-only address.
function matchesCityGuess(address: string, cityGuess: string): boolean {
  return Boolean(cityGuess) && address.toUpperCase().includes(cityGuess.toUpperCase());
}

// Re-applies "filter to typed city when any city match exists, else show
// everything" over whatever has been found SO FAR — called once per
// sub-search as it resolves, so each call can only ever add information,
// never require waiting on a slower sibling search first. Filter-not-sort
// — found live ("walmart denton" showing real Denton matches on top, but
// also real Plano/Celina ones trailing below): once there ARE matches in
// the city actually typed, the rest are noise. Only falls back to the
// unfiltered list when the typed city genuinely has zero matches among
// everything found so far.
function buildDisplayList(all: UnifiedMatch[], cityGuess: string): UnifiedMatch[] {
  if (cityGuess) {
    const inCity = all.filter((m) => matchesCityGuess(m.address, cityGuess));
    if (inCity.length > 0) return inCity.slice(0, MAX_RESULTS);
  }
  return all.slice(0, MAX_RESULTS);
}

// Hard overall ceiling, independent of any individual county's own
// per-request timeout — direct product decision after watching a real
// Braum's/Denton search run ~7.2s end-to-end: better to show whatever's
// already in hand and stop than to let one unusually slow candidate (or a
// government endpoint having a bad day) keep the dropdown spinning
// indefinitely. Anything that resolves after the cutoff is discarded, not
// displayed — it's genuinely too late to be a "live suggestion" anymore.
// Less critical now that candidates appear immediately and are enriched in
// place — the ceiling mostly bounds how long a "pending" row can stay
// pending before further updates to it are dropped.
const SEARCH_TIMEOUT_MS = 10_000;

// Resolves whatever the user typed to a merged list of real addresses —
// direct matches from the raw typed text (always CAD-grounded, since
// that's what a direct search IS), plus every one of Google's Text Search
// matches (shown immediately, enriched with CAD data as it resolves),
// filtered to the city actually typed when any city match exists. Never
// throws: any individual lookup that fails just leaves that row at
// cadStatus "none" (or contributes nothing, for the direct path), same as
// a plain no-match, so one slow/broken source can't blank the others.
//
// Streaming contract: onUpdate fires every time the current best list
// changes — a new row appears, or an existing row's cadStatus/record
// changes — each time with the complete current best list, so a caller can
// just replace its displayed list wholesale on every call. The returned
// promise resolves once every sub-search has settled or SEARCH_TIMEOUT_MS
// is reached, whichever first.
export async function unifiedPropertySearch(
  query: string,
  onUpdate: (matches: UnifiedMatch[]) => void,
  signal?: AbortSignal,
): Promise<void> {
  const cityGuess = guessCityWord(query);
  const order: string[] = [];
  const byId = new Map<string, UnifiedMatch>();
  // Lets a Google candidate's resolved CAD record recognize it's the same
  // parcel as a row that already exists under a different id (another
  // Google candidate, or the direct search) — merges onto that row instead
  // of creating a visible duplicate.
  const rowIdByCadKey = new Map<string, string>();
  let timedOut = false;

  function emit() {
    onUpdate(buildDisplayList(order.map((id) => byId.get(id)!), cityGuess));
  }

  function upsert(id: string, patch: Partial<UnifiedMatch> & { address: string; cadStatus: CadStatus }) {
    if (timedOut) return;
    const existing = byId.get(id);
    if (existing) {
      Object.assign(existing, patch);
    } else {
      byId.set(id, { id, googleLabel: undefined, ...patch });
      order.push(id);
    }
    emit();
  }

  // Direct results — a match on the raw typed text (a real address, or our
  // own owner-name search) is always already CAD-grounded.
  const direct = lookupRecords(query)
    .then((records) => {
      for (const record of records) {
        upsert(cadKey(record), { address: record.propertyAddress, record, cadStatus: "found" });
      }
    })
    .catch(() => {});

  const viaGoogle = GOOGLE_API_KEY
    ? fetchGoogleTextSearch(query, signal)
        .then(async (results) => {
          const candidates = results.slice(0, MAX_GOOGLE_CANDIDATES);
          await Promise.all(
            candidates.map(async (candidate) => {
              const googleRowId = `google:${candidate.placeId ?? candidate.address}`;
              // Shown immediately — this is the actual fix for "I don't
              // see all the addresses": a real Google match is a visible
              // row the instant it's found, not only once/if a CAD record
              // attaches to it.
              upsert(googleRowId, {
                address: candidate.address,
                googleLabel: candidate.label,
                cadStatus: "pending",
              });

              const records = await lookupRecords(candidate.address, false);
              if (records.length === 0) {
                // Still a real, selectable address — just no county parcel
                // on file for it (outside a supported county, a lookup
                // failure, or genuinely not in CAD data).
                upsert(googleRowId, {
                  address: candidate.address,
                  googleLabel: candidate.label,
                  cadStatus: "none",
                });
                return;
              }
              for (const record of records) {
                const key = cadKey(record);
                const dupeRowId = rowIdByCadKey.get(key);
                if (dupeRowId && dupeRowId !== googleRowId) {
                  // Another row (direct search, or an earlier-resolving
                  // Google candidate) already found this exact parcel —
                  // merge the label onto it rather than show a duplicate.
                  const target = byId.get(dupeRowId);
                  if (target && !target.googleLabel) {
                    target.googleLabel = candidate.label;
                    emit();
                  }
                  continue;
                }
                rowIdByCadKey.set(key, googleRowId);
                upsert(googleRowId, {
                  address: record.propertyAddress,
                  googleLabel: candidate.label,
                  record,
                  cadStatus: "found",
                });
              }
            }),
          );
        })
        .catch(() => {})
    : Promise.resolve();

  const everything = Promise.all([direct, viaGoogle]).then(() => {});

  let timer!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve();
    }, SEARCH_TIMEOUT_MS);
  });

  try {
    await Promise.race([everything, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
