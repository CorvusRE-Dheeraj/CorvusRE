// The CAD evidence-response engine. The AI only READS the district's evidence
// packet into a structured extraction (every comp, the district's stated facts
// about the subject, its adjustments and income assumptions — see
// sanitizeExtraction); everything here is deterministic arithmetic on that
// extraction plus the owner's own facts: per-comp metrics, comparability
// problems, incorrect subject characteristics, stale or post-valuation-date
// sales, adjustment size, inconsistent treatment, the proposed value against
// Corvus's evidence, and the 3-5 strongest points to make at the hearing.
// Pure (no Deno APIs) — the app's vitest suite tests it.

export type CadAdjustment = { factor: string; pct: number | null };

export type CadComp = {
  label: string; // "Comp 1", "Sale 3" — as the packet names it
  address: string | null;
  kind: "sale" | "equity" | "rent" | "other";
  salePrice: number | null;
  saleDate: string | null; // YYYY-MM-DD
  appraisedValue: number | null;
  buildingSqft: number | null;
  yearBuilt: number | null;
  acres: number | null;
  propertyType: string | null;
  distanceMi: number | null;
  adjustments: CadAdjustment[];
  adjustedValue: number | null;
  capRatePct: number | null;
};

export type CadExtraction = {
  proposedValue: number | null;
  subjectAsStated: {
    buildingSqft: number | null;
    yearBuilt: number | null;
    acres: number | null;
    propertyType: string | null;
    condition: string | null;
  };
  comps: CadComp[];
  income: {
    marketRentPerSf: number | null;
    vacancyPct: number | null;
    expensePct: number | null;
    capRatePct: number | null;
  } | null;
};

export type SubjectFacts = {
  buildingSqft: number | null;
  yearBuilt: number | null;
  acres: number | null;
  propertyType: string | null;
  capRatePct: number | null; // the owner's / market cap rate, when known
};

// ── Sanitizing the AI's extraction ─────────────────────────────────────────

