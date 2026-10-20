// Setback-based fit: how much of the lot can be built on once the front, rear
// and side setbacks — and any easements / no-build strips along a property
// line — are taken off, and whether the design's footprint fits in what's left.
// Pure arithmetic on the confirmed site values (survey-reading.ts), so the same
// inputs always give the same answer. Lots are treated as rectangles.
import {
  SIDES,
  SIDE_LABEL,
  missingSiteValues,
  siteValues,
  type Side,
  type SiteInputs,
  type SurveyReading,
} from "./survey-reading";

export type FitStatus = "needs_info" | "no_room" | "fits" | "tight" | "too_big";
export const FIT_LABEL: Record<FitStatus, string> = {
  needs_info: "Needs site details",
  no_room: "No buildable area",
  fits: "Fits",
  tight: "Tight fit",
  too_big: "Doesn't fit as planned",
};

export type SideLimit = {
  side: Side;
  /** the distance from the property line nothing can be built inside */
  ft: number;
  /** what sets it: the setback, or an easement / no-build strip that's wider */
  governedBy: string;
  setbackFt: number;
};

export type SiteFit = {
  status: FitStatus;
  missing: string[];
  lot: { widthFt: number; depthFt: number; areaSqFt: number } | null;
  limits: Record<Side, SideLimit> | null;
  envelope: { widthFt: number; depthFt: number; areaSqFt: number; pctOfLot: number } | null;
  program: { buildingAreaSqFt: number | null; floors: number; footprintSqFt: number | null };
  /** how much of the envelope the footprint uses */
  usePct: number | null;
  /** footprint ÷ lot area */
  coveragePct: number | null;
  /** floors needed for the program to fit the envelope (when it doesn't on the planned floors) */
  floorsNeeded: number | null;
  /** a footprint with the envelope's proportions, for the diagram */
  suggested: { widthFt: number; depthFt: number } | null;
  notes: string[];
};

