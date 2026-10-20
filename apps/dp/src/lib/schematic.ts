// AI schematic plan: the request built from the confirmed site (site-fit.ts),
// and the layout Corvus AI returns (supabase/dp/functions/ai-schematic-plan)
// made safe before it's shown — the building is clamped inside the buildable
// envelope, parking kept on the lot and off the building, the driveway on the
// street side — so every saved option respects the setbacks.
import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";
import type { SiteFit } from "./site-fit";
import type { SiteInputs, SurveyReading } from "./survey-reading";

export const SCHEMATIC_LABEL =
  "Conceptual schematic — subject to professional review; not for construction or permit submission.";
export const SQFT_PER_STALL = 325; // stall + share of drive aisle, typical surface lot

export type Rect = { x: number; y: number; w: number; d: number };
export type Layout = {
  title: string;
  building: Rect[];
  parking: Rect | null;
  driveway: { x: number; w: number; toY: number } | null;
  entrance: "front" | "left" | "right" | "rear";
  openSpace: (Rect & { label: string })[];
  rationale: string;
  assumptions: string[];
};
export type SchematicOption = Layout & {
  id: string;
  createdAt: string;
  instruction: string | null;
  /** what the clamp changed, shown to the user */
  adjustments: string[];
  metrics: {
    footprintSqFt: number;
    targetFootprintSqFt: number | null;
    coveragePct: number;
    stalls: number;
    stallsNeeded: number | null;
    openSpaceSqFt: number;
  };
  /** the site it was generated for — a later change to the site makes it stale */
  siteKey: string;
};
export type Schematic = { options: SchematicOption[]; selected: number };

export const DEFAULT_SF_PER_STALL = 300;
/**
 * Stalls a program needs: 1 per `sfPerStall` of building (default 1 per 300 sf);
 * null for single-family, or when the user says no parking is needed (0).
 */
export function stallsNeeded(
  sector: string | null | undefined,
  buildingAreaSqFt: number | null,
  sfPerStall?: number | null,
): number | null {
  if (!buildingAreaSqFt || sfPerStall === 0) return null;
  if ((sector ?? "commercial") === "residential" && !sfPerStall) return null;
  return Math.ceil(buildingAreaSqFt / (sfPerStall || DEFAULT_SF_PER_STALL));
}

/** A fingerprint of the site + assumptions a plan was fitted to (and the user confirmed). */
export function siteKey(fit: SiteFit, inputs?: SiteInputs | null): string {
  const L = fit.limits;
  return [
    fit.lot?.widthFt,
    fit.lot?.depthFt,
    L?.front.ft,
    L?.rear.ft,
    L?.left.ft,
    L?.right.ft,
    fit.program.buildingAreaSqFt,
    fit.program.floors,
    fit.maxFootprintSqFt,
    fit.strips.map((x) => `${x.side}:${x.ft}`).join(","),
    inputs?.parkingSfPerStall ?? "",
  ]
    .map((v) => v ?? "")
    .join("|");
}
/** What the user confirms: the site + assumptions, and which survey reading they checked. */
export function confirmKey(
  fit: SiteFit,
  inputs: SiteInputs | null,
  readAt: string | null | undefined,
): string {
  return `${siteKey(fit, inputs)}|${readAt ?? "manual"}`;
}
export function isConfirmed(
  fit: SiteFit,
  inputs: SiteInputs | null,
  readAt: string | null | undefined,
): boolean {
  return !!inputs?.confirmedKey && inputs.confirmedKey === confirmKey(fit, inputs, readAt);
}

const area = (r: Rect) => r.w * r.d;
const overlap = (a: Rect, b: Rect) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const d = Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y);
  return w > 0 && d > 0 ? w * d : 0;
};
const r1 = (n: number) => Math.round(n * 10) / 10;
function clampRect(r: Rect, x0: number, y0: number, x1: number, y1: number): Rect | null {
  const x = Math.max(x0, Math.min(r.x, x1)),
    y = Math.max(y0, Math.min(r.y, y1));
  const w = Math.min(r.x + r.w, x1) - x,
    d = Math.min(r.y + r.d, y1) - y;
  return w >= 1 && d >= 1 ? { x: r1(x), y: r1(y), w: r1(w), d: r1(d) } : null;
}

