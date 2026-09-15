// Permit fee estimation (PRD 1.1.16 / 1.1.17 / 2.1.29 / 2.1.30).
//
// Order-of-magnitude estimates from typical US municipal fee structures, scaled
// by construction valuation. Always presented as an estimate with assumptions.
import type { PermitItem } from "./permits";
import type { JurisdictionInfo } from "./jurisdiction";

export type FeeLine = {
  permitId: string;
  label: string;
  low: number;
  high: number;
  basis: string;
};

export type FeeEstimate = {
  lines: FeeLine[];
  subtotalLow: number;
  subtotalHigh: number;
  impactFeesLow: number;
  impactFeesHigh: number;
  totalLow: number;
  totalHigh: number;
  assumptions: string[];
};

/** rough construction valuation from building area + a $/sf cost band */
export function estimateConstructionValue(
  buildingAreaSqft: number | null,
  sector: "commercial" | "residential" = "commercial",
): { low: number; high: number } {
  const sf = buildingAreaSqft && buildingAreaSqft > 0 ? buildingAreaSqft : 10000;
  const band = sector === "commercial" ? [180, 320] : [140, 260];
  return { low: sf * band[0], high: sf * band[1] };
}

// Valuation-based building permit fee — a compressed version of the common
// ICC/1997 UBC table: ~$7 per $1,000 of valuation above the first $100k, plus base.
function buildingPermitFee(value: number): number {
  if (value <= 25000) return 400 + value * 0.012;
  if (value <= 500000) return 700 + (value - 25000) * 0.0072;
  return 4120 + (value - 500000) * 0.005;
}

const FLAT_BANDS: Record<string, [number, number, string]> = {
  plat: [1500, 6000, "Plat filing + per-lot/per-acre fee"],
  site: [2500, 12000, "Site plan review, % of civil construction cost"],
  civil: [3000, 18000, "Infrastructure inspection, % of public improvement cost"],
  grading: [500, 3500, "Per-acre disturbed + SWPPP review"],
  fire: [400, 2500, "Fire plan review + per-system fees"],
  utility: [800, 5000, "Meter / tap fees (impact fees separate below)"],
  env: [750, 6000, "Environmental / floodplain / tree review"],
};

export function estimateFees(input: {
  permits: PermitItem[];
  jurisdiction: JurisdictionInfo;
  buildingAreaSqft: number | null;
  sector?: "commercial" | "residential";
}): FeeEstimate {
  const sector = input.sector ?? "commercial";
  const value = estimateConstructionValue(input.buildingAreaSqft, sector);
  const lines: FeeLine[] = [];

  for (const p of input.permits) {
    if (p.id === "building") {
      lines.push({
        permitId: p.id,
        label: p.name,
        low: Math.round(buildingPermitFee(value.low)),
        high: Math.round(buildingPermitFee(value.high) * 1.15),
        basis: "Construction valuation (compressed ICC fee table)",
      });
    } else if (FLAT_BANDS[p.id]) {
      const [low, high, basis] = FLAT_BANDS[p.id];
      lines.push({ permitId: p.id, label: p.name, low, high, basis });
    } else {
      lines.push({
        permitId: p.id,
        label: p.name,
        low: 300,
        high: 2000,
        basis: "Department minimum review fee",
      });
    }
  }

  const subtotalLow = lines.reduce((n, l) => n + l.low, 0);
  const subtotalHigh = lines.reduce((n, l) => n + l.high, 0);

  // Impact / capital recovery fees — only when new demand is created.
  const createsDemand = input.permits.some((p) => ["utility", "civil", "plat"].includes(p.id));
  const sf = input.buildingAreaSqft && input.buildingAreaSqft > 0 ? input.buildingAreaSqft : 10000;
  const impactFeesLow = createsDemand ? Math.round(sf * 1.5) : 0;
  const impactFeesHigh = createsDemand ? Math.round(sf * 6) : 0;

  return {
    lines,
    subtotalLow,
    subtotalHigh,
    impactFeesLow,
    impactFeesHigh,
    totalLow: subtotalLow + impactFeesLow,
    totalHigh: subtotalHigh + impactFeesHigh,
    assumptions: [
      `Construction valuation assumed at ${sector} rates (~$${sector === "commercial" ? "180–320" : "140–260"}/sf).`,
      `Building area assumed at ${sf.toLocaleString()} sf where not provided.`,
      "Impact / capital-recovery fees vary widely by district and are shown as a broad band.",
      "Excludes consultant design fees, surety/bonds, and third-party testing.",
      input.jurisdiction.matched
        ? `${input.jurisdiction.authority} fee schedule referenced at a high level; confirm current adopted schedule.`
        : "Jurisdiction not in the verified table — figures are national-typical placeholders.",
    ],
  };
}
