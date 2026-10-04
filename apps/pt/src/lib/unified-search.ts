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
// WHY THE LIVE LOOKUPS THEMSELVES ARE SLOW, AND THE REAL FIX FOR IT: each
// county query is a single, unretried fetch() straight to that county's own
// government GIS server (see cad-lookup/index.ts) — confirmed live, the
// same exact query can genuinely take anywhere from under 1s to 60s+ at
// different moments, pure government-server variance, nothing to optimize
// in our own matching code. What WAS fixable: every Google candidate used
// to blind-fire all 12 supported counties concurrently, every time, even
// though Google's own addressComponents already name the exact county
// ("Denton County") for that candidate — so a 5-candidate business-name
// search fired 5 × 12 = 60 concurrent county queries, hammering the same
// few real government servers far harder than necessary and almost
// certainly worsening their already-variable response times. Each
// candidate's resolved county (see google-places.ts's countyFromComponents)
// is now passed through as a hint, so cad-lookup tries just that one county
// first and only falls back to the full 12-county sweep if it genuinely
// comes back empty — same correctness as before, a small fraction of the
// concurrent load.
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
import { SUPPORTED_COUNTY_NAMES } from "./cad-record-url";

// Google Text Search itself returns up to ~20 for a loosely-matched query —
// bounded well below that (each candidate fires its own real CAD lookup),
// but raised from the old 8 specifically to surface more of what Google
// Maps itself would show, per direct "I want to see ALL the addresses"
// product ask.
const MAX_GOOGLE_CANDIDATES = 15;
const MAX_RESULTS = 20;

export type CadStatus = "pending" | "found" | "none" | "unsupported";

// Found live: searching "denver walmart" showed a real Colorado address
// sitting under a "Searching Dallas County records…" spinner for a long
// time before settling — a county-by-county CAD sweep was being run
// against an address we can never possibly serve. candidate.county (from
// Google's own addressComponents, already fetched for the county-hint
// optimization above — no extra network call needed here) is checked
// against SUPPORTED_COUNTY_NAMES, the same list intake.tsx's own
// "We don't cover X County yet" modal already uses, before a CAD lookup is
// even attempted. An unrecognized/unparseable county (Google omitted it,
// or it's a form SUPPORTED_COUNTY_NAMES doesn't recognize) still gets the
// benefit of the doubt and proceeds normally — this only ever skips a
// lookup when we're confident it's out of coverage, never a maybe.
function isSupportedCounty(county: string | undefined): boolean {
  if (!county) return true;
  return SUPPORTED_COUNTY_NAMES.has(county.replace(/\s*County$/i, "").trim());
}

// Every other US state's 2-letter code — found live chasing a second,
// related report ("2770 West Evans Avenue, Denver, CO 80219" typed
// directly, not via a Google suggestion, showed a confident-looking but
// completely WRONG Bexar County match): the direct-search path has no
// concept of state at all, since our own address parser only ever extracts
// house number + street CORE and sweeps all 12 Texas counties for it —
// "Evans" + "2770" genuinely collided with a real, unrelated San Antonio
// street. Google's county hint (isSupportedCounty above) only covers the
// Google-resolved candidates, not whatever the user typed directly, so this
// checks the raw typed text itself for an explicit non-Texas state before
// ever attempting that sweep. Deliberately only acts on a CONFIDENT, clearly
// state-coded address ("..., CO 80219" or "..., Colorado") — anything
// ambiguous (no comma-state pattern at all, e.g. a bare business name) just
// proceeds normally, same "only skip when we're sure" principle as
// isSupportedCounty.
const NON_TEXAS_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS",
  "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
  "OR", "PA", "RI", "SC", "SD", "TN", "UT", "VT", "VA", "WA", "WV", "WI",
  "WY", "DC",
]);

