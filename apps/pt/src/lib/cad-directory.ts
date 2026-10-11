import directory from "../data/tx-cad-directory.json";
import { countyFromCad } from "./tax-rates-official";

// The Texas Comptroller's official directory of every county's appraisal
// district and tax assessor-collector (src/data/tx-cad-directory.json, rebuilt by
// scripts/build-tx-cad-directory.mjs). The statewide floor under the
// hand-researched county-protest-info.ts entries: real contact facts for all 254
// counties, nothing inferred.

export type DirectoryOffice = {
  phone: string | null;
  email: string | null;
  website: string | null;
  mailingAddress: string | null;
  streetAddress: string | null;
};

export type DirectoryEntry = {
  countyCode: string;
  county: string;
  slug: string;
  appraisalDistrict: (DirectoryOffice & { name: string }) | null;
  taxOffice: DirectoryOffice | null;
  sourceUrl: string;
  builtAt: string;
};

type DirectoryFile = {
  source: string;
  builtAt: string;
  counties: Record<
    string,
    {
      county: string;
      slug: string;
      appraisalDistrict: (DirectoryOffice & { name: string }) | null;
      taxOffice: DirectoryOffice | null;
    }
  >;
};

const data = directory as unknown as DirectoryFile;

// Matches by county, not exact district name — the app's cad strings and the
// Comptroller's differ ("Fort Bend Central Appraisal District" vs "Fort Bend
// Appraisal District").
export function lookupCadDirectory(cad: string | null | undefined): DirectoryEntry | null {
  const county = countyFromCad(cad);
  if (!county) return null;
  for (const [code, c] of Object.entries(data.counties)) {
    if (c.county.toLowerCase() === county) {
      return {
        countyCode: code,
        ...c,
        sourceUrl: `${data.source}${c.slug}.php`,
        builtAt: data.builtAt,
      };
    }
  }
  return null;
}
