// Site grading, floodplain and ingress/egress analyses for the Site Data
// pages. The raw public data comes from the site-analysis edge function
// (Census geocoder, FEMA NFHL, USGS 3DEP elevations, Census TIGER roads);
// everything here is pure interpretation of it, so it's testable and the
// same data always reads the same way.
import { invokeEdgeFunction } from "./edge-functions";

export type FloodZone = { zone: string; subtype: string | null; sfha: boolean; bfe: number | null };
export type RoadHit = {
  name: string;
  aliases: string[];
  mtfcc: string;
  layer: string;
  distanceM: number;
  bearingDeg: number;
};
export type SiteAnalysisRaw = {
  fetchedAt: string;
  address: string;
  geocode: { x: number; y: number; matched: string };
  flood: {
    atPoint: FloodZone[];
    nearby: FloodZone[] | null;
    panel: { number: string; effective: string | null } | null;
  } | null;
  elevation: {
    sideFt: number;
    assumedLot: boolean;
    points: { dx: number; dy: number; ft: number }[];
  } | null;
  roads: RoadHit[] | null;
  errors: Record<string, string>;
};

export async function runSiteAnalysis(target: { projectId: string } | { designRequestId: string }) {
  return invokeEdgeFunction<{ analysis: SiteAnalysisRaw }>("site-analysis", target);
}

const COMPASS = [
  "north",
  "northeast",
  "east",
  "southeast",
  "south",
  "southwest",
  "west",
  "northwest",
];
export const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

// ── Floodplain ───────────────────────────────────────────────────────────────
export type FloodStatus = "floodway" | "sfha" | "moderate" | "minimal" | "undetermined" | "unknown";
export type FloodResult = {
  status: FloodStatus;
  inFloodplain: boolean;
  zone: string | null;
  label: string;
  nearFloodplain: boolean;
  bfe: number | null;
  panel: { number: string; effective: string | null } | null;
  requirements: string[];
};
const isSfha = (z: FloodZone) => z.sfha || /^(A|V)/.test(z.zone);
const isFloodway = (z: FloodZone) => /FLOODWAY/i.test(z.subtype ?? "");
const isModerate = (z: FloodZone) => /0\.2 PCT/i.test(z.subtype ?? "") || z.zone === "B";

export function floodplain(raw: SiteAnalysisRaw | null): FloodResult | null {
  const f = raw?.flood;
  if (!f) return null;
  const at = f.atPoint;
  const nearFloodplain = !at.some(isSfha) && !!f.nearby?.some(isSfha);
  const base = { panel: f.panel, nearFloodplain, bfe: at.find((z) => z.bfe != null)?.bfe ?? null };
  if (at.some(isFloodway)) {
    const z = at.find(isFloodway)!;
    return {
      ...base,
      status: "floodway",
      inFloodplain: true,
      zone: `${z.zone} (floodway)`,
      label: "In the regulatory floodway — the channel that carries the 100-year flood",
      requirements: [
        "Building in a floodway is heavily restricted — any development needs an engineer's \"no-rise\" certification showing it won't raise flood levels.",
        "Floodplain development permit from the city/county floodplain administrator.",
        "Expect the buildable area to be limited to the parts of the lot outside the floodway — a survey with the floodway line is essential.",
        "Flood insurance is required for federally backed mortgages.",
      ],
    };
  }
  if (at.some(isSfha)) {
    const z = at.find(isSfha)!;
    return {
      ...base,
      status: "sfha",
      inFloodplain: true,
      zone: z.zone,
      label: `In the 100-year floodplain (FEMA Zone ${z.zone} — 1% annual chance)`,
      requirements: [
        "Floodplain development permit before grading or building.",
        `Lowest floor at or above the base flood elevation${base.bfe != null ? ` (${base.bfe} ft)` : ""} plus the local freeboard — often 1–2 ft in Texas cities.`,
        "Elevation certificate from a surveyor; fill or grading in the floodplain may need a FEMA map revision (CLOMR/LOMR) and drainage study.",
        "Flood insurance is required for federally backed mortgages.",
      ],
    };
  }
  if (at.some(isModerate))
    return {
      ...base,
      status: "moderate",
      inFloodplain: false,
      zone: "X (shaded)",
      label: "Outside the 100-year floodplain, in the 500-year area (0.2% annual chance)",
      requirements: [
        "No FEMA floodplain permit, but flood risk is real — flood insurance is recommended.",
        "Some cities regulate critical facilities (hospitals, schools, emergency services) in the 500-year area.",
      ],
    };
  if (at.some((z) => z.zone === "D"))
    return {
      ...base,
      status: "undetermined",
      inFloodplain: false,
      zone: "D",
      label: "Flood hazard not studied by FEMA here (Zone D)",
      requirements: [
        "Ask the floodplain administrator whether a local flood study applies before designing.",
      ],
    };
  if (at.length)
    return {
      ...base,
      status: "minimal",
      inFloodplain: false,
      zone: "X",
      label: "Not in a FEMA floodplain (Zone X — minimal flood hazard)",
      requirements: [
        "No FEMA floodplain requirements. Local drainage and detention rules still apply.",
      ],
    };
  return {
    ...base,
    status: "unknown",
    inFloodplain: false,
    zone: null,
    label: "No FEMA flood map covers this point",
    requirements: ["Check with the local floodplain administrator."],
  };
}

