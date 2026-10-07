import { invokeEdgeFunction } from "./edge-functions";
import type {
  AttomComp,
  AttomProperty,
  RegridParcel,
  SourceStatus,
} from "../../../../supabase/pt/functions/_shared/property-sources";

export type { AttomComp, AttomProperty, RegridParcel, SourceStatus };

export type PropertySourcesResult = {
  attom: AttomProperty | null;
  regrid: RegridParcel | null;
  // Recent comparable sales with real prices (ATTOM sales comparables).
  attomComps: AttomComp[];
  status: { attom: SourceStatus; regrid: SourceStatus; attomComps?: SourceStatus };
};

const UNAVAILABLE: PropertySourcesResult = {
  attom: null,
  regrid: null,
  attomComps: [],
  status: { attom: "error", regrid: "error", attomComps: "error" },
};

// ATTOM + Regrid for one property, through the property-sources edge function
// (which holds the API keys). Never throws — a source that isn't configured,
// didn't match, or failed just comes back null with its status.
export async function fetchPropertySources(
  address: string,
  coords: { lat: number; lng: number } | null,
): Promise<PropertySourcesResult> {
  try {
    return await invokeEdgeFunction<PropertySourcesResult>("property-sources", {
      address,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
    });
  } catch {
    return UNAVAILABLE;
  }
}
