import { countyFromCad as baseCounty } from "./tax-rates-official";

// Official deed records live with each county clerk, not the appraisal
// district. Their search sites (most on publicsearch.us) sit behind bot
// protection with no public API, so the app doesn't read them — it opens the
// clerk's own search already filled in with the owner's name, so the owner
// sees the official recorded deeds, liens and plats themselves. Checked live:
// each link below opens real results. Counties are added one by one.

export type ClerkRecords = {
  county: string;
  clerk: string;
  // search for an owner (grantor/grantee) name; absent when the clerk's
  // search is a form that can't be pre-filled from a link
  searchUrl?: (owner: string) => string;
  homeUrl: string;
};

const publicSearch = (sub: string, county: string): ClerkRecords => ({
  county,
  clerk: `${county} County Clerk`,
  homeUrl: `https://${sub}.tx.publicsearch.us/`,
  searchUrl: (owner) =>
    `https://${sub}.tx.publicsearch.us/results?department=RP&searchType=quickSearch&searchValue=${encodeURIComponent(owner)}`,
});

export const CLERK_RECORDS: Record<string, ClerkRecords> = {
  collin: publicSearch("collin", "Collin"),
  dallas: publicSearch("dallas", "Dallas"),
  tarrant: publicSearch("tarrant", "Tarrant"),
  denton: publicSearch("denton", "Denton"),
  bexar: publicSearch("bexar", "Bexar"),
  montgomery: publicSearch("montgomery", "Montgomery"),
  grayson: publicSearch("grayson", "Grayson"),
  // statewide sweep (2026-11-07): every other county whose clerk uses
  // publicsearch.us and whose real-property search returned live results
  anderson: publicSearch("anderson", "Anderson"),
  bee: publicSearch("bee", "Bee"),
  bell: publicSearch("bell", "Bell"),
  blanco: publicSearch("blanco", "Blanco"),
  brazos: publicSearch("brazos", "Brazos"),
  brewster: publicSearch("brewster", "Brewster"),
  burleson: publicSearch("burleson", "Burleson"),
  cameron: publicSearch("cameron", "Cameron"),
  chambers: publicSearch("chambers", "Chambers"),
  cochran: publicSearch("cochran", "Cochran"),
  coleman: publicSearch("coleman", "Coleman"),
  freestone: publicSearch("freestone", "Freestone"),
  gillespie: publicSearch("gillespie", "Gillespie"),
  goliad: publicSearch("goliad", "Goliad"),
  grimes: publicSearch("grimes", "Grimes"),
  hidalgo: publicSearch("hidalgo", "Hidalgo"),
  hockley: publicSearch("hockley", "Hockley"),
  jefferson: publicSearch("jefferson", "Jefferson"),
  "jim hogg": publicSearch("jimhogg", "Jim Hogg"),
  "jim wells": publicSearch("jimwells", "Jim Wells"),
  johnson: publicSearch("johnson", "Johnson"),
  kendall: publicSearch("kendall", "Kendall"),
  leon: publicSearch("leon", "Leon"),
  "live oak": publicSearch("liveoak", "Live Oak"),
  llano: publicSearch("llano", "Llano"),
  matagorda: publicSearch("matagorda", "Matagorda"),
  medina: publicSearch("medina", "Medina"),
  midland: publicSearch("midland", "Midland"),
  milam: publicSearch("milam", "Milam"),
  nacogdoches: publicSearch("nacogdoches", "Nacogdoches"),
  nueces: publicSearch("nueces", "Nueces"),
  "red river": publicSearch("redriver", "Red River"),
  reeves: publicSearch("reeves", "Reeves"),
  refugio: publicSearch("refugio", "Refugio"),
  rusk: publicSearch("rusk", "Rusk"),
  "san patricio": publicSearch("sanpatricio", "San Patricio"),
  smith: publicSearch("smith", "Smith"),
  starr: publicSearch("starr", "Starr"),
  walker: publicSearch("walker", "Walker"),
  wilson: publicSearch("wilson", "Wilson"),
  zapata: publicSearch("zapata", "Zapata"),
  travis: {
    county: "Travis",
    clerk: "Travis County Clerk",
    homeUrl: "https://www.tccsearch.org/",
  },
  harris: {
    county: "Harris",
    clerk: "Harris County Clerk",
    homeUrl: "https://www.cclerk.hctx.net/Applications/WebSearch/RP.aspx",
  },
};

const countyFromCad = (cad: string | null | undefined) =>
  baseCounty(cad?.replace(/\s+cad\s*$/i, ""));

export function clerkRecordsFor(cad: string | null | undefined): ClerkRecords | null {
  const c = countyFromCad(cad);
  return (c && CLERK_RECORDS[c]) || null;
}

// "SMITH JOHN & JANE ET UX" → "SMITH JOHN": the clerk search matches a
// party name, and the extra co-owner / "et ux" wording only narrows it to
// nothing.
export function ownerSearchName(owner: string | null | undefined): string | null {
  const s = (owner ?? "")
    .split(/\s(?:&|AND)\s|,|\//i)[0]
    .replace(/\b(ET\s?UX|ET\s?AL|ETVIR|ET\s?VIR|LIFE ESTATE|TRUSTEES?|TR)\b\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return s.length >= 3 ? s : null;
}