// ── Site grading ─────────────────────────────────────────────────────────────
export type GradeClass = "very_flat" | "gentle" | "moderate" | "steep" | "very_steep";
export const GRADE_LABEL: Record<GradeClass, string> = {
  very_flat: "Very flat",
  gentle: "Gently sloping",
  moderate: "Moderate slope",
  steep: "Steep",
  very_steep: "Very steep",
};
export type GradingResult = {
  slopePct: number;
  reliefFt: number;
  lowFt: number;
  highFt: number;
  downhill: string | null;
  unevenFt: number;
  grade: GradeClass;
  sideFt: number;
  assumedLot: boolean;
  notes: string[];
};

/** Least-squares plane z = a + b·dx + c·dy through the sampled points. */
export function fitPlane(points: { dx: number; dy: number; ft: number }[]) {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.dx, 0) / n;
  const my = points.reduce((s, p) => s + p.dy, 0) / n;
  const mz = points.reduce((s, p) => s + p.ft, 0) / n;
  let sxx = 0,
    syy = 0,
    sxy = 0,
    sxz = 0,
    syz = 0;
  for (const p of points) {
    const x = p.dx - mx,
      y = p.dy - my,
      z = p.ft - mz;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
    sxz += x * z;
    syz += y * z;
  }
  const det = sxx * syy - sxy * sxy;
  const b = det ? (sxz * syy - syz * sxy) / det : 0;
  const c = det ? (syz * sxx - sxz * sxy) / det : 0;
  const a = mz - b * mx - c * my;
  return { a, b, c };
}