/** Makes an AI layout safe for the site: everything on the lot, the building inside the envelope. */
export function validateLayout(
  layout: Layout,
  fit: SiteFit,
  sector?: string | null,
  inputs?: SiteInputs | null,
): Pick<
  SchematicOption,
  "building" | "parking" | "driveway" | "openSpace" | "adjustments" | "metrics"
> {
  const lot = fit.lot!,
    L = fit.limits!;
  const ex0 = L.left.ft,
    ex1 = lot.widthFt - L.right.ft,
    ey0 = L.front.ft,
    ey1 = lot.depthFt - L.rear.ft;
  const adjustments: string[] = [];
  let building = layout.building
    .map((b) => {
      const c = clampRect(b, ex0, ey0, ex1, ey1);
      if (c && (c.x !== r1(b.x) || c.y !== r1(b.y) || c.w !== r1(b.w) || c.d !== r1(b.d)))
        adjustments.push("Moved the building fully inside the setbacks.");
      return c;
    })
    .filter((b): b is Rect => !!b && b.w >= 8 && b.d >= 8);
  if (!building.length) {
    // fall back to the fit's own footprint, set at the front setback line, centred
    const s = fit.suggested ?? { widthFt: ex1 - ex0, depthFt: ey1 - ey0 };
    building = [{ x: r1(ex0 + (ex1 - ex0 - s.widthFt) / 2), y: ey0, w: s.widthFt, d: s.depthFt }];
    adjustments.push(
      "Corvus AI's building didn't fit the envelope — showing the largest footprint that does.",
    );
  }
  // L-shapes overlap; count the union once
  const footprint = Math.round(
    building.reduce((t, b) => t + area(b), 0) -
      (building.length === 2 ? overlap(building[0], building[1]) : 0),
  );
  let parking = layout.parking ? clampRect(layout.parking, 0, 0, lot.widthFt, lot.depthFt) : null;
  if (parking && building.some((b) => overlap(parking!, b) > 0)) {
    // trim the parking away from the building on the side with more room
    const b = building[0];
    const behind = parking.y >= b.y + b.d / 2;
    const trimmed = behind
      ? clampRect(parking, 0, b.y + b.d, lot.widthFt, lot.depthFt)
      : clampRect(parking, 0, 0, lot.widthFt, b.y);
    parking =
      trimmed && trimmed.d >= 18 && !building.some((x) => overlap(trimmed, x) > 0) ? trimmed : null;
    adjustments.push(
      parking
        ? "Trimmed the parking so it doesn't overlap the building."
        : "Removed parking that overlapped the building.",
    );
  }
  let driveway = layout.driveway;
  if (driveway) {
    const w = Math.max(10, Math.min(driveway.w, 30));
    const x = Math.max(0, Math.min(driveway.x, lot.widthFt - w));
    const toY = Math.max(L.front.ft, Math.min(driveway.toY || L.front.ft, lot.depthFt));
    driveway = { x: r1(x), w: r1(w), toY: r1(toY) };
  }
  const openSpace = layout.openSpace
    .map((o) => {
      const c = clampRect(o, 0, 0, lot.widthFt, lot.depthFt);
      return c && !building.some((b) => overlap(c, b) > c.w * c.d * 0.5)
        ? { ...c, label: o.label }
        : null;
    })
    .filter((o): o is Rect & { label: string } => !!o);
  // parking may sit in a setback (many codes allow it with a buffer) — but say so
  if (parking) {
    const into = [
      parking.y < ey0 - 0.5 && `front (${L.front.ft}′)`,
      parking.y + parking.d > ey1 + 0.5 && `rear (${L.rear.ft}′)`,
      parking.x < ex0 - 0.5 && `left side (${L.left.ft}′)`,
      parking.x + parking.w > ex1 + 0.5 && `right side (${L.right.ft}′)`,
    ].filter(Boolean);
    if (into.length)
      adjustments.push(
        `Parking reaches into the ${into.join(" and ")} setback — many cities allow surface parking there with a landscape buffer; check the zoning code.`,
      );
  }
  if (fit.maxFootprintSqFt && footprint > fit.maxFootprintSqFt * 1.02)
    adjustments.push(
      `The footprint (${footprint.toLocaleString()} sf) is over the ${inputs?.maxCoveragePct ?? ""}% lot-coverage limit (${fit.maxFootprintSqFt.toLocaleString()} sf).`,
    );
  const stalls = parking ? Math.floor(area(parking) / SQFT_PER_STALL) : 0;
  return {
    building,
    parking,
    driveway,
    openSpace,
    adjustments: [...new Set(adjustments)],
    metrics: {
      footprintSqFt: footprint,
      targetFootprintSqFt: fit.program.footprintSqFt,
      coveragePct: Math.round((footprint / lot.areaSqFt) * 100),
      stalls,
      stallsNeeded: stallsNeeded(sector, fit.program.buildingAreaSqFt, inputs?.parkingSfPerStall),
      openSpaceSqFt: Math.round(openSpace.reduce((t, o) => t + area(o), 0)),
    },
  };
}