const num = (v: unknown): number | null => {
  const n =
    typeof v === "number"
      ? v
      : typeof v === "string"
        ? Number(v.replace(/[$,%\s]/g, ""))
        : NaN;
  return Number.isFinite(n) ? n : null;
};
const pos = (v: unknown, max = 1e10): number | null => {
  const n = num(v);
  return n != null && n > 0 && n < max ? n : null;
};
const str = (v: unknown, len: number): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s && !/^(null|n\/a|none|unknown)$/i.test(s) ? s.slice(0, len) : null;
};
const isoDate = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  let m = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
  if (m)
    return `${m[1]}-${m[2].padStart(2, "0")}-${(m[3] ?? "15").padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\/(?:(\d{1,2})\/)?(\d{4})$/);
  if (m)
    return `${m[3]}-${m[1].padStart(2, "0")}-${(m[2] ?? "15").padStart(2, "0")}`;
  return null;
};
const year = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n >= 1800 && n <= 2100 ? Math.round(n) : null;
};

export function sanitizeExtraction(raw: unknown): CadExtraction {
  const r = (raw ?? {}) as Record<string, unknown>;
  const s = (r.subjectAsStated ?? {}) as Record<string, unknown>;
  const inc = r.income as Record<string, unknown> | null | undefined;
  const comps: CadComp[] = [];
  for (const [i, c] of (Array.isArray(r.comps) ? r.comps : [])
    .slice(0, 30)
    .entries()) {
    const x = (c ?? {}) as Record<string, unknown>;
    const kind = ["sale", "equity", "rent", "other"].includes(String(x.kind))
      ? (x.kind as CadComp["kind"])
      : "other";
    comps.push({
      label: str(x.label, 40) ?? `Comp ${i + 1}`,
      address: str(x.address, 160),
      kind,
      salePrice: pos(x.salePrice),
      saleDate: isoDate(x.saleDate),
      appraisedValue: pos(x.appraisedValue),
      buildingSqft: pos(x.buildingSqft, 1e8),
      yearBuilt: year(x.yearBuilt),
      acres: pos(x.acres, 1e6),
      propertyType: str(x.propertyType, 80),
      distanceMi: pos(x.distanceMi, 500),
      adjustments: (Array.isArray(x.adjustments) ? x.adjustments : [])
        .map((a) => ({
          factor: str((a as Record<string, unknown>)?.factor, 40) ?? "",
          pct: num((a as Record<string, unknown>)?.pct),
        }))
        .filter((a) => a.factor)
        .slice(0, 12),
      adjustedValue: pos(x.adjustedValue),
      capRatePct: (() => {
        const n = pos(x.capRatePct, 30);
        return n;
      })(),
    });
  }
  return {
    proposedValue: pos(r.proposedValue),
    subjectAsStated: {
      buildingSqft: pos(s.buildingSqft, 1e8),
      yearBuilt: year(s.yearBuilt),
      acres: pos(s.acres, 1e6),
      propertyType: str(s.propertyType, 80),
      condition: str(s.condition, 60),
    },
    comps,
    income: inc
      ? {
          marketRentPerSf: pos(inc.marketRentPerSf, 1000),
          vacancyPct: num(inc.vacancyPct),
          expensePct: num(inc.expensePct),
          capRatePct: pos(inc.capRatePct, 30),
        }
      : null,
  };
}

// ── Metrics and findings ───────────────────────────────────────────────────

export type FindingKind =
  | "subject_data"
  | "stale_sale"
  | "post_date_sale"
  | "size"
  | "age"
  | "property_type"
  | "distance"
  | "adjustments"
  | "inconsistent"
  | "cap_rate";

export type Finding = {
  kind: FindingKind;
  comp: string | null; // comp label, or null for subject/packet-wide
  title: string;
  detail: string;
  weight: number; // how much it matters at a hearing, 1-10
};

export type CompMetrics = {
  label: string;
  address: string | null;
  kind: CadComp["kind"];
  value: number | null; // the value the comp argues (adjusted, sale, or appraised)
  pricePerSf: number | null;
  sizeDiffPct: number | null; // comp vs subject, %
  ageDiffYears: number | null; // comp newer (+) / older (−)
  saleMonthsBeforeValuation: number | null; // negative = sold after Jan 1
  grossAdjPct: number | null;
  netAdjPct: number | null;
  flags: FindingKind[];
};

// Thresholds — common appraisal review guidelines.
export const LIMITS = {
  sizeDiffPct: 25,
  ageDiffYears: 15,
  staleMonths: 24,
  grossAdjPct: 25,
  netAdjPct: 15,
  distanceMi: 5,
  capSpreadPts: 1.5,
  subjectSqftPct: 5,
  subjectAcresPct: 5,
};

const pct1 = (n: number) => Math.round(n * 10) / 10;
const usd = (n: number) => `${Math.round(n).toLocaleString("en-US")}`;
const article = (w: string) => (/^[aeiou]/i.test(w) ? "an" : "a");
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const sameType = (a: string, b: string) => {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z]/g, "");
  const A = norm(a);
  const B = norm(b);
  return A.includes(B) || B.includes(A);
};

export type CadEvidenceAnalysis = {
  metrics: CompMetrics[];
  findings: Finding[]; // strongest first
  proposedValue: number | null;
  comparison: {
    proposedValue: number;
    corvusLow: number;
    corvusHigh: number;
    gapToHigh: number; // proposed − Corvus high (positive = district is above your evidence)
    gapPct: number;
  } | null;
};

export function analyzeCadEvidence(
  x: CadExtraction,
  subject: SubjectFacts,
  taxYear: number,
  corvusRange: { low: number; high: number } | null,
): CadEvidenceAnalysis {
  const valuationDate = Date.UTC(taxYear, 0, 1);
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(f);

  // Incorrect subject characteristics.
  const st = x.subjectAsStated;
  if (st.buildingSqft && subject.buildingSqft) {
    const diff =
      ((st.buildingSqft - subject.buildingSqft) / subject.buildingSqft) * 100;
    if (Math.abs(diff) > LIMITS.subjectSqftPct) {
      add({
        kind: "subject_data",
        comp: null,
        title: `The district lists your building at ${st.buildingSqft.toLocaleString("en-US")} SF; it's ${subject.buildingSqft.toLocaleString("en-US")} SF`,
        detail: `A ${Math.abs(pct1(diff))}% ${diff > 0 ? "overstatement" : "understatement"} of building size flows straight into a $/SF value.`,
        weight: 10,
      });
    }
  }
  if (st.yearBuilt && subject.yearBuilt && st.yearBuilt !== subject.yearBuilt) {
    add({
      kind: "subject_data",
      comp: null,
      title: `The district lists your year built as ${st.yearBuilt}; it's ${subject.yearBuilt}`,
      detail: `A building ${Math.abs(st.yearBuilt - subject.yearBuilt)} years ${st.yearBuilt > subject.yearBuilt ? "older" : "newer"} than stated carries more depreciation.`,
      weight: st.yearBuilt > subject.yearBuilt ? 9 : 5,
    });
  }
  if (st.acres && subject.acres) {
    const diff = ((st.acres - subject.acres) / subject.acres) * 100;
    if (Math.abs(diff) > LIMITS.subjectAcresPct) {
      add({
        kind: "subject_data",
        comp: null,
        title: `The district lists ${st.acres} acres; the site is ${subject.acres} acres`,
        detail:
          "Land value is priced per acre — the wrong site size misprices the land.",
        weight: 8,
      });
    }
  }

  // Per-comp metrics and comparability problems.
  const metrics: CompMetrics[] = x.comps.map((c) => {
    const value = c.adjustedValue ?? c.salePrice ?? c.appraisedValue;
    const flags: FindingKind[] = [];
    const sizeDiffPct =
      c.buildingSqft && subject.buildingSqft
        ? pct1(
            ((c.buildingSqft - subject.buildingSqft) / subject.buildingSqft) *
              100,
          )
        : null;
    const ageDiffYears =
      c.yearBuilt && subject.yearBuilt ? c.yearBuilt - subject.yearBuilt : null;
    const saleMonths = c.saleDate
      ? Math.round(
          (valuationDate - Date.parse(`${c.saleDate}T00:00:00Z`)) /
            (30.44 * 86_400_000),
        )
      : null;
    const pcts = c.adjustments
      .map((a) => a.pct)
      .filter((p): p is number => p != null);
    const grossAdjPct = pcts.length
      ? pct1(pcts.reduce((s, p) => s + Math.abs(p), 0))
      : null;
    const netAdjPct = pcts.length
      ? pct1(pcts.reduce((s, p) => s + p, 0))
      : null;

    if (sizeDiffPct != null && Math.abs(sizeDiffPct) > LIMITS.sizeDiffPct) {
      flags.push("size");
      add({
        kind: "size",
        comp: c.label,
        title: `${c.label} is ${Math.abs(Math.round(sizeDiffPct))}% ${sizeDiffPct < 0 ? "smaller" : "larger"} than your building`,
        detail: `Size drives price per SF — ${sizeDiffPct < 0 ? "smaller buildings sell for more per SF" : "a much larger building isn't a like-for-like comparison"}, beyond the ${LIMITS.sizeDiffPct}% a comparable usually stays within.`,
        weight: 7,
      });
    }
    if (ageDiffYears != null && Math.abs(ageDiffYears) > LIMITS.ageDiffYears) {
      flags.push("age");
      add({
        kind: "age",
        comp: c.label,
        title: `${c.label} is ${Math.abs(ageDiffYears)} years ${ageDiffYears > 0 ? "newer" : "older"} than your building`,
        detail:
          ageDiffYears > 0
            ? "A newer building commands a higher value and needs a substantial age/condition adjustment."
            : "An older building isn't comparable without an age adjustment.",
        weight: ageDiffYears > 0 ? 6 : 4,
      });
    }
    if (c.kind === "sale" && saleMonths != null) {
      if (saleMonths < 0) {
        flags.push("post_date_sale");
        add({
          kind: "post_date_sale",
          comp: c.label,
          title: `${c.label} sold after January 1, ${taxYear}`,
          detail:
            "The appraisal date is January 1 — a later sale reflects conditions that didn't exist on that date.",
          weight: 7,
        });
      } else if (saleMonths > LIMITS.staleMonths) {
        flags.push("stale_sale");
        add({
          kind: "stale_sale",
          comp: c.label,
          title: `${c.label} sold ${saleMonths} months before the valuation date`,
          detail: `Sales more than ${LIMITS.staleMonths} months old need a supported time adjustment${c.adjustments.some((a) => /time|market|date/i.test(a.factor)) ? " — check the one applied" : " and none is shown"}.`,
          weight: 8,
        });
      }
    }
    if (
      c.propertyType &&
      subject.propertyType &&
      !sameType(c.propertyType, subject.propertyType)
    ) {
      flags.push("property_type");
      add({
        kind: "property_type",
        comp: c.label,
        title: `${c.label} is ${article(c.propertyType)} ${c.propertyType.toLowerCase()}, not ${article(subject.propertyType)} ${subject.propertyType.toLowerCase()}`,
        detail:
          "A different property type has a different market and isn't a valid comparable.",
        weight: 6,
      });
    }
    if (c.distanceMi != null && c.distanceMi > LIMITS.distanceMi) {
      flags.push("distance");
      add({
        kind: "distance",
        comp: c.label,
        title: `${c.label} is ${c.distanceMi} miles away`,
        detail:
          "A distant comp is in a different submarket unless the district shows a location adjustment.",
        weight: 4,
      });
    }
    if (
      (grossAdjPct != null && grossAdjPct > LIMITS.grossAdjPct) ||
      (netAdjPct != null && Math.abs(netAdjPct) > LIMITS.netAdjPct)
    ) {
      flags.push("adjustments");
      add({
        kind: "adjustments",
        comp: c.label,
        title: `${c.label} needed ${grossAdjPct}% gross / ${netAdjPct}% net adjustments`,
        detail: `Adjustments above ~${LIMITS.grossAdjPct}% gross or ${LIMITS.netAdjPct}% net mean the property isn't truly comparable.`,
        weight: 6,
      });
    }
    return {
      label: c.label,
      address: c.address,
      kind: c.kind,
      value,
      // The comp's own price per SF — its actual sale (or appraised) value,
      // never the district's adjusted figure, which is restated for the subject.
      pricePerSf: (() => {
        const own = c.salePrice ?? c.appraisedValue ?? c.adjustedValue;
        return own && c.buildingSqft
          ? Math.round((own / c.buildingSqft) * 100) / 100
          : null;
      })(),
      sizeDiffPct,
      ageDiffYears,
      saleMonthsBeforeValuation: saleMonths,
      grossAdjPct,
      netAdjPct,
      flags,
    };
  });

  // Inconsistent treatment: the same difference adjusted at a different rate
  // from comp to comp (or in the wrong direction). Opposite signs alone are
  // normal — a smaller comp and a larger one are adjusted opposite ways — so
  // each adjustment is divided by the difference it's for and those rates are
  // compared: time per month before Jan 1, size per % of size, age per year.
  const RATE_FACTORS: {
    test: RegExp;
    name: string;
    unit: string;
    driver: (m: CompMetrics) => number | null;
  }[] = [
    {
      test: /time|market|date/i,
      name: "time (market conditions)",
      unit: "per month",
      driver: (m) => m.saleMonthsBeforeValuation,
    },
    {
      test: /size|sq|area|gba/i,
      name: "size",
      unit: "per 1% of size difference",
      driver: (m) => m.sizeDiffPct,
    },
    {
      test: /age|year|condition|effective/i,
      name: "age / condition",
      unit: "per year of age difference",
      driver: (m) => m.ageDiffYears,
    },
  ];
  for (const rf of RATE_FACTORS) {
    const rates: { label: string; rate: number }[] = [];
    x.comps.forEach((c, i) => {
      const adj = c.adjustments.find(
        (a) => rf.test.test(a.factor) && a.pct != null && a.pct !== 0,
      );
      const d = rf.driver(metrics[i]);
      if (adj?.pct != null && d != null && d !== 0) {
        rates.push({
          label: c.label,
          rate: Math.round((adj.pct / d) * 1000) / 1000,
        });
      }
    });
    if (rates.length < 2) continue;
    const signs = new Set(rates.map((r) => Math.sign(r.rate)));
    const mags = rates.map((r) => Math.abs(r.rate));
    const ratio = Math.max(...mags) / Math.max(Math.min(...mags), 1e-9);
    if (signs.size > 1 || ratio > 2) {
      add({
        kind: "inconsistent",
        comp: null,
        title: `The district's ${rf.name} adjustment isn't applied consistently`,
        detail: `${rates.map((r) => `${r.label}: ${r.rate}% ${rf.unit}`).join("; ")} — ${signs.size > 1 ? "the same kind of difference is adjusted in opposite directions" : `the rate varies ${Math.round(ratio * 10) / 10}x`}. Ask the district to explain it.`,
        weight: 6,
      });
    }
  }

  // Cap rates: spread among the district's own comps, and the rate it applied.
  const caps = x.comps
    .map((c) => c.capRatePct)
    .filter((v): v is number => v != null);
  const applied = x.income?.capRatePct ?? null;
  if (caps.length >= 2) {
    const spread = Math.max(...caps) - Math.min(...caps);
    const med = median(caps) as number;
    if (spread > LIMITS.capSpreadPts) {
      add({
        kind: "cap_rate",
        comp: null,
        title: `The district's comps show cap rates from ${Math.min(...caps)}% to ${Math.max(...caps)}%`,
        detail: `A ${pct1(spread)}-point spread — its own data doesn't support a single market cap rate.`,
        weight: 7,
      });
    }
    if (applied != null && applied < med - 0.25) {
      add({
        kind: "cap_rate",
        comp: null,
        title: `The district applied a ${applied}% cap rate; its own comps' median is ${pct1(med)}%`,
        detail:
          "A lower cap rate means a higher value — the rate applied is below what the district's own evidence shows.",
        weight: 9,
      });
    }
  }
  if (
    applied != null &&
    subject.capRatePct != null &&
    applied < subject.capRatePct - 0.5
  ) {
    add({
      kind: "cap_rate",
      comp: null,
      title: `The district's ${applied}% cap rate is below the ${subject.capRatePct}% supported for your property`,
      detail:
        "Every half point of cap rate moves the income value by roughly 6-8%.",
      weight: 8,
    });
  }

  findings.sort((a, b) => b.weight - a.weight);
  const proposed = x.proposedValue;
  return {
    metrics,
    findings,
    proposedValue: proposed,
    comparison:
      proposed != null && corvusRange
        ? {
            proposedValue: proposed,
            corvusLow: corvusRange.low,
            corvusHigh: corvusRange.high,
            gapToHigh: proposed - corvusRange.high,
            gapPct: pct1(
              ((proposed - corvusRange.high) / corvusRange.high) * 100,
            ),
          }
        : null,
  };
}