export function grading(raw: SiteAnalysisRaw | null): GradingResult | null {
  const e = raw?.elevation;
  if (!e || e.points.length < 5) return null;
  const { a, b, c } = fitPlane(e.points);
  const slopePct = Math.round(Math.hypot(b, c) * 1000) / 10;
  const zs = e.points.map((p) => p.ft);
  const lowFt = Math.min(...zs),
    highFt = Math.max(...zs);
  const reliefFt = Math.round((highFt - lowFt) * 10) / 10;
  const unevenFt =
    Math.round(Math.max(...e.points.map((p) => Math.abs(p.ft - (a + b * p.dx + c * p.dy)))) * 10) /
    10;
  // downhill = opposite the gradient (dx east, dy north)
  const downhill = slopePct >= 0.3 ? compass((Math.atan2(-b, -c) * 180) / Math.PI) : null;
  const grade: GradeClass =
    slopePct < 1
      ? "very_flat"
      : slopePct < 3
        ? "gentle"
        : slopePct < 6
          ? "moderate"
          : slopePct < 12
            ? "steep"
            : "very_steep";
  const notes = {
    very_flat: [
      "Under 1% slope: water won't drain off by itself — the grading plan has to create fall (typically 1–2% away from the building) with fill, swales or inlets.",
    ],
    gentle: [
      "1–3% slope: typical, buildable ground — modest cut and fill to set the pad and drain it.",
    ],
    moderate: [
      "3–6% slope: expect noticeable cut and fill, possibly low retaining walls or a stepped slab; parking and drives need care to stay under ADA/fire-lane grade limits.",
    ],
    steep: [
      "6–12% slope: significant earthwork — retaining walls, stepped foundations and a geotechnical report are likely; lay the building and drives along the contours.",
    ],
    very_steep: [
      "Over 12% slope: major earthwork and slope-stability design; many cities limit development on slopes this steep — a topographic survey and geotech report come first.",
    ],
  }[grade];
  if (downhill)
    notes.push(
      `The ground falls toward the ${downhill} — storm water will leave the site that way, which is where detention and outfalls usually go.`,
    );
  if (unevenFt >= 2)
    notes.push(
      `The ground is uneven (up to ${unevenFt} ft off a straight plane) — there may be a ridge, swale or ditch on the lot.`,
    );
  if (reliefFt >= 10) notes.push(`About ${reliefFt} ft of fall across the sampled area.`);
  return {
    slopePct,
    reliefFt,
    lowFt,
    highFt,
    downhill,
    unevenFt,
    grade,
    sideFt: e.sideFt,
    assumedLot: e.assumedLot,
    notes,
  };
}

