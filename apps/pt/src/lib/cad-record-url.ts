import type { CadRecord } from "./cad-lookup";

// A link to the property's real, official county record — lets a user
// independently verify what this app shows (owner, values, account number)
// against the source of truth itself, and is especially useful when
// disambiguating multiple accounts at the same address (see cad-lookup.ts's
// "multiple" result).
//
// Six counties get a REAL deep link straight to the specific account, since
// their URL format is confirmed (not guessed):
//   - Bexar: verified directly against a real record a user shared
//     (bexar.trueautomation.com/clientdb/Property.aspx?cid=110&prop_id=...).
//     cid=110 is Bexar's own fixed client ID on the TrueAutomation platform,
//     not something derived per-property.
//   - Dallas: the exact account-detail path this app's own enrichDallas()
//     already fetches server-side (AcctDetailCom.aspx — the commercial
//     variant, matching this app's commercial-only scope; see
//     DALLAS_DETAIL_PATHS in supabase/functions/cad-lookup/index.ts).
//   - Denton, Tarrant, Montgomery, Travis: same underlying TrueProdigy/
//     ProdigyCAD platform this app's own cad-comps already uses for their
//     backend data (see texas_cad_vendor_landscape) — confirmed live by
//     actually searching each county's public site for a real account
//     (Denton 34086, Tarrant 41054806, Montgomery 167662, Travis 230964) and
//     following the result through to its detail page:
//     {site}/property-detail/{accountNumber}. Travis's portal lives on its
//     own subdomain (travis.prodigycad.com) rather than under traviscad.org
//     itself — easy to miss if you only check the county's main domain, as
//     an earlier pass here did before this was corrected.
//   - Grayson and Kaufman: both run BIS Consultants (esearch.graysonappraisal.org
//     / esearch.kaufman-cad.org — see texas_cad_vendor_landscape memory), same
//     real pattern for both, confirmed 2026-09-03 by reading the site's own JS
//     (redirectWithParams()) rather than guessing: {site}/Property/View/
//     {accountNumber} — a cold, cookie-less request works (no year/session
//     param needed, confirmed by testing with and without one on both
//     counties). This app's own accountNumber for both (queryGrayson's
//     PropertyNumber field; queryKaufman's own accountNumber, which is
//     literally BIS's raw propertyId already) is exactly BIS's internal
//     numeric propertyId, so no extra plumbing was needed to wire either up.
//   - Fort Bend: runs the SAME BIS vendor as Grayson/Kaufman, but its own
//     accountNumber (queryFortBend's PROPNUMBER field, a dashed parcel/geo ID
//     like "0062-00-000-4026-907") is BIS's geoId, not its internal numeric
//     propertyId — confirmed live that the geoId 404s on the same URL shape
//     above. Fixed properly rather than left unsupported: enrichBIS already
//     calls BIS's search API and gets the real numeric propertyId back in
//     the same response (confirmed live — Fort Bend's own raw BIS row even
//     carries its own `detailUrl: "/Property/View?Id=R504849&year=2026"`,
//     confirming the ID), just wasn't previously surfaced — now captured as
//     the separate `bisPropertyId` field on CadRecord (see the type's own
//     comment and enrichBIS in supabase/functions/cad-lookup/index.ts) and
//     used here instead of accountNumber, specifically for Fort Bend. Only
//     available when enrichment succeeds (best-effort, can fail) — falls
//     back to the generic search homepage when absent, never a guessed URL.
//   - Williamson: a third vendor (search.wcad.org, ASP.NET/DNN — see
//     texas_cad_vendor_landscape), real pattern found 2026-09-03 by driving
//     the real search UI and reading the resulting URL after clicking into a
//     real result: {site}/Property-Detail/PropertyQuickRefID/{accountNumber}
//     — confirmed live the second path segment (PartyQuickRefID, an owner ID
//     this app doesn't have) is NOT actually required; the page resolves
//     correctly by PropertyQuickRefID alone. This app's own accountNumber
//     for Williamson (queryWilliamson's PARCELID field) is confirmed to be
//     the exact same value as this site's own PropertyQuickRefID (cross-
//     checked live against the same real record, "R010784").
//
// Every other county only gets that CAD's general property-search homepage
// (a real, verified domain — not a guessed deep-link route this app has
// never actually confirmed works) rather than a specific-record URL nobody's
// checked. Better an honest "search here yourself" than a link that might
// silently 404 or land on the wrong page.
export const CAD_SEARCH_HOMEPAGE: Record<string, string> = {
  "Bexar Appraisal District": "https://bcad.org",
  "Collin Central Appraisal District": "https://www.collincad.org",
  "Dallas Central Appraisal District": "https://www.dallascad.org",
  "Denton Central Appraisal District": "https://www.dentoncad.com",
  "Fort Bend Central Appraisal District": "https://esearch.fbcad.org",
  "Grayson Central Appraisal District": "https://www.graysonappraisal.org",
  "Harris Central Appraisal District": "https://hcad.org",
  "Montgomery Central Appraisal District": "https://mcad-tx.org",
  "Kaufman Central Appraisal District": "https://esearch.kaufman-cad.org",
  "Tarrant Appraisal District": "https://www.tad.org",
  "Travis Central Appraisal District": "https://www.traviscad.org",
  "Williamson Central Appraisal District": "https://search.wcad.org",
};

