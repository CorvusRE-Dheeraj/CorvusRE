import type { PropertyRecord } from "./properties";
import type { ProtestRecord } from "./protests";

// For users with more than one property/protest — deterministic, no AI.
// Flags real same-day hearings across a portfolio and gives honest,
// practical scheduling guidance. Deliberately does NOT attempt a computed
// travel-time estimate: no real, verified per-hearing address-to-address
// distance/traffic source exists in this app today (hearingLocation is
// free text read off a real notice, and the real Google Maps travel-time
// APIs this project's key can reach are browser-referrer-restricted — see
// the google-maps-loader.ts comment), so rather than invent a number this
// hands the user a real Google Maps directions link and lets Maps itself
// report the live, accurate time.
export type HearingConflictGroup = {
  date: string;
  hearings: {
    protestId: string;
    propertyId: string;
    address: string;
    time: string | null;
    location: string | null;
    mode: ProtestRecord["hearingMode"];
  }[];
  // True once at least two hearings in this group have a real, different
  // location string — the actual travel-required signal, not just "more
  // than one hearing today" (two hearings at the same courthouse the same
  // day need no travel between them).
  requiresTravel: boolean;
  // A real, zero-API-key Google Maps directions URL between the first two
  // distinct real locations in this group — always accurate (Maps computes
  // the live route itself), never a fabricated number from this app.
  directionsUrl: string | null;
  guidance: string[];
};

function normalizeLocation(v: string | null): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function directionsUrl(origin: string, destination: string): string {
  const params = new URLSearchParams({ api: "1", origin, destination });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function findHearingConflicts(
  protests: ProtestRecord[],
  properties: PropertyRecord[],
): HearingConflictGroup[] {
  const propertyById = new Map(properties.map((p) => [p.id, p] as const));
  // BPP protests (propertyId null) have no property to cross-reference an
  // address/portfolio conflict against — this is a property-portfolio-only
  // check, same scope as the `properties` param it already takes.
  const scheduled = protests.filter(
    (p) => p.status === "hearing_scheduled" && p.hearingDate && p.propertyId,
  ) as (ProtestRecord & { hearingDate: string; propertyId: string })[];

  // Group by calendar date (not by exact string equality of a full
  // timestamp — hearingDate is a date, sameDay compares just the date part
  // in case it's ever a full ISO string).
  const byDate = new Map<string, HearingConflictGroup["hearings"]>();
  for (const protest of scheduled) {
    const key = protest.hearingDate.slice(0, 10);
    const property = propertyById.get(protest.propertyId);
    const entry = {
      protestId: protest.id,
      propertyId: protest.propertyId,
      address: property?.address ?? "your property",
      time: protest.hearingTime,
      location: normalizeLocation(protest.hearingLocation),
      mode: protest.hearingMode,
    };
    const list = byDate.get(key);
    if (list) list.push(entry);
    else byDate.set(key, [entry]);
  }

  const result: HearingConflictGroup[] = [];
  for (const [date, hearings] of byDate) {
    if (hearings.length < 2) continue;

    const distinctLocations = [
      ...new Set(hearings.map((h) => h.location).filter((l): l is string => l != null)),
    ];
    const remoteCount = hearings.filter(
      (h) => h.mode === "Phone" || h.mode === "Videoconference" || h.mode === "Affidavit",
    ).length;
    const requiresTravel = distinctLocations.length >= 2;

    const guidance: string[] = [];
    if (remoteCount > 0) {
      guidance.push(
        `${remoteCount} of these ${hearings.length} hearings can be attended remotely (${hearings
          .filter(
            (h) => h.mode === "Phone" || h.mode === "Videoconference" || h.mode === "Affidavit",
          )
          .map((h) => h.address)
          .join(", ")}) — no travel required for those.`,
      );
    }
    if (requiresTravel) {
      guidance.push(
        "These hearings are at different locations — check the real driving time between them (link below) before your day, and add at least a 30–45 minute buffer beyond that for parking, security, and check-in.",
      );
      guidance.push(
        "If either county allows it, ask about rescheduling one hearing or attending by phone/video instead — contact the county directly, since no county publishes live rescheduling availability.",
      );
    } else if (distinctLocations.length === 1) {
      guidance.push(
        "Both hearings are at the same location — you may be able to attend them back-to-back with a shorter buffer between them.",
      );
    } else {
      guidance.push(
        "At least one hearing's location isn't on file yet — upload its hearing notice to know whether travel is required.",
      );
    }
    guidance.push(
      "Hearing times are read from each county's own notice and can be approximate — call ahead to confirm your exact check-in time if these look close together.",
    );

    result.push({
      date,
      hearings,
      requiresTravel,
      directionsUrl:
        distinctLocations.length >= 2
          ? directionsUrl(distinctLocations[0], distinctLocations[1])
          : null,
      guidance,
    });
  }

  return result.sort((a, b) => a.date.localeCompare(b.date));
}