// The 3-5 strongest points to make at the hearing: the calculated findings and
// the AI's own observations (e.g. location), strongest first, one per comp-issue.
export type HearingPoint = {
  title: string;
  detail: string;
  source: "calculated" | "reviewed";
};

const AI_WEIGHT: Record<string, number> = {
  subject_data: 9,
  location: 6,
  cap_rate: 7,
  income: 6,
  time: 7,
  size: 6,
  age_condition: 5,
  property_type: 6,
  other: 3,
};

// Which calculated findings an AI weakness category overlaps with.
const AI_TO_FINDING: Record<string, FindingKind[]> = {
  subject_data: ["subject_data"],
  cap_rate: ["cap_rate"],
  size: ["size"],
  time: ["stale_sale", "post_date_sale", "inconsistent"],
  age_condition: ["age"],
  property_type: ["property_type"],
};

export function strongestPoints(
  analysis: CadEvidenceAnalysis,
  aiWeaknesses: { category: string; finding: string; detail: string }[],
  max = 5,
): HearingPoint[] {
  // Every calculated finding stands on its own (two different wrong facts are
  // two points). An AI observation is dropped when a calculated finding
  // already covers the same issue — for the same comp, or packet-wide.
  const covered = new Set(
    analysis.findings.map((f) => `${f.kind}:${(f.comp ?? "-").toLowerCase()}`),
  );
  const coveredKinds = new Set(analysis.findings.map((f) => f.kind));
  const pool: (HearingPoint & { weight: number })[] = [
    ...analysis.findings.map((f) => ({
      title: f.title,
      detail: f.detail,
      source: "calculated" as const,
      weight: f.weight + 0.5, // exact arithmetic beats a reading, on a tie
    })),
    ...aiWeaknesses
      .filter((w) => {
        const kinds = AI_TO_FINDING[w.category] ?? [];
        const comp = w.finding
          .match(/\b(?:comp|sale)\s*#?\s*\d+/i)?.[0]
          .toLowerCase()
          .replace(/#\s*/, "");
        return !kinds.some((k) =>
          comp ? covered.has(`${k}:${comp}`) : coveredKinds.has(k),
        );
      })
      .map((w) => ({
        title: w.finding,
        detail: w.detail,
        source: "reviewed" as const,
        weight: AI_WEIGHT[w.category] ?? 3,
      })),
  ].sort((a, b) => b.weight - a.weight);
  const out: HearingPoint[] = [];
  const seenTitles = new Set<string>();
  for (const p of pool) {
    if (seenTitles.has(p.title)) continue;
    seenTitles.add(p.title);
    out.push({ title: p.title, detail: p.detail, source: p.source });
    if (out.length >= max) break;
  }
  if (
    analysis.comparison &&
    analysis.comparison.gapToHigh > 0 &&
    out.length < max
  ) {
    out.push({
      title: `The district's ${usd(analysis.comparison.proposedValue)} is ${analysis.comparison.gapPct}% above what your evidence supports`,
      detail: `Corvus's valuation approaches support ${usd(analysis.comparison.corvusLow)}–${usd(analysis.comparison.corvusHigh)}.`,
      source: "calculated",
    });
  }
  return out;
}
