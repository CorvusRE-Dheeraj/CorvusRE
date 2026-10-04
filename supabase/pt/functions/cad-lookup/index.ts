// Deploy via CLI: `supabase functions deploy cad-lookup`.
// No secrets required — both ArcGIS FeatureServer endpoints queried below are public,
// unauthenticated county open-data services.
//
// Collin, Montgomery, Denton, Harris, Tarrant, Fort Bend, Williamson, Grayson,
// Travis, Bexar, and Dallas counties are wired up for real (Phase 2A/2B/2C/2D). All
// eleven publish live-queryable parcel data on public ArcGIS FeatureServer/MapServer
// REST APIs — turns out every one of the originally-assumed "bulk file only"
// counties (Harris/Tarrant/Williamson/Grayson) actually has a live API too, just not
// discoverable via plain web search (found via ArcGIS's own item-search API
// instead). Travis's and Dallas's public sources have no value fields at all (only
// address + legal description for Travis; owner + address + account for Dallas) —
// included anyway per product decision, with those fields honestly null rather than
// faked. Bexar is served directly from BCAD's own domain (maps.bcad.org) — current
// values, but requires fully-qualified `table.column` names in the query (see
// queryBexar) and has no land/improvement split, only a combined total. Addresses
// outside these eleven counties correctly fall through to "not matched" rather than
// returning fabricated data.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  // Without this, supabase-js's functions.invoke() parses the body as plain text
  // (a JSON string) instead of a parsed object, based on the response Content-Type.
  "Content-Type": "application/json",
};

type CadRecord = {
  ownerName: string | null;
  propertyAddress: string;
  cad: string;
  accountNumber: string | null;
  propertyType: string | null;
  landValue: number | null;
  improvementValue: number | null;
  totalValue: number | null;
  taxYear: number | null;
  // Enrichment fields — populated for the counties whose public site offers a real,
  // callable second source: TrueProdigy (Denton/Montgomery/Tarrant/Travis), BIS
  // Consultants (Fort Bend/Grayson), Williamson's own JSON search API, and Dallas's
  // plain-GET account-detail pages. Collin and Harris remain unenriched (bot/WAF-
  // blocked); Bexar's second source (bexar.trueautomation.com) now also returns a
  // hard 403 from an Azure Application Gateway even with a real browser User-Agent
  // — confirmed 2026-08-11, not attempted further. See texas_cad_vendor_landscape
  // memory for the full per-county breakdown.
  legalDescription?: string | null;
  subdivision?: string | null;
  geoId?: string | null;
  mailingAddress?: string | null;
  ownershipPct?: number | null;
  protestStatus?: string | null;
  // Fort Bend only (see enrichBIS) — that county's own accountNumber is BIS's
  // "geoId" field, a different internal identifier than the numeric
  // "propertyId" BIS's own property-detail page URL actually needs. Captured
  // here, separately from accountNumber, purely so a real direct CAD-record
  // link can be built for Fort Bend — see cad-record-url.ts. Grayson and
  // Kaufman don't need this: their own accountNumber already IS BIS's
  // propertyId directly (confirmed live 2026-09-03).
  bisPropertyId?: string | null;
  valueHistory?: Array<{
    year: number;
    landValue: number | null;
    improvementValue: number | null;
    marketValue: number | null;
    appraisedValue: number | null;
  }>;
  deeds?: Array<{
    date: string | null;
    type: string | null;
    description: string | null;
    seller: string | null;
    buyer: string | null;
    instrumentNum: string | null;
  }>;
  // Structure / lot detail — populated wherever a real source has it:
  //  - building SF + year built + class: Denton, Collin, Tarrant, Fort Bend,
  //    Williamson (ArcGIS); Dallas (dallascad.org detail page, see enrichDallas)
  //  - building SF + year built only: Montgomery (ArcGIS)
  //  - lot size only: Harris, Travis, Grayson, Kaufman (ArcGIS field or the
  //    acreage stated in the legal description, see acresFromLegalText)
  //  - nothing: Bexar (no field on its layer, second source 403-blocked)
  // Null wherever the source didn't have it; never fabricated.
  buildingSqft?: number | null;
  yearBuilt?: number | null;
  buildingClass?: string | null;
  lotSizeSqft?: number | null;
  lotSizeAcres?: number | null;
};

// Per-county parcel-layer field names for structure / lot detail. Only the
// counties whose ArcGIS layer actually exposes these appear here — verified
// live against each layer's `?f=json` metadata on 2026-09-10. Everyone else
// leaves the fields null. Because every one of these fields is added to an
// `outFields` list on a query that already runs, this costs zero extra HTTP
// calls. `klass` omitted where the layer has no construction-class field.
const STRUCTURE_FIELDS_BY_CAD: Record<
  string,
  { sqft?: string; year?: string; klass?: string; lotAcres?: string; lotSqft?: string }
> = {
  "Denton Central Appraisal District": {
    sqft: "imprvMainArea",
    year: "imprvActualYearBuilt",
    klass: "imprvClasses",
    lotAcres: "legalAcreage",
    lotSqft: "land_sqft",
  },
  "Collin Central Appraisal District": {
    sqft: "imprvMainArea",
    year: "imprvYearBuilt",
    klass: "imprvClassCd",
    lotAcres: "landSizeAcres",
    lotSqft: "landSizeSqft",
  },
  "Tarrant Appraisal District": {
    sqft: "Living_Are",
    year: "Year_Built",
    lotAcres: "Land_Acres",
    lotSqft: "Land_SqFt",
  },
  "Fort Bend Central Appraisal District": {
    sqft: "TOTSQFTLVG",
    year: "YEARBUILT",
    klass: "Building_Class",
    lotAcres: "LANDSIZEAC",
    lotSqft: "LANDSIZEFT",
  },
  "Williamson Central Appraisal District": {
    sqft: "BLDGAREA",
    year: "RESYRBLT",
    klass: "STRCLASS",
    lotAcres: "TotAcreDeed",
  },
  "Montgomery Central Appraisal District": {
    sqft: "imprvMainArea",
    year: "imprvActualYearBuilt",
  },
  "Harris Central Appraisal District": { lotSqft: "land_sqft", lotAcres: "acreage_1" },
  "Travis Central Appraisal District": { lotAcres: "tcad_acres" },
  "Grayson Central Appraisal District": { lotAcres: "LegalAcreage" },
};

// The extra comma-separated outFields each county needs, derived from the map
// above. Append to a county's existing outFields string.
function structureOutFields(cad: string): string {
  const f = STRUCTURE_FIELDS_BY_CAD[cad];
  if (!f) return "";
  return [f.sqft, f.year, f.klass, f.lotAcres, f.lotSqft].filter(Boolean).join(",");
}

