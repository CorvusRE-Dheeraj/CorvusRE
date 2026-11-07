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
  // search for an owner (grantor/grantee) name
  searchUrl: (owner: string) => string;
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
