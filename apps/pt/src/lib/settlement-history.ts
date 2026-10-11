import { supabase } from "./supabase";
import { classifyPropertyCategory, getBaseReductionPct } from "./texas-tax-rates";
import {
  bandOf,
  BAND_LABEL,
  CLASS_LABEL,
  classOf,
  type PropertyClass,
  type ValueBand,
} from "../../../../supabase/pt/functions/_shared/settlement-stats";

// How similar protests have actually settled, from the historical settlement
// database (public.settlement_stats — scripts/import-settlements.mts). Where
// a county publishes account-level outcomes (Harris today), the benchmark is
// the property's own class and value band; elsewhere it falls back to the
// county's published average reduction, and says so.

export type Cell = {
  taxYear: number;
  protests: number;
  reducedPct: number;
  medianCutPct: number;
  p25CutPct: number;
  p75CutPct: number;
  medianCutWhenReducedPct: number | null;
  heardShare: number;
};

export type SettlementBenchmark =
  | {
      kind: "outcomes";
      cad: string;
      label: string; // "Commercial, $1M–$5M"
      latest: Cell;
      byRepresentation: { agent: Cell | null; owner: Cell | null };
      byStage: { informal: Cell | null; formal: Cell | null };
      trend: { taxYear: number; medianCutPct: number; reducedPct: number }[];
      source: string;
    }
  | { kind: "published_average"; cad: string | null; averageCutPct: number; label: string }
  | null;

type Row = {
  tax_year: number;
  property_class: string;
  value_band: string;
  representation: string;
  stage: string;
  protests: number;
  reduced: number;
  median_cut_pct: number;
  p25_cut_pct: number;
  p75_cut_pct: number;
  median_cut_when_reduced_pct: number | null;
  heard_share: number;
  source: string;
};

const toCell = (r: Row): Cell => ({
  taxYear: r.tax_year,
  protests: r.protests,
  reducedPct: Math.round((r.reduced / r.protests) * 1000) / 10,
  medianCutPct: Number(r.median_cut_pct),
  p25CutPct: Number(r.p25_cut_pct),
  p75CutPct: Number(r.p75_cut_pct),
  medianCutWhenReducedPct:
    r.median_cut_when_reduced_pct == null ? null : Number(r.median_cut_when_reduced_pct),
  heardShare: Number(r.heard_share),
});

// The state class code isn't on the property record; its type text is enough
// to place it ("F1 Commercial", "Office", "Single Family"…).
export function classForProperty(propertyType: string | null): PropertyClass {
  const code = propertyType?.trim().match(/^[A-Z]\d?\b/i)?.[0];
  if (code) {
    const c = classOf(code);
    if (c !== "other") return c;
  }
  const cat = classifyPropertyCategory(propertyType);
  return cat === "residential" ? "residential" : "commercial";
}

export async function getSettlementBenchmark(p: {
  cad: string | null;
  propertyType: string | null;
  value: number | null;
}): Promise<SettlementBenchmark> {
  if (!p.cad) return null;
  const cls = classForProperty(p.propertyType);
  const band: ValueBand | "all" = p.value ? bandOf(p.value) : "all";
  const { data } = await supabase
    .from("settlement_stats")
    .select(
      "tax_year, property_class, value_band, representation, stage, protests, reduced, median_cut_pct, p25_cut_pct, p75_cut_pct, median_cut_when_reduced_pct, heard_share, source",
    )
    .eq("cad", p.cad)
    .eq("property_class", cls)
    .in("value_band", [band, "all"]);
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) {
    const cat = classifyPropertyCategory(p.propertyType);
    return {
      kind: "published_average",
      cad: p.cad,
      // Stored as a fraction (0.0526 = 5.3%).
      averageCutPct: Math.round(getBaseReductionPct(p.cad, cat) * 1000) / 10,
      label: CLASS_LABEL[cls],
    };
  }
  // The property's own value band when it has enough protests, else the class.
  const useBand = rows.some((r) => r.value_band === band) ? band : "all";
  const mine = rows.filter((r) => r.value_band === useBand);
  const latestYear = Math.max(...mine.map((r) => r.tax_year));
  const pick = (rep: string, stage: string, year = latestYear) =>
    mine.find((r) => r.tax_year === year && r.representation === rep && r.stage === stage);
  const latest = pick("all", "all");
  if (!latest) return null;
  const opt = (r: Row | undefined) => (r ? toCell(r) : null);
  return {
    kind: "outcomes",
    cad: p.cad,
    label: `${CLASS_LABEL[cls]}${useBand !== "all" ? `, ${BAND_LABEL[useBand]}` : ""}`,
    latest: toCell(latest),
    byRepresentation: { agent: opt(pick("agent", "all")), owner: opt(pick("owner", "all")) },
    byStage: { informal: opt(pick("all", "informal")), formal: opt(pick("all", "formal")) },
    trend: [...new Set(mine.map((r) => r.tax_year))]
      .sort()
      .map((y) => pick("all", "all", y))
      .filter((r): r is Row => !!r)
      .map((r) => ({
        taxYear: r.tax_year,
        medianCutPct: Number(r.median_cut_pct),
        reducedPct: Math.round((r.reduced / r.protests) * 1000) / 10,
      })),
    source: latest.source,
  };
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

// Where an informal offer sits against how similar protests settled.
export function compareOffer(
  b: SettlementBenchmark,
  original: number,
  offer: number,
): string | null {
  if (!b || original <= 0) return null;
  const cut = Math.round(((original - offer) / original) * 1000) / 10;
  if (b.kind === "published_average")
    return `This offer is a ${cut}% reduction; the county's published average reduction is about ${b.averageCutPct}%.`;
  const c = b.latest;
  const where =
    cut < c.p25CutPct
      ? "below the middle half"
      : cut > c.p75CutPct
        ? "above the middle half"
        : "within the middle half";
  return `This offer is a ${cut}% reduction. Similar ${lowerFirst(b.label)} protests in ${c.taxYear} settled at a median ${c.medianCutPct}% (middle half ${c.p25CutPct}–${c.p75CutPct}%) — the offer is ${where} of those outcomes.`;
}