export async function generateSchematic(opts: {
  designRequestId: string;
  fit: SiteFit;
  reading: SurveyReading | null;
  sector?: string | null;
  inputs?: SiteInputs | null;
  instruction?: string | null;
  previous?: SchematicOption | null;
}): Promise<Layout> {
  const { fit, reading } = opts;
  const lot = fit.lot!,
    L = fit.limits!,
    env = fit.envelope!;
  const describe = (o: SchematicOption) =>
    `${o.title}: building at x ${o.building[0].x}, y ${o.building[0].y} (${o.building[0].w}×${o.building[0].d})${o.parking ? `, parking at x ${o.parking.x}, y ${o.parking.y}` : ""}, entrance ${o.entrance}`;
  const r = await invokeEdgeFunction<{ layout: Layout }>("ai-schematic-plan", {
    designRequestId: opts.designRequestId,
    site: {
      lotWidthFt: lot.widthFt,
      lotDepthFt: lot.depthFt,
      front: L.front.ft,
      rear: L.rear.ft,
      left: L.left.ft,
      right: L.right.ft,
      envX0: L.left.ft,
      envX1: lot.widthFt - L.right.ft,
      envY0: L.front.ft,
      envY1: lot.depthFt - L.rear.ft,
      envW: env.widthFt,
      envD: env.depthFt,
      street: reading?.frontage.street ?? null,
      cornerLot: reading?.frontage.cornerLot ?? false,
      frontFaces: reading?.orientation.frontFaces ?? null,
      easements: fit.strips.map((x) => `${x.label} ${x.ft} ft along the ${x.side}`),
    },
    program: {
      buildingAreaSqFt: fit.program.buildingAreaSqFt,
      floors: fit.program.floors,
      footprintSqFt: fit.program.footprintSqFt,
      parkingStalls: stallsNeeded(
        opts.sector,
        fit.program.buildingAreaSqFt,
        opts.inputs?.parkingSfPerStall,
      ),
      noParking: opts.inputs?.parkingSfPerStall === 0,
      maxFootprintSqFt: fit.maxFootprintSqFt,
    },
    instruction: opts.instruction ?? null,
    previous: opts.previous ? describe(opts.previous) : null,
  });
  return r.layout;
}

export function makeOption(
  layout: Layout,
  fit: SiteFit,
  sector: string | null | undefined,
  instruction: string | null,
  inputs?: SiteInputs | null,
): SchematicOption {
  const v = validateLayout(layout, fit, sector, inputs);
  return {
    ...layout,
    ...v,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    instruction,
    siteKey: siteKey(fit, inputs),
  };
}

export async function saveSchematic(designRequestId: string, schematic: Schematic | null) {
  const { error } = await supabase
    .from("design_requests")
    .update({ schematic })
    .eq("id", designRequestId);
  if (error) throw error;
}