// The 3 TrueProdigy-platform counties (see the comment above) all share the
// identical {base}/property-detail/{accountNumber} shape — just a different
// base per county's own public site.
const PRODIGYCAD_DETAIL_BASE: Record<string, string> = {
  "Denton Central Appraisal District": "https://www.dentoncad.com",
  "Tarrant Appraisal District": "https://tarrant.prodigycad.com",
  "Montgomery Central Appraisal District": "https://mcad-tx.org",
  "Travis Central Appraisal District": "https://travis.prodigycad.com",
};

// BIS Consultants counties whose own accountNumber field is confirmed to be
// BIS's internal numeric propertyId (see the comment above) — Fort Bend runs
// the same vendor but isn't included here; it's handled separately via
// bisPropertyId below since its accountNumber isn't the right ID.
const BIS_DETAIL_BASE: Record<string, string> = {
  "Grayson Central Appraisal District": "https://esearch.graysonappraisal.org",
  "Kaufman Central Appraisal District": "https://esearch.kaufman-cad.org",
};

const WCAD_DETAIL_BASE = "https://search.wcad.org";

export function getCadRecordUrl(
  record: Pick<CadRecord, "cad" | "accountNumber"> & Partial<Pick<CadRecord, "bisPropertyId">>,
): string | null {
  if (record.cad === "Fort Bend Central Appraisal District") {
    // The one county whose deep-link ID isn't accountNumber — see this
    // file's own top comment. Falls back to the generic homepage (not a
    // guessed URL built from the wrong ID) whenever enrichment hasn't
    // populated bisPropertyId yet.
    return record.bisPropertyId
      ? `https://esearch.fbcad.org/Property/View/${encodeURIComponent(record.bisPropertyId)}`
      : (CAD_SEARCH_HOMEPAGE[record.cad] ?? null);
  }

  if (!record.accountNumber) return CAD_SEARCH_HOMEPAGE[record.cad] ?? null;

  if (record.cad === "Bexar Appraisal District") {
    return `https://bexar.trueautomation.com/clientdb/Property.aspx?cid=110&prop_id=${encodeURIComponent(record.accountNumber)}`;
  }
  if (record.cad === "Dallas Central Appraisal District") {
    return `https://www.dallascad.org/AcctDetailCom.aspx?ID=${encodeURIComponent(record.accountNumber)}`;
  }
  if (record.cad === "Williamson Central Appraisal District") {
    return `${WCAD_DETAIL_BASE}/Property-Detail/PropertyQuickRefID/${encodeURIComponent(record.accountNumber)}`;
  }
  const prodigyBase = PRODIGYCAD_DETAIL_BASE[record.cad];
  if (prodigyBase) {
    return `${prodigyBase}/property-detail/${encodeURIComponent(record.accountNumber)}`;
  }
  const bisBase = BIS_DETAIL_BASE[record.cad];
  if (bisBase) {
    return `${bisBase}/Property/View/${encodeURIComponent(record.accountNumber)}`;
  }
  return CAD_SEARCH_HOMEPAGE[record.cad] ?? null;
}

// True only for the counties with a real, verified deep link straight to the
// account — used to phrase the link's own label honestly ("View Official CAD
// Record" vs. "Search on {CAD}'s Website") rather than promising a specific
// record every county doesn't actually jump straight to.
export function isDirectCadRecordUrl(cad: string): boolean {
  return (
    cad === "Bexar Appraisal District" ||
    cad === "Dallas Central Appraisal District" ||
    cad === "Williamson Central Appraisal District" ||
    cad in PRODIGYCAD_DETAIL_BASE ||
    cad in BIS_DETAIL_BASE
  );
}

// Plain county names ("Bexar", not "Bexar Appraisal District") derived from
// CAD_SEARCH_HOMEPAGE's own keys above — the one place this app's actual
// county coverage is enumerated — rather than a second hand-maintained list
// that could silently drift out of sync with it (the same class of bug as
// the $699/$799 pricing mismatch: two copies of one fact, only one updated).
// Used by intake.tsx to tell "this county genuinely isn't supported yet"
// apart from "supported county, just no record found for this address."
export const SUPPORTED_COUNTY_NAMES = new Set(
  Object.keys(CAD_SEARCH_HOMEPAGE).map((cad) =>
    cad.replace(/\s*(Central\s+)?Appraisal District$/i, "").trim(),
  ),
);
