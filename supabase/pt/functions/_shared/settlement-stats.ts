// Historical settlement database — the pure part. Account-level protest
// outcomes published by appraisal districts (Harris CAD's annual ARB hearing
// files: initial and final market value, informal or formal, owner or agent,
// state property class) are aggregated here into outcome statistics by
// county, tax year, property class and value band. Only aggregates are
// stored — never an owner name or account — and a cell with too few
// protests is dropped rather than shown as a pattern.

export type HearingRow = {
  taxYear: number;
  stateClass: string; // e.g. "F1", "A1"
  stage: "informal" | "formal";
  heard: boolean; // an ARB hearing actually took place
  representation: "agent" | "owner";
  initialValue: number; // initial market value
  finalValue: number;
  withdrawn: boolean;
};

export type PropertyClass =
  | "residential"
  | "multifamily"
  | "vacant_land"
  | "acreage"
  | "commercial"
  | "industrial"
  | "other";

export const CLASS_LABEL: Record<PropertyClass | "all", string> = {
  all: "All property",
  residential: "Single-family residential",
  multifamily: "Multifamily",
  vacant_land: "Vacant lots",
  acreage: "Acreage",
  commercial: "Commercial",
  industrial: "Industrial",
  other: "Other",
};

// Texas Comptroller state property classification codes (PTAD).
export function classOf(stateClass: string): PropertyClass {
  const c = stateClass.trim().toUpperCase();
  if (c.startsWith("F2")) return "industrial";
  if (c.startsWith("F")) return "commercial";
  if (
    c.startsWith("A") ||
    c.startsWith("E") ||
    c.startsWith("M") ||
    c.startsWith("O")
  )
    return "residential";
  if (c.startsWith("B")) return "multifamily";
  if (c.startsWith("C")) return "vacant_land";
  if (c.startsWith("D")) return "acreage";
  return "other";
}

export type ValueBand =
  "under_500k" | "500k_1m" | "1m_5m" | "5m_20m" | "over_20m";

export const BAND_LABEL: Record<ValueBand | "all", string> = {
  all: "All values",
  under_500k: "Under $500K",
  "500k_1m": "$500K–$1M",
  "1m_5m": "$1M–$5M",
  "5m_20m": "$5M–$20M",
  over_20m: "Over $20M",
};

export function bandOf(value: number): ValueBand {
  if (value < 500_000) return "under_500k";
  if (value < 1_000_000) return "500k_1m";
  if (value < 5_000_000) return "1m_5m";
  if (value < 20_000_000) return "5m_20m";
  return "over_20m";
}

// Fewer protests than this in a cell isn't a pattern worth showing.
export const MIN_CELL = 10;

export type StatCell = {
  cad: string;
  taxYear: number;
  propertyClass: PropertyClass | "all";
  valueBand: ValueBand | "all";
  representation: "all" | "agent" | "owner";
  stage: "all" | "informal" | "formal";
  protests: number;
  reduced: number; // final value below initial
  medianCutPct: number; // across all protests in the cell (0 when unchanged)
  p25CutPct: number;
  p75CutPct: number;
  medianCutWhenReducedPct: number | null;
  heardShare: number; // share that went to an actual ARB hearing
};

const quantile = (sorted: number[], q: number) => {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};
const r1 = (n: number) => Math.round(n * 10) / 10;

// Cut as a percent of the initial value; clamped so a data-entry outlier
// can't distort a median.
export function cutPct(initial: number, final: number): number {
  return Math.max(-50, Math.min(100, ((initial - final) / initial) * 100));
}

export function usable(r: HearingRow): boolean {
  return (
    !r.withdrawn &&
    r.initialValue > 0 &&
    r.finalValue > 0 &&
    classOf(r.stateClass) !== "other"
  );
}

export function aggregate(cad: string, rows: HearingRow[]): StatCell[] {
  type Acc = {
    cuts: number[];
    reduced: number;
    heard: number;
    reducedCuts: number[];
  };
  const cells = new Map<string, Acc>();
  const add = (key: string, cut: number, heard: boolean) => {
    let a = cells.get(key);
    if (!a)
      cells.set(key, (a = { cuts: [], reduced: 0, heard: 0, reducedCuts: [] }));
    a.cuts.push(cut);
    if (cut > 0) {
      a.reduced++;
      a.reducedCuts.push(cut);
    }
    if (heard) a.heard++;
  };
  for (const r of rows) {
    if (!usable(r)) continue;
    const cut = cutPct(r.initialValue, r.finalValue);
    const cls = classOf(r.stateClass);
    const band = bandOf(r.initialValue);
    for (const c of [cls, "all"])
      for (const b of [band, "all"])
        for (const rep of [r.representation, "all"])
          for (const st of [r.stage, "all"])
            add(`${r.taxYear}|${c}|${b}|${rep}|${st}`, cut, r.heard);
  }
  const out: StatCell[] = [];
  for (const [key, a] of cells) {
    if (a.cuts.length < MIN_CELL) continue;
    const [year, c, b, rep, st] = key.split("|");
    const cuts = a.cuts.sort((x, y) => x - y);
    const red = a.reducedCuts.sort((x, y) => x - y);
    out.push({
      cad,
      taxYear: Number(year),
      propertyClass: c as StatCell["propertyClass"],
      valueBand: b as StatCell["valueBand"],
      representation: rep as StatCell["representation"],
      stage: st as StatCell["stage"],
      protests: cuts.length,
      reduced: a.reduced,
      medianCutPct: r1(quantile(cuts, 0.5)),
      p25CutPct: r1(quantile(cuts, 0.25)),
      p75CutPct: r1(quantile(cuts, 0.75)),
      medianCutWhenReducedPct: red.length ? r1(quantile(red, 0.5)) : null,
      heardShare: Math.round((a.heard / cuts.length) * 1000) / 1000,
    });
  }
  return out;
}

// Harris CAD arb_hearings_real.txt (tab-delimited, header row).
export function parseHarrisHearingLine(
  header: string[],
  line: string,
): HearingRow | null {
  const f = line.split("\t");
  const col = (name: string) => f[header.indexOf(name)]?.trim() ?? "";
  const year = Number(col("Tax_Year"));
  const initial = Number(col("Initial_Market_Value"));
  const final = Number(col("Final_Market_Value"));
  if (!year || !Number.isFinite(initial) || !Number.isFinite(final))
    return null;
  return {
    taxYear: year,
    stateClass: col("State_Class_Code"),
    stage: col("Hearing_Type") === "I" ? "informal" : "formal",
    heard: col("Actual_Hearing_Date") !== "",
    representation:
      col("Agent_Code").toLowerCase() === "agent" ? "agent" : "owner",
    initialValue: initial,
    finalValue: final,
    withdrawn: col("Letter_Type") === "WD",
  };
}