/** "8,000", "8000 sf", "about 8k sq ft" → 8000 */
export function parseArea(s: string | number | null | undefined): number | null {
  if (typeof s === "number") return s > 0 ? s : null;
  if (!s) return null;
  const m = s.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(k)?/i);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] ? 1000 : 1);
  return n > 0 ? n : null;
}
export function parseFloors(s: string | number | null | undefined): number {
  const n = typeof s === "number" ? s : Number(String(s ?? "").match(/\d+/)?.[0]);
  return Number.isFinite(n) && n >= 1 && n <= 100 ? Math.round(n) : 1;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function siteFit(
  reading: SurveyReading | null,
  inputs: SiteInputs | null,
  program: { buildingArea?: string | number | null; floors?: string | number | null },
): SiteFit {
  const v = siteValues(reading, inputs);
  const missing = missingSiteValues(v);
  const buildingAreaSqFt = parseArea(program.buildingArea);
  const floors = parseFloors(program.floors);
  const footprintSqFt = buildingAreaSqFt ? Math.ceil(buildingAreaSqFt / floors) : null;
  const notes: string[] = [];
  const base = {
    program: { buildingAreaSqFt, floors, footprintSqFt },
    usePct: null,
    coveragePct: null,
    floorsNeeded: null,
    suggested: null,
  };
  if (missing.length)
    return {
      status: "needs_info",
      missing,
      lot: null,
      limits: null,
      envelope: null,
      notes,
      ...base,
    };

  const W = v.lotWidth.value!,
    D = v.lotDepth.value!;
  const lot = { widthFt: W, depthFt: D, areaSqFt: Math.round(W * D) };

  // each side: the setback, unless an easement / no-build strip along that line is wider
  const limits = Object.fromEntries(
    SIDES.map((s) => {
      const setbackFt = v.setbacks[s].value!;
      let ft = setbackFt;
      let governedBy = `${SIDE_LABEL[s]} setback`;
      for (const e of reading?.easements ?? [])
        if (e.side === s && e.widthFt != null && e.widthFt > ft) {
          ft = e.widthFt;
          governedBy = e.label ?? `${e.type} easement`;
        }
      for (const n of reading?.noBuildAreas ?? [])
        if (n.side === s && n.depthFt != null && n.depthFt > ft) {
          ft = n.depthFt;
          governedBy = n.label ?? n.description;
        }
      return [s, { side: s, ft, governedBy, setbackFt }];
    }),
  ) as Record<Side, SideLimit>;

  const ew = r1(W - limits.left.ft - limits.right.ft);
  const ed = r1(D - limits.front.ft - limits.rear.ft);
  const placedElsewhere = [
    ...(reading?.easements ?? []).filter((e) => e.side === "interior" || e.side === "unknown"),
    ...(reading?.noBuildAreas ?? []).filter((n) => n.side === "interior" || n.side === "unknown"),
  ];
  if (placedElsewhere.length)
    notes.push(
      `${placedElsewhere.length} easement/no-build area${placedElsewhere.length === 1 ? " isn't" : "s aren't"} along a property line and ${placedElsewhere.length === 1 ? "isn't" : "aren't"} taken off the buildable area — check ${placedElsewhere.length === 1 ? "it" : "them"} on the survey.`,
    );
  if (reading?.boundary.shape === "irregular")
    notes.push(
      "The lot isn't a simple rectangle — this treats it as one, so treat the numbers as approximate.",
    );

  if (ew <= 0 || ed <= 0) {
    notes.unshift(
      ew <= 0
        ? `The side limits (${limits.left.ft}' + ${limits.right.ft}') use up the full ${W}' lot width.`
        : `The front and rear limits (${limits.front.ft}' + ${limits.rear.ft}') use up the full ${D}' lot depth.`,
    );
    return { status: "no_room", missing, lot, limits, envelope: null, notes, ...base };
  }
  const envArea = Math.round(ew * ed);
  const envelope = {
    widthFt: ew,
    depthFt: ed,
    areaSqFt: envArea,
    pctOfLot: Math.round((envArea / lot.areaSqFt) * 100),
  };
  if (Math.min(ew, ed) < 20)
    notes.push(
      `The buildable area is only ${Math.min(ew, ed)}' across at its narrowest — hard to fit a practical building.`,
    );

  if (!footprintSqFt) {
    notes.push(
      "Add the building area to the design brief to check the footprint against the buildable area.",
    );
    return {
      status: "fits",
      missing,
      lot,
      limits,
      envelope,
      notes,
      ...base,
      program: { buildingAreaSqFt, floors, footprintSqFt },
    };
  }
  const usePct = Math.round((footprintSqFt / envArea) * 100);
  const coveragePct = Math.round((footprintSqFt / lot.areaSqFt) * 100);
  const status: FitStatus = usePct <= 85 ? "fits" : usePct <= 100 ? "tight" : "too_big";
  const floorsNeeded = status === "too_big" ? Math.ceil(buildingAreaSqFt! / envArea) : null;
  // the footprint with the envelope's proportions (capped at the envelope)
  const k = Math.min(1, Math.sqrt(footprintSqFt / envArea));
  const suggested = { widthFt: r1(ew * k), depthFt: r1(ed * k) };
  if (status === "tight")
    notes.push(
      "The footprint uses almost all of the buildable area — little room left for parking, driveways or open space.",
    );
  if (status === "too_big")
    notes.push(
      floorsNeeded && floorsNeeded <= 6
        ? `On ${floors} floor${floors === 1 ? "" : "s"} the footprint needs ${footprintSqFt.toLocaleString()} sf but only ${envArea.toLocaleString()} sf is buildable — it would fit on ${floorsNeeded} floors, or with a smaller program.`
        : `The program is far larger than the buildable area (${envArea.toLocaleString()} sf) — reduce the building area or look for a larger site.`,
    );
  if (status !== "too_big")
    notes.push(
      `Lot coverage would be about ${coveragePct}% — check the zoning district's maximum.`,
    );
  return {
    status,
    missing,
    lot,
    limits,
    envelope,
    program: { buildingAreaSqFt, floors, footprintSqFt },
    usePct,
    coveragePct,
    floorsNeeded,
    suggested,
    notes,
  };
}
