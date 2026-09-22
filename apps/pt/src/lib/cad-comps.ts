import { invokeEdgeFunction } from "./edge-functions";

export type CompProperty = {
  pid: number;
  address: string;
  latitude: number;
  longitude: number;
  marketValue: number | null;
  ownerName: string | null;
  // Real fields already on the same CAD row — see comps-analysis.ts. Never a
  // sale price or building SF: Texas doesn't require either to be public
  // (see the cad-comps deploy comment) and no such field exists here.
  // Optional (not just nullable) so existing test fixtures that mock a
  // CompProperty without these — savings-estimate.test.ts,
  // success-probability.test.ts — don't need updating; the real API always
  // populates them.
  legalAcreage?: number | null;
  landValue?: number | null;
  improvementValue?: number | null;
  appraisedValue?: number | null;
  // A real deed/transfer date, never a sale price — labeled "Last Transfer"
  // in the UI, not "Sale Date", so it's never mistaken for one.
  lastTransferDt?: string | null;
  // Raw CAD property-type code — used only for the same/different-type
  // similarity signal, never shown untranslated in the UI.
  propType?: string | null;
  zoning?: string | null;
};

export type CompsResult = {
  subject: (CompProperty & { asCode: string }) | null;
  comps: CompProperty[];
};

// Real data for the 4 TrueProdigy counties (Denton, Montgomery, Tarrant, Travis —
// same-subdivision comps) and Collin (nearest same-category parcels within 5
// miles, from the county's own parcel layer) — every other county gets
// { subject: null, comps: [] } rather than a fabricated map.
export async function getComps(input: {
  cad?: string;
  accountNumber?: string;
  // Only used by counties whose comps come from a spatial parcel query (e.g.
  // Collin) when the saved account number isn't that county's own id — the
  // address finds the parcel, the assessed value picks between several that
  // share one address.
  address?: string;
  totalValue?: number;
}): Promise<CompsResult> {
  return invokeEdgeFunction<CompsResult>("cad-comps", input);
}
