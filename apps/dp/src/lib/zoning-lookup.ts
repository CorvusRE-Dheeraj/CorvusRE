import { invokeEdgeFunction } from "./edge-functions";

// The zoning-lookup edge function: an address's zoning from the city's own
// public zoning map (see supabase/dp/functions/zoning-lookup for which cities
// and how). "no_zoning" is a real answer (Houston, or outside city limits),
// not a failure.
export type ZoningLookup =
  | {
      status: "found";
      code: string;
      description: string | null;
      extras: string[];
      nearby: string[];
      city: string;
      source: string;
      mapUrl: string;
    }
  | { status: "no_zoning"; city: string | null; reason: string }
  | { status: "not_covered"; city: string; reason: string }
  | { status: "not_found"; city: string | null; reason: string };

export async function lookupZoning(address: string): Promise<ZoningLookup> {
  try {
    return await invokeEdgeFunction<ZoningLookup>("zoning-lookup", { address });
  } catch {
    return {
      status: "not_found",
      city: null,
      reason: "The zoning lookup didn't respond — type the zoning in if you know it.",
    };
  }
}

/** The intake fields a lookup result fills in. */
export function zoningFields(r: ZoningLookup): {
  zoning: string;
  zoningDescription?: string;
  zoningStatus: ZoningLookup["status"];
  zoningSource?: string;
  zoningNote?: string;
} {
  if (r.status === "found") {
    const note = [
      r.extras.length ? r.extras.join(" · ") : "",
      r.nearby.length ? `Nearby: ${r.nearby.join(", ")} — check the exact parcel line` : "",
    ]
      .filter(Boolean)
      .join(". ");
    return {
      zoning: r.code,
      zoningDescription: r.description ?? undefined,
      zoningStatus: "found",
      zoningSource: r.source,
      zoningNote: note || undefined,
    };
  }
  return { zoning: "", zoningStatus: r.status, zoningNote: r.reason };
}