// Copies whatever structure / lot fields the county's layer returned onto the
// record. A value only appears when the source actually gave a sane one:
// positive numbers, a plausible 4-digit year, a non-empty class string.
function applyStructureDetail(
  record: CadRecord,
  attrs: Record<string, string | number | null | undefined>,
): CadRecord {
  const f = STRUCTURE_FIELDS_BY_CAD[record.cad];
  if (!f) return record;
  const num = (key?: string): number | null => {
    if (!key) return null;
    const raw = attrs[key];
    if (raw == null || raw === "") return null;
    const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const str = (key?: string): string | null => {
    if (!key) return null;
    const raw = attrs[key];
    const s = typeof raw === "string" ? raw.trim() : raw != null ? String(raw).trim() : "";
    return s.length > 0 ? s : null;
  };
  const yr = num(f.year);
  const nowYear = new Date().getFullYear();
  return {
    ...record,
    buildingSqft: num(f.sqft),
    yearBuilt: yr != null && yr >= 1700 && yr <= nowYear + 1 ? Math.round(yr) : null,
    buildingClass: str(f.klass),
    lotSizeAcres: num(f.lotAcres),
    lotSizeSqft: num(f.lotSqft),
  };
}

// Every county below used to be gated behind a city-name regex (e.g. only try
// Collin if the address said "Plano" or "McKinney"), on the theory that a city name
// reliably indicates a county. It doesn't: three separate real-address bug reports
// on 2026-07-24 each turned out to be this same assumption failing a different way
// — Frisco/Prosper/Celina/Little Elm/The Colony are real parcels in *either*
// Collin or Denton depending on the specific address, and USPS assigns "Dallas" as
// the mailing city for large swaths of ZIP codes that are legally in Collin or
// Denton County, not Dallas County. Enumerating every small town and unincorporated
// area in ten counties (plus every USPS mailing-city quirk) is an unbounded,
// unwinnable list. So this now just queries every supported county in parallel for
// every address and takes the first one that returns a real record, in the fixed
// priority order below — no city-name filtering at all. The per-county ArcGIS/GIS
// queries are cheap, public, and independent, so this costs a few concurrent HTTP
// calls (bounded by the slowest single county, not the sum) rather than any real
// correctness risk, and permanently closes off this entire class of bug.

// Expanded 2026-07-26 after large-scale real-address sampling: "cv" (cove
// abbreviated), "run", and "fwy" (freeway) were missing and caused real
// unstripped-core false negatives (e.g. "10603 Queensbury Cv" — the split-field
// counties store the suffix separately, so an unstripped "Cv" stuck to the core
// meant it could never match the bare street-name field).
const STREET_SUFFIX_ALT =
  "st|street|rd|road|dr|drive|ln|lane|ave|avenue|blvd|boulevard|ct|court|pl|place|plz|plaza|pkwy|parkway|hwy|highway|fwy|freeway|cir|circle|way|trl|trail|trce|trace|loop|cv|cove|bend|xing|crossing|walk|row|run|mnr|manor|holw|hollow|pt|point|rdg|ridge|grn|green|knl|knoll|pass|path|vlg|village";

// Canonicalizes a suffix word to one short form (PKWY, not "parkway" or
// "Pkwy") — hand-kept in sync with STREET_SUFFIX_ALT above, same pairs.
// Used by findNearby's street-match sort tier (below) so two streets that
// differ only in suffix SPELLING ("Parker Road" vs "PARKER RD") still
// compare equal, while two that differ in suffix TYPE ("Dallas Pkwy" vs
// "Dallas Dr" — both genuinely real, different streets that merely share a
// base word) do not collapse into a false match.
const SUFFIX_CANONICAL: Record<string, string> = {
  ST: "ST",
  STREET: "ST",
  RD: "RD",
  ROAD: "RD",
  DR: "DR",
  DRIVE: "DR",
  LN: "LN",
  LANE: "LN",
  AVE: "AVE",
  AVENUE: "AVE",
  BLVD: "BLVD",
  BOULEVARD: "BLVD",
  CT: "CT",
  COURT: "CT",
  PL: "PL",
  PLACE: "PL",
  PLZ: "PLZ",
  PLAZA: "PLZ",
  PKWY: "PKWY",
  PARKWAY: "PKWY",
  HWY: "HWY",
  HIGHWAY: "HWY",
  FWY: "FWY",
  FREEWAY: "FWY",
  CIR: "CIR",
  CIRCLE: "CIR",
  WAY: "WAY",
  TRL: "TRL",
  TRAIL: "TRL",
  TRCE: "TRCE",
  TRACE: "TRCE",
  LOOP: "LOOP",
  CV: "CV",
  COVE: "CV",
  BEND: "BEND",
  XING: "XING",
  CROSSING: "XING",
  WALK: "WALK",
  ROW: "ROW",
  RUN: "RUN",
  MNR: "MNR",
  MANOR: "MNR",
  HOLW: "HOLW",
  HOLLOW: "HOLW",
  PT: "PT",
  POINT: "PT",
  RDG: "RDG",
  RIDGE: "RDG",
  GRN: "GRN",
  GREEN: "GRN",
  KNL: "KNL",
  KNOLL: "KNL",
  PASS: "PASS",
  PATH: "PATH",
  VLG: "VLG",
  VILLAGE: "VLG",
};

// The trailing suffix word of a street string (whole street, e.g. "Dallas
// Pkwy", or just a house-number-stripped portion), canonicalized — null
// when none is recognized at all (a bare road with no suffix typed).
function trailingSuffixOf(street: string): string | null {
  const m = street.match(new RegExp(`\\b(${STREET_SUFFIX_ALT})\\.?$`, "i"));
  return m ? (SUFFIX_CANONICAL[m[1].toUpperCase()] ?? null) : null;
}

// A comma DOES exist somewhere in the address but not between the street and
// the city specifically ("4220 S Preston Rd Celina, TX 75009" — the comma
// only separates city from state/zip) — found live 2026-09-03 chasing a
// real report where Collin genuinely has this exact road ("910 N Preston Rd,
// Celina, TX 75009") but the naive withComma split above swallows "Celina"
// into the STREET capture (everything before the FIRST comma), so `core`
// ends up searching for a street literally named "Preston Rd Celina" —
// real, but zero matches, and even the "nearby" fallback comes up empty
// since nothing real contains that exact glued phrase. Fixed by finding the
// LAST recognized street-suffix word in the captured street text (greedy,
// not the first — a legitimate multi-suffix-looking name like "Park Circle
// Drive" must still resolve to itself, not split at "Circle") and treating
// anything genuinely left over after it as a glued-on city. Guarded against
// a bare trailing directional ("107 Oak Dr E, Fort Worth" — a real, already-
// supported input shape) being mistaken for one: a real city is never just
// "E"/"N"/"NE"/etc. on its own.
function splitGluedCity(rawStreet: string): { street: string; gluedCity: string } | null {
  const m = rawStreet.match(new RegExp(`^(.*\\b(?:${STREET_SUFFIX_ALT})\\.?)\\b\\s+(\\S.*)$`, "i"));
  if (!m) return null;
  const extra = m[2].trim();
  if (/^(n|s|e|w|ne|nw|se|sw|north|south|east|west)\.?$/i.test(extra)) return null;
  // A real glued-on city is never a bare number — found live 2026-09-04
  // chasing a real report ("705 Hwy 352, Mesquite, TX 75149"): STREET_SUFFIX_ALT
  // includes "hwy"/"highway"/"fwy"/"freeway" for real NAMED streets that end in
  // that word ("Old Spanish Trail Hwy"), but the same word is also how Texas
  // numbered highways are typed ("Hwy 352") — there the route number right
  // after it isn't a glued city at all, it's the rest of the road's own name.
  // Without this guard, "Hwy 352" got split into street="Hwy" (the actual
  // route number silently discarded) and gluedCity="352" (a fake city that
  // then leaked into the display address and matched almost nothing real),
  // exactly the same class of corruption the directional guard above already
  // prevents for "107 Oak Dr E".
  if (/^\d+$/.test(extra)) return null;
  return { street: m[1].trim(), gluedCity: extra };
}

function parseHouseAndStreet(
  address: string,
): { house: string; street: string; cityStateZip: string } | null {
  const withComma = address.match(/^\s*(\d+)\s+([^,]+?)\s*,(.*)$/);
  if (withComma) {
    const rawStreet = withComma[2].trim();
    const split = splitGluedCity(rawStreet);
    if (split) {
      return {
        house: withComma[1],
        street: split.street,
        cityStateZip: `${split.gluedCity}, ${withComma[3].trim()}`,
      };
    }
    return { house: withComma[1], street: rawStreet, cityStateZip: withComma[3].trim() };
  }

  // No comma (e.g. "900 Willowwood St Denton") — capture the house number and street
  // name through the street-suffix word instead, treating everything after it (the
  // city, and optionally state/zip) as the tail. Without this fallback, any address
  // typed without a comma failed to parse at all and silently returned "not matched"
  // before ever reaching the county API.
  const noComma = address.match(
    new RegExp(`^\\s*(\\d+)\\s+(.+?\\b(?:${STREET_SUFFIX_ALT})\\.?)\\b\\s*(.*)$`, "i"),
  );
  if (!noComma) return null;
  return { house: noComma[1], street: noComma[2].trim(), cityStateZip: noComma[3].trim() };
}

// Same idea as parseHouseAndStreet, but for a bare road/street with no leading
// house number at all — e.g. "FM 1957, San Antonio, TX 78245" (a highway name,
// not a numbered street address). Used only for the "nearby" search fallback:
// there's no single parcel to exact-match without a house number, but a street
// name alone is still enough to search by and suggest real nearby options.
function parseStreetOnly(address: string): { street: string; cityStateZip: string } | null {
  const withComma = address.match(/^\s*([^,]+?)\s*,(.*)$/);
  if (withComma) {
    const rawStreet = withComma[1].trim();
    const split = splitGluedCity(rawStreet);
    if (split)
      return { street: split.street, cityStateZip: `${split.gluedCity}, ${withComma[2].trim()}` };
    return { street: rawStreet, cityStateZip: withComma[2].trim() };
  }

  const noComma = address.match(
    new RegExp(`^\\s*(.+?\\b(?:${STREET_SUFFIX_ALT})\\.?)\\b\\s*(.*)$`, "i"),
  );
  if (!noComma) return null;
  return { street: noComma[1].trim(), cityStateZip: noComma[2].trim() };
}

// Every county query below used to call parseHouseAndStreet(address) directly
// and bail out to [] whenever it failed — including in "nearby" mode, which
// is specifically meant to work WITHOUT a house number. That made the nearby
// fallback silently do nothing for any address that didn't start with a house
// number (a bare road name like "FM 1957" or "Loop 410"), even though nearby
// mode's own WHERE clause (coreClauseOr) never actually needed one. Exact
// mode still requires a real parse, since there's no way to pick one specific
// parcel on a whole road without a house number.
function parseAddressForQuery(
  address: string,
  mode: QueryMode,
): { house: string; street: string; cityStateZip: string } | null {
  const parsed = parseHouseAndStreet(address);
  if (parsed) return parsed;
  if (mode !== "nearby") return null;
  const streetOnly = parseStreetOnly(address);
  if (!streetOnly) return null;
  return { house: "", street: streetOnly.street, cityStateZip: streetOnly.cityStateZip };
}

type NameQuery = { name: string; city: string };

// Multi-word city names within the 12 counties this app supports — checked
// longest-first (by trying 3 words, then 2) so "Fort Worth"/"San Antonio"
// aren't misread as city "Worth"/"Antonio" with "Fort"/"San" stuck onto the
// business name (found live: "walmart fort worth" and "walmart san antonio"
// both returned zero results this way, despite real Tarrant/Bexar matches).
// Not exhaustive — a multi-word city not in this short list still falls back
// to the single-last-word heuristic below, same as before.
const MULTI_WORD_CITIES = [
  "fort worth",
  "san antonio",
  "the colony",
  "flower mound",
  "round rock",
  "sugar land",
  "missouri city",
  "grand prairie",
  "little elm",
  "highland village",
  "north richland hills",
  "lake dallas",
  "corpus christi",
];

// A short, deliberately non-exhaustive allowlist of single-word Texas city
// names within this app's supported counties — checked against EVERY word
// in the query, not just the last one, before falling back to the
// last-word guess. Found live: "Braum's Denton west univ dr" took the last
// word ("dr") as the city, so the real city ("Denton," in the middle of
// the query) was never recognized at all — the same class of bug
// MULTI_WORD_CITIES above already exists to prevent for a multi-word city,
// just for a single-word one with extra trailing words. Trailing words
// after a recognized city (here, "west univ dr") are dropped from the name
// entirely — they read as leftover address fragments the user tacked on,
// not part of either the business name or a second real city reference.
const KNOWN_SINGLE_WORD_CITIES = new Set([
  "denton", "houston", "dallas", "plano", "frisco", "mckinney", "allen",
  "carrollton", "lewisville", "wylie", "celina", "garland", "mesquite",
  "irving", "arlington", "austin", "sherman", "denison", "conroe", "katy",
  "georgetown", "humble", "spring", "stafford", "aubrey", "porter",
  "crandall", "forney", "montgomery", "euless", "hurst", "bedford",
  "colleyville", "southlake", "keller", "burleson", "haslet", "roanoke",
  "grapevine",
]);

// A bare business/owner name (optionally + city) — "Walmart Denton", "Walmart,
// Denton, TX", or just "7-Eleven" — rather than a street address. Deliberately
// simple: prefers an explicit comma ("Name, City, TX") when present (reusing
// guessCity on the tail, same as a real address's own city extraction);
// otherwise checks the known multi-word cities above, then any recognized
// single-word city anywhere in the query, then falls back to treating the
// LAST word as the city and everything before it as the name, which covers
// the common "Business City" typed form without a comma.
function parseNameQuery(address: string): NameQuery | null {
  const trimmed = address.trim();
  if (!trimmed) return null;
  const withComma = trimmed.match(/^([^,]+),(.*)$/);
  if (withComma) {
    const name = withComma[1].trim();
    if (!name) return null;
    return { name, city: guessCity(withComma[2].trim()) };
  }
  const words = trimmed.split(/\s+/);
  if (words.length < 2) return { name: trimmed, city: "" };
  const lower = trimmed.toLowerCase();
  for (const city of MULTI_WORD_CITIES) {
    if (lower.endsWith(` ${city}`)) {
      const name = trimmed.slice(0, trimmed.length - city.length).trim();
      if (name) return { name, city };
    }
  }
  const cityIndex = words.findIndex((w) =>
    KNOWN_SINGLE_WORD_CITIES.has(w.replace(/[^a-zA-Z]/g, "").toLowerCase()),
  );
  if (cityIndex > 0) {
    return { name: words.slice(0, cityIndex).join(" "), city: words[cityIndex] };
  }
  return { name: words.slice(0, -1).join(" "), city: words[words.length - 1] };
}

// Best-effort extraction of just the city name from the "city, state, zip" tail —
// used only as a tiebreaker (see the comment in Deno.serve below), so approximate
// is fine. Takes everything before the first comma (if any), then strips a
// trailing "TX"/"Texas" and whatever follows it (covers the no-comma case, where
// cityStateZip is still "city TX zip" space-separated).
function guessCity(cityStateZip: string): string {
  return cityStateZip
    .split(",")[0]
    .replace(/\btx\b.*$/i, "")
    .replace(/\btexas\b.*$/i, "")
    .trim();
}

// Extracts just the CITY from a full, already-returned `propertyAddress`
// (house+street+city, in whatever shape that specific county's own source
// hands back) — needed by both the exact-sweep tiebreak and findNearby's
// city filter below, neither of which can safely use a plain
// `.includes(cityGuess)` check against the WHOLE address (see the long
// comment on cityOf's two call sites). Every source's own returned address
// ends in some form of "<city> TX <zip>" / "<city>, TX, <zip>" — comma
// placement before the city varies wildly between sources (Bexar has NONE
// at all, e.g. "...FAIR OAKS, TX 78015"; Denton/Collin usually do) — but the
// STREET always ends in a recognized suffix word first, so anchoring on the
// LAST such suffix word (the leading `.*` forces the greedy match to the
// rightmost occurrence, so a street name that itself contains an earlier
// suffix-shaped word — "Bay Ridge Dr" — doesn't win over the real one) and
// taking the genuinely-multi-word text between it and the state marker
// reliably isolates the real city regardless of a given source's own comma
// habits. Confirmed live 2026-09-03 against real returned addresses from
// every county in this file, including 2-word cities (Fair Oaks, Little
// Elm, Grand Prairie) and a street whose own name contains "Place" (Market
// Place Blvd) — the trailing `\b` after the suffix alternation is required
// so "Pl" can't match as a false prefix of an unrelated word like "Plano".
function cityOf(propertyAddress: string): string {
  const m = propertyAddress.match(
    new RegExp(`.*\\b(?:${STREET_SUFFIX_ALT})\\b\\.?\\s*,?\\s*(.*?)\\s*,?\\s*(?:TX|Texas)\\b`, "i"),
  );
  if (m) return m[1].replace(/,/g, " ").replace(/\s+/g, " ").trim();
  // No recognized suffix word found at all (a genuinely unusual shape) —
  // fall back to the single-last-word heuristic. Only reached when the
  // primary approach can't anchor on anything, so an imperfect multi-word
  // city (truncated to its last word) here is a rare, honest degradation,
  // not the common case.
  const fallback = propertyAddress.match(/.*[,\s]([A-Za-z][A-Za-z'-]*?)\s*,?\s*(?:TX|Texas)\b/i);
  return fallback ? fallback[1].trim() : "";
}

// Mirror of cityOf above, same suffix-word anchor (greedy .* so a street
// whose own name contains a suffix word, e.g. "Market Place Blvd", still
// anchors on the real trailing suffix, not a false mid-name match) — but
// capturing what comes BEFORE the suffix instead of after it: the house
// number + the real street name + its suffix, with the city/state/zip tail
// dropped. Used by findNearby's street-match sort tier below.
function streetPortionOf(propertyAddress: string): string {
  const m = propertyAddress.match(
    new RegExp(`^\\s*\\d+[A-Za-z]?\\s+(.*\\b(?:${STREET_SUFFIX_ALT})\\b\\.?)`, "i"),
  );
  return m ? m[1].trim() : "";
}

// Bidirectional on purpose — real, minor city-naming differences go both
// ways: Bexar's own data says "Fair Oaks" for a user-typed "Fair Oaks
// Ranch" (the county's name is a SUBSET of what the user typed), but the
// reverse (a source using a more specific/longer name than the user typed)
// is just as plausible for some other county. Empty on either side never
// matches — an empty extractedCity (cityOf found nothing) or an empty
// cityGuess (the user typed no city at all) is "unverifiable," never a
// coincidental match.
function cityMatches(extractedCity: string, cityGuess: string): boolean {
  if (!extractedCity || !cityGuess) return false;
  const a = extractedCity.toUpperCase();
  const b = cityGuess.toUpperCase();
  return a.includes(b) || b.includes(a);
}

// cityOf() above anchors on a trailing "TX"/"Texas" to find the city group —
// but some counties' own constructed propertyAddress strings never include a
// state at all (Harris, Tarrant, Grayson: e.g. "11242 GESSNER, HOUSTON", no
// ", TX" after it), so cityOf() silently returns "" for them, and the plain
// cityMatches(cityOf(...), ...) call always treats those as "no match" even
// when the real city is sitting right there in the string. Found live
// chasing a real report ("Walmart Houston" never surfacing any of Harris's
// 50 real Houston matches). Only used by findByName's city tiebreak below —
// findNearby's own tiebreak keeps the stricter cityOf()-only check, since a
// name search has no house number to fall back on and the city signal
// matters far more there.
// Address-only on purpose — NOT the record's CAD/county name. Tried
// matching the county too (treating "Denton" as matching any city inside
// Denton County, e.g. Frisco), but direct user correction: typing a city
// name in this search means that city, not its whole county — a real
// Denton, TX resident expects "Denton" to mean the city of Denton, not
// Frisco or The Colony just because they share a CAD.
function nameSearchCityMatches(propertyAddress: string, cityGuess: string): boolean {
  if (!cityGuess) return false;
  const extracted = cityOf(propertyAddress);
  if (extracted) return cityMatches(extracted, cityGuess);
  return propertyAddress.toUpperCase().includes(cityGuess.toUpperCase());
}

// Extracts a leading directional word (N/S/E/W or spelled out) immediately
// after the house number — from either the user's OWN parsed street text
// ("W University Ave" -> "W") or a candidate's returned propertyAddress
// ("2601 W UNIVERSITY AVE, GEORGETOWN..." -> "W"). Every single-field
// county's exact-match query deliberately DROPS the directional entirely
// (see coreStreetName's own comment — needed so a county address embedding
// a directional the user didn't type still matches) — which means two real,
// separately-owned parcels that share a house number and only differ by
// directional (2601 E University Ave vs. 2601 W University Ave, confirmed
// live 2026-09-04, Williamson County) both come back as "candidates" for
// the SAME query. This is the disambiguator: when the user typed one, it's
// a genuine, deliberate signal — not something to discard the way the
// street-matching query itself must.
function directionalOf(text: string): string {
  const m = text
    .replace(/^\d+\s+/, "") // for a full propertyAddress, skip the house number first
    .match(/^(n|s|e|w|ne|nw|se|sw|north|south|east|west)\b/i);
  if (!m) return "";
  const dir = m[1].toUpperCase();
  const long: Record<string, string> = {
    NORTH: "N",
    SOUTH: "S",
    EAST: "E",
    WEST: "W",
  };
  return long[dir] ?? dir;
}

// A real US address always ends with its zip — end-anchored specifically so
// this never matches a 5-digit HOUSE NUMBER earlier in the string instead.
// Confirmed live chasing a real "FM 1957" no-house-number Bexar property: a
// plain "any 5 digits" match misidentified several OTHER candidates' own
// 5-digit house numbers (e.g. "13158 FM 1957...") as their zip. Used by
// findNearby to prioritize real zip matches over an otherwise-arbitrary
// county row order (see below).
function extractZip(address: string): string {
  const m = address.trim().match(/(\d{5})\s*$/);
  return m ? m[1] : "";
}

// Strips a leading directional (N/S/E/W) and a trailing street-type word, leaving just
// the "core" street name — used for counties whose schema splits house number and
// street type into separate fields, so we can't match the full phrase in one LIKE.
//
// Every single-field county query below builds its LIKE pattern as
// `${house} %${coreStreetName(street)}%` — house number anchored to the very START
// of the field (NO leading `%`), followed by a required literal space, THEN a
// wildcard before the core street name. Two bugs, found in sequence on 2026-07-26:
//
// 1) The original pattern was `%${house} ${core}%` (leading wildcard, house+core
//    exactly one space apart). Denton's situs field stores "3500 N BONNIE BRAE ST"
//    — the directional sits BETWEEN the house number and the core name — so
//    house+core being forced adjacent-with-one-space silently failed on any
//    address whose county data embeds a directional right after the house number.
// 2) The first fix for that — `%${house}%${core}%`, a wildcard in place of the
//    space — went too far: with a LEADING wildcard too, "%2021%" matches the
//    DIGITS "2021" occurring ANYWHERE in the field, including as a prefix of an
//    unrelated house number like "20217" or a suffix like "1103" (which contains
//    "103"). Sampling ~100 real addresses across all 11 counties on 2026-07-26
//    turned up over a dozen cases of this returning a completely different real
//    property — sometimes in a different county entirely — as a false positive
//    "match" (e.g. "103 Berkshire St, Bellaire" incorrectly resolved to a Denton
//    County record at "1103 Berkshire Ct, Trophy Club"). Silently wrong data is
//    worse than "not found," so this needed a real fix, not another loosening.
//
// The current pattern fixes both: no leading `%` anchors the house number to the
// true start of the field (so "103" can never match inside "1103"), and the
// required literal space right after it anchors the house number's own end (so
// "2021" can't match as a prefix of "20217"). The wildcard AFTER that space is what
// still tolerates a directional or anything else sitting between the house number
// and the core street name.
const STREET_SUFFIX_WORDS = new RegExp(`\\b(?:${STREET_SUFFIX_ALT})\\.?$`, "i");
function coreStreetName(street: string): string {
  return street
    .replace(/^(n|s|e|w|north|south|east|west)\s+/i, "")
    .replace(STREET_SUFFIX_WORDS, "")
    .trim();
}

// Highway-named streets are stored under wildly different conventions per county —
// found 2026-07-26 chasing a real address ("5800 North Interstate 35, Denton"):
// Denton stores it as "I35" (no space, no word at all), Travis stores US highways
// as "U S HY 183" (literally spaced out), Montgomery spells interstates out in
// full ("INTERSTATE 45"), and Bexar abbreviates to "IH 10" — four different real
// conventions for the same concept, confirmed across four counties. No single
// rewrite of the user's input can match all of them, so this generates every
// plausible variant instead and tries them all (OR'd) in the same query.
//
// FM (Farm-to-Market) roads are the exact same problem, found 2026-09-02 chasing
// a real report: "FM1957, San Antonio, TX 78245" (typed with no space, no house
// number — a real highway-frontage commercial property with no numbered address
// at all) returned nothing. Confirmed live against Bexar's own data: searching
// the literal typed "FM1957" matches zero rows, but "FM 1957" (with a space) is
// exactly how Bexar stores it — e.g. "11440 FM 1957 SAN ANTONIO, TX 78245", a
// real match for this exact report. RM (Ranch-to-Market) and RR (Ranch Road) are
// the same style of Texas road prefix, included here on the same pattern.
//
// A second, separate form of the same problem, found 2026-09-02 chasing the
// SAME report after the fix above shipped and the user still couldn't search
// it: picking "FM1957, San Antonio, TX 78245" from the address autocomplete
// dropdown (the realistic flow — not typing the abbreviated form and hitting
// Validate directly) hands this app Google's own spelled-out street name —
// confirmed live via Place Details: "FM1957" resolves to addressComponents
// longText "Farm to Market Road 1957", and "RM2222"/"RR620" alike both
// resolve to "Ranch to Market Road 2222"/"620" (Google doesn't distinguish
// RM from RR by name at all). AddressAutocomplete.tsx deliberately prefers
// this un-abbreviated longText over the abbreviated form for a different,
// already-fixed bug (see buildAddressFromComponents's own comment — mid-word
// abbreviations like "Market Pl" broke matching for "Market Place Blvd"), so
// the fix belongs here, recognizing Google's spelled-out form as a variant
// input rather than fighting that same abbreviation problem again.
//
// The same two-sided problem (abbreviated typed form vs. Google's spelled-out
// form) applies to every other Texas highway-style road prefix this app
// already space-normalizes client-side (see TX_ROAD_PREFIX in
// AddressAutocomplete.tsx: FM/RM/CR/SH/US/IH/LP/LOOP/SPUR) but this function
// didn't yet recognize. Extended 2026-09-02, each confirmed live the same way
// as FM above — a real county record AND Google's real Place Details output
// for a real road of that type. Kept deliberately minimal per variant (only
// forms actually confirmed live, not every plausible spelling) after finding
// that Loop 1604 — a genuinely huge, high-traffic road with thousands of real
// records — pushed Tarrant's and Harris's already-known-slow wildcard scans
// (see NEARBY_QUERY_TIMEOUT_MS's own history above) well past even the
// bumped 10s timeout with the first, more generous variant list tried; a
// leading-wildcard LIKE scan's cost scales with the number of OR'd variants
// on these two backends specifically, so fewer-but-confirmed variants is both
// more honest AND faster:
// - Loop: Bexar stores "5040 E LOOP 1604 ELMENDORF" and Denton stores
//   "1703 S LOOP 288, DENTON" — both spell "LOOP" out already (never
//   abbreviated "LP" in any real record found, so no "LP" variants are
//   generated despite TX_ROAD_PREFIX assuming the abbreviation exists
//   somewhere — not confirmed, not guessed here). Google's own longText for
//   a specific frontage-road segment can come back directional-QUALIFIED on
//   both ends ("West Loop 1604 South" — confirmed live), not just prefixed —
//   the trailing directional is tolerated below (matched, not captured) so it
//   doesn't break the end-anchored match.
// - State highways: Bexar has BOTH "S STATE HWY 16 VON ORMY" and
//   "23167 SH 16 S VON ORMY" for the literal same road — two real, different
//   stored forms in the very same county. Google's own longText resolves
//   "SH16" to "Texas Highway 16" — a third real, confirmed form; all three
//   are generated. "State Highway" and "TX Highway" were dropped — neither
//   showed up in the real county data or Google's real output, only "guessed
//   by analogy," which is exactly what this fix exists to avoid doing.
// - County roads: Bexar stores "216 COUNTY ROAD 125 ELMENDORF" spelled out —
//   no abbreviated "CR 125" form found in any real record — and Google's own
//   longText for "CR125" independently resolves to "County Road 125", the
//   same spelled-out form. The abbreviated "CR"/"CR-" variants are still
//   generated for a directly-typed abbreviated address, which has no
//   autocomplete resolution step to expand it.
// Spur was NOT extended here — TX_ROAD_PREFIX assumes it exists, but no real
// NUMBERED Spur route turned up in Bexar's or Denton's own data while
// checking the above (only literal street NAMES containing the word "Spur",
// a false-positive shape, not a highway prefix) — left alone rather than
// guessed, per this file's own standing discipline (see the Sixth bug class
// note in the texas_cad_data_sources memory).
// Appends every cardinal direction GLUED directly onto each of the given
// forms with no separating space/hyphen ("I35" -> "I35N"/"I35S"/"I35E"/
// "I35W") — found live chasing a real report (a genuinely real Denton
// Braum's, correctly resolved by Google, missing from the live dropdown):
// Denton stores this specific interstate's situs as "...I35E..." with the
// direction glued straight onto the number, no space at all. The INPUT
// address often has no directional to work with in the first place —
// Google's own resolved address for this exact place was plain "Interstate
// 35," no "E" — so there's nothing to echo back; the only way to still
// find a real record stored this way is to try every direction as its own
// candidate. Deliberately only wired into the interstate branch below,
// which is the one confirmed-live case of this glued-no-space storage
// convention — kept off the other highway types per this function's own
// "only forms actually confirmed live, not every plausible spelling"
// discipline (see the long comment above this function), and never
// applied to ordinary (non-highway) street names, which already have a
// separately proven, working mechanism for a trailing directional (see
// singleFieldWhere's "end of string" boundary case, built for exactly
// this on plain streets like "107 OAK DR E").
function withGluedDirectionals(forms: string[]): string[] {
  return forms.flatMap((f) => [f, ...["N", "S", "E", "W"].map((d) => `${f}${d}`)]);
}

function coreVariants(core: string): string[] {
  const variants = new Set<string>([core]);
  const m = core.match(
    /^(interstate|ih|i|u\.?s\.?|us|fm|rm|rr|farm[\s-]to[\s-]market(?:[\s-]road)?|ranch[\s-]to[\s-]market(?:[\s-]road)?|ranch[\s-]road|loop|sh|state[\s-]hwy|texas[\s-]highway|cr|county[\s-]road)\s*-?\s*(?:hy|hwy|highway)?\s*-?\s*(\d+)(?:\s+(?:n|s|e|w|north|south|east|west))?$/i,
  );
  if (m) {
    const n = m[2];
    const prefix = m[1]
      .toLowerCase()
      .replace(/[\s-]+/g, " ")
      .trim();
    if (/^(interstate|ih|i)$/.test(prefix)) {
      for (const v of withGluedDirectionals([`I${n}`, `I ${n}`, `I-${n}`, `IH ${n}`, `IH-${n}`])) {
        variants.add(v);
      }
      for (const v of [`INTERSTATE ${n}`, `INTERSTATE HY ${n}`]) {
        variants.add(v);
      }
    } else if (/^(us|u s|u\.s\.)$/.test(prefix)) {
      for (const v of [`US ${n}`, `U S HY ${n}`, `US HWY ${n}`, `US HIGHWAY ${n}`, `HWY ${n}`]) {
        variants.add(v);
      }
    } else if (/^(fm|farm to market( road)?)$/.test(prefix)) {
      for (const v of [`FM${n}`, `FM ${n}`, `FM-${n}`]) {
        variants.add(v);
      }
    } else if (/^(rm|rr|ranch to market( road)?|ranch road)$/.test(prefix)) {
      // RM / RR, and Google's spelled-out "Ranch to Market Road" — which
      // Google uses for both prefixes indistinguishably (confirmed live on
      // RM2222 and RR620 alike), so generate both abbreviations rather than
      // guess which one this particular county actually uses.
      for (const p of ["RM", "RR"]) {
        for (const v of [`${p}${n}`, `${p} ${n}`, `${p}-${n}`]) {
          variants.add(v);
        }
      }
    } else if (/^loop$/.test(prefix)) {
      for (const v of [`LOOP ${n}`, `LOOP${n}`, `LOOP-${n}`]) {
        variants.add(v);
      }
    } else if (/^(sh|state hwy|texas highway)$/.test(prefix)) {
      for (const v of [`SH ${n}`, `SH${n}`, `SH-${n}`, `STATE HWY ${n}`, `TEXAS HIGHWAY ${n}`]) {
        variants.add(v);
      }
    } else {
      // cr / county road
      for (const v of [`CR ${n}`, `CR${n}`, `CR-${n}`, `COUNTY ROAD ${n}`]) {
        variants.add(v);
      }
    }
  }
  return [...variants];
}

// Builds the WHERE clause shared by every county whose situs data is one
// concatenated field (house number + street all in a single column). Two
// anchoring requirements, both found chasing real false-positive matches on
// 2026-07-26:
// 1) House number: anchored to the START of the field with a required literal
//    space right after it (see the long comment above coreStreetName) — without
//    this, "103" matches inside "1103", "2021" matches as a prefix of "20217".
// 2) Core street name: must be followed by a space or a comma, not just anything
//    — without this, a short/suffix-stripped core like "Oak" or "Broad" matches as
//    a mere PREFIX of an unrelated, longer single-word street ("Oakbluff",
//    "Broadway"), and "Day"/"Knight"/"Buckner" similarly matched inside
//    "Daytona"/"Knights"/"Buckners". The OR of two literal suffixes (space vs.
//    comma) covers both "core is followed by its own suffix word" and "core is the
//    last word before the city, with no suffix" — SQL LIKE has no word-boundary
//    metacharacter, so this is the closest safe equivalent. `core` itself may be
//    several OR'd highway-naming variants (see coreVariants) rather than one string.
function singleFieldWhere(field: string, house: string, core: string): string {
  // Three boundary cases, not two: core can be followed by its own suffix word
  // (space), directly precede the city (comma), OR be the very last thing in the
  // whole field with nothing after it at all (found 2026-07-26 on Tarrant, whose
  // Situs_Addr has no city appended — "107 OAK DR E" ends the string right after
  // the trailing directional, so neither "core " nor "core," ever matched).
  const coreClause = coreVariants(core)
    .map(
      (c) =>
        // A leading space is required so the core only matches a WHOLE word ("ROSS" must not match
        // "CROSS TIMBER"; "ELM" must not match "BELMONT") — the house number always precedes it.
        `(UPPER(${field}) LIKE UPPER('% ${c} %') OR UPPER(${field}) LIKE UPPER('% ${c},%') OR UPPER(${field}) LIKE UPPER('% ${c}'))`,
    )
    .join(" OR ");
  return `UPPER(${field}) LIKE UPPER('${house} %') AND (${coreClause})`;
}

// Same highway-variant OR'ing as singleFieldWhere, for the counties whose schema
// already splits house number (matched exactly, no anchoring tricks needed) from a
// street-name-only field.
// Fetches several candidate rows per county instead of just one — found 2026-07-26
// that a single county can genuinely have MULTIPLE real matches for the same house
// number + generic street name across different small towns within that same
// county (e.g. Montgomery has both "111 Park Way, Montgomery" AND "111 N Acacia
// Park Cir, Spring" for a "111"+"Park" search; the ArcGIS service has no inherent
// ordering that favors either). With only ever fetching row 1, the city-tiebreak in
// Deno.serve had nothing useful to compare against whenever the arbitrary top row
// wasn't the one whose city matched the user's input. Fetching several rows and
// letting the tiebreak search across all of them (not just each county's row 1)
// fixes this at the source.
const MULTI_CANDIDATE_LIMIT = 8;

// "nearby" mode (see Deno.serve below) reuses every one of the query*
// functions below unchanged except for one line each — the WHERE clause drops
// the house-number anchor entirely (coreClauseOr(field, core) instead of
// singleFieldWhere(field, house, core), or dropping the split-field house-
// number `=` clause) so the SAME real endpoint returns every real parcel on
// that street, any house number. Only ever queried after the exact-match
// sweep has already come up empty, then filtered/sorted/capped to 8 centrally
// in findNearby() below — this is the PER-COUNTY fetch size before that
// happens, not the final list size.
//
// 300, not 50: found live 2026-10-01 chasing a real report ("6555 Dallas
// Pkwy") — the exact "100+ real matches" case this comment already warned
// was still possible at 50 (itself raised from 12 for "901 Willowwood St",
// same reasoning: ArcGIS has no inherent ordering favoring numerically-close
// house numbers). Dallas Pkwy is a long, dense commercial corridor — the 50
// rows Collin's service happened to return clustered around house numbers
// 2700-3100 and never included 6555 at all, so no amount of sorting
// afterward (see findNearby's proximity sort below) could have surfaced it —
// the real candidate was never fetched in the first place. 300 stays a real,
// bounded cap (not unbounded), sized to comfortably cover even a long
// commercial corridor while staying well inside both the per-county
// NEARBY_QUERY_TIMEOUT_MS budget and typical ArcGIS FeatureServer response
// limits for this few, narrow outFields.
const NEARBY_LIMIT = 300;
// "name" — a business/owner-name search (e.g. "Walmart Denton"), added
// 2026-10-01 chasing a real report that typing a business name + city
// returned literally nothing: parseHouseAndStreet/parseStreetOnly both
// require either a leading house number or a trailing street-suffix word,
// so a bare name+city never parsed as ANY kind of address and every county
// query bailed out before ever making a request. See parseNameQuery and
// ownerNameFeatures below — a new, separate code path that only ever
// activates when the existing address parsing already failed, so it can't
// regress any address-matching behavior above.
type QueryMode = "exact" | "nearby" | "name";

function coreClauseOr(field: string, core: string): string {
  // Same word-boundary reasoning as singleFieldWhere — these fields hold ONLY the
  // street name (no suffix, no city), so "ends with core" is actually the common
  // case here, not the exception.
  return coreVariants(core)
    .map(
      (c) =>
        // Whole-word only, as above; here the core may also be the very start of the field.
        `(UPPER(${field}) LIKE UPPER('${c} %') OR UPPER(${field}) LIKE UPPER('% ${c} %') OR UPPER(${field}) LIKE UPPER('${c},%') OR UPPER(${field}) LIKE UPPER('% ${c},%') OR UPPER(${field}) LIKE UPPER('% ${c}') OR UPPER(${field}) LIKE UPPER('${c}'))`,
    )
    .join(" OR ");
}

// A short, deliberately small seed list of common business names Texas CAD
// systems record with internal punctuation a user would never type — found
// live chasing a real report ("Walmart Denton" returning zero matches
// despite two real Denton Walmart parcels): Denton's own owner-name field
// has it as "WAL-MART REAL ESTATE BUSINESS TRUST", not "WALMART". Not an
// attempt at general fuzzy business-name matching against messy government
// ownership records (a genuinely open-ended problem) — just this one
// confirmed case, tried as an additional OR'd alternate alongside whatever
// the user actually typed. Extend as more real reports surface a specific
// mismatch, the same way SUFFIX_CANONICAL grew for street suffixes.
const NAME_SEARCH_ALIASES: Record<string, string> = {
  WALMART: "WAL-MART",
  // Confirmed live (Denton): "MCDONALD'S REAL ESTATE COMPANY" — the key is
  // punctuation/space-stripped before lookup (see nameSearchVariants below),
  // so "mcdonalds", "Mc Donalds", and "McDonald's" all hit this same entry.
  MCDONALDS: "MCDONALD'S",
};

// Prefix match, not exact — found live ("walmart south loop denton"):
// parseNameQuery's own name/city split only recognizes the trailing city, so
// extra real words typed between the brand and the city ("south loop," a
// genuine part of this real store's street) get glued onto "the name" as
// "walmart south loop," which never exact-matches the WALMART alias key.
// The alias text itself ("WAL-MART") is still a clean, correct OR'd variant
// regardless of what garbage is stuck on the end of the broken name, as
// long as the name at least STARTS WITH a recognized brand — true for the
// overwhelmingly common "Brand [extra words] City" typed shape.
function nameSearchVariants(name: string): string[] {
  const key = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
  for (const [aliasKey, alias] of Object.entries(NAME_SEARCH_ALIASES)) {
    if (key.startsWith(aliasKey)) {
      return alias.toUpperCase() !== name.toUpperCase() ? [name, alias] : [name];
    }
  }
  return [name];
}

// Plain fetch+parse used by nearbyFeaturesWithFallback below — every ArcGIS
// county's response shares this exact `{features: [{attributes}]}` shape.
async function fetchFeatures(
  url: string,
): Promise<Array<{ attributes: Record<string, string | number | null> }>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`query failed: ${res.status}`);
  const json = (await res.json()) as {
    features?: Array<{ attributes: Record<string, string | number | null> }>;
  };
  return json.features ?? [];
}

// Owner/business-name search (mode "name" — see parseNameQuery above).
// Deliberately NOT city-filtered in the WHERE clause itself — found live
// chasing a real report ("Walmart Denton"): a naive `city LIKE '%DENTON%'`
// AND-clause against a combined address field also matched "4025 OLD DENTON
// RD, CARROLLTON, TX" purely because the STREET name contains "Denton", the
// exact same city/street-word-collision class this file already fixed for
// address search (see the Parker Rd/Parker, Lucas Rd/Lucas comments on
// findNearby). Same fix here: fetch by name alone, then sort by city as a
// tiebreak in JS afterward (see findByName below), reusing cityOf/
// cityMatches — the same city-is-a-preference-not-a-filter approach that
// already works correctly for address search.
function ownerNameFeatures(
  url: string,
  ownerField: string,
  outFields: string,
  name: string,
  limit: number | null,
): Promise<Array<{ attributes: Record<string, string | number | null> }>> {
  const where = nameSearchVariants(name)
    .map((v) => `UPPER(${ownerField}) LIKE UPPER('%${escapeSqlString(v)}%')`)
    .join(" OR ");
  const limitParam = limit != null ? `&resultRecordCount=${limit}` : "";
  return fetchFeatures(
    `${url}?where=${encodeURIComponent(where)}&outFields=${outFields}${limitParam}&returnGeometry=false&f=json`,
  );
}

// A failed tight nearby match can take as long as a real one on some
// backends' full-scan LIKE (confirmed live 2026-09-03: 6.5s-22s for zero
// rows, on different real cases) — capped separately and generously short
// so it can never be the thing that starves the loose fallback's own,
// almost-always-real answer. withTimeout is defined later in this file
// (function declarations hoist) — see the long comment on
// nearbyFeaturesWithFallback below for why this exists.
const TIGHT_NEARBY_QUERY_TIMEOUT_MS = 4000;

// Nearby mode's coreClauseOr match is intentionally broad (bare, suffix-
// stripped core, tolerant of Rd/Road-style spelling mismatches) — but for
// the counties whose situs field concatenates house+street+CITY into one
// string, that same breadth means a street whose core word ALSO happens to
// be the city's own name (a real, common Texas pattern — Parker Rd in
// Parker, Lucas Rd in Lucas, Anna Rd in Anna, ...) can have its entire
// NEARBY_LIMIT-capped result window filled by unrelated ADDRESSES-IN-THAT-
// CITY matches before a single genuine same-named-street row is ever
// fetched. Confirmed live 2026-09-03 chasing a real report ("2514 Parker
// Rd, Parker, TX"): Collin has 598 real rows containing bare "PARKER "
// (nearly all just city-name matches), and the live nearby search for it
// returned zero actual Parker Rd rows among 50. Only affects the combined-
// field counties (Collin/Montgomery/Denton/Fort Bend/Williamson/Bexar/
// Tarrant) — the split-field ones (Harris/Grayson/Travis/Dallas) query a
// STREET-NAME-ONLY column that never contains the city at all, so they were
// never at risk of this collision and don't call this helper.
//
// Fixed by trying a TIGHTER match first — the street's own suffix word
// still attached ("Parker Rd", not just "Parker") — which can't collide
// with a bare city name; only falling back to the broad suffix-stripped
// search (for the Road/Rd spelling-mismatch case this whole match style
// exists for) when the tight one comes back genuinely empty.
async function nearbyFeaturesWithFallback(
  baseUrl: string,
  field: string,
  rawStreet: string,
  outFieldsParam: string,
  limit: number | null,
): Promise<Array<{ attributes: Record<string, string | number | null> }>> {
  const limitParam = limit != null ? `&resultRecordCount=${limit}` : "";
  const buildUrl = (where: string) =>
    `${baseUrl}?where=${encodeURIComponent(where)}&outFields=${outFieldsParam}${limitParam}&returnGeometry=false&f=json`;
  const core = coreStreetName(rawStreet);
  if (rawStreet.trim().toUpperCase() === core.toUpperCase()) {
    // Nothing was stripped at all (the typed street was already just the
    // bare core) — a second, more expensive tight-first attempt has nothing
    // to gain here, go straight to the one query.
    return fetchFeatures(buildUrl(coreClauseOr(field, core)));
  }
  // Fired concurrently, NOT sequentially (tight-then-fallback-if-empty) —
  // found live 2026-09-03, the very next report after this function
  // shipped: a failed tight match can be just as slow as a real one on some
  // backends' full-scan LIKE (confirmed: Collin took 6.5s to return ZERO
  // rows for one unmatched tight phrase, and 22s for another). Sequential
  // tight-then-loose was doubling this county's own contribution to the
  // shared NEARBY_QUERY_TIMEOUT_MS budget whenever the tight attempt
  // failed — the COMMON case, not rare (any Google-autocomplete-spelled-out
  // street, e.g. "East Parker Road" vs. the county's own abbreviated
  // "E Parker Rd", fails tight by design) — silently costing this county's
  // own correct loose-search results whenever the combined sequential time
  // pushed past the timeout.
  //
  // Plain concurrency alone wasn't enough, though — found immediately after
  // shipping THAT fix, chasing the very next real report ("Parker Village
  // Drive"): a plain `Promise.all([tight, loose])` still waits for BOTH
  // before returning anything, so a tight query slow enough on its own
  // (confirmed live: 22s for one real case) still starves a loose query
  // that would have come back correctly in 9s — Promise.all doesn't let a
  // fast, real answer escape a slow sibling. The tight attempt gets its own
  // short, separate timeout (falling back to [] alone, not the whole
  // function) — worth trying since it's genuinely more precise when it
  // works, but never allowed to hold up the loose fallback that almost
  // always has the real answer anyway.
  const [tight, loose] = await Promise.all([
    withTimeout(
      fetchFeatures(buildUrl(coreClauseOr(field, rawStreet.trim()))),
      TIGHT_NEARBY_QUERY_TIMEOUT_MS,
      [] as Array<{ attributes: Record<string, string | number | null> }>,
    ),
    fetchFeatures(buildUrl(coreClauseOr(field, core))),
  ]);
  return tight.length > 0 ? tight : loose;
}

const COLLIN_URL =
  "https://services2.arcgis.com/uXyoacYrZTPTKD3R/ArcGIS/rest/services/CCAD_Parcel_Feature_Set/FeatureServer/4/query";
const COLLIN_OUT_FIELDS =
  "ownerName,situsConcat,currValLand,currValImprv,currValAppraised,currValYear,prevValLand,prevValImprv,prevValAppraised,prevValYear,PROP_ID,propType,propSubType,propCategoryCode,propYear,imprvMainArea,imprvYearBuilt,imprvClassCd,landSizeAcres,landSizeSqft";

async function queryCollin(address: string, mode: QueryMode = "exact"): Promise<CadRecord[]> {
  let features: Array<{ attributes: Record<string, string | number | null> }>;
  if (mode === "name") {
    const nq = parseNameQuery(address);
    if (!nq?.name) return [];
    features = await ownerNameFeatures(COLLIN_URL, "ownerName", COLLIN_OUT_FIELDS, nq.name, NEARBY_LIMIT);
  } else {
    const parsed = parseAddressForQuery(address, mode);
    if (!parsed) return [];
    const core = coreStreetName(parsed.street);
    features =
      mode === "nearby"
        ? await nearbyFeaturesWithFallback(
            COLLIN_URL,
            "situsConcat",
            parsed.street,
            COLLIN_OUT_FIELDS,
            NEARBY_LIMIT,
          )
        : await fetchFeatures(
            `${COLLIN_URL}?where=${encodeURIComponent(singleFieldWhere("situsConcat", parsed.house, core))}` +
              `&outFields=${COLLIN_OUT_FIELDS}&resultRecordCount=${MULTI_CANDIDATE_LIMIT}&returnGeometry=false&f=json`,
          );
  }
  return features.map(({ attributes: attrs }) =>
    applyStructureDetail(
      {
        ownerName: (attrs.ownerName as string) ?? null,
        propertyAddress: (attrs.situsConcat as string) ?? address,
        cad: "Collin Central Appraisal District",
        accountNumber: attrs.PROP_ID != null ? String(attrs.PROP_ID) : null,
        // `propType` is always null on this service despite the name — the real
        // classification lives in propSubType (plain text, e.g. "Commercial") and
        // propCategoryCode (the Comptroller's standard state code, e.g. "F1").
        // Discovered 2026-08-04 chasing a real Frisco house that fell through to
        // the generic "unknown category" fallback.
        propertyType:
          (attrs.propSubType as string)?.trim() ||
          (attrs.propCategoryCode as string)?.trim() ||
          (attrs.propType as string)?.trim() ||
          null,
        // Collin's currVal* fields go null county-wide while a new tax year's
        // reappraisal is still "InProgress" — confirmed 2026-08-28 sampling 30
        // real commercial parcels: all 30 had currValYear/currValAppraised null,
        // every one of them mid-reappraisal for 2027, with a real, fully
        // populated PREVIOUS year (2026) value set sitting right next to it
        // unused. Without this fallback every single Collin property in this app
        // shows blank land/improvement/total and a $0 estimated savings — not a
        // rare edge case, the current default state for the entire county. Falls
        // back to prevVal* (Collin's last finalized, real, published assessment)
        // rather than showing nothing; taxYear falls back alongside it so the
        // displayed year always matches whichever set of numbers is actually
        // shown, never claims the still-null new year while showing old figures.
        landValue: (attrs.currValLand as number) ?? (attrs.prevValLand as number) ?? null,
        improvementValue: (attrs.currValImprv as number) ?? (attrs.prevValImprv as number) ?? null,
        totalValue:
          (attrs.currValAppraised as number) ?? (attrs.prevValAppraised as number) ?? null,
        taxYear:
          (attrs.currValYear as number) ??
          (attrs.prevValYear as number) ??
          (attrs.propYear as number) ??
          null,
      },
      attrs,
    ),
  );
}

const MONTGOMERY_URL =
  "https://services1.arcgis.com/PRoAPGnMSUqvTrzq/arcgis/rest/services/Tax_Parcel_view/FeatureServer/0/query";
const MONTGOMERY_OUT_FIELDS =
  "ownerName,situs,legalDescription,PIN,imprvMainArea,imprvActualYearBuilt";

async function queryMontgomery(address: string, mode: QueryMode = "exact"): Promise<CadRecord[]> {
  let features: Array<{ attributes: Record<string, string | number | null> }>;
  if (mode === "name") {
    const nq = parseNameQuery(address);
    if (!nq?.name) return [];
    features = await ownerNameFeatures(
      MONTGOMERY_URL,
      "ownerName",
      MONTGOMERY_OUT_FIELDS,
      nq.name,
      NEARBY_LIMIT,
    );
  } else {
    const parsed = parseAddressForQuery(address, mode);
    if (!parsed) return [];
    const core = coreStreetName(parsed.street);
    features =
      mode === "nearby"
        ? await nearbyFeaturesWithFallback(
            MONTGOMERY_URL,
            "situs",
            parsed.street,
            MONTGOMERY_OUT_FIELDS,
            NEARBY_LIMIT,
          )
        : await fetchFeatures(
            `${MONTGOMERY_URL}?where=${encodeURIComponent(singleFieldWhere("situs", parsed.house, core))}` +
              `&outFields=${MONTGOMERY_OUT_FIELDS}&resultRecordCount=${MULTI_CANDIDATE_LIMIT}&returnGeometry=false&f=json`,
          );
  }
  return features.map(({ attributes: attrs }) =>
    applyStructureDetail(
      {
        ownerName: (attrs.ownerName as string) ?? null,
        propertyAddress: (attrs.situs as string) ?? address,
        cad: "Montgomery Central Appraisal District",
        accountNumber: attrs.PIN != null ? String(attrs.PIN) : null,
        propertyType: "Not published by county",
        landValue: null,
        improvementValue: null,
        totalValue: null,
        taxYear: null,
      },
      attrs,
    ),
  );
}

function parseMoneyField(v: string | number | null): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseInt(v.trim(), 10);
  return Number.isFinite(n) ? n : null;
}

// Pulls a parcel acreage out of a CAD legal-description string when there is no
// dedicated acreage field to read — e.g. Dallas "... ACS 1.671 ...", the BIS
// counties' "ACRES 1.024", "12.5 AC". Deliberately narrow: a number immediately
// beside the token AC/ACS/ACRE(S), 0 < n < 100000, first hit wins. "\bAC" never
// fires inside "VAC"/"VACANT" (the V is a word char, so there's no boundary
// before "AC"), which keeps "VAC ST"/"VAC ALLEY" fragments from matching.
function acresFromLegalText(legal: string | null | undefined): number | null {
  if (!legal) return null;
  const m =
    legal.match(/\bAC(?:RE)?S?\.?\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)/i) ??
    legal.match(/([0-9]+(?:\.[0-9]+)?)\s*AC(?:RE)?S?\b/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 && n < 100000 ? n : null;
}

const DENTON_URL = "https://gis.dentoncounty.gov/arcgis/rest/services/Parcels_FC/MapServer/0/query";
const DENTON_OUT_FIELDS =
  "name,situs_full_address,landHSValue,landNHSValue,improvementValue,ownerMarketValue,pid,pYear,propType,stateCodes,imprvMainArea,imprvActualYearBuilt,imprvClasses,legalAcreage,land_sqft";

async function queryDenton(address: string, mode: QueryMode = "exact"): Promise<CadRecord[]> {
  // Denton County's own GIS (gis.dentoncounty.gov) — full ~382k-parcel countywide
  // dataset, not the earlier "TAD_Parcels" service this used to point at, which
  // turned out (discovered 2026-07-24, chasing a "not found" report for a real
  // Denton address) to be a single ~234-parcel subdivision extract, not county-wide
  // coverage. See texas-cad-data-sources memory for the full story.
  let features: Array<{ attributes: Record<string, string | number | null> }>;
  if (mode === "name") {
    const nq = parseNameQuery(address);
    if (!nq?.name) return [];
    features = await ownerNameFeatures(DENTON_URL, "name", DENTON_OUT_FIELDS, nq.name, NEARBY_LIMIT);
  } else {
    const parsed = parseAddressForQuery(address, mode);
    if (!parsed) return [];
    const core = coreStreetName(parsed.street);
    features =
      mode === "nearby"
        ? await nearbyFeaturesWithFallback(
            DENTON_URL,
            "situs_full_address",
            parsed.street,
            DENTON_OUT_FIELDS,
            NEARBY_LIMIT,
          )
        : await fetchFeatures(
            `${DENTON_URL}?where=${encodeURIComponent(singleFieldWhere("situs_full_address", parsed.house, core))}` +
              `&outFields=${DENTON_OUT_FIELDS}&resultRecordCount=${MULTI_CANDIDATE_LIMIT}&returnGeometry=false&f=json`,
          );
  }
  return features.map(({ attributes: attrs }) => {
    const situsAddr = (attrs.situs_full_address as string | null)?.trim();
    return applyStructureDetail(
      {
        ownerName: (attrs.name as string)?.trim() || null,
        propertyAddress: situsAddr || address,
        cad: "Denton Central Appraisal District",
        accountNumber: attrs.pid != null ? String(attrs.pid) : null,
        // `propType` here is always the generic "R" (real property) vs personal
        // property — it doesn't distinguish residential from commercial at all.
        // `stateCodes` carries the actual Texas Comptroller state property-type
        // code (e.g. "A1" single-family, "B1" multifamily, "F1" commercial —
        // the same codes the Comptroller's own ratio-study reports use), which
        // classifyPropertyCategory() knows how to read. Discovered 2026-08-04
        // chasing a real Frisco house that fell through to the generic
        // "unknown category" fallback.
        propertyType:
          (attrs.stateCodes as string)?.trim() || (attrs.propType as string)?.trim() || null,
        landValue:
          (parseMoneyField(attrs.landHSValue) ?? 0) + (parseMoneyField(attrs.landNHSValue) ?? 0),
        improvementValue: parseMoneyField(attrs.improvementValue),
        totalValue: parseMoneyField(attrs.ownerMarketValue),
        taxYear: attrs.pYear != null ? parseInt(String(attrs.pYear), 10) : null,
      },
      attrs,
    );
  });
}

const HARRIS_URL = "https://www.gis.hctx.net/arcgis/rest/services/HCAD/Parcels/MapServer/0/query";
const HARRIS_OUT_FIELDS =
  "owner_name_1,site_str_num,site_str_pfx,site_str_name,site_str_sfx,site_city,land_value,bld_value,total_appraised_val,acct_num,tax_year,land_sqft,acreage_1";

async function queryHarris(address: string, mode: QueryMode = "exact"): Promise<CadRecord[]> {
  let features: Array<{ attributes: Record<string, string | number | null> }>;
  if (mode === "name") {
    const nq = parseNameQuery(address);
    if (!nq?.name) return [];
    features = await ownerNameFeatures(HARRIS_URL, "owner_name_1", HARRIS_OUT_FIELDS, nq.name, NEARBY_LIMIT);
  } else {
    const parsed = parseAddressForQuery(address, mode);
    if (!parsed) return [];
    const core = coreStreetName(parsed.street);
    const streetClause = coreClauseOr("site_str_name", core);
    const where =
      mode === "nearby"
        ? `(${streetClause})`
        : `site_str_num = ${parsed.house} AND (${streetClause})`;
    const url =
      `${HARRIS_URL}?where=${encodeURIComponent(where)}` +
      `&outFields=${HARRIS_OUT_FIELDS}` +
      `&resultRecordCount=${mode === "nearby" ? NEARBY_LIMIT : MULTI_CANDIDATE_LIMIT}` +
      "&returnGeometry=false&f=json";
    features = await fetchFeatures(url);
  }
  // site_str_pfx (the directional — "S ", "N ", etc.) was silently missing from the
  // returned address entirely until 2026-07-26 — found sampling real Harris
  // addresses (4036 S Braeswood Blvd came back as "4036 Braeswood Blvd", dropping
  // the "S"). The match itself was never broken (the WHERE clause never filtered on
  // prefix), only the displayed address was wrong.
  return features.map(({ attributes: attrs }) => {
    const streetParts = [
      attrs.site_str_num,
      attrs.site_str_pfx,
      attrs.site_str_name,
      attrs.site_str_sfx,
    ]
      .map((v) => (typeof v === "string" ? v.trim() : v))
      .filter(Boolean)
      .join(" ");
    // Found live 2026-08-25 (the same class of bug already fixed for Tarrant/
    // Travis — see the long comment in Deno.serve): falling back to the
    // USER'S OWN typed city when site_city is missing made a match against a
    // totally different, unrelated real city look confirmed just because the
    // displayed address happened to echo back whatever the user typed. Left
    // bare (no city) when site_city is genuinely absent — Deno.serve appends
    // the user's typed city centrally, but only AFTER a record is chosen, so
    // it can never influence which record gets chosen in the first place.
    return applyStructureDetail(
      {
        ownerName: (attrs.owner_name_1 as string) ?? null,
        propertyAddress: streetParts
          ? attrs.site_city
            ? `${streetParts}, ${attrs.site_city}`
            : streetParts
          : address,
        cad: "Harris Central Appraisal District",
        accountNumber: (attrs.acct_num as string) ?? null,
        propertyType: null,
        landValue: parseMoneyField(attrs.land_value),
        improvementValue: parseMoneyField(attrs.bld_value),
        totalValue: parseMoneyField(attrs.total_appraised_val),
        taxYear: attrs.tax_year != null ? parseInt(String(attrs.tax_year), 10) : null,
      },
      attrs,
    );
  });
}

// Tarrant's parcel layer DOES have a `City` field — it just doesn't look like one:
// it's a 3-digit jurisdiction code ("026"), not a name, so it was missed entirely
// in the earlier fix (which assumed "no city field at all" and just left
// propertyAddress bare). Large-scale sampling on 2026-07-26 showed Tarrant losing
// a disproportionate share of city-based tiebreaks against common street names
// (Main/Oak/Elm) purely because it looked cityless. Codes resolved via TAD's own
// `OD_City` reference layer (CITY_TDC -> CITY_NAME), fetched once and hardcoded
// here since it's a small, stable ~40-row government reference table, not worth a
// second network round-trip per lookup. "000" (unincorporated county land) and any
// unrecognized code map to null — no fake city rather than guessing.
const TARRANT_CITY_CODES: Record<string, string> = {
  "001": "Azle",
  "002": "Bedford",
  "003": "Benbrook",
  "004": "Blue Mound",
  "005": "Colleyville",
  "006": "Crowley",
  "007": "Dalworthington Gardens",
  "008": "Edgecliff Village",
  "009": "Everman",
  "010": "Forest Hill",
  "011": "Grapevine",
  "013": "Keller",
  "014": "Kennedale",
  "015": "Lakeside",
  "016": "Lake Worth",
  "017": "Mansfield",
  "018": "North Richland Hills",
  "019": "Pantego",
  "020": "Richland Hills",
  "021": "Saginaw",
  "022": "Southlake",
  "023": "Westover Hills",
  "024": "Arlington",
  "025": "Euless",
  "026": "Fort Worth",
  "027": "Haltom City",
  "028": "Hurst",
  "029": "River Oaks",
  "030": "White Settlement",
  "031": "Watauga",
  "032": "Westworth Village",
  "033": "Burleson",
  "034": "Haslet",
  "036": "Pelican Bay",
  "037": "Westlake",
  "038": "Grand Prairie",
  "039": "Sansom Park",
  "041": "Reno",
  "042": "Flower Mound",
  "043": "Roanoke",
  "044": "Trophy Club",
};

const TARRANT_URL =
  "https://tad.newedgeservices.com/arcgis/rest/services/OD_TAD/OD_ParcelView/MapServer/0/query";
const TARRANT_OUT_FIELDS =
  "Owner_Name,Situs_Addr,City,Land_Value,Improvemen,Total_Valu,Appraised_,Account_Nu,Property_C,Living_Are,Year_Built,Land_Acres,Land_SqFt";

async function queryTarrant(address: string, mode: QueryMode = "exact"): Promise<CadRecord[]> {
  // This endpoint doesn't support resultRecordCount ("Pagination is not
  // supported") — always returns every matching row unbounded, sliced
  // client-side below (limit: null tells nearbyFeaturesWithFallback/
  // ownerNameFeatures the same — omit the param rather than send one this
  // backend rejects). Tarrant's own city is a numeric jurisdiction code (see
  // TARRANT_CITY_CODES), decoded for display below AFTER fetching — not
  // usable as a SQL text filter, same reason it's never one for address
  // search's own nearby/exact modes either.
  let features: Array<{ attributes: Record<string, string | number | null> }>;
  if (mode === "name") {
    const nq = parseNameQuery(address);
    if (!nq?.name) return [];
    features = await ownerNameFeatures(TARRANT_URL, "Owner_Name", TARRANT_OUT_FIELDS, nq.name, null);
  } else {
    const parsed = parseAddressForQuery(address, mode);
    if (!parsed) return [];
    const core = coreStreetName(parsed.street);
    features =
      mode === "nearby"
        ? await nearbyFeaturesWithFallback(
            TARRANT_URL,
            "Situs_Addr",
            parsed.street,
            TARRANT_OUT_FIELDS,
            null,
          )
        : await fetchFeatures(
            `${TARRANT_URL}?where=${encodeURIComponent(singleFieldWhere("Situs_Addr", parsed.house, core))}` +
              `&outFields=${TARRANT_OUT_FIELDS}&returnGeometry=false&f=json`,
          );
  }
  return features
    .slice(0, mode === "nearby" ? NEARBY_LIMIT : MULTI_CANDIDATE_LIMIT)
    .map(({ attributes: attrs }) => {
      const situsAddr = (attrs.Situs_Addr as string | null)?.trim();
      const cityName = TARRANT_CITY_CODES[(attrs.City as string)?.trim()] ?? null;
      return applyStructureDetail(
        {
          ownerName: (attrs.Owner_Name as string) ?? null,
          propertyAddress: situsAddr
            ? cityName
              ? `${situsAddr}, ${cityName}`
              : situsAddr
            : address,
          cad: "Tarrant Appraisal District",
          accountNumber: (attrs.Account_Nu as string)?.trim() || null,
          propertyType: (attrs.Property_C as string)?.trim() || null,
          landValue: parseMoneyField(attrs.Land_Value),
          improvementValue: parseMoneyField(attrs.Improvemen),
          totalValue: parseMoneyField(attrs.Appraised_ ?? attrs.Total_Valu),
          taxYear: null,
        },
        attrs,
      );
    });
}

const FORT_BEND_URL =
  "https://services2.arcgis.com/D4saGHECICkCeoJm/arcgis/rest/services/FBCAD_Public_Data/FeatureServer/0/query";
const FORT_BEND_OUT_FIELDS =
  "OWNERNAME,SITUS,LANDVALUE,IMPVALUE,TOTALVALUE,PROPNUMBER,Building_Class,TOTSQFTLVG,YEARBUILT,LANDSIZEAC,LANDSIZEFT";

async function queryFortBend(address: string, mode: QueryMode = "exact"): Promise<CadRecord[]> {
  let features: Array<{ attributes: Record<string, string | number | null> }>;
  if (mode === "name") {
    const nq = parseNameQuery(address);
    if (!nq?.name) return [];
    features = await ownerNameFeatures(
      FORT_BEND_URL,
      "OWNERNAME",
      FORT_BEND_OUT_FIELDS,
      nq.name,
      NEARBY_LIMIT,
    );
  } else {
    const parsed = parseAddressForQuery(address, mode);
    if (!parsed) return [];
    const core = coreStreetName(parsed.street);
    features =
      mode === "nearby"
        ? await nearbyFeaturesWithFallback(
            FORT_BEND_URL,
            "SITUS",
            parsed.street,
            FORT_BEND_OUT_FIELDS,
            NEARBY_LIMIT,
          )
        : await fetchFeatures(
            `${FORT_BEND_URL}?where=${encodeURIComponent(singleFieldWhere("SITUS", parsed.house, core))}` +
              `&outFields=${FORT_BEND_OUT_FIELDS}&resultRecordCount=${MULTI_CANDIDATE_LIMIT}&returnGeometry=false&f=json`,
          );
  }
  return features.map(({ attributes: attrs }) =>
    applyStructureDetail(
      {
        ownerName: (attrs.OWNERNAME as string) ?? null,
        propertyAddress: (attrs.SITUS as string)?.trim() || address,
        cad: "Fort Bend Central Appraisal District",
        accountNumber: (attrs.PROPNUMBER as string) ?? null,
        propertyType: (attrs.Building_Class as string) ?? null,
        landValue: parseMoneyField(attrs.LANDVALUE),
        improvementValue: parseMoneyField(attrs.IMPVALUE),
        totalValue: parseMoneyField(attrs.TOTALVALUE),
        taxYear: null,
      },
      attrs,
    ),
  );
}

const WILLIAMSON_URL =
  "https://services1.arcgis.com/Xff0bbfp6vwIWmlU/arcgis/rest/services/WCAD_Tax_Parcels/FeatureServer/0/query";
const WILLIAMSON_OUT_FIELDS =
  "OWNERNME1,SITEADDRESS,LNDVALUE,CNTASSDVAL,PARCELID,CLASSDSCRP,BLDGAREA,RESYRBLT,STRCLASS,TotAcreDeed";

async function queryWilliamson(address: string, mode: QueryMode = "exact"): Promise<CadRecord[]> {
  let features: Array<{ attributes: Record<string, string | number | null> }>;
  if (mode === "name") {
    const nq = parseNameQuery(address);
    if (!nq?.name) return [];
    features = await ownerNameFeatures(
      WILLIAMSON_URL,
      "OWNERNME1",
      WILLIAMSON_OUT_FIELDS,
      nq.name,
      NEARBY_LIMIT,
    );
  } else {
    const parsed = parseAddressForQuery(address, mode);
    if (!parsed) return [];
    const core = coreStreetName(parsed.street);
    features =
      mode === "nearby"
        ? await nearbyFeaturesWithFallback(
            WILLIAMSON_URL,
            "SITEADDRESS",
            parsed.street,
            WILLIAMSON_OUT_FIELDS,
            NEARBY_LIMIT,
          )
        : await fetchFeatures(
            `${WILLIAMSON_URL}?where=${encodeURIComponent(singleFieldWhere("SITEADDRESS", parsed.house, core))}` +
              `&outFields=${WILLIAMSON_OUT_FIELDS}&resultRecordCount=${MULTI_CANDIDATE_LIMIT}&returnGeometry=false&f=json`,
          );
  }
  return features.map(({ attributes: attrs }) =>
    applyStructureDetail(
      {
        ownerName: (attrs.OWNERNME1 as string) ?? null,
        propertyAddress: (attrs.SITEADDRESS as string)?.trim() || address,
        cad: "Williamson Central Appraisal District",
        accountNumber: (attrs.PARCELID as string) ?? null,
        propertyType: (attrs.CLASSDSCRP as string) ?? null,
        landValue: parseMoneyField(attrs.LNDVALUE),
        improvementValue: null,
        totalValue: parseMoneyField(attrs.CNTASSDVAL),
        taxYear: null,
      },
      attrs,
    ),
  );
}

const GRAYSON_URL =
  "https://services1.arcgis.com/EVxyUkKpll765a5X/arcgis/rest/services/Grayson_Appraisal_Parcel_Map_WFL1/FeatureServer/13/query";
const GRAYSON_OUT_FIELDS =
  "OwnerName,SitusNumber,SitusStreetPrefix,SitusStreet,SitusStreetSufix,SitusCity,LandValue,ImprovementValue,MarketValue,PropertyNumber,Year,LegalAcreage";

async function queryGrayson(address: string, mode: QueryMode = "exact"): Promise<CadRecord[]> {
  let features: Array<{ attributes: Record<string, string | number | null> }>;
  if (mode === "name") {
    const nq = parseNameQuery(address);
    if (!nq?.name) return [];
    features = await ownerNameFeatures(
      GRAYSON_URL,
      "OwnerName",
      GRAYSON_OUT_FIELDS,
      nq.name,
      NEARBY_LIMIT,
    );
  } else {
    const parsed = parseAddressForQuery(address, mode);
    if (!parsed) return [];
    const core = coreStreetName(parsed.street);
    const streetClause = coreClauseOr("SitusStreet", core);
    const where =
      mode === "nearby"
        ? `(${streetClause})`
        : `SitusNumber = '${parsed.house}' AND (${streetClause})`;
    const url =
      `${GRAYSON_URL}?where=${encodeURIComponent(where)}` +
      `&outFields=${GRAYSON_OUT_FIELDS}` +
      `&resultRecordCount=${mode === "nearby" ? NEARBY_LIMIT : MULTI_CANDIDATE_LIMIT}` +
      "&returnGeometry=false&f=json";
    features = await fetchFeatures(url);
  }
  // SitusStreetPrefix (the directional) was missing from outFields the same way
  // Harris's site_str_pfx was — see the comment in queryHarris.
  return features.map(({ attributes: attrs }) => {
    const streetParts = [
      attrs.SitusNumber,
      attrs.SitusStreetPrefix,
      attrs.SitusStreet,
      attrs.SitusStreetSufix,
    ]
      .map((v) => (typeof v === "string" ? v.trim() : v))
      .filter(Boolean)
      .join(" ");
    // Same fix as queryHarris above, found via the same live report — echoing
    // the user's own typed city when SitusCity is null made an unrelated real
    // Grayson parcel (confirmed: two Sherman-area lots, ~90 miles from the
    // Forney address that surfaced this) falsely look like a match.
    return applyStructureDetail(
      {
        ownerName: (attrs.OwnerName as string) ?? null,
        propertyAddress: streetParts
          ? attrs.SitusCity
            ? `${streetParts}, ${attrs.SitusCity}`
            : streetParts
          : address,
        cad: "Grayson Central Appraisal District",
        accountNumber: attrs.PropertyNumber != null ? String(attrs.PropertyNumber) : null,
        propertyType: null,
        landValue: parseMoneyField(attrs.LandValue),
        improvementValue: parseMoneyField(attrs.ImprovementValue),
        totalValue: parseMoneyField(attrs.MarketValue),
        taxYear: attrs.Year != null ? parseInt(String(attrs.Year), 10) : null,
      },
      attrs,
    );
  });
}

async function queryTravis(address: string, mode: QueryMode = "exact"): Promise<CadRecord[]> {
  const parsed = parseAddressForQuery(address, mode);
  if (!parsed) return [];
  const core = coreStreetName(parsed.street);
  const streetClause = coreClauseOr("situs_street", core);
  const where =
    mode === "nearby" ? `(${streetClause})` : `situs_num = '${parsed.house}' AND (${streetClause})`;
  const url =
    "https://gis.traviscountytx.gov/server1/rest/services/Boundaries_and_Jurisdictions/TCAD_public/MapServer/0/query" +
    `?where=${encodeURIComponent(where)}` +
    "&outFields=situs_num,situs_street_prefx,situs_street,situs_street_suffix,situs_city,PROP_ID,tcad_acres" +
    `&resultRecordCount=${mode === "nearby" ? NEARBY_LIMIT : MULTI_CANDIDATE_LIMIT}` +
    "&returnGeometry=false&f=json";

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Travis CAD query failed: ${res.status}`);
  const json = (await res.json()) as {
    features?: Array<{ attributes: Record<string, string | number | null> }>;
  };
  return (json.features ?? []).map(({ attributes: attrs }) => {
    const streetParts = [
      attrs.situs_num,
      attrs.situs_street_prefx,
      attrs.situs_street,
      attrs.situs_street_suffix,
    ]
      .filter(Boolean)
      .join(" ");
    return applyStructureDetail(
      {
        // Travis's public source has no owner name or value fields at all — real
        // address, honestly null everything else, rather than fabricating a match.
        // situs_city is often actually null in this dataset too — when it is,
        // propertyAddress is left without a city rather than echoing the user's own
        // typed city back (same tiebreak-corruption reasoning as queryTarrant, above).
        ownerName: null,
        propertyAddress: streetParts
          ? attrs.situs_city
            ? `${streetParts}, ${attrs.situs_city}`
            : streetParts
          : address,
        cad: "Travis Central Appraisal District",
        accountNumber: attrs.PROP_ID != null ? String(attrs.PROP_ID) : null,
        propertyType: "Not published by county",
        landValue: null,
        improvementValue: null,
        totalValue: null,
        taxYear: null,
      },
      attrs,
    );
  });
}

// BCAD's own domain (maps.bcad.org) DOES work for targeted queries — the earlier
// "Failed to execute query" error (see comment below) was caused by using bare
// column names against this service's underlying SQL join, which requires the
// fully-qualified `table.column` form. Discovered 2026-07-24 chasing a real address
// (19730 Bulverde Rd) that the third-party mirror below simply didn't have —
// BCAD's own system has it, with current (2026) values, so it's the primary source
// now. No land/improvement split is published on this view (only a combined
// `appraised_val`), so those two fields are honestly null here rather than
// backfilled from the (stale, incomplete) mirror.
function parseDollarString(v: string | number | null): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const n = Number(v.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

const BCAD_FIELDS = {
  owner: "PAMaps.dbo.web_map_property.owner_name",
  situs: "PAMaps.dbo.web_map_property.situs",
  appraisedVal: "PAMaps.dbo.web_map_property.appraised_val",
  taxYear: "PAMaps.dbo.web_map_property.prop_val_yr",
  propType: "PAMaps.dbo.web_map_property.prop_type_desc",
  propId: "PAMaps.DBO.ParcelFabric_Parcels.PROP_ID",
};

const BEXAR_URL = "https://maps.bcad.org/arcgis/rest/services/PAMapSearch/MapServer/6/query";
const BEXAR_OUT_FIELDS = Object.values(BCAD_FIELDS).join(",");

async function queryBexar(address: string, mode: QueryMode = "exact"): Promise<CadRecord[]> {
  let features: Array<{ attributes: Record<string, string | number | null> }>;
  if (mode === "name") {
    const nq = parseNameQuery(address);
    if (!nq?.name) return [];
    features = await ownerNameFeatures(
      BEXAR_URL,
      BCAD_FIELDS.owner,
      BEXAR_OUT_FIELDS,
      nq.name,
      NEARBY_LIMIT,
    );
  } else {
    const parsed = parseAddressForQuery(address, mode);
    if (!parsed) return [];
    const core = coreStreetName(parsed.street);
    features =
      mode === "nearby"
        ? await nearbyFeaturesWithFallback(
            BEXAR_URL,
            BCAD_FIELDS.situs,
            parsed.street,
            BEXAR_OUT_FIELDS,
            NEARBY_LIMIT,
          )
        : await fetchFeatures(
            `${BEXAR_URL}?where=${encodeURIComponent(singleFieldWhere(BCAD_FIELDS.situs, parsed.house, core))}` +
              `&outFields=${BEXAR_OUT_FIELDS}&resultRecordCount=${MULTI_CANDIDATE_LIMIT}&returnGeometry=false&f=json`,
          );
  }
  return features.map(({ attributes: attrs }) => ({
    ownerName: (attrs[BCAD_FIELDS.owner] as string)?.trim() || null,
    propertyAddress: (attrs[BCAD_FIELDS.situs] as string)?.trim() || address,
    cad: "Bexar Appraisal District",
    accountNumber: attrs[BCAD_FIELDS.propId] != null ? String(attrs[BCAD_FIELDS.propId]) : null,
    propertyType: (attrs[BCAD_FIELDS.propType] as string)?.trim() || null,
    landValue: null,
    improvementValue: null,
    totalValue: parseDollarString(attrs[BCAD_FIELDS.appraisedVal]),
    taxYear: attrs[BCAD_FIELDS.taxYear] != null ? Number(attrs[BCAD_FIELDS.taxYear]) : null,
  }));
}

// Dallas County — found 2026-07-26 chasing a real address (1800 Market Place Blvd,
// Irving) that had no source at all until now. `DCAD_PARCELS`, hosted by an org
// literally named `dallascountygis` — county-official, not a third-party mirror.
// Unlike every other county here, house number and street name are already split
// into their own fields (STREET_NUM/FULL_STREET_NAME), so this query is immune to
// the whole class of directional-prefix AND false-positive-substring bugs described
// above coreStreetName — an exact `=` on STREET_NUM needs no anchoring trick at
// all. No land/improvement/market value fields exist on
// this layer at all (checked — no companion table either), so those are honestly
// null here, same pattern as Montgomery/Travis.
const DALLAS_URL =
  "https://services3.arcgis.com/zqe2kwz79KUqUvxC/arcgis/rest/services/DCAD_PARCELS/FeatureServer/0/query";
const DALLAS_OUT_FIELDS = "OWNER_NAME1,SiteAddress,PROPERTY_CITY,PROPERTY_ZIPCODE,ACCOUNT_NUM,APPRAISAL_YR";

async function queryDallas(address: string, mode: QueryMode = "exact"): Promise<CadRecord[]> {
  let features: Array<{ attributes: Record<string, string | number | null> }>;
  if (mode === "name") {
    const nq = parseNameQuery(address);
    if (!nq?.name) return [];
    features = await ownerNameFeatures(DALLAS_URL, "OWNER_NAME1", DALLAS_OUT_FIELDS, nq.name, NEARBY_LIMIT);
  } else {
    const parsed = parseAddressForQuery(address, mode);
    if (!parsed) return [];
    const core = coreStreetName(parsed.street);
    const streetClause = coreClauseOr("FULL_STREET_NAME", core);
    const where =
      mode === "nearby" ? `(${streetClause})` : `STREET_NUM=${parsed.house} AND (${streetClause})`;
    const url =
      `${DALLAS_URL}?where=${encodeURIComponent(where)}` +
      `&outFields=${DALLAS_OUT_FIELDS}` +
      `&resultRecordCount=${mode === "nearby" ? NEARBY_LIMIT : MULTI_CANDIDATE_LIMIT}` +
      "&returnGeometry=false&f=json";
    features = await fetchFeatures(url);
  }
  return features.map(({ attributes: attrs }) => {
    const site = (attrs.SiteAddress as string)?.trim();
    // Dallas disambiguates same-named cities in neighboring counties right in the
    // data — "GARLAND (DALLAS CO)", "MESQUITE (DALLAS CO)", etc. — useful for the
    // WHERE clause's own disambiguation but redundant/odd-looking in a displayed
    // address (the "Dallas Central Appraisal District" cad field already says which
    // county this is), so it's stripped here for display only.
    const city = (attrs.PROPERTY_CITY as string)?.trim().replace(/\s*\([^)]*\)\s*$/, "");
    const zip9 = attrs.PROPERTY_ZIPCODE != null ? String(attrs.PROPERTY_ZIPCODE) : null;
    const zip = zip9 && zip9.length >= 5 ? `${zip9.slice(0, 5)}-${zip9.slice(5)}` : zip9;
    const propertyAddress =
      site && city ? `${site}, ${city}, TX${zip ? ` ${zip}` : ""}` : site || address;

    return {
      ownerName: (attrs.OWNER_NAME1 as string)?.trim() || null,
      propertyAddress,
      cad: "Dallas Central Appraisal District",
      accountNumber: (attrs.ACCOUNT_NUM as string)?.trim() || null,
      propertyType: null,
      landValue: null,
      improvementValue: null,
      totalValue: null,
      taxYear: attrs.APPRAISAL_YR != null ? Number(attrs.APPRAISAL_YR) : null,
    };
  });
}

// Kaufman (Phase 7, 2026-08-29) — found chasing a real report ("601 Ridgecrest
// Rd, Forney" — Forney is in Kaufman County, which had no source here at all
// until now). Kaufman has no public ArcGIS parcel layer at all (unlike every
// county above); its only real public search surface is esearch.kaufman-cad.org,
// which — like Fort Bend and Grayson (see BIS_CONFIG_BY_CAD/fetchBisResults
// above) — runs the same "BIS Consultants" vendor platform, session-token-
// authenticated the same way Grayson's deployment is. Reuses fetchBisResults()
// directly as the PRIMARY source here (not just enrichment, unlike Fort
// Bend/Grayson's use of it) — confirmed live by driving the real search UI
// with a browser and inspecting the actual request it made, after several
// blind guesses at the request shape all failed silently (200 OK, but every
// field in the response echoed back null/zero — the server was accepting the
// request but not recognizing any of the guessed parameter names/shapes).
// The real keyword format turned out to be free-text field:value pairs
// space-separated in one string ("StreetNumber:601 StreetName:Ridgecrest"),
// not a JSON body field or URL query params the way every guess had assumed.
//
// Kaufman's response is unusually rich for a primary source — legal
// description, subdivision, geoId, and percent ownership all come back on
// the same call that finds the property at all, fields every ArcGIS-only
// county above needs a SEPARATE enrichment call for (and several counties
// can't get at all). No separate enrichBIS() call is added for Kaufman
// (deliberately not added to BIS_CONFIG_BY_CAD) since there's nothing left
// for a second call to add.
async function queryKaufman(address: string, mode: QueryMode = "exact"): Promise<CadRecord[]> {
  const parsed = parseAddressForQuery(address, mode);
  if (!parsed) return [];
  const core = coreStreetName(parsed.street);
  // "nearby" mode omits StreetNumber entirely — same street, any house
  // number — confirmed live this vendor's search engine still returns real
  // results with just a StreetName field present.
  const keywords =
    mode === "nearby" ? `StreetName:${core}` : `StreetNumber:${parsed.house} StreetName:${core}`;

  try {
    const rows = await fetchBisResults("esearch.kaufman-cad.org", true, keywords);
    return rows.slice(0, mode === "nearby" ? NEARBY_LIMIT : MULTI_CANDIDATE_LIMIT).map((r) => {
      // "propertyTypeCode" alone is a single opaque letter ("R") — not
      // useful for classifyPropertyCategory()'s commercial/residential
      // keyword matching. "neighborhoodCode" is real free text this same
      // response already carries ("RETAIL - A", confirmed live on a real
      // commercial property) that DOES match its COMMERCIAL_TYPE_KEYWORDS
      // list — preferred when present, falling back to the opaque code
      // rather than nothing.
      const neighborhoodCode = (r.neighborhoodCode as string)?.trim();
      const propertyTypeCode = (r.propertyTypeCode as string)?.trim();
      const percentOwnership =
        typeof r.percentOwnership === "string" ? r.percentOwnership.replace("%", "") : null;
      return {
        ownerName: (r.ownerName as string)?.trim() || null,
        propertyAddress: (r.address as string)?.trim() || address,
        cad: "Kaufman Central Appraisal District",
        accountNumber: r.propertyId != null ? String(r.propertyId) : null,
        propertyType: neighborhoodCode || propertyTypeCode || null,
        landValue: null,
        improvementValue: null,
        totalValue: typeof r.appraisedValue === "number" ? r.appraisedValue : null,
        taxYear: typeof r.year === "number" ? r.year : null,
        legalDescription: (r.legalDescription as string)?.trim() || null,
        subdivision: (r.subdivision as string)?.trim() || null,
        geoId: (r.geoId as string)?.trim() || null,
        ownershipPct: percentOwnership ? parseFloat(percentOwnership) : null,
      };
    });
  } catch {
    return [];
  }
}

// Nueces (Corpus Christi) — added per the Oct 2026 competitive analysis
// (Priority #5: geographic coverage is a real, named gap against both
// Ownwell's 9 states and O'Connor's 45). Found live via ArcGIS Online's own
// public item search (sharing/rest/search), not guessed — Nueces CAD's
// public map viewer (gis.bisclient.com/nuecescad) is the same BIS platform
// already used for Grayson/Kaufman/Fort Bend, but its own TLS cert has
// expired, so the usual "follow the viewer to its config" approach didn't
// work; searching ArcGIS Online's public index for "Nueces CAD parcels"
// surfaced the real, live, independently-hosted FeatureServer below
// directly. Confirmed live: real commercial parcels with populated land/
// improvement/market values, and the house-number + street-core WHERE
// clause correctly matches a real known parcel (1429 Laguna Shores Rd,
// Corpus Christi -> prop_id 200099368).
const NUECES_URL =
  "https://services6.arcgis.com/j94FvPaik4etwHFk/ArcGIS/rest/services/NuecesCADWebService/FeatureServer/0/query";
const NUECES_OUT_FIELDS =
  "file_as_name,situs_num,situs_street_prefx,situs_street,situs_street_sufix,situs_city,land_val,imprv_val,market,prop_id,geo_id,owner_tax_yr,legal_desc,abs_subdv_cd,legal_acreage";

async function queryNueces(address: string, mode: QueryMode = "exact"): Promise<CadRecord[]> {
  let features: Array<{ attributes: Record<string, string | number | null> }>;
  if (mode === "name") {
    const nq = parseNameQuery(address);
    if (!nq?.name) return [];
    features = await ownerNameFeatures(
      NUECES_URL,
      "file_as_name",
      NUECES_OUT_FIELDS,
      nq.name,
      NEARBY_LIMIT,
    );
  } else {
    const parsed = parseAddressForQuery(address, mode);
    if (!parsed) return [];
    const core = coreStreetName(parsed.street);
    const streetClause = coreClauseOr("situs_street", core);
    const where =
      mode === "nearby"
        ? `(${streetClause})`
        : `situs_num = '${parsed.house}' AND (${streetClause})`;
    const url =
      `${NUECES_URL}?where=${encodeURIComponent(where)}` +
      `&outFields=${NUECES_OUT_FIELDS}` +
      `&resultRecordCount=${mode === "nearby" ? NEARBY_LIMIT : MULTI_CANDIDATE_LIMIT}` +
      "&returnGeometry=false&f=json";
    features = await fetchFeatures(url);
  }
  // This layer's own geometry means the SAME real parcel can come back as
  // several duplicate feature rows (confirmed live: one real account
  // returned 5 times) — left as-is rather than de-duped here, since
  // Deno.serve's own distinctAccounts grouping (keyed by accountNumber)
  // already collapses exactly this case for every county, not just this one.
  return features.map(({ attributes: attrs }) => {
    const streetParts = [
      attrs.situs_num,
      attrs.situs_street_prefx,
      attrs.situs_street,
      attrs.situs_street_sufix,
    ]
      .map((v) => (typeof v === "string" ? v.trim() : v))
      .filter(Boolean)
      .join(" ");
    return applyStructureDetail(
      {
        ownerName: (attrs.file_as_name as string)?.trim() || null,
        propertyAddress: streetParts
          ? attrs.situs_city
            ? `${streetParts}, ${attrs.situs_city}`
            : streetParts
          : address,
        cad: "Nueces County Appraisal District",
        accountNumber: attrs.prop_id != null ? String(attrs.prop_id) : null,
        propertyType: null,
        landValue: parseMoneyField(attrs.land_val),
        improvementValue: parseMoneyField(attrs.imprv_val),
        totalValue: parseMoneyField(attrs.market),
        taxYear: attrs.owner_tax_yr != null ? parseInt(String(attrs.owner_tax_yr), 10) : null,
        legalDescription: (attrs.legal_desc as string)?.trim() || null,
        subdivision: (attrs.abs_subdv_cd as string)?.trim() || null,
        geoId: (attrs.geo_id as string)?.trim() || null,
      },
      attrs,
    );
  });
}

// --- Direct account-number lookup (Phase 8, 2026-09-03) --------------------
// A user who can't find their property in the address/nearby results (a
// genuinely common real case — a bare-road commercial address with no house
// number in the county's own data has several unrelated real accounts, see
// texas_cad_data_sources memory's "PINNACLE MONTESSORI FRANCHISE COMPANY on
// FM 1957" case) can instead type the account/parcel number straight off
// their own appraisal notice, plus which county it's in. This bypasses
// address parsing entirely — a single exact `field = value` match against
// the SAME real per-county source each queryX above already uses, never a
// second/different data source.
//
// Every county's ID field is filtered as `UPPER(field) = UPPER('value')`
// EXCEPT Denton and Travis, confirmed live 2026-09-03 that both specifically
// error ("Unable to complete operation") on that form against their own real
// numeric-typed ID field (pid / PROP_ID) — every other county's numeric
// field (Collin's PROP_ID, Montgomery's PIN, Travis's own situs fields
// elsewhere in this file) tolerates UPPER() fine, so this isn't a numeric-
// vs-string rule, just two specific backends' own SQL dialect being pickier.
// Those two use a plain unquoted `field = 123` instead — gated on the input
// actually being all-digits first (returns no match rather than ever
// building an unquoted clause from unvalidated input, an injection risk).
type AccountFieldMode = "quoted" | "numeric";

type ArcgisAccountConfig = {
  cad: string;
  url: string;
  idField: string;
  mode: AccountFieldMode;
  outFields: string;
  mapRow: (attrs: Record<string, string | number | null>) => CadRecord;
};

function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''");
}

const ARCGIS_ACCOUNT_LOOKUP: ArcgisAccountConfig[] = [
  {
    cad: "Collin Central Appraisal District",
    url: "https://services2.arcgis.com/uXyoacYrZTPTKD3R/ArcGIS/rest/services/CCAD_Parcel_Feature_Set/FeatureServer/4/query",
    idField: "PROP_ID",
    mode: "quoted",
    outFields:
      "ownerName,situsConcat,currValLand,currValImprv,currValAppraised,currValYear,prevValLand,prevValImprv,prevValAppraised,prevValYear,PROP_ID,propType,propSubType,propCategoryCode,propYear",
    mapRow: (attrs) => ({
      ownerName: (attrs.ownerName as string) ?? null,
      propertyAddress: (attrs.situsConcat as string) ?? "",
      cad: "Collin Central Appraisal District",
      accountNumber: attrs.PROP_ID != null ? String(attrs.PROP_ID) : null,
      propertyType:
        (attrs.propSubType as string)?.trim() ||
        (attrs.propCategoryCode as string)?.trim() ||
        (attrs.propType as string)?.trim() ||
        null,
      landValue: (attrs.currValLand as number) ?? (attrs.prevValLand as number) ?? null,
      improvementValue: (attrs.currValImprv as number) ?? (attrs.prevValImprv as number) ?? null,
      totalValue: (attrs.currValAppraised as number) ?? (attrs.prevValAppraised as number) ?? null,
      taxYear:
        (attrs.currValYear as number) ??
        (attrs.prevValYear as number) ??
        (attrs.propYear as number) ??
        null,
    }),
  },
  {
    cad: "Montgomery Central Appraisal District",
    url: "https://services1.arcgis.com/PRoAPGnMSUqvTrzq/arcgis/rest/services/Tax_Parcel_view/FeatureServer/0/query",
    idField: "PIN",
    mode: "quoted",
    outFields: "ownerName,situs,legalDescription,PIN",
    mapRow: (attrs) => ({
      ownerName: (attrs.ownerName as string) ?? null,
      propertyAddress: (attrs.situs as string) ?? "",
      cad: "Montgomery Central Appraisal District",
      accountNumber: attrs.PIN != null ? String(attrs.PIN) : null,
      propertyType: "Not published by county",
      landValue: null,
      improvementValue: null,
      totalValue: null,
      taxYear: null,
    }),
  },
  {
    cad: "Denton Central Appraisal District",
    url: "https://gis.dentoncounty.gov/arcgis/rest/services/Parcels_FC/MapServer/0/query",
    idField: "pid",
    mode: "numeric",
    outFields:
      "name,situs_full_address,landHSValue,landNHSValue,improvementValue,ownerMarketValue,pid,pYear,propType,stateCodes",
    mapRow: (attrs) => ({
      ownerName: (attrs.name as string)?.trim() || null,
      propertyAddress: (attrs.situs_full_address as string | null)?.trim() || "",
      cad: "Denton Central Appraisal District",
      accountNumber: attrs.pid != null ? String(attrs.pid) : null,
      propertyType:
        (attrs.stateCodes as string)?.trim() || (attrs.propType as string)?.trim() || null,
      landValue:
        (parseMoneyField(attrs.landHSValue) ?? 0) + (parseMoneyField(attrs.landNHSValue) ?? 0),
      improvementValue: parseMoneyField(attrs.improvementValue),
      totalValue: parseMoneyField(attrs.ownerMarketValue),
      taxYear: attrs.pYear != null ? parseInt(String(attrs.pYear), 10) : null,
    }),
  },
  {
    cad: "Harris Central Appraisal District",
    url: "https://www.gis.hctx.net/arcgis/rest/services/HCAD/Parcels/MapServer/0/query",
    idField: "acct_num",
    mode: "quoted",
    outFields:
      "owner_name_1,site_str_num,site_str_pfx,site_str_name,site_str_sfx,site_city,land_value,bld_value,total_appraised_val,acct_num,tax_year",
    mapRow: (attrs) => {
      const streetParts = [
        attrs.site_str_num,
        attrs.site_str_pfx,
        attrs.site_str_name,
        attrs.site_str_sfx,
      ]
        .map((v) => (typeof v === "string" ? v.trim() : v))
        .filter(Boolean)
        .join(" ");
      return {
        ownerName: (attrs.owner_name_1 as string) ?? null,
        propertyAddress: streetParts
          ? attrs.site_city
            ? `${streetParts}, ${attrs.site_city}`
            : streetParts
          : "",
        cad: "Harris Central Appraisal District",
        accountNumber: (attrs.acct_num as string) ?? null,
        propertyType: null,
        landValue: parseMoneyField(attrs.land_value),
        improvementValue: parseMoneyField(attrs.bld_value),
        totalValue: parseMoneyField(attrs.total_appraised_val),
        taxYear: attrs.tax_year != null ? parseInt(String(attrs.tax_year), 10) : null,
      };
    },
  },
  {
    cad: "Tarrant Appraisal District",
    url: "https://tad.newedgeservices.com/arcgis/rest/services/OD_TAD/OD_ParcelView/MapServer/0/query",
    idField: "Account_Nu",
    mode: "quoted",
    outFields:
      "Owner_Name,Situs_Addr,City,Land_Value,Improvemen,Total_Valu,Appraised_,Account_Nu,Property_C",
    mapRow: (attrs) => {
      const situsAddr = (attrs.Situs_Addr as string | null)?.trim();
      const cityName = TARRANT_CITY_CODES[(attrs.City as string)?.trim()] ?? null;
      return {
        ownerName: (attrs.Owner_Name as string) ?? null,
        propertyAddress: situsAddr ? (cityName ? `${situsAddr}, ${cityName}` : situsAddr) : "",
        cad: "Tarrant Appraisal District",
        accountNumber: (attrs.Account_Nu as string)?.trim() || null,
        propertyType: (attrs.Property_C as string)?.trim() || null,
        landValue: parseMoneyField(attrs.Land_Value),
        improvementValue: parseMoneyField(attrs.Improvemen),
        totalValue: parseMoneyField(attrs.Appraised_ ?? attrs.Total_Valu),
        taxYear: null,
      };
    },
  },
  {
    cad: "Fort Bend Central Appraisal District",
    url: "https://services2.arcgis.com/D4saGHECICkCeoJm/arcgis/rest/services/FBCAD_Public_Data/FeatureServer/0/query",
    idField: "PROPNUMBER",
    mode: "quoted",
    outFields: "OWNERNAME,SITUS,LANDVALUE,IMPVALUE,TOTALVALUE,PROPNUMBER,Building_Class",
    mapRow: (attrs) => ({
      ownerName: (attrs.OWNERNAME as string) ?? null,
      propertyAddress: (attrs.SITUS as string)?.trim() || "",
      cad: "Fort Bend Central Appraisal District",
      accountNumber: (attrs.PROPNUMBER as string) ?? null,
      propertyType: (attrs.Building_Class as string) ?? null,
      landValue: parseMoneyField(attrs.LANDVALUE),
      improvementValue: parseMoneyField(attrs.IMPVALUE),
      totalValue: parseMoneyField(attrs.TOTALVALUE),
      taxYear: null,
    }),
  },
  {
    cad: "Williamson Central Appraisal District",
    url: "https://services1.arcgis.com/Xff0bbfp6vwIWmlU/arcgis/rest/services/WCAD_Tax_Parcels/FeatureServer/0/query",
    idField: "PARCELID",
    mode: "quoted",
    outFields: "OWNERNME1,SITEADDRESS,LNDVALUE,CNTASSDVAL,PARCELID,CLASSDSCRP",
    mapRow: (attrs) => ({
      ownerName: (attrs.OWNERNME1 as string) ?? null,
      propertyAddress: (attrs.SITEADDRESS as string)?.trim() || "",
      cad: "Williamson Central Appraisal District",
      accountNumber: (attrs.PARCELID as string) ?? null,
      propertyType: (attrs.CLASSDSCRP as string) ?? null,
      landValue: parseMoneyField(attrs.LNDVALUE),
      improvementValue: null,
      totalValue: parseMoneyField(attrs.CNTASSDVAL),
      taxYear: null,
    }),
  },
  {
    cad: "Grayson Central Appraisal District",
    url: "https://services1.arcgis.com/EVxyUkKpll765a5X/arcgis/rest/services/Grayson_Appraisal_Parcel_Map_WFL1/FeatureServer/13/query",
    idField: "PropertyNumber",
    mode: "quoted",
    outFields:
      "OwnerName,SitusNumber,SitusStreetPrefix,SitusStreet,SitusStreetSufix,SitusCity,LandValue,ImprovementValue,MarketValue,PropertyNumber,Year",
    mapRow: (attrs) => {
      const streetParts = [
        attrs.SitusNumber,
        attrs.SitusStreetPrefix,
        attrs.SitusStreet,
        attrs.SitusStreetSufix,
      ]
        .map((v) => (typeof v === "string" ? v.trim() : v))
        .filter(Boolean)
        .join(" ");
      return {
        ownerName: (attrs.OwnerName as string) ?? null,
        propertyAddress: streetParts
          ? attrs.SitusCity
            ? `${streetParts}, ${attrs.SitusCity}`
            : streetParts
          : "",
        cad: "Grayson Central Appraisal District",
        accountNumber: attrs.PropertyNumber != null ? String(attrs.PropertyNumber) : null,
        propertyType: null,
        landValue: parseMoneyField(attrs.LandValue),
        improvementValue: parseMoneyField(attrs.ImprovementValue),
        totalValue: parseMoneyField(attrs.MarketValue),
        taxYear: attrs.Year != null ? parseInt(String(attrs.Year), 10) : null,
      };
    },
  },
  {
    cad: "Travis Central Appraisal District",
    url: "https://gis.traviscountytx.gov/server1/rest/services/Boundaries_and_Jurisdictions/TCAD_public/MapServer/0/query",
    idField: "PROP_ID",
    mode: "numeric",
    outFields: "situs_num,situs_street_prefx,situs_street,situs_street_suffix,situs_city,PROP_ID",
    mapRow: (attrs) => {
      const streetParts = [
        attrs.situs_num,
        attrs.situs_street_prefx,
        attrs.situs_street,
        attrs.situs_street_suffix,
      ]
        .filter(Boolean)
        .join(" ");
      return {
        ownerName: null,
        propertyAddress: streetParts
          ? attrs.situs_city
            ? `${streetParts}, ${attrs.situs_city}`
            : streetParts
          : "",
        cad: "Travis Central Appraisal District",
        accountNumber: attrs.PROP_ID != null ? String(attrs.PROP_ID) : null,
        propertyType: "Not published by county",
        landValue: null,
        improvementValue: null,
        totalValue: null,
        taxYear: null,
      };
    },
  },
  {
    cad: "Bexar Appraisal District",
    url: "https://maps.bcad.org/arcgis/rest/services/PAMapSearch/MapServer/6/query",
    idField: BCAD_FIELDS.propId,
    mode: "quoted",
    outFields: Object.values(BCAD_FIELDS).join(","),
    mapRow: (attrs) => ({
      ownerName: (attrs[BCAD_FIELDS.owner] as string)?.trim() || null,
      propertyAddress: (attrs[BCAD_FIELDS.situs] as string)?.trim() || "",
      cad: "Bexar Appraisal District",
      accountNumber: attrs[BCAD_FIELDS.propId] != null ? String(attrs[BCAD_FIELDS.propId]) : null,
      propertyType: (attrs[BCAD_FIELDS.propType] as string)?.trim() || null,
      landValue: null,
      improvementValue: null,
      totalValue: parseDollarString(attrs[BCAD_FIELDS.appraisedVal]),
      taxYear: attrs[BCAD_FIELDS.taxYear] != null ? Number(attrs[BCAD_FIELDS.taxYear]) : null,
    }),
  },
  {
    cad: "Dallas Central Appraisal District",
    url: "https://services3.arcgis.com/zqe2kwz79KUqUvxC/arcgis/rest/services/DCAD_PARCELS/FeatureServer/0/query",
    idField: "ACCOUNT_NUM",
    mode: "quoted",
    outFields: "OWNER_NAME1,SiteAddress,PROPERTY_CITY,PROPERTY_ZIPCODE,ACCOUNT_NUM,APPRAISAL_YR",
    mapRow: (attrs) => {
      const site = (attrs.SiteAddress as string)?.trim();
      const city = (attrs.PROPERTY_CITY as string)?.trim().replace(/\s*\([^)]*\)\s*$/, "");
      const zip9 = attrs.PROPERTY_ZIPCODE != null ? String(attrs.PROPERTY_ZIPCODE) : null;
      const zip = zip9 && zip9.length >= 5 ? `${zip9.slice(0, 5)}-${zip9.slice(5)}` : zip9;
      return {
        ownerName: (attrs.OWNER_NAME1 as string)?.trim() || null,
        propertyAddress: site && city ? `${site}, ${city}, TX${zip ? ` ${zip}` : ""}` : site || "",
        cad: "Dallas Central Appraisal District",
        accountNumber: (attrs.ACCOUNT_NUM as string)?.trim() || null,
        propertyType: null,
        landValue: null,
        improvementValue: null,
        totalValue: null,
        taxYear: attrs.APPRAISAL_YR != null ? Number(attrs.APPRAISAL_YR) : null,
      };
    },
  },
];

async function queryArcgisAccount(
  config: ArcgisAccountConfig,
  accountNumber: string,
): Promise<CadRecord | null> {
  let where: string;
  if (config.mode === "numeric") {
    // Only Denton and Travis (see the long comment above) — never build an
    // unquoted numeric SQL fragment from unvalidated input.
    if (!/^\d+$/.test(accountNumber)) return null;
    where = `${config.idField} = ${accountNumber}`;
  } else {
    where = `UPPER(${config.idField}) = UPPER('${escapeSqlString(accountNumber)}')`;
  }
  // Pull the county's structure / lot fields in the same query when its layer
  // has them (see STRUCTURE_FIELDS_BY_CAD) — no extra request.
  const extra = structureOutFields(config.cad);
  const url =
    `${config.url}?where=${encodeURIComponent(where)}` +
    `&outFields=${config.outFields}${extra ? `,${extra}` : ""}&returnGeometry=false&f=json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      features?: Array<{ attributes: Record<string, string | number | null> }>;
    };
    const attrs = json.features?.[0]?.attributes;
    return attrs ? applyStructureDetail(config.mapRow(attrs), attrs) : null;
  } catch {
    return null;
  }
}

