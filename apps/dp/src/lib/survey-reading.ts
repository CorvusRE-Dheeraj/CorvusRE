// What Corvus AI read from the land survey (supabase/dp/functions/ai-survey-read)
// and what the user confirmed or entered (design_requests.site_inputs). The
// user's values always win; anything the fit and schematic steps need that
// neither provides is "missing" and the UI asks for it.
import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";

export type Side = "front" | "rear" | "left" | "right";
export const SIDES: Side[] = ["front", "rear", "left", "right"];
export const SIDE_LABEL: Record<Side, string> = {
  front: "Front",
  rear: "Rear",
  left: "Left side",
  right: "Right side",
};
type Conf = "high" | "medium" | "low";

export type SurveyReading = {
  quality: "clear" | "partly_readable" | "unreadable";
  isSurvey: boolean;
  boundary: {
    shape: "rectangular" | "irregular" | "unknown";
    description: string | null;
    sides: {
      side: Side | "unknown";
      lengthFt: number | null;
      bearing: string | null;
      source: string | null;
    }[];
  };
  lot: {
    widthFt: number | null;
    depthFt: number | null;
    areaSqFt: number | null;
    source: string | null;
  };
  orientation: { northArrow: boolean; frontFaces: string | null; note: string | null };
  frontage: {
    street: string | null;
    cornerLot: boolean;
    secondStreet: string | null;
    access: string | null;
  };
  easements: {
    type: string;
    side: Side | "interior" | "unknown";
    widthFt: number | null;
    label: string | null;
  }[];
  noBuildAreas: {
    description: string;
    side: Side | "interior" | "unknown";
    depthFt: number | null;
    label: string | null;
  }[];
  setbacks: Record<Side, { ft: number | null; label: string | null }>;
  envelope: {
    shown: boolean;
    widthFt: number | null;
    depthFt: number | null;
    areaSqFt: number | null;
    note: string | null;
  };
  existing: string[];
  labels: {
    legalDescription: string | null;
    address: string | null;
    surveyor: string | null;
    date: string | null;
    notes: string[];
  };
  confidence: { lot: Conf; setbacks: Conf; easements: Conf; orientation: Conf };
  flags: { field: string; issue: string }[];
  /** where the lot is drawn on the survey, for the plan overlay (absent on older readings) */
  placement?: import("./survey-image").Placement | null;
};

/** Values the user confirmed or typed in, in feet. */
export type SiteInputs = {
  lotWidthFt?: number | null;
  lotDepthFt?: number | null;
  setbacks?: Partial<Record<Side, number | null>>;
  /** buildable-area assumptions the user can correct */
  buildingAreaSqFt?: number | null;
  floors?: number | null;
  /** square feet of building per parking space; 0 = no parking needed */
  parkingSfPerStall?: number | null;
  maxCoveragePct?: number | null;
  /** survey easements / no-build areas the user says don't apply ("e0", "n1", …) */
  excludedStrips?: string[];
  /** strips the user adds that the survey didn't show */
  extraStrips?: { side: Side; ft: number; label: string }[];
  /** the user confirmed the reading + these values (key = what was confirmed) */
  confirmedAt?: string | null;
  confirmedKey?: string | null;
};

export type Sourced = {
  value: number | null;
  source: "you" | "survey" | null;
  label?: string | null;
};
export type SiteValues = {
  lotWidth: Sourced;
  lotDepth: Sourced;
  lotArea: Sourced;
  setbacks: Record<Side, Sourced>;
};

const pickVal = (
  mine: number | null | undefined,
  survey: number | null | undefined,
  label?: string | null,
  // a setback can genuinely be 0 (zero-lot-line); a lot dimension can't
  allowZero = false,
): Sourced =>
  mine != null && (allowZero ? mine >= 0 : mine > 0)
    ? { value: mine, source: "you" }
    : survey != null && (allowZero ? survey >= 0 : survey > 0)
      ? { value: survey, source: "survey", label: label ?? null }
      : { value: null, source: null };

export function siteValues(reading: SurveyReading | null, inputs: SiteInputs | null): SiteValues {
  const r = reading;
  const i = inputs ?? {};
  const lotWidth = pickVal(i.lotWidthFt, r?.lot.widthFt, r?.lot.source);
  const lotDepth = pickVal(i.lotDepthFt, r?.lot.depthFt, r?.lot.source);
  const area =
    lotWidth.source === "you" || lotDepth.source === "you"
      ? lotWidth.value && lotDepth.value
        ? { value: Math.round(lotWidth.value * lotDepth.value), source: "you" as const }
        : { value: null, source: null }
      : pickVal(
          null,
          r?.lot.areaSqFt ??
            (lotWidth.value && lotDepth.value ? lotWidth.value * lotDepth.value : null),
          r?.lot.source,
        );
  const setbacks = Object.fromEntries(
    SIDES.map((s) => [
      s,
      pickVal(i.setbacks?.[s], r?.setbacks[s]?.ft, r?.setbacks[s]?.label, true),
    ]),
  ) as Record<Side, Sourced>;
  return { lotWidth, lotDepth, lotArea: area, setbacks };
}

/** What the fit and schematic steps still need (lot size and all four setbacks). */
export function missingSiteValues(v: SiteValues): string[] {
  const out: string[] = [];
  if (!v.lotWidth.value) out.push("Lot width");
  if (!v.lotDepth.value) out.push("Lot depth");
  for (const s of SIDES) if (v.setbacks[s].value == null) out.push(`${SIDE_LABEL[s]} setback`);
  return out;
}

/** Show "Some site details could not be confidently read…" when anything is doubtful. */
export function readingIsUnclear(r: SurveyReading | null, v: SiteValues): boolean {
  if (!r) return false;
  return (
    r.quality !== "clear" ||
    !r.isSurvey ||
    r.flags.length > 0 ||
    r.confidence.lot === "low" ||
    r.confidence.setbacks === "low" ||
    missingSiteValues(v).length > 0
  );
}

/** A lot area that doesn't match width × depth by more than 5% usually means an irregular lot or a misread. */
export function areaMismatch(r: SurveyReading | null): string | null {
  if (!r?.lot.widthFt || !r.lot.depthFt || !r.lot.areaSqFt) return null;
  const calc = r.lot.widthFt * r.lot.depthFt;
  const diff = Math.abs(calc - r.lot.areaSqFt) / r.lot.areaSqFt;
  return diff > 0.05
    ? `Width × depth is ${Math.round(calc).toLocaleString()} sf but the survey states ${Math.round(r.lot.areaSqFt).toLocaleString()} sf — the lot may not be a simple rectangle.`
    : null;
}

export async function readSurvey(designRequestId: string) {
  return invokeEdgeFunction<{ reading: SurveyReading; readAt: string }>("ai-survey-read", {
    designRequestId,
  });
}

export async function saveSiteInputs(designRequestId: string, inputs: SiteInputs) {
  const { error } = await supabase
    .from("design_requests")
    .update({ site_inputs: inputs })
    .eq("id", designRequestId);
  if (error) throw error;
}

export const ft = (n: number | null | undefined) =>
  n == null ? "—" : `${Number.isInteger(n) ? n : n.toFixed(1)}'`;
export const sqft = (n: number | null | undefined) =>
  n == null ? "—" : `${Math.round(n).toLocaleString()} sf`;