function detectNonTexasState(query: string): boolean {
  // The LAST ", XX" in the text is the one that actually sits in the
  // state position ("123 Texas St, Denver, CO" has "Texas" as a street
  // name earlier but the real state code at the end) — matched with a word
  // boundary after it so "CO" doesn't also match inside "CO2" or similar.
  const matches = [...query.matchAll(/,\s*([A-Za-z]{2})\b/g)];
  if (matches.length === 0) return false;
  const code = matches[matches.length - 1][1].toUpperCase();
  return NON_TEXAS_STATE_CODES.has(code);
}

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
async function lookupRecords(
  addressOrName: string,
  includeNearby = true,
  countyHint?: string,
  signal?: AbortSignal,
): Promise<CadRecord[]> {
  return cadLookupPreview(addressOrName, countyHint, signal)
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

// Same city -> county mapping as cad-lookup/index.ts's own
// CITY_TO_COUNTY_HINT (kept in sync by hand, same as every other
// client/server pair of constants in this app — Deno functions can't
// import from src/lib) — used here purely for display, by
// LiveSearchLoader, to show the real likely county while a search is in
// flight instead of cycling through all 13 names. A handful of these
// cities genuinely straddle two counties (Frisco, Carrollton, Celina);
// picking one here has zero correctness stakes, it only ever affects
// which name a loading message shows for a few seconds.
const CITY_TO_COUNTY_DISPLAY: Record<string, string> = {
  denton: "Denton", houston: "Harris", dallas: "Dallas", plano: "Collin",
  frisco: "Collin", mckinney: "Collin", allen: "Collin", carrollton: "Denton",
  lewisville: "Denton", wylie: "Collin", celina: "Collin", garland: "Dallas",
  mesquite: "Dallas", irving: "Dallas", arlington: "Tarrant", austin: "Travis",
  sherman: "Grayson", denison: "Grayson", conroe: "Montgomery", katy: "Harris",
  georgetown: "Williamson", humble: "Harris", spring: "Harris",
  stafford: "Fort Bend", aubrey: "Denton", porter: "Montgomery",
  crandall: "Kaufman", forney: "Kaufman", montgomery: "Montgomery",
  euless: "Tarrant", haltomcity: "Tarrant", hurst: "Tarrant", bedford: "Tarrant",
  colleyville: "Tarrant", southlake: "Tarrant", keller: "Tarrant",
  burleson: "Tarrant", haslet: "Tarrant", roanoke: "Denton", grapevine: "Tarrant",
};

// Best-effort "which county is this search probably in" for display only —
// returns null (not a guess) when the typed text doesn't recognizably name
// one of the cities above, same "only act when confident" discipline as
// everywhere else county-guessing happens in this app.
export function guessLikelyCountyName(query: string): string | null {
  const city = guessCityWord(query).toLowerCase();
  return CITY_TO_COUNTY_DISPLAY[city] ?? null;
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
// Raised twice since: 10s -> 30s -> 3 minutes, per direct ask each time,
// giving a genuinely slow county endpoint real room to still come back with
// an actual parcel instead of settling for "none" early — still bounded,
// just a patient one now; every "pending" row still settles to "none" at
// the cutoff (see the timer below) rather than spinning forever past it.
const SEARCH_TIMEOUT_MS = 3 * 60_000;

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

  // insertAfter places a brand-new row right next to a related one (a
  // second parcel found at the same Google-resolved address, right after
  // the first) instead of always appending at the end of the list, where it
  // would read as unrelated to the row it actually belongs next to.
  function upsert(
    id: string,
    patch: Partial<UnifiedMatch> & { address: string; cadStatus: CadStatus },
    insertAfter?: string,
  ) {
    if (timedOut) return;
    const existing = byId.get(id);
    if (existing) {
      Object.assign(existing, patch);
    } else {
      byId.set(id, { id, googleLabel: undefined, ...patch });
      const afterIdx = insertAfter ? order.indexOf(insertAfter) : -1;
      if (afterIdx === -1) order.push(id);
      else order.splice(afterIdx + 1, 0, id);
    }
    emit();
  }

  function removeRow(id: string) {
    if (!byId.delete(id)) return;
    const idx = order.indexOf(id);
    if (idx !== -1) order.splice(idx, 1);
  }

  // Direct results — a match on the raw typed text (a real address, or our
  // own owner-name search) is always already CAD-grounded.
  //
  // Checks rowIdByCadKey BOTH ways — found live ("Walmart Denton" showing
  // every real parcel TWICE) in two stages:
  //
  // 1st attempt only registered a direct row in rowIdByCadKey so a LATER
  // Google candidate for the same parcel could find and merge onto it. That
  // fixed the case where direct resolves first, but direct and the Google
  // candidates' own CAD lookups race the same way everything else here
  // does — reported again right after shipping that fix, because the
  // Google candidate just as often resolves to the parcel FIRST and
  // registers its own row before direct's lookup (a slower owner-name
  // search) finishes, and direct was only ever registering a NEW row for
  // itself, never checking whether one already existed. Now checks first:
  // if the parcel already has a row (from an already-resolved Google
  // candidate), update that SAME row in place with the direct search's own
  // (more authoritative) data instead of creating a second one; its
  // googleLabel, if any, is untouched (upsert's Object.assign only
  // overwrites fields actually present in the patch).
  const direct = detectNonTexasState(query)
    ? Promise.resolve().then(() => {
        // A real "..., CO 80219"-style address typed directly — never
        // worth sweeping all 12 Texas counties for, since it's confidently
        // not in Texas at all. Its own row id doubles as its cadKey so a
        // later Google candidate resolving to something real at this same
        // text (unlikely, but matches every other row's dedup convention)
        // still merges onto it rather than duplicating.
        const key = `direct:${query}`;
        rowIdByCadKey.set(key, key);
        upsert(key, { address: query.trim(), cadStatus: "unsupported" });
      })
    : lookupRecords(query, true, undefined, signal)
        .then((records) => {
          for (const record of records) {
            const key = cadKey(record);
            const existingRowId = rowIdByCadKey.get(key);
            if (existingRowId) {
              upsert(existingRowId, { address: record.propertyAddress, record, cadStatus: "found" });
            } else {
              rowIdByCadKey.set(key, key);
              upsert(key, { address: record.propertyAddress, record, cadStatus: "found" });
            }
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

              if (!isSupportedCounty(candidate.county)) {
                // Known to be out of coverage (a real Colorado Walmart, not
                // a Texas one) — shown, not hidden (same "show it, don't
                // drop it" principle as every other row here), but never
                // even attempts a CAD lookup: that lookup would only ever
                // come back empty after real latency against counties we
                // don't serve, which is exactly what "it's taking a long
                // time searching Dallas County" turned out to be for an
                // out-of-state address.
                upsert(googleRowId, {
                  address: candidate.address,
                  googleLabel: candidate.label,
                  cadStatus: "unsupported",
                });
                return;
              }

              // Shown immediately — this is the actual fix for "I don't
              // see all the addresses": a real Google match is a visible
              // row the instant it's found, not only once/if a CAD record
              // attaches to it.
              upsert(googleRowId, {
                address: candidate.address,
                googleLabel: candidate.label,
                cadStatus: "pending",
              });

              const records = await lookupRecords(candidate.address, false, candidate.county, signal);
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
              // One Google-resolved address can genuinely carry more than
              // one real parcel (found live: a Denton Braum's address with
              // 2 separate CAD accounts on file) — every one of them needs
              // its own row, not just the first. The placeholder row this
              // candidate already has (googleRowId) is claimed by whichever
              // record isn't already a duplicate of some other row; any
              // further distinct records get their own new row inserted
              // right next to it, so they read as "more parcels here," not
              // as unrelated entries at the bottom of the list.
              let claimedPlaceholder = false;
              records.forEach((record, i) => {
                const key = cadKey(record);
                const dupeRowId = rowIdByCadKey.get(key);
                if (dupeRowId) {
                  // Another row (direct search, or an earlier-resolving
                  // Google candidate) already found this exact parcel —
                  // merge the label onto it rather than show a duplicate.
                  const target = byId.get(dupeRowId);
                  if (target && !target.googleLabel) {
                    target.googleLabel = candidate.label;
                    emit();
                  }
                  return;
                }
                if (!claimedPlaceholder) {
                  claimedPlaceholder = true;
                  rowIdByCadKey.set(key, googleRowId);
                  upsert(googleRowId, {
                    address: record.propertyAddress,
                    googleLabel: candidate.label,
                    record,
                    cadStatus: "found",
                  });
                } else {
                  const extraRowId = `${googleRowId}#${i}`;
                  rowIdByCadKey.set(key, extraRowId);
                  upsert(
                    extraRowId,
                    {
                      address: record.propertyAddress,
                      googleLabel: candidate.label,
                      record,
                      cadStatus: "found",
                    },
                    googleRowId,
                  );
                }
              });
              if (!claimedPlaceholder) {
                // Every record this candidate resolved to turned out to
                // already be shown under some other row — nothing new to
                // add, so drop the now-redundant "pending" placeholder
                // instead of leaving it stuck mid-search forever.
                removeRow(googleRowId);
                emit();
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
      // Settle every row still stuck on "pending" instead of just freezing
      // future updates — found live ("it's been a long time, but still
      // this is looking") on a real Denton address whose CAD lookup never
      // came back before the cutoff: without this, timedOut silently makes
      // upsert a no-op for it and the spinner just spins forever, since
      // nothing ever flips its cadStatus to a resting state. This is its
      // one chance to resolve to "none" — a real address, just no parcel
      // found in time.
      let changed = false;
      for (const id of order) {
        const m = byId.get(id)!;
        if (m.cadStatus === "pending") {
          m.cadStatus = "none";
          changed = true;
        }
      }
      if (changed) emit();
      resolve();
    }, SEARCH_TIMEOUT_MS);
  });

  try {
    await Promise.race([everything, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