// Kaufman has no ArcGIS layer at all (see queryKaufman above) — same BIS
// search endpoint, just keyed by account number instead of street/house.
async function queryKaufmanByAccount(accountNumber: string): Promise<CadRecord | null> {
  try {
    const rows = await fetchBisResults(
      "esearch.kaufman-cad.org",
      true,
      `PropertyId:${accountNumber}`,
    );
    const r = rows.find((row) => String(row.propertyId) === accountNumber) ?? rows[0];
    if (!r) return null;
    const neighborhoodCode = (r.neighborhoodCode as string)?.trim();
    const propertyTypeCode = (r.propertyTypeCode as string)?.trim();
    const percentOwnership =
      typeof r.percentOwnership === "string" ? r.percentOwnership.replace("%", "") : null;
    const legalDescription = (r.legalDescription as string)?.trim() || null;
    // BIS carries no building detail — its results only sometimes state the
    // acreage in the legal-description text (see acresFromLegalText).
    const lotSizeAcres = acresFromLegalText(legalDescription);
    return {
      ownerName: (r.ownerName as string)?.trim() || null,
      propertyAddress: (r.address as string)?.trim() || "",
      cad: "Kaufman Central Appraisal District",
      accountNumber: r.propertyId != null ? String(r.propertyId) : null,
      propertyType: neighborhoodCode || propertyTypeCode || null,
      landValue: null,
      improvementValue: null,
      totalValue: typeof r.appraisedValue === "number" ? r.appraisedValue : null,
      taxYear: typeof r.year === "number" ? r.year : null,
      legalDescription,
      subdivision: (r.subdivision as string)?.trim() || null,
      geoId: (r.geoId as string)?.trim() || null,
      ownershipPct: percentOwnership ? parseFloat(percentOwnership) : null,
      ...(lotSizeAcres != null ? { lotSizeAcres } : {}),
    };
  } catch {
    return null;
  }
}

