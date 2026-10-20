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

/** An easement / no-build strip: from the survey or added by the user; `included` = counts. */
export type Strip = {
  key: string;
  side: Side | "interior" | "unknown";
  ft: number | null;
  label: string;
  source: "survey" | "you";
  included: boolean;
};

export function siteStrips(reading: SurveyReading | null, inputs: SiteInputs | null): Strip[] {
  const off = new Set(inputs?.excludedStrips ?? []);
  return [
    ...(reading?.easements ?? []).map((e, i) => ({
      key: `e${i}`,
      side: e.side,
      ft: e.widthFt,
      label: e.label ?? `${e.type} easement`,
      source: "survey" as const,
      included: !off.has(`e${i}`),
    })),
    ...(reading?.noBuildAreas ?? []).map((n, i) => ({
      key: `n${i}`,
      side: n.side,
      ft: n.depthFt,
      label: n.label ?? n.description,
      source: "survey" as const,
      included: !off.has(`n${i}`),
    })),
    ...(inputs?.extraStrips ?? []).map((x, i) => ({
      key: `x${i}`,
      side: x.side,
      ft: x.ft,
      label: x.label || "No-build strip",
      source: "you" as const,
      included: true,
    })),
  ];
}

export type SiteFit = {
  status: FitStatus;
  /** the strips that count, along a property line (drawn hatched) */
  strips: Strip[];
  /** footprint allowed by the max lot coverage, when one is set */
  maxFootprintSqFt: number | null;
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
  const buildingAreaSqFt = inputs?.buildingAreaSqFt || parseArea(program.buildingArea);
  const floors = inputs?.floors ? parseFloors(inputs.floors) : parseFloors(program.floors);
  const allStrips = siteStrips(reading, inputs);
  const strips = allStrips.filter(
    (x) => x.included && x.ft != null && ["front", "rear", "left", "right"].includes(x.side),
  );
  const footprintSqFt = buildingAreaSqFt ? Math.ceil(buildingAreaSqFt / floors) : null;
  const notes: string[] = [];
  const base = {
    strips,
    maxFootprintSqFt: null as number | null,
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
      for (const x of strips)
        if (x.side === s && x.ft! > ft) {
          ft = x.ft!;
          governedBy = x.label;
        }
      return [s, { side: s, ft, governedBy, setbackFt }];
    }),
  ) as Record<Side, SideLimit>;

  const ew = r1(W - limits.left.ft - limits.right.ft);
  const ed = r1(D - limits.front.ft - limits.rear.ft);
  const placedElsewhere = allStrips.filter(
    (x) => x.included && (x.side === "interior" || x.side === "unknown"),
  );
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
  // a max lot coverage can allow less than the envelope
  const maxFootprintSqFt = inputs?.maxCoveragePct
    ? Math.round((lot.areaSqFt * inputs.maxCoveragePct) / 100)
    : null;
  const allowed = maxFootprintSqFt ? Math.min(envArea, maxFootprintSqFt) : envArea;
  if (maxFootprintSqFt && maxFootprintSqFt < envArea)
    notes.push(
      `The ${inputs!.maxCoveragePct}% maximum lot coverage allows ${maxFootprintSqFt.toLocaleString()} sf of footprint — less than the ${envArea.toLocaleString()} sf the setbacks leave.`,
    );
  const usePct = Math.round((footprintSqFt / allowed) * 100);
  const coveragePct = Math.round((footprintSqFt / lot.areaSqFt) * 100);
  const status: FitStatus = usePct <= 85 ? "fits" : usePct <= 100 ? "tight" : "too_big";
  const floorsNeeded = status === "too_big" ? Math.ceil(buildingAreaSqFt! / allowed) : null;
  // the footprint with the envelope's proportions (capped at what's allowed)
  const k = Math.min(1, Math.sqrt(Math.min(footprintSqFt, allowed) / envArea));
  const suggested = { widthFt: r1(ew * k), depthFt: r1(ed * k) };
  if (status === "tight")
    notes.push(
      "The footprint uses almost all of the buildable area — little room left for parking, driveways or open space.",
    );
  if (status === "too_big")
    notes.push(
      floorsNeeded && floorsNeeded <= 6
        ? `On ${floors} floor${floors === 1 ? "" : "s"} the footprint needs ${footprintSqFt.toLocaleString()} sf but only ${allowed.toLocaleString()} sf is allowed — it would fit on ${floorsNeeded} floors, or with a smaller program.`
        : `The program is far larger than the buildable area (${allowed.toLocaleString()} sf) — reduce the building area or look for a larger site.`,
    );
  if (status !== "too_big" && !maxFootprintSqFt)
    notes.push(
      `Lot coverage would be about ${coveragePct}% — check the zoning district's maximum.`,
    );
  return {
    status,
    strips,
    maxFootprintSqFt,
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