// ── Ingress / egress + TIA ───────────────────────────────────────────────────
export const ROAD_CLASS: Record<string, string> = {
  S1100: "Interstate / primary highway",
  S1200: "US / state highway or major arterial",
  S1400: "Local street",
  S1500: "Unpaved road",
  S1630: "Highway ramp",
  S1640: "Highway frontage road",
  S1730: "Alley",
};
const TXDOT_NAME =
  /(^|[\s(])(US|SH|FM|RM|IH|I-\d|Interstate|State Hwy|State Highway|Hwy|Highway|Farm[- ]to[- ]Market|Ranch[- ]to[- ]Market|State Loop|Loop \d|Spur \d|Business \d)/i;
export const isStateRoad = (r: RoadHit) =>
  ["S1100", "S1200", "S1630", "S1640"].includes(r.mtfcc) ||
  [r.name, ...r.aliases].some((n) => TXDOT_NAME.test(n));

/** Approximate ITE trip-generation rates per 1,000 sf: weekday PM peak hour and daily. */
const TRIP_RATES: Record<string, { pm: number; daily: number; use: string }> = {
  retail: { pm: 3.4, daily: 37.0, use: "shopping / retail" },
  office: { pm: 1.44, daily: 10.84, use: "general office" },
  restaurant: { pm: 9.05, daily: 107.2, use: "sit-down restaurant" },
  hospitality: { pm: 0.6, daily: 8.0, use: "hotel" },
  healthcare: { pm: 3.93, daily: 36.0, use: "medical office" },
  education_childcare: { pm: 11.12, daily: 47.6, use: "day care" },
  personal_services_fitness: { pm: 3.45, daily: 34.5, use: "health / fitness club" },
  entertainment_recreation: { pm: 2.0, daily: 20.0, use: "recreation" },
  automotive_fuel: { pm: 15.0, daily: 150.0, use: "fuel / convenience" },
  storage_warehousing: { pm: 0.18, daily: 1.71, use: "warehousing" },
  data_center: { pm: 0.09, daily: 0.99, use: "data center" },
  mixed_use: { pm: 2.5, daily: 25.0, use: "mixed-use commercial" },
  other: { pm: 2.0, daily: 20.0, use: "general commercial" },
};
export const TIA_PEAK_TRIPS = 100;
export const TIA_DAILY_TRIPS = 1000;

export type TiaStatus = "likely" | "possible" | "unlikely" | "needs_info";
export type AccessResult = {
  frontage: (RoadHit & { classLabel: string; state: boolean })[];
  others: (RoadHit & { classLabel: string; state: boolean })[];
  cornerLot: boolean;
  txdot: boolean;
  trips: { pm: number; daily: number; basis: string } | null;
  tia: TiaStatus;
  tiaReason: string;
  notes: string[];
};

export function tripEstimate(program: {
  sector?: string | null;
  subcategory?: string | null;
  buildingAreaSqFt?: number | null;
  floors?: number | null;
}): { pm: number; daily: number; basis: string } | null {
  const a = program.buildingAreaSqFt;
  if (!a || a <= 0) return null;
  if (program.sector === "residential") {
    const multi = (program.floors ?? 1) >= 3 || a > 6000;
    const units = multi ? Math.max(2, Math.round(a / 1000)) : 1;
    const pm = Math.round(units * (multi ? 0.39 : 0.94));
    const daily = Math.round(units * (multi ? 4.54 : 9.43));
    return {
      pm,
      daily,
      basis: multi ? `about ${units} apartments (≈1,000 sf each)` : "one single-family home",
    };
  }
  const r = TRIP_RATES[program.subcategory ?? ""] ?? TRIP_RATES.other;
  return {
    pm: Math.round((a / 1000) * r.pm),
    daily: Math.round((a / 1000) * r.daily),
    basis: `${Math.round(a).toLocaleString()} sf of ${r.use}`,
  };
}

export function access(
  raw: SiteAnalysisRaw | null,
  program: {
    sector?: string | null;
    subcategory?: string | null;
    buildingAreaSqFt?: number | null;
    floors?: number | null;
    intent?: string | null;
  },
): AccessResult | null {
  const roads = raw?.roads;
  if (!roads) return null;
  const tag = (r: RoadHit) => ({
    ...r,
    classLabel: ROAD_CLASS[r.mtfcc] ?? "Road",
    state: isStateRoad(r),
  });
  const near = roads.filter((r) => r.distanceM <= 30).map(tag);
  const frontage = near.length ? near : roads.slice(0, 1).map(tag);
  const others = roads
    .filter((r) => !frontage.some((f) => f.name === r.name))
    .slice(0, 4)
    .map(tag);
  const cornerLot =
    frontage.length >= 2 &&
    frontage.some((a, i) =>
      frontage
        .slice(i + 1)
        .some((b) => Math.abs(((a.bearingDeg - b.bearingDeg + 540) % 360) - 180) > 45),
    );
  const txdot = frontage.some((r) => r.state);
  const trips = tripEstimate(program);
  let tia: TiaStatus, tiaReason: string;
  if (!trips) {
    tia = "needs_info";
    tiaReason = "Add the building area to estimate traffic.";
  } else if (trips.pm >= TIA_PEAK_TRIPS || trips.daily >= TIA_DAILY_TRIPS) {
    tia = "likely";
    tiaReason = `About ${trips.pm} PM peak-hour and ${trips.daily.toLocaleString()} daily trips — over the ${TIA_PEAK_TRIPS} peak-hour / ${TIA_DAILY_TRIPS.toLocaleString()} daily threshold most Texas cities use for a Traffic Impact Analysis.`;
  } else if (trips.pm >= TIA_PEAK_TRIPS / 2 || trips.daily >= TIA_DAILY_TRIPS / 2) {
    tia = "possible";
    tiaReason = `About ${trips.pm} PM peak-hour and ${trips.daily.toLocaleString()} daily trips — below the usual threshold, but some cities set it lower or ask for a TIA worksheet; confirm at the pre-application meeting.`;
  } else {
    tia = "unlikely";
    tiaReason = `About ${trips.pm} PM peak-hour and ${trips.daily.toLocaleString()} daily trips — well under the usual ${TIA_PEAK_TRIPS} peak-hour threshold.`;
  }
  const notes: string[] = [];
  const main = frontage[0];
  if (main)
    notes.push(
      `Primary access from ${main.name}${main.aliases.length ? ` (${main.aliases.join(", ")})` : ""} — ${main.classLabel.toLowerCase()}.`,
    );
  if (cornerLot) {
    // state road < other major road < local street — the driveway goes on the last
    const rank = (r: RoadHit & { state: boolean }) =>
      r.state ? 0 : r.mtfcc === "S1400" || r.mtfcc === "S1730" ? 2 : 1;
    const lower = [...frontage].sort((x, y) => rank(y) - rank(x))[0];
    notes.push(
      `Corner lot — two street frontages. Cities usually want driveways on the lower-classed street${lower ? ` (${lower.name})` : ""} and kept back from the intersection.`,
    );
  }
  if (txdot)
    notes.push(
      "Fronts a state road: a driveway needs a TxDOT access permit, with spacing from other driveways and intersections set by TxDOT's Access Management Manual; TxDOT may also ask for a traffic study.",
    );
  else if (main)
    notes.push(
      "Driveway permits come from the city — expect minimum spacing from intersections and other driveways.",
    );
  if (
    program.intent &&
    program.intent !== "new_construction" &&
    program.intent !== "site_development" &&
    trips
  )
    notes.push(
      "For a remodel or change of use, a TIA is usually only triggered if the new use adds significant traffic over the existing one.",
    );
  if (tia === "likely" && txdot)
    notes.push(
      "With state-road access and this much traffic, plan for TxDOT and city review of the TIA together.",
    );
  return { frontage, others, cornerLot, txdot, trips, tia, tiaReason, notes };
}

/** Plain-text lines for the downloadable site summary. */
export function analysisSummaryLines(
  raw: SiteAnalysisRaw | null,
  program: Parameters<typeof access>[1],
): string[] {
  if (!raw) return ["SITE ANALYSES", "  Not run yet."];
  const f = floodplain(raw),
    g = grading(raw),
    a = access(raw, program);
  return [
    `SITE GRADING`,
    g
      ? `  ${GRADE_LABEL[g.grade]} — about ${g.slopePct}% slope${g.downhill ? `, falling to the ${g.downhill}` : ""}; ${g.reliefFt} ft relief (${g.lowFt}–${g.highFt} ft)`
      : "  Not available",
    ...(g?.notes ?? []).map((n) => `  - ${n}`),
    ``,
    `FLOODPLAIN`,
    f
      ? `  ${f.label}${f.panel ? ` — FIRM panel ${f.panel.number}${f.panel.effective ? `, effective ${f.panel.effective}` : ""}` : ""}`
      : "  Not available",
    ...(f?.nearFloodplain
      ? [
          "  - A mapped floodplain is within about 150 m (500 ft) — check the survey for the floodplain line.",
        ]
      : []),
    ...(f?.requirements ?? []).map((n) => `  - ${n}`),
    ``,
    `INGRESS & EGRESS`,
    ...(a
      ? a.frontage.map(
          (r) => `  Access: ${r.name} — ${r.classLabel}${r.state ? " (state road, TxDOT)" : ""}`,
        )
      : ["  Not available"]),
    ...(a
      ? [
          `  Traffic Impact Analysis: ${{ likely: "likely required", possible: "possibly required", unlikely: "unlikely", needs_info: "needs building area" }[a.tia]} — ${a.tiaReason}`,
        ]
      : []),
    ...(a?.notes ?? []).map((n) => `  - ${n}`),
    ``,
    `Sources: FEMA National Flood Hazard Layer, USGS 3DEP elevations, US Census TIGER roads (fetched ${raw.fetchedAt.slice(0, 10)}). Early estimates — not a survey, flood determination or traffic study.`,
  ];
}