// The single entry point intake.tsx's manual "enter account number and
// county" flow calls, via Deno.serve's `{cad, accountNumber}` request shape
// below — never invented UI text, `cad` is always one of SUPPORTED_COUNTY_NAMES'
// full names the client's own dropdown offers (see cad-record-url.ts).
async function queryByAccountNumber(cad: string, accountNumber: string): Promise<CadRecord | null> {
  const trimmed = accountNumber.trim();
  if (!trimmed) return null;
  if (cad === "Kaufman Central Appraisal District") return queryKaufmanByAccount(trimmed);
  const config = ARCGIS_ACCOUNT_LOOKUP.find((c) => c.cad === cad);
  if (!config) return null;
  const record = await queryArcgisAccount(config, trimmed);
  return record ? await enrichRecord(record) : null;
}

// --- Enrichment (Phase 5, 2026-07-27) ---------------------------------------
// Best-effort second call, made ONLY after a county's own primary query above has
// already matched a record by address. Never used to find or select a property —
// only to attach extra detail (legal description, deed history, value history,
// mailing address, protest status) that the ArcGIS parcel layers don't carry, by
// looking up the SAME property on that county's own richer public website via its
// vendor's JSON API. Enrichment failures (network error, vendor API shape change,
// no match) are swallowed and simply leave the extra fields absent — a lookup
// must never fail, and a confirm screen must never show stale/wrong enrichment,
// just because a second, non-essential vendor call didn't work this time.
//
// Four real second sources now cover 8 of the 11 counties (see
// texas_cad_vendor_landscape memory for the remaining 3 — Collin/Harris are
// bot-walled, Bexar's own second source is now also infrastructure-blocked):
//   - TrueProdigy (Denton, Montgomery, Tarrant, Travis): confirmed live 2026-07-27
//     that each county's own ArcGIS accountNumber IS that county's TrueProdigy
//     "pid" (Tarrant's needs its leading zeros stripped first).
//   - BIS Consultants (Fort Bend, Grayson): Fort Bend's ArcGIS accountNumber
//     (PROPNUMBER) matches BIS's own "geoId" field; Grayson's ArcGIS accountNumber
//     (PropertyNumber) matches BIS's own "propertyId" field instead — different
//     cross-reference key per county, both confirmed live.
//   - Williamson (Phase 6, 2026-08-11): search.wcad.org's own unauthenticated JSON
//     search API — see enrichWilliamson below.
//   - Dallas (Phase 6, 2026-08-11): dallascad.org's plain-GET account-detail pages,
//     keyed directly by the already-trusted account number — see enrichDallas
//     below, including why it doesn't need the same house-number cross-check.
//
// TrueProdigy/BIS/Williamson enrichment is keyed off the property ID or address
// already trusted from the primary match — never re-derived from the user's typed
// address — and is cross-checked against the primary match's own house number
// before merging, so a wrong cross-county ID coincidence can never silently attach
// one property's deed/value history onto a different property's screen.

const TRUEPRODIGY_OFFICE_BY_CAD: Record<string, string> = {
  "Denton Central Appraisal District": "Denton",
  "Montgomery Central Appraisal District": "Montgomery",
  "Tarrant Appraisal District": "Tarrant",
  "Travis Central Appraisal District": "Travis",
};

async function getTrueProdigyToken(office: string): Promise<string> {
  const res = await fetch(
    "https://prod-container.trueprodigyapi.com/trueprodigy/cadpublic/auth/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ office }),
    },
  );
  if (!res.ok) throw new Error(`TrueProdigy auth failed for ${office}: ${res.status}`);
  const json = (await res.json()) as { user?: { token?: string } };
  const token = json.user?.token;
  if (!token) throw new Error(`TrueProdigy auth returned no token for ${office}`);
  return token;
}

function houseNumberOf(address: string): string {
  return address.trim().match(/^\d+/)?.[0] ?? "";
}

async function enrichTrueProdigy(
  cadName: string,
  accountNumber: string,
  expectedHouseNumber: string,
): Promise<Partial<CadRecord> | null> {
  const office = TRUEPRODIGY_OFFICE_BY_CAD[cadName];
  if (!office) return null;
  const pid = parseInt(accountNumber, 10);
  if (!Number.isFinite(pid)) return null;

  try {
    const token = await getTrueProdigyToken(office);
    const headers = { "Content-Type": "application/json", Authorization: token };

    // Deeds only needs the pid + token, not the search result, so it's fetched
    // concurrently with the search call rather than after it — cuts a whole
    // network round-trip off the enrichment latency.
    const [searchRes, deedsRes] = await Promise.all([
      fetch("https://prod-container.trueprodigyapi.com/public/property/search", {
        method: "POST",
        headers,
        // The API 500s with a Python TypeError ("object of type 'int' has no
        // len()") if value isn't a string — confirmed live 2026-07-27.
        body: JSON.stringify({ pid: { operator: "=", value: String(pid) } }),
      }),
      fetch(`https://prod-container.trueprodigyapi.com/public/property/${pid}/deeds`, {
        headers: { Authorization: token },
      }),
    ]);
    if (!searchRes.ok) return null;
    const searchJson = (await searchRes.json()) as { results?: Array<Record<string, unknown>> };
    const rows = searchJson.results ?? [];
    if (rows.length === 0) return null;

    const latest = rows.reduce((a, b) => (Number(a.pYear) > Number(b.pYear) ? a : b));
    const streetNum = String(latest.streetNum ?? "").trim();
    if (streetNum && expectedHouseNumber && streetNum !== expectedHouseNumber) return null;

    const valueHistory = rows
      .map((r) => ({
        year: Number(r.pYear),
        landValue: typeof r.landValue === "number" ? r.landValue : null,
        improvementValue: typeof r.improvementValue === "number" ? r.improvementValue : null,
        marketValue: typeof r.marketValue === "number" ? r.marketValue : null,
        appraisedValue: typeof r.appraisedValue === "number" ? r.appraisedValue : null,
      }))
      .sort((a, b) => b.year - a.year);

    const deedsJson = deedsRes.ok
      ? ((await deedsRes.json()) as { results?: Array<Record<string, unknown>> })
      : {};
    const deeds = (deedsJson.results ?? []).map((d) => ({
      date: (d.deedDt as string) ?? null,
      type: (d.deedType as string) ?? null,
      description: (d.deedDescription as string) ?? null,
      seller: (d.seller as string) ?? null,
      buyer: (d.buyer as string) ?? null,
      instrumentNum: (d.instrumentNum as string) ?? null,
    }));

    const mailingLine = [latest.addrDeliveryLine, latest.addrCity, latest.addrState]
      .filter(Boolean)
      .join(", ");
    const mailingAddress = mailingLine
      ? `${mailingLine}${latest.addrZip ? " " + latest.addrZip : ""}`
      : null;

    // TrueProdigy's public property rows carry no building SF / year built /
    // class (confirmed live 2026-09-10 — no such keys, and no improvements
    // sub-endpoint), but they DO carry a real lot acreage, which Montgomery's
    // and Travis's primary ArcGIS layers are missing. Never overwrites a real
    // ArcGIS acreage (enrichRecord's spread only fills gaps that matter).
    const tpAcresRaw =
      latest.legalAcreage ?? latest.effectiveSizeAcres ?? latest.legalAcres ?? null;
    const tpAcres =
      tpAcresRaw != null && Number.isFinite(parseFloat(String(tpAcresRaw)))
        ? parseFloat(String(tpAcresRaw))
        : null;

    return {
      legalDescription: (latest.legalDescription as string) || null,
      geoId: (latest.geoID as string) || null,
      mailingAddress,
      ownershipPct: latest.ownerPct != null ? parseFloat(String(latest.ownerPct)) : null,
      valueHistory,
      deeds,
      ...(tpAcres != null && tpAcres > 0 ? { lotSizeAcres: tpAcres } : {}),
    };
  } catch {
    return null;
  }
}

// Both counties run the same "BIS Consultants" vendor software, but Fort Bend's
// deployment answers a plain GET while Grayson's requires a short-lived session
// token (minted via its own endpoint, then echoed back in both the POST body and
// the Referer header) — a lightweight CSRF-style guard confirmed live 2026-07-27
// (a bare GET or a token-less POST both 404/500 on Grayson specifically). Also,
// each county's own ArcGIS accountNumber matches a DIFFERENT BIS field: Fort
// Bend's matches BIS's "geoId", Grayson's matches BIS's "propertyId" — so
// Grayson's search keywords need a "PropertyId:" prefix to hit the right field.
const BIS_CONFIG_BY_CAD: Record<string, { host: string; sessionAuth: boolean }> = {
  "Fort Bend Central Appraisal District": { host: "esearch.fbcad.org", sessionAuth: false },
  "Grayson Central Appraisal District": { host: "esearch.graysonappraisal.org", sessionAuth: true },
};

async function fetchBisResults(
  host: string,
  sessionAuth: boolean,
  keywords: string,
): Promise<Array<Record<string, unknown>>> {
  if (!sessionAuth) {
    const res = await fetch(
      `https://${host}/search/SearchResults?keywords=${encodeURIComponent(keywords)}&isArb=false`,
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { resultsList?: Array<Record<string, unknown>> };
    return json.resultsList ?? [];
  }

  const tokenRes = await fetch(`https://${host}/search/requestSessionToken`);
  if (!tokenRes.ok) return [];
  const { searchSessionToken } = (await tokenRes.json()) as { searchSessionToken?: string };
  if (!searchSessionToken) return [];

  const encodedKeywords = encodeURIComponent(keywords);
  const res = await fetch(`https://${host}/search/SearchResults?keywords=${encodedKeywords}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `https://${host}/search/result?keywords=${encodedKeywords}&searchSessionToken=${encodeURIComponent(searchSessionToken)}`,
    },
    body: JSON.stringify({
      page: 1,
      pageSize: 25,
      isArb: false,
      recaptchaToken: "",
      searchToken: searchSessionToken,
    }),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { resultsList?: Array<Record<string, unknown>> };
  return json.resultsList ?? [];
}

async function enrichBIS(
  cadName: string,
  accountNumber: string,
  expectedHouseNumber: string,
): Promise<Partial<CadRecord> | null> {
  const config = BIS_CONFIG_BY_CAD[cadName];
  if (!config) return null;

  try {
    const keywords = config.sessionAuth ? `PropertyId:${accountNumber}` : accountNumber;
    const rows = await fetchBisResults(config.host, config.sessionAuth, keywords);
    if (rows.length === 0) return null;

    // Fort Bend's accountNumber matches BIS's own "geoId"; Grayson's matches BIS's
    // "propertyId" instead — both confirmed live, so check either field.
    const match =
      rows.find((r) => r.geoId === accountNumber || r.propertyId === accountNumber) ?? rows[0];
    const streetNum = String(match.streetNumber ?? "").trim();
    if (streetNum && expectedHouseNumber && streetNum !== expectedHouseNumber) return null;

    return {
      legalDescription: (match.legalDescription as string) || null,
      subdivision: (match.subdivision as string) || null,
      geoId: (match.geoId as string) || null,
      ownershipPct:
        match.percentOwnership != null ? parseFloat(String(match.percentOwnership)) : null,
      protestStatus: (match.status as string) || (match.arbStatus as string) || null,
      // Fort Bend-only field (see the CadRecord type comment) — captured
      // unconditionally here since it costs nothing when accountNumber
      // already equals it (Grayson/Kaufman), and getCadRecordUrl only
      // actually consumes it for Fort Bend.
      bisPropertyId: match.propertyId != null ? String(match.propertyId) : null,
    };
  } catch {
    return null;
  }
}

// Williamson (Phase 6, 2026-08-11) — search.wcad.org's own results grid calls a
// plain, unauthenticated JSON GET (no VIEWSTATE, no browser needed) that the 2026-
// 07-27 vendor-landscape investigation missed (it either didn't exist yet or wasn't
// found by that pass — this was confirmed live just now, not assumed). No per-
// property detail endpoint was found, but the search results themselves already
// carry legal description, subdivision, and a real owner mailing address (which no
// county currently returns via the ArcGIS primary match) — same value tier as the
// BIS-tier counties (Fort Bend/Grayson), no deed history.
async function enrichWilliamson(
  record: CadRecord,
  expectedHouseNumber: string,
): Promise<Partial<CadRecord> | null> {
  try {
    // The API requires a tax-year filter (omitting it returns zero results) but
    // isn't picky about which recent year — 2025/2026/2027 all confirmed live —
    // so this uses the current calendar year rather than a literal that would go
    // stale, matching no county-specific significance beyond "a real recent year".
    const taxYear = new Date().getFullYear();
    const url =
      "https://search.wcad.org/ProxyT/Search/Properties/" +
      `?f=${encodeURIComponent(record.propertyAddress)}&ty=${taxYear}&pvty=${taxYear}&pn=1&st=9&so=1&pt=RP%3BPP%3BMH%3BNR&take=20&skip=0&page=1&pageSize=20`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as { ResultList?: Array<Record<string, unknown>> };
    const rows = json.ResultList ?? [];
    if (rows.length === 0) return null;

    const match = rows.find((r) => {
      const situs = String(r.SitusAddress ?? "").trim();
      return expectedHouseNumber && situs.startsWith(expectedHouseNumber);
    });
    if (!match) return null;

    const enrichment: Partial<CadRecord> = {
      legalDescription: (match.LegalDescription as string) || null,
      subdivision: (match.Subdivision as string) || null,
      mailingAddress: (match.OwnerFullAddress as string)?.trim() || null,
    };

    // WCAD's own ArcGIS parcel layer (queryWilliamson's primary source, above)
    // confirmed live 2026-09-04 to lag the current tax year: a real, actively
    // assessed commercial parcel (account R039247) read CNTASSDVAL 0 there,
    // while this same county's own live search portal already had the real,
    // current $2,474,086 value for tax year 2026 — same property, same day.
    // Only used as a fallback (never overwrites a real ArcGIS value) since
    // this is filling a genuine gap, not second-guessing a good number.
    if (!record.totalValue) {
      const assessedValue = parseMoneyField(
        (match.AssessedValue ?? match.MarketValue ?? match.PropertyValue) as number | string | null,
      );
      if (assessedValue) {
        enrichment.totalValue = assessedValue;
        const searchTaxYear = Number(match.TaxYear);
        if (Number.isFinite(searchTaxYear)) enrichment.taxYear = searchTaxYear;
        // The primary source's land value came from the exact same stale
        // current-year block as its wrong $0 total — pairing a real total
        // with that stale $0 land split would just look like a second bug,
        // not a fix, so this clears it rather than leaving numbers that no
        // longer add up. Left untouched if the primary source actually had
        // a real land value on file.
        if (!record.landValue) enrichment.landValue = null;
      }
    }

    return enrichment;
  } catch {
    return null;
  }
}

// Dallas (Phase 6, 2026-08-11) — the account-detail pages (dallascad.org) need no
// search/postback at all for enrichment: they're reachable with a single plain GET
// keyed directly by the account number the primary queryDallas() match already
// trusts. Confirmed live with a cold, cookie-less request — the page renders with
// stable ASP.NET server-control element IDs (parsed below via regex, not a full DOM
// parser, since the IDs are fixed and predictable). Account type (residential vs.
// commercial vs. business-personal-property) isn't known ahead of time, so this
// tries each detail-page variant in turn and stops at the first real hit — a 200
// with no lblOwner span is DCAD's "wrong type for this ID" response, not an error.
// This is also the first enrichment function that backfills VALUE fields, not just
// extra detail — deliberate, since queryDallas()'s ArcGIS source has none at all;
// enrichRecord()'s existing spread-merge already applies them correctly.
const DALLAS_DETAIL_PATHS = ["AcctDetailRes.aspx", "AcctDetailCom.aspx", "AcctDetailBPP.aspx"];

// Improvement detail off a DCAD account-detail page. The residential page
// (AcctDetailRes.aspx) exposes clean span ids; the commercial page
// (AcctDetailCom.aspx) has none and uses "<b>Total Area:</b> N sqft" /
// "<b>Year Built:</b> YYYY" label pairs plus a "Quality: GOOD" cell (confirmed
// live 2026-09-10). The MAIN improvement is always the first one listed, so a
// non-global regex naturally takes it.
function parseDallasImprovement(html: string): {
  buildingSqft: number | null;
  yearBuilt: number | null;
  buildingClass: string | null;
} {
  const digits = (s: string | null): number | null => {
    if (!s || !/\d/.test(s)) return null;
    const n = Number(s.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };
  const nowYear = new Date().getFullYear();
  const sqft =
    digits(extractSpan(html, "MainImpRes1_lblLivingArea")) ??
    digits(
      html.match(/Total Area:<\/b>\s*(?:&nbsp;|\s)*([\d,]+)\s*(?:&nbsp;|\s)*sqft/i)?.[1] ?? null,
    );
  const yb =
    digits(extractSpan(html, "MainImpRes1_lblYearBuilt")) ??
    digits(html.match(/Year Built:<\/b>\s*(?:&nbsp;|\s)*(\d{4})/i)?.[1] ?? null);
  const cls =
    extractSpan(html, "MainImpRes1_lblBuildClass") ||
    html.match(/Quality:<\/TH>\s*<TD[^>]*>\s*([A-Za-z][A-Za-z /-]*?)\s*<\/TD>/i)?.[1]?.trim() ||
    null;
  return {
    buildingSqft: sqft,
    yearBuilt: yb != null && yb >= 1700 && yb <= nowYear + 1 ? yb : null,
    buildingClass: cls,
  };
}

function extractSpan(html: string, id: string): string | null {
  const m = html.match(new RegExp(`id="${id}"[^>]*>([^<]*)`, "i"));
  const text = m?.[1]?.replace(/&nbsp;/g, " ").trim();
  return text || null;
}

// DCAD shows "Value in Dispute" instead of a number whenever a property's value is
// under active protest (confirmed live 2026-08-11) — stripping non-digits from that
// text leaves an EMPTY string, and `Number("")` is 0 in JS (not NaN), so this must
// require at least one real digit before parsing, or a disputed value would have
// silently come back as a fabricated $0 instead of the honest "no value available".
function parseDallasDollar(v: string | null): number | null {
  if (!v || !/\d/.test(v)) return null;
  const n = Number(v.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

// No house-number cross-check needed here, unlike every other enrichment
// function: this fetches by the EXACT account number the primary queryDallas()
// match already trusts (a direct primary-key lookup), not an independent
// secondary text search that could ambiguously match a different property —
// that's the risk the cross-check in the other enrich* functions guards
// against, and it doesn't apply to a lookup keyed by an already-trusted ID.
async function enrichDallas(accountNumber: string): Promise<Partial<CadRecord> | null> {
  try {
    for (const path of DALLAS_DETAIL_PATHS) {
      const res = await fetch(
        `https://www.dallascad.org/${path}?ID=${encodeURIComponent(accountNumber)}`,
      );
      if (!res.ok) continue;
      const html = await res.text();
      // Bounded by the next <a name="MultiOwner"> anchor, not a "double <br />"
      // pattern — confirmed live 2026-08-11 that the real markup only has a single
      // trailing <br /> after the address (with blank whitespace before it, not a
      // second tag), so the original double-<br /> terminator never matched and
      // silently swallowed the rest of the page instead of just the owner block.
      // The header span's own inner text ("Owner (Current 2027)") is explicitly
      // consumed too, so it can't leak into the first line.
      const ownerBlock = html.match(/id="lblOwner"[^>]*>[^<]*<\/span>([\s\S]*?)<a name=/i)?.[1];
      if (!ownerBlock) continue; // wrong account-type page for this ID — try the next

      // ownerBlock is "NAME[<br />NAME2 ...]<br />LINE1<br />LINE2" — some accounts
      // list multiple co-owners, each on their own <br />-separated line, before the
      // address (confirmed live 2026-08-11 on a real two-owner account, which broke
      // an earlier "everything after line 1" assumption). The address itself is
      // always the last two lines (street, then city/state/zip) regardless of how
      // many owner-name lines precede it, so slice from the end instead.
      const lines = ownerBlock
        .split(/<br\s*\/?>/i)
        .map((s) => s.replace(/&nbsp;/g, " ").trim())
        .filter(Boolean);
      const mailingAddress = lines.length >= 2 ? lines.slice(-2).join(", ") : null;

      // The legal-description text lives in nested <span id="LegalDesc1_lblLegalN">
      // elements inside each <TD>, not as the TD's own direct text — confirmed live
      // 2026-08-11 that matching bare <TD>text</TD> finds nothing, since every cell
      // opens with a <span> tag before any text.
      const legalLines: string[] = [];
      const legalMatch = html.match(/id="lblLegalDesc"[\s\S]*?<\/TABLE>/i)?.[0];
      if (legalMatch) {
        for (const m of legalMatch.matchAll(/id="LegalDesc1_lblLegal\d+"[^>]*>([^<]*)/gi)) {
          const line = m[1].trim();
          if (line) legalLines.push(line);
        }
      }
      const saleDate =
        legalMatch?.match(/id="LegalDesc1_lblSaleDate"[^>]*>([^<]*)/i)?.[1]?.trim() || null;

      // DCAD serves a (near-empty) AcctDetailRes.aspx even for commercial
      // accounts, and this loop stops at the first page with an owner block —
      // so a commercial parcel's real building data (only on AcctDetailCom.aspx)
      // is missed. When the matched page had no improvement SF, fetch the
      // commercial page once and read it from there. Value/legal/mailing above
      // still come from the page that actually matched.
      let imp = parseDallasImprovement(html);
      if (imp.buildingSqft == null && path !== "AcctDetailCom.aspx") {
        try {
          const comRes = await fetch(
            `https://www.dallascad.org/AcctDetailCom.aspx?ID=${encodeURIComponent(accountNumber)}`,
          );
          if (comRes.ok) {
            const comHtml = await comRes.text();
            if (/id="lblOwner"/.test(comHtml)) imp = parseDallasImprovement(comHtml);
          }
        } catch {
          // keep whatever the first page gave (usually nothing) — non-fatal
        }
      }
      const { buildingSqft, yearBuilt, buildingClass } = imp;

      return {
        legalDescription: legalLines.join(" ").trim() || null,
        mailingAddress,
        landValue: parseDallasDollar(extractSpan(html, "ValueSummary1_pnlValue_lblLandVal")),
        improvementValue: parseDallasDollar(extractSpan(html, "ValueSummary1_lblImpVal")),
        totalValue: parseDallasDollar(extractSpan(html, "ValueSummary1_pnlValue_lblTotalVal")),
        ...(buildingSqft != null ? { buildingSqft } : {}),
        ...(yearBuilt != null ? { yearBuilt } : {}),
        ...(buildingClass ? { buildingClass } : {}),
        // Only the single most-recent deed's date is available here (unlike
        // TrueProdigy's full deed history) — same lighter tier as Fort Bend/Grayson,
        // which get no deed info at all, so a date-only entry is still a real gain.
        deeds: saleDate
          ? [
              {
                date: saleDate,
                type: null,
                description: null,
                seller: null,
                buyer: null,
                instrumentNum: null,
              },
            ]
          : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function enrichRecord(record: CadRecord): Promise<CadRecord> {
  if (!record.accountNumber) return record;
  const expectedHouseNumber = houseNumberOf(record.propertyAddress);

  const enrichment =
    record.cad in TRUEPRODIGY_OFFICE_BY_CAD
      ? await enrichTrueProdigy(record.cad, record.accountNumber, expectedHouseNumber)
      : record.cad in BIS_CONFIG_BY_CAD
        ? await enrichBIS(record.cad, record.accountNumber, expectedHouseNumber)
        : record.cad === "Williamson Central Appraisal District"
          ? await enrichWilliamson(record, expectedHouseNumber)
          : record.cad === "Dallas Central Appraisal District"
            ? await enrichDallas(record.accountNumber)
            : null;

  const merged = enrichment ? { ...record, ...enrichment } : record;

  // Structure / lot fields are gap-fill only: a real value from the primary
  // ArcGIS match (applyStructureDetail) always wins over an enrichment source's
  // version of the same field, so a spread can't null out or override it.
  for (const k of [
    "buildingSqft",
    "yearBuilt",
    "buildingClass",
    "lotSizeSqft",
    "lotSizeAcres",
  ] as const) {
    if (record[k] != null && merged[k] == null) merged[k] = record[k];
  }

  // Last-resort lot size: several counties (Dallas, Kaufman, Bexar) have no
  // acreage field anywhere, but their legal description text routinely states
  // it ("... ACS 1.671 ...", "ACRES 1.024"). Parsed only when nothing better
  // was found — never overrides a real numeric field.
  if (merged.lotSizeAcres == null && merged.legalDescription) {
    const acres = acresFromLegalText(merged.legalDescription);
    if (acres != null) merged.lotSizeAcres = acres;
  }

  return merged;
}

function nearbyDedupeKey(r: CadRecord): string {
  return r.accountNumber
    ? `${r.cad}::${r.accountNumber}`
    : `addr::${r.propertyAddress.trim().toLowerCase()}`;
}

// Only ever called after the exact-match sweep above has already come up
// empty. Re-runs the same real per-county sources in "nearby" mode (street
// name only, any house number — see the comment on NEARBY_LIMIT), so this
// surfaces real parcels, never fabricated ones. City-filtered against the
// user's own typed city when there is one (avoids "genuinely nearby" vs.
// "same street name, unrelated town in a different supported county"); when
// the user typed no city at all (e.g. just "901 Willowwood St" — a real,
// previously-confirmed case where the street is real but that exact house
// number isn't its own parcel), there's nothing to filter by, so every real
// candidate is kept rather than suppressing the whole feature for lack of a
// city — each result still shows its own county/city so the user can judge
// relevance themselves. Capped, closest house number first.
// Dropping the house-number anchor for "nearby" mode removes the most
// selective part of the WHERE clause — found live 2026-08-25 that this makes
// Tarrant's backend specifically (no pagination support, so it can't just
// return a fast first page either) take ~19s for a single common street name,
// nearly 3x its own already-slow exact-match query. Race every county's
// nearby query against a timeout instead of trusting Promise.allSettled alone
// (which has no time bound) — a genuinely slow county just contributes
// nothing this round rather than holding up the whole response for everyone.
//
// Bumped 6000 -> 10000 on 2026-09-02 chasing a real, reproducible report
// ("FM1957, San Antonio, TX 78245" via the address autocomplete dropdown,
// not typed by hand): Bexar's own backend, timed directly and repeatedly
// against its live endpoint with the exact WHERE clause this app generates
// for that address, consistently took 6.5-6.8s for a broad highway-name LIKE
// scan — just over the old 6000ms bound, so Bexar's real, correct results
// (including the user's own property) were silently dropped by the timeout
// on every single attempt, not an occasional flake. 10000ms clears that with
// real margin while still bounding Tarrant's genuinely pathological ~19s case
// above.
//
// Bumped 10000 -> 15000 on 2026-09-03 chasing a real report one step further
// than the bump above: nearbyFeaturesWithFallback's own LOOSE query alone
// (independent of its now-separately-capped tight sibling, see
// TIGHT_NEARBY_QUERY_TIMEOUT_MS) timed at 9.2s for a real case ("Parker
// Village Drive" — no exact match at the typed house number, but 5 real
// nearby parcels on the same real street) — right at the edge of the old
// 10000ms bound, so ordinary request overhead on top of that 9.2s was
// enough to silently drop a real, correct nearby list on a plain, otherwise
// unremarkable query.
//
// Bumped 15000 -> 30000 on 2026-10-03: see EXACT_QUERY_TIMEOUT_MS's own
// history below for why this is now a universal, every-county headroom
// increase rather than another one-off bump chasing a single address.
const NEARBY_QUERY_TIMEOUT_MS = 30000;
// The exact-match sweep is normally faster (a more selective, house-number-
// anchored WHERE clause), but a single county source going slow or getting
// rate-limited isn't otherwise bounded at all — found live 2026-08-25 that a
// plain exact-match "900 Willowwood St" query took 97+ seconds this way. A
// bit more generous than the nearby timeout since a real exact match is
// worth waiting a little longer for than an optional suggestion is.
//
// Bumped 10000 -> 15000 on 2026-09-03 chasing a real, genuinely flaky report
// ("705 Hwy 352, Mesquite" — correctly resolved to "multiple" on some
// attempts, silently fell through to an unrelated nearby list on others,
// confirmed by calling the live endpoint 3 times in a row). Timed every
// individual county's own real query for this address directly: none were
// pathologically slow on their own (Tarrant alone ~5s, everything else
// under 1.2s), but real network variance getting to each county's own
// endpoint pushed the TOTAL exact sweep (bounded by whichever one county is
// slowest on a given attempt, not their sum) past the old 10000ms often
// enough to matter — this is ordinary latency jitter, not a specific bad
// county the way the nearby-timeout bump above was. More headroom, not a
// county-specific fix.
//
// Bumped 15000 -> 30000 on 2026-10-03 after this exact "close to the
// ceiling" pattern recurred a third time, for a third different reason
// (Denton), and it became clear bumping the number by a few seconds each
// time a new slow address got reported was never going to actually end:
// each per-county query here is one plain, unretried, unchained `fetch()`
// (see fetchFeatures/queryDenton etc.) — there is no inefficiency in our
// own code to optimize away, the latency is genuinely the county's own
// government server, and real, measured Denton response times for
// DIFFERENT real addresses ranged from 4.4s to 15.5s on their own, no
// request ever involving more than one county. Each county's timeout here
// is independent and runs concurrently with every other county's (see
// `withTimeout(query(address), queryTimeoutMs, [])` in Deno.serve below) —
// a slow Denton query only ever costs Denton's own result, it never slows
// down the other 11 counties' real, often much faster answers — so there
// is no real downside to a generous per-county ceiling, only upside:
// real margin above the worst government-server response seen so far,
// instead of a number tuned to the last one reported.
const EXACT_QUERY_TIMEOUT_MS = 30000;

// Used only for the as-you-type live-search dropdown (`body.preview === true`,
// see Deno.serve below) — NOT the "Validate address"/full-submit flow, which
// always keeps the generous timeouts above so a real but slow/rate-limited
// county is never silently missed on the authoritative check.
//
// Used to be deliberately shorter than EXACT_QUERY_TIMEOUT_MS (4000, then
// 6000, then briefly tied to it at 15000) on the reasoning that the old live
// dropdown was all-or-nothing: nothing showed at all until every candidate's
// query finished, so waiting a long time for one laggard county read as the
// whole search being broken. That reasoning no longer holds — the client
// (unified-search.ts) now shows each Google-resolved address as its own row
// the instant it's found and enriches it in place as its CAD lookup
// resolves, so one slow county just keeps that one row on "Looking up
// county parcel…" a little longer while every other row is already
// showing. Set deliberately MORE generous than EXACT_QUERY_TIMEOUT_MS now
// (not just equal to it) specifically because the live dropdown's own
// overall patience for a "pending" row is a full 3 minutes (see
// SEARCH_TIMEOUT_MS in unified-search.ts) — there's no reason for this
// per-county ceiling to be the thing that gives up first.
const PREVIEW_QUERY_TIMEOUT_MS = 60000;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

async function findNearby(
  countyQueries: Array<(address: string, mode?: QueryMode) => Promise<CadRecord[]>>,
  address: string,
  cityGuess: string,
  queryTimeoutMs: number = NEARBY_QUERY_TIMEOUT_MS,
): Promise<CadRecord[]> {
  // A bare road with no leading house number (e.g. "FM 1957, San Antonio")
  // can't be proximity-sorted by house number below, but it can still be
  // searched by street name — targetHouse just becomes NaN, so every
  // candidate's distance comes out Infinity (see the sort below) and results
  // return in whatever order the counties gave them, unsorted but real.
  // Previously this whole function returned [] whenever there was no house
  // number, silently skipping every county query rather than ever trying.
  const parsed = parseHouseAndStreet(address);
  const targetHouse = parsed ? parseInt(parsed.house, 10) : NaN;
  const targetZip = extractZip(address);

  const results = await Promise.allSettled(
    countyQueries.map((query) =>
      withTimeout(query(address, "nearby"), queryTimeoutMs, [] as CadRecord[]),
    ),
  );
  const candidates = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));

  // City is now a sort PREFERENCE, not a hard exclude — found live 2026-09-04
  // chasing a real report ("2514 Parker Rd, Parker, TX 75002"): Collin's own
  // data has real "W PARKER RD" parcels in PLANO (2224, 2313, 2801...) that
  // bracket house 2514 closely, but the ONLY nearby suggestions shown were a
  // completely different, far-away segment ("E PARKER RD", house 4800+) in
  // the literal town of Parker — because the real, close, correct candidates
  // are in Plano's city label, not "Parker", and the old hard filter dropped
  // them outright. A small town's road frequently continues into a
  // neighboring city under the exact same CAD-county and street name; only
  // hard-filtering by county (via nearbyDedupeKey/cad, unchanged below) still
  // prevents the original cross-COUNTY collision this filter was meant to
  // stop ("Ridgecrest Rd" in Kaufman vs. elsewhere) — filtering by city on
  // top of that was over-broad.
  const seen = new Set<string>();
  const deduped = candidates.filter((c) => {
    const key = nearbyDedupeKey(c);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Region (zip's first two digits), THEN house-number distance, THEN exact
  // zip, THEN city.
  //
  // House-number distance was promoted ahead of zip/city on 2026-10-01,
  // found live chasing "2514 Parker Rd, Parker, TX": the real closest
  // parcels are on "W Parker Rd" in Plano (house numbers bracketing 2514
  // closely), but the OLD zip/city-first order buried them behind a
  // completely different, much farther segment of the same-named road in
  // the actual town of Parker, simply because that segment's city label
  // matched what the user typed. A county/FM road commonly crosses several
  // small cities under one name — its own city label is a weaker signal
  // than how close the house number actually is, so it must not outrank a
  // real, nearby match.
  //
  // The region tier was added the same day chasing the very next real
  // report ("6555 Dallas Pkwy"): a bare-text core-street match on a
  // combined address+city field can collide with an unrelated county 200+
  // miles away whose CITY happens to contain the same word ("Dallas Dr,
  // AUSTIN" for a "Dallas Pkwy" search — Williamson CAD, not Collin) —  and
  // that candidate's house number can coincidentally be numerically closer
  // to the target than the real, same-metro match, which let house-number
  // distance alone rank the wrong-region result first. Texas zip-code
  // prefixes cleanly separate the state's metros (75/76 = DFW, 78 = Austin,
  // 77 = Houston, 7-prefix San Antonio, ...) and don't require a full
  // zip-to-county table — cheap and reliable enough to use as a hard tier
  // ahead of distance, without the fragility a full county guess would add.
  //
  // da/db fall through to Infinity (never finite) whenever either side has
  // no parseable house number, OR the search itself had none (targetHouse
  // NaN — a bare road like "FM 1957, San Antonio" with no number to sort
  // by) — so that case still falls straight through to the zip/city
  // tiebreak below exactly as before: a common road can have 40+ real
  // parcels with no house number to sort by at all, so without zip/city
  // every candidate ties and the list is really just "whichever order the
  // county API happened to return them in" — a real match with the wrong
  // zip could otherwise silently fall past the slice below.
  const targetZipPrefix = targetZip ? targetZip.slice(0, 2) : null;
  const zipPrefixOf = (addr: string) => {
    const z = extractZip(addr);
    return z ? z.slice(0, 2) : null;
  };

  // Strongest signal of all, checked ahead of everything else — found live
  // 2026-10-01, the very next report after the region tier shipped ("6555
  // Dallas Pkwy" still not surfacing even with a real zip given): a
  // per-county nearby query's own tight-phrase-first attempt
  // (nearbyFeaturesWithFallback above) can fall through to its loose,
  // bare-core-word fallback under load, and that loose query is exactly the
  // "street core word collides with an unrelated city name" case already
  // documented there — "DALLAS" being both the searched street's core AND
  // an extremely common city name in its own right made this far worse than
  // the "PARKER" case that pattern was first found for. The result: real
  // "Dallas Pkwy" parcels and "Frankford Rd, DALLAS" parcels (wrong street,
  // right word only because DALLAS is its CITY) arrived mixed together, and
  // house-number coincidence alone let the wrong street win.
  //
  // This re-checks each candidate's OWN street portion (not city, not the
  // whole address) against the searched street's core AND suffix —
  // independent of whatever the upstream query actually matched on, so a
  // slow/loose backend response can no longer let the wrong street outrank
  // the right one. Core word alone isn't enough: a first version of this
  // fix compared only the suffix-stripped core and still let "Dallas Dr" in
  // Austin pass as a match for "Dallas Pkwy", since both reduce to the bare
  // core "DALLAS" — genuinely different streets that merely share a base
  // word. trailingSuffixOf (canonicalized, so "Parker Road" vs. "PARKER RD"
  // still agree despite the spelling difference) now has to agree too, when
  // both sides actually have a recognized suffix.
  const searchedPortion = parsed ? parsed.street.trim() : null;
  const searchedStreetCore = searchedPortion ? coreStreetName(searchedPortion).toUpperCase() : null;
  const searchedSuffix = searchedPortion ? trailingSuffixOf(searchedPortion) : null;
  const matchesSearchedStreet = (addr: string): boolean => {
    if (!searchedStreetCore) return false;
    const portion = streetPortionOf(addr);
    if (!portion || coreStreetName(portion).toUpperCase() !== searchedStreetCore) return false;
    const candidateSuffix = trailingSuffixOf(portion);
    if (searchedSuffix && candidateSuffix && searchedSuffix !== candidateSuffix) return false;
    return true;
  };

  deduped.sort((a, b) => {
    if (searchedStreetCore) {
      const as_ = matchesSearchedStreet(a.propertyAddress) ? 0 : 1;
      const bs_ = matchesSearchedStreet(b.propertyAddress) ? 0 : 1;
      if (as_ !== bs_) return as_ - bs_;
    }
    if (targetZipPrefix) {
      const ar = zipPrefixOf(a.propertyAddress) === targetZipPrefix ? 0 : 1;
      const br = zipPrefixOf(b.propertyAddress) === targetZipPrefix ? 0 : 1;
      if (ar !== br) return ar - br;
    }
    const ha = parseInt(houseNumberOf(a.propertyAddress), 10);
    const hb = parseInt(houseNumberOf(b.propertyAddress), 10);
    const da =
      Number.isFinite(ha) && Number.isFinite(targetHouse) ? Math.abs(ha - targetHouse) : Infinity;
    const db =
      Number.isFinite(hb) && Number.isFinite(targetHouse) ? Math.abs(hb - targetHouse) : Infinity;
    if (da !== db) return da - db;
    const az = targetZip && extractZip(a.propertyAddress) === targetZip ? 0 : 1;
    const bz = targetZip && extractZip(b.propertyAddress) === targetZip ? 0 : 1;
    if (az !== bz) return az - bz;
    const ac = cityGuess && cityMatches(cityOf(a.propertyAddress), cityGuess) ? 0 : 1;
    const bc = cityGuess && cityMatches(cityOf(b.propertyAddress), cityGuess) ? 0 : 1;
    return ac - bc;
  });

  // Found live 2026-08-28 chasing a real report (a Bexar property on FM 1957,
  // itself one of 42 real matches for that one road — no house number to
  // sort by, so all 42 tie at Infinity distance and this list is really just
  // "whichever order the county API happened to return them in"): an 8-item
  // cap silently dropped a real, correctly-matched property that just wasn't
  // in the county's arbitrary first 8 rows. Raised to 20 — still a bounded
  // list the UI's plain scrollable rows handle fine, but 8 was clearly too
  // aggressive for a common road with dozens of real parcels on it.
  return deduped.slice(0, 20);
}

// Business/owner-name search (mode "name" — see parseNameQuery). Parallel to
// findNearby above, but simpler: there's no house-number proximity to sort
// by, so results are just deduped by account number, sorted by whether the
// parsed city guess matches (same cityOf/cityMatches tiebreak findNearby
// uses, and the same reason: a city is a preference here, not a hard SQL
// filter — see ownerNameFeatures's own comment for the collision that forced
// this), and capped. Two of the twelve counties are skipped entirely: Travis
// publishes no owner-name field at all (see queryTravis's own comment), and
// Kaufman's only source is a third-party vendor's free-text keyword search
// whose exact field names for a name search aren't confirmed — safer to
// return nothing there than guess at an unverified query shape.
async function findByName(
  countyQueries: Array<(address: string, mode?: QueryMode) => Promise<CadRecord[]>>,
  nameQuery: string,
  cityGuess: string,
  queryTimeoutMs: number,
): Promise<CadRecord[]> {
  const results = await Promise.allSettled(
    countyQueries.map((query) =>
      withTimeout(query(nameQuery, "name"), queryTimeoutMs, [] as CadRecord[]),
    ),
  );
  // Each county's own mapper falls back to `propertyAddress ?? address` when
  // a record's real situs is missing — a reasonable display fallback for an
  // address-mode search (where `address` genuinely is what the user typed),
  // but nonsensical here: `address` passed into a county function under
  // "name" mode is the raw owner-name query text, not a real address at
  // all. Found live: 4 real Collin "Land" parcels (WAL-MART REAL ESTATE
  // BUSINESS TRUST, no situs on file — likely future store sites) came back
  // with propertyAddress literally equal to "walmart denton," which then
  // passed the city filter below since the ENTIRE fake "address" was
  // exactly the city word being filtered for. Replaced with an honest
  // fallback instead of a query-text echo that happens to look like a real
  // match.
  const candidates = results
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .map((c) =>
      c.propertyAddress.trim().toLowerCase() === nameQuery.trim().toLowerCase()
        ? { ...c, propertyAddress: `${c.cad}${c.accountNumber ? ` — Account #${c.accountNumber}` : ""}` }
        : c,
    );
  const seen = new Set<string>();
  const deduped: CadRecord[] = [];
  for (const c of candidates) {
    const key = `${c.cad}:${c.accountNumber ?? c.propertyAddress}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(c);
  }
  // Filter to the typed city, not just sort it first — found live ("walmart
  // denton" showing real Denton matches on top, but also Plano/Celina ones
  // trailing below them): once there ARE real matches in the city the user
  // actually typed, the other cities are just noise, not a helpful
  // runner-up — and they can crowd a real same-city match out of the
  // dropdown's own top-6 display cap. Only falls back to the full,
  // unfiltered list when the typed city genuinely has zero matches at all
  // (same reasoning as the "no matching records" empty state elsewhere:
  // something real is better than nothing, but only once nothing real
  // exists for what was actually asked).
  if (cityGuess) {
    const inCity = deduped.filter((r) => nameSearchCityMatches(r.propertyAddress, cityGuess));
    if (inCity.length > 0) return inCity.slice(0, 20);
  }
  return deduped.slice(0, 20);
}

// Texas road names are commonly typed/pasted without a space before the
// number ("FM1957", "CR304", "Loop410") — county CAD systems store these
// with a space ("FM 1957"), so an un-normalized query's street-core token
// never matches. Mirrors the same normalization already applied client-side
// before querying Nominatim (src/components/AddressAutocomplete.tsx) so a
// user who pastes a raw address (skipping the autocomplete dropdown) still
// gets a real match instead of silently finding nothing.
const TX_ROAD_PREFIX = /\b(FM|RM|CR|SH|US|IH|LP|LOOP|SPUR)(\d)/gi;

// The opposite direction from TX_ROAD_PREFIX: Google spells an interstate
// out in full with spaces ("Interstate 35 E") or a user types the
// hyphenated form ("I-35 E"), but Denton (and likely other counties) store
// it fully glued with no spaces at all ("I35E") — found live chasing a real
// report (a real Braum's location resolved by Google at "529 S Interstate
// 35 E, Denton, TX 76205" that cad-lookup couldn't find at all, but matched
// immediately once retried as "529 S I35E, Denton, TX 76205"). Digits
// capped at 3 (every real TX interstate is 1-3 digits) to keep this from
// ever matching an unrelated standalone "I" elsewhere in an address.
const TX_INTERSTATE = /\binterstate[\s-]*(\d{1,3})\s*([NSEW])?\b/gi;
const TX_INTERSTATE_HYPHEN = /\bi[\s-]+(\d{1,3})\s*([NSEW])?\b/gi;

function normalizeRoadPrefix(address: string): string {
  return address
    .replace(TX_ROAD_PREFIX, "$1 $2")
    .replace(TX_INTERSTATE, (_m, num: string, dir?: string) => `I${num}${dir ?? ""}`)
    .replace(TX_INTERSTATE_HYPHEN, (_m, num: string, dir?: string) => `I${num}${dir ?? ""}`);
}

// Every county query function, in priority order — the full, unhinted
// sweep. Queried concurrently with no city-name filtering on which to try
// (see the comment on this further down); a single county's transient
// failure (network error, endpoint down) no longer fails the whole lookup,
// it's just skipped, same as a plain no-match.
const ALL_COUNTY_QUERIES = [
  queryCollin,
  queryMontgomery,
  queryDenton,
  queryHarris,
  queryTarrant,
  queryFortBend,
  queryWilliamson,
  queryGrayson,
  queryTravis,
  queryBexar,
  queryDallas,
  queryKaufman,
  queryNueces,
];

// Maps Google's own `administrative_area_level_2` ("Denton County") to the
// one query function for that county — see unified-search.ts's own comment
// on why this exists: without it, every one of a business-name search's
// several Google candidates blind-fires all 12 counties concurrently, even
// when Google already names the exact county for each one. Built from
// ALL_COUNTY_QUERIES itself (one entry per county name baked into each
// function's own URL/comment) rather than hand-duplicated, so the two can
// never silently drift apart.
const COUNTY_QUERY_BY_HINT: Record<string, (typeof ALL_COUNTY_QUERIES)[number]> = {
  collin: queryCollin,
  montgomery: queryMontgomery,
  denton: queryDenton,
  harris: queryHarris,
  tarrant: queryTarrant,
  "fort bend": queryFortBend,
  williamson: queryWilliamson,
  grayson: queryGrayson,
  travis: queryTravis,
  bexar: queryBexar,
  dallas: queryDallas,
  kaufman: queryKaufman,
  nueces: queryNueces,
};

function countyQueryForHint(hint: unknown): ((typeof ALL_COUNTY_QUERIES)[number]) | undefined {
  if (typeof hint !== "string") return undefined;
  const key = hint.toLowerCase().replace(/\s*county\s*$/i, "").trim();
  return COUNTY_QUERY_BY_HINT[key];
}

// Same idea as Google's own countyHint above, for the ONE path that never
// gets one: a search typed directly (not resolved through a Google
// candidate — see unified-search.ts's "direct" branch) never carried a
// county hint at all, so "walmart dallas" or "dental frisco" always swept
// every one of the 13 supported counties concurrently, even though the
// typed text itself names a real, usually unambiguous city. Found live
// ("instead of searching all the counties, search directly in the
// respective county based on the keyword").
//
// Maps each city already recognized by KNOWN_SINGLE_WORD_CITIES/
// MULTI_WORD_CITIES above (reused rather than a second hand-maintained
// list) to its PRIMARY supported county — a handful of these cities
// genuinely straddle two counties (Frisco: Collin/Denton; Carrollton:
// Denton/Dallas/Collin; Celina: Collin/Denton; Grand Prairie: Dallas/
// Tarrant) and this only ever picks one. That's safe, not a correctness
// risk: countyQueryForHint's own caller already falls back to the full
// sweep whenever the hinted county isn't a confident match (see
// isConfidentMatch) — a wrong guess here only ever costs one extra,
// usually-fast single-county query before landing on the right answer the
// same way an un-hinted search always did, it never excludes the real
// county from being tried.
const CITY_TO_COUNTY_HINT: Record<string, (typeof ALL_COUNTY_QUERIES)[number]> = {
  "fort worth": queryTarrant,
  "san antonio": queryBexar,
  "the colony": queryDenton,
  "flower mound": queryDenton,
  "round rock": queryWilliamson,
  "sugar land": queryFortBend,
  "missouri city": queryFortBend,
  "grand prairie": queryDallas,
  "little elm": queryDenton,
  "highland village": queryDenton,
  "north richland hills": queryTarrant,
  "lake dallas": queryDenton,
  "corpus christi": queryNueces,
  denton: queryDenton,
  houston: queryHarris,
  dallas: queryDallas,
  plano: queryCollin,
  frisco: queryCollin,
  mckinney: queryCollin,
  allen: queryCollin,
  carrollton: queryDenton,
  lewisville: queryDenton,
  wylie: queryCollin,
  celina: queryCollin,
  garland: queryDallas,
  mesquite: queryDallas,
  irving: queryDallas,
  arlington: queryTarrant,
  austin: queryTravis,
  sherman: queryGrayson,
  denison: queryGrayson,
  conroe: queryMontgomery,
  katy: queryHarris,
  georgetown: queryWilliamson,
  humble: queryHarris,
  spring: queryHarris,
  stafford: queryFortBend,
  aubrey: queryDenton,
  porter: queryMontgomery,
  crandall: queryKaufman,
  forney: queryKaufman,
  montgomery: queryMontgomery,
  euless: queryTarrant,
  hurst: queryTarrant,
  bedford: queryTarrant,
  colleyville: queryTarrant,
  southlake: queryTarrant,
  keller: queryTarrant,
  burleson: queryTarrant,
  haslet: queryTarrant,
  roanoke: queryDenton,
  grapevine: queryTarrant,
};

// Tries the same two interpretations the rest of this file already uses to
// find a city in free text — parseNameQuery's (a business name + city, no
// house number) and parseHouseAndStreet's own cityStateZip tail (a real
// address) — and looks the result up in CITY_TO_COUNTY_HINT. Returns
// undefined (full sweep, exactly today's behavior) whenever neither
// interpretation finds a recognized city, rather than guessing.
function countyQueryFromQueryText(
  address: string,
): ((typeof ALL_COUNTY_QUERIES)[number]) | undefined {
  const nameCity = parseNameQuery(address)?.city;
  if (nameCity) {
    const hit = CITY_TO_COUNTY_HINT[nameCity.toLowerCase().trim()];
    if (hit) return hit;
  }
  const addressCity = parseHouseAndStreet(address)?.cityStateZip;
  if (addressCity) {
    const hit = CITY_TO_COUNTY_HINT[guessCity(addressCity).toLowerCase().trim()];
    if (hit) return hit;
  }
  return undefined;
}

type LookupResult =
  | { matched: false; nearby: CadRecord[] }
  | { matched: true; record: CadRecord }
  | { matched: "multiple"; options: CadRecord[] };

// Deliberately NOT "did the hinted county find literally nothing" — a
// single wrong/stale hint (confirmed live: hinting "Collin County" for a
// real Denton address) can still produce a plausible-looking "nearby"
// result from the WRONG county's own loose fallback search, which isn't
// empty but also isn't the real property. Only an actual exact-match or
// multiple-accounts result is confident enough to skip the full sweep on;
// anything else (including a non-empty "nearby" guess) still falls back to
// ALL_COUNTY_QUERIES, discarding the hinted attempt entirely, so a bad hint
// can only cost a little time, never a real match.
//
// isNameQuery changes what counts as confident for a business-name search
// specifically — found live chasing a real report ("walmart dallas" still
// took 13.8s with a hint in place): findByName() STRUCTURALLY only ever
// returns `{matched: false, nearby: [...]}`, win or lose — it has no
// "matched: true" shape to produce, since a name search is inherently a
// list of candidates, not one exact row. The strict check above treated
// every one of its results as "not confident," so the hinted single-county
// attempt was discarded and the full sweep ran anyway EVERY time for a
// name search, making the whole optimization a no-op for exactly the kind
// of query ("<business> <city>") most live searches actually are. A
// non-empty name-mode result from the hinted county doesn't carry the
// address-mode risk above: it's a real owner-name match from that ONE
// county's own search, not a fuzzy cross-county proximity guess, so it's
// trustworthy on its own.
function isConfidentMatch(r: LookupResult, isNameQuery: boolean): boolean {
  if (r.matched === true || r.matched === "multiple") return true;
  return isNameQuery && r.matched === false && r.nearby.length > 0;
}

// The full address-lookup sweep, parameterized by WHICH county query
// functions to run — everything that used to be the bulk of the
// Deno.serve handler below, unchanged in behavior, just no longer
// hardcoded to ALL_COUNTY_QUERIES so it can be tried against a single
// hinted county first (see Deno.serve below for the two-phase caller).
// Returns a plain result object rather than a Response so the caller can
// inspect it (isConfidentMatch) and decide whether a fallback sweep is needed
// before anything is sent back over the wire.
async function runLookup(
  address: string,
  queryTimeoutMs: number,
  countyQueriesInOrder: typeof ALL_COUNTY_QUERIES,
  // Found live chasing a real report ("2930 West University Drive, Denton"
  // took 33-38s even with the right county hinted and Denton's own raw
  // ArcGIS endpoint independently confirmed to answer in 3.6s at that exact
  // moment): enrichRecord() used to run unconditionally after every match,
  // including every live-search-dropdown preview, even though enrichment's
  // own TrueProdigy call makes a FRESH, uncached auth round-trip every
  // single time (getTrueProdigyToken has no caching at all) before even
  // starting its own search+deeds fetches — three real external network
  // calls the dropdown doesn't need at all, just to show deed history and
  // building class the user hasn't asked to see yet. Skipped entirely for a
  // preview lookup now; the authoritative, non-preview call this same
  // function serves for "Validate address" (or picking a suggestion) still
  // enriches the one property actually chosen, same as before.
  preview = false,
): Promise<LookupResult> {
  // A business/owner name ("Walmart Denton"), not a street address at all —
  // neither parseHouseAndStreet nor its bare-road sibling parseStreetOnly
  // can parse this (both require a house number or a street-suffix word),
  // so every county query below would otherwise bail out to [] without
  // ever making a request. Checked here, once, rather than inside each of
  // the 12 county functions separately.
  if (!parseAddressForQuery(address, "nearby")) {
    const nameQuery = parseNameQuery(address);
    if (!nameQuery?.name) return { matched: false, nearby: [] };
    const nameResults = await findByName(countyQueriesInOrder, address, nameQuery.city, queryTimeoutMs);
    return { matched: false, nearby: nameResults };
  }

  // cityGuess only depends on the raw address text, not on anything the
  // exact sweep finds — computed up front so the nearby sweep below can
  // start immediately, in parallel with the exact sweep, instead of only
  // starting after it finishes.
  const parsedForCity = parseHouseAndStreet(address);
  const cityGuess = parsedForCity ? guessCity(parsedForCity.cityStateZip) : "";

  // Fired now, not awaited yet — a real address search used to pay the
  // exact sweep's full latency AND THEN the nearby sweep's full latency
  // back-to-back whenever nothing matched, since nearby only ever started
  // after `!record` was already known. Calling findNearby() here starts its
  // own concurrent county queries immediately; `await`ing the *result* is
  // deferred until after the tiebreak below decides whether it's even
  // needed. If an exact match is found, this promise is simply never
  // awaited — its in-flight requests cost nothing to the response, since
  // nothing here ever reads their result.
  const nearbyPromise = findNearby(countyQueriesInOrder, address, cityGuess, queryTimeoutMs);

  // Found live 2026-08-25, a real report ("900 Willowwood St" taking 97+
  // seconds): a single slow/rate-limited county source could block the
  // ENTIRE lookup, since Promise.allSettled alone has no time bound of its
  // own — it just waits for every promise to settle, however long that
  // takes. Same fix as the nearby sweep's own per-county timeout (see
  // NEARBY_QUERY_TIMEOUT_MS above): a county that doesn't answer in time
  // just contributes nothing this round, exactly like a real query error
  // already does, rather than holding up every other (fast) county's real
  // answer.
  const results = await Promise.allSettled(
    countyQueriesInOrder.map((query) => withTimeout(query(address), queryTimeoutMs, [] as CadRecord[])),
  );
  // Flattened in county-priority order, then row order within each county — each
  // county now returns up to MULTI_CANDIDATE_LIMIT real rows instead of just one
  // (see the comment above that constant), so the tiebreak below has every real
  // candidate to search, not just each county's arbitrary first row.
  const candidates = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));

    // It's possible (found sampling real addresses on 2026-07-26) for the SAME
    // house number + a generic street word ("Commerce", "Marshall", "Maple", ...)
    // to be a genuine, correctly-formatted real record in TWO different counties —
    // not a query bug, just an honest coincidence. Picking the first in priority
    // order alone would silently return the wrong one whenever that happens. Since
    // the user's own input names a city, prefer whichever candidate's own returned
    // address actually mentions that city over one that doesn't, before falling
    // back to priority order (still needed for Tarrant, whose source has no city
    // field at all, and any other candidate where this can't be determined).
    let record: CadRecord | null = null;
    // The city check below exists ONLY to disambiguate a genuine cross-county
    // collision (see the comment above `candidates` — same house number +
    // generic street word, coincidentally real in two DIFFERENT counties).
    // Found live 2026-09-03 chasing a real report ("28324 Leslie Pfeiffer Dr,
    // Fair Oaks Ranch" — a real, correctly-matched Bexar record whose OWN
    // situs data says "FAIR OAKS", not "FAIR OAKS RANCH"): requiring the
    // user's exact typed city as a substring was silently discarding the
    // ONLY real candidate whenever a county's own city spelling differs even
    // slightly from what the user typed (a colloquial/older name, a missing
    // "Ranch"/"Heights"/etc. suffix) — there was never any actual ambiguity
    // to resolve, since every candidate came from the same single county.
    // Only apply the strict city match when candidates genuinely span more
    // than one distinct CAD; a single-source result set is exactly as safe
    // to take directly as the original `cityGuess`-empty case already did.
    const distinctCads = new Set(candidates.map((c) => c.cad)).size;
    if (cityGuess && distinctCads > 1) {
      // cityOf/cityMatches, not a plain `.includes(cityGuess)` against the
      // whole address — found live 2026-09-03 chasing the SAME "Parker Rd"
      // report a second time, after the combined-field fix above shipped:
      // Kaufman genuinely has an unrelated "Parker Rd" in Crandall, and
      // Denton has one in Carrollton — a naive whole-address substring check
      // matched BOTH purely because their own STREET happens to be named
      // "Parker" too, the exact same class of false positive as the
      // Ridgecrest/Forney case below, just triggered by the street name
      // instead of a bare word coincidence.
      record = candidates.find((c) => cityMatches(cityOf(c.propertyAddress), cityGuess)) ?? null;
      // Found live 2026-08-25 chasing a real report ("601 Ridgecrest Rd, Forney" —
      // Forney is in Kaufman County, which has no source here at all): falling
      // back to candidates[0] unconditionally whenever nothing matched cityGuess
      // silently returned a real, correctly-formatted, but WRONG property — a
      // same-named street ("Ridgecrest") existing by coincidence in a totally
      // different, unrelated county, with no relationship to the city the user
      // actually typed.
      //
      // Only fall back to an unverified candidate when its OWN returned address
      // has no city in it AT ALL (no comma — same tell already used below for
      // "this source had nothing to append a city from") — a real "we can't
      // verify, but nothing contradicts it either" situation. First tried
      // excluding entire cityless SOURCES (Tarrant/Travis) instead, but that was
      // still too broad: most real Tarrant rows DO carry a resolved city (via
      // TARRANT_CITY_CODES) and should be judged on it like everyone else — only
      // the specific rows where that resolution came back null (unincorporated
      // county land, or an unrecognized code) are genuinely unverifiable.
      if (!record) {
        record = candidates.find((c) => !c.propertyAddress.includes(",")) ?? null;
      }
    } else {
      record = candidates[0] ?? null;
    }

    // Tarrant (always) and Travis (often) have no city in their own data, so their
    // propertyAddress comes back as just the street with no comma at all — that's
    // also exactly why they can never win the tiebreak above (nothing to match
    // cityGuess against). Now that a record has actually been chosen, append the
    // user's own typed city/state/zip for a normal-looking display address. Only
    // fires when there's truly no city already present (every other county always
    // has a real comma-separated city baked in from its own source).
    if (record && parsedForCity && !record.propertyAddress.includes(",")) {
      record = {
        ...record,
        propertyAddress: `${record.propertyAddress}, ${parsedForCity.cityStateZip}`,
      };
    }

    // A single civic address can genuinely cover more than one real, separately
    // owned CAD account — confirmed live on a real report: "11400 Culebra, San
    // Antonio" is BOTH a day care (PINNACLE MONTESSORI OF ALAMO RANCH LLC,
    // account 1199177) AND a strip center (AVIGHNA HOLDINGS LLC, account
    // 1256855) on adjacent lots of the same block. The tiebreak above silently
    // picked whichever one happened to come first in the county's own row
    // order — a real, previously undetectable wrong-owner report, since
    // nothing on screen ever showed the second account existed at all.
    // Grouped by record's own source only (not all `candidates` — a
    // same-house-number-plus-generic-street coincidence in a DIFFERENT county
    // is the cityGuess tiebreak's job above, not this one's): "exact" mode's
    // WHERE clause already anchors house number + street core within one
    // county's own query, so same-source candidates here are genuinely the
    // same address, not a coincidence. Deduped by accountNumber first — a
    // source occasionally returns the identical account twice, which isn't a
    // second real property.
    if (record) {
      const sameSourceCandidates = candidates.filter((c) => c.cad === record!.cad);
      const distinctAccounts = new Map<string, CadRecord>();
      for (const c of sameSourceCandidates) {
        const key = c.accountNumber ?? c.propertyAddress;
        if (!distinctAccounts.has(key)) distinctAccounts.set(key, c);
      }
      // The user's own typed directional, when there is one, disambiguates a
      // same-house-number "multiple" result that's actually just the
      // directional-blind query matching two DIFFERENT real streets (2601 E
      // University Ave vs. 2601 W University Ave — see directionalOf's own
      // comment). Only resolves directly when it narrows to EXACTLY one
      // account; any other outcome (no directional typed, or more than one
      // candidate somehow shares it) falls through to the real "multiple"
      // response below unchanged, same as before this fix.
      if (distinctAccounts.size > 1 && parsedForCity) {
        const userDirectional = directionalOf(parsedForCity.street);
        if (userDirectional) {
          const matchingDirectional = [...distinctAccounts.values()].filter(
            (c) => directionalOf(c.propertyAddress) === userDirectional,
          );
          if (matchingDirectional.length === 1) {
            record = matchingDirectional[0];
            // Same city-append this function already does for the ORIGINAL
            // tiebreak-selected record above, and for each "multiple" option
            // below — needed here too since this replaces `record` with a raw
            // candidate from `candidates`, not the one that already went
            // through that step.
            if (parsedForCity && !record.propertyAddress.includes(",")) {
              record = {
                ...record,
                propertyAddress: `${record.propertyAddress}, ${parsedForCity.cityStateZip}`,
              };
            }
            distinctAccounts.clear();
            distinctAccounts.set(record.accountNumber ?? record.propertyAddress, record);
          }
        }
      }
      if (distinctAccounts.size > 1) {
        const options = await Promise.all(
          [...distinctAccounts.values()].map(async (c) => {
            const withCity =
              parsedForCity && !c.propertyAddress.includes(",")
                ? { ...c, propertyAddress: `${c.propertyAddress}, ${parsedForCity.cityStateZip}` }
                : c;
            return preview ? withCity : enrichRecord(withCity);
          }),
        );
        return { matched: "multiple", options };
      }
    }

    if (!record) {
      // Already well underway (started before the exact sweep even began) —
      // usually resolves close to immediately from here, not from scratch.
      const nearby = await nearbyPromise;
      if (nearby.length === 0) {
        // Falls back to a name search when the address interpretation found
        // literally nothing — found live ("walmart south loop denton"):
        // "loop" is itself a real street-suffix word (same as "dr" in an
        // earlier report), so parseStreetOnly happily parses the WHOLE
        // query as a bare road ("walmart south loop") and this never even
        // reaches findByName at all, even though it's clearly a business
        // name search. Rather than trying to anticipate every one of
        // STREET_SUFFIX_ALT's ~50 words colliding with some real business
        // name, just try the other interpretation when the first one comes
        // up empty — address mode still gets first try (and wins if it
        // finds anything), so this never changes behavior for a real
        // address that happens to share a word with a business name.
        const nameQuery = parseNameQuery(address);
        if (nameQuery?.name) {
          const nameResults = await findByName(
            countyQueriesInOrder,
            address,
            nameQuery.city,
            queryTimeoutMs,
          );
          if (nameResults.length > 0) {
            return { matched: false, nearby: nameResults };
          }
        }
      }
      return { matched: false, nearby };
    }

    if (!preview) record = await enrichRecord(record);

    return { matched: true, record };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();

    // Manual account-number lookup (see queryByAccountNumber's own comment)
    // — a completely separate request shape from the address flow below,
    // checked first so it never touches address parsing at all.
    if (typeof body.accountNumber === "string" && typeof body.cad === "string") {
      const record = await queryByAccountNumber(body.cad, body.accountNumber);
      return new Response(JSON.stringify({ matched: Boolean(record), record: record ?? null }), {
        status: 200,
        headers: corsHeaders,
      });
    }

    const rawAddress = body.address;
    if (!rawAddress || typeof rawAddress !== "string") {
      return new Response(JSON.stringify({ error: "address is required" }), {
        status: 400,
        headers: corsHeaders,
      });
    }
    const address = normalizeRoadPrefix(rawAddress);

    // Set only by the as-you-type live-search dropdown (never by "Validate
    // address" / a direct submit) — see PREVIEW_QUERY_TIMEOUT_MS's own
    // comment for why a more patient ceiling is the right tradeoff there.
    const preview = body.preview === true;
    const queryTimeoutMs = preview ? PREVIEW_QUERY_TIMEOUT_MS : EXACT_QUERY_TIMEOUT_MS;

    // See COUNTY_QUERY_BY_HINT's own comment — when the caller already knows
    // the county (every Google-resolved candidate does), try just that one
    // county first instead of ALL_COUNTY_QUERIES. Never trusted blindly: see
    // isConfidentMatch's own comment for a real case (a wrong hint that
    // produced a plausible but WRONG "nearby" guess from the wrong county)
    // that made this check deliberately stricter than "came back empty" —
    // only an actual exact/multiple match short-circuits the full sweep; a
    // wrong or stale hint can only cost a little time, never a real match.
    //
    // Google's own structured hint is preferred when the caller sent one;
    // CITY_TO_COUNTY_HINT (countyQueryFromQueryText) only runs as a fallback
    // for the one path that never gets one — a search typed directly, not
    // resolved through a Google candidate (see that function's own comment).
    const hintedQuery = countyQueryForHint(body.countyHint) ?? countyQueryFromQueryText(address);
    // Same test runLookup itself uses internally to choose its name-search
    // branch — computed here too so isConfidentMatch knows which shape of
    // "confident" applies to this particular query.
    const isNameQuery = !parseAddressForQuery(address, "nearby");
    let result: LookupResult;
    if (hintedQuery) {
      const hinted = await runLookup(address, queryTimeoutMs, [hintedQuery], preview);
      result = isConfidentMatch(hinted, isNameQuery)
        ? hinted
        : await runLookup(address, queryTimeoutMs, ALL_COUNTY_QUERIES, preview);
    } else {
      result = await runLookup(address, queryTimeoutMs, ALL_COUNTY_QUERIES, preview);
    }

    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 502, headers: corsHeaders },
    );
  }
});
