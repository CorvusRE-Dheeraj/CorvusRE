// Pure helpers for analyze-cad-evidence: the weakness categories, and the
// clamp that turns the model's JSON into a review the UI and the dashboard's
// decision card can trust. No Deno APIs, so the app's vitest suite tests it.

export const WEAKNESS_CATEGORIES = [
  "location",
  "size",
  "age_condition",
  "cap_rate",
  "income",
  "time",
  "subject_data",
  "property_type",
  "other",
] as const;
export type WeaknessCategory = (typeof WEAKNESS_CATEGORIES)[number];

export const WEAKNESS_LABEL: Record<WeaknessCategory, string> = {
  location: "Comp location",
  size: "Comp size",
  age_condition: "Age / condition",
  cap_rate: "Cap-rate assumptions",
  income: "Income / expense assumptions",
  time: "Sale date / time adjustment",
  subject_data: "Your property's data",
  property_type: "Property type / use",
  other: "Other",
};

export type CadWeakness = {
  category: WeaknessCategory;
  finding: string; // one line, e.g. "Comp 3 is 42% smaller than your building"
  detail: string; // why it matters / what to say
  item: string | null; // which comp / page / line it concerns
};

export type CadEvidenceReview = {
  summary: string;
  weaknesses: CadWeakness[];
  hearingResponse: string;
  cadIndicatedValue: number | null; // the value the district's evidence argues for
};

const str = (v: unknown, len: number): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s && !/^(null|n\/a|none|unknown)$/i.test(s) ? s.slice(0, len) : null;
};

export function sanitizeCadEvidenceReview(
  parsed: Record<string, unknown>,
): CadEvidenceReview {
  const raw = Array.isArray(parsed.weaknesses) ? parsed.weaknesses : [];
  const weaknesses: CadWeakness[] = [];
  for (const w of raw as Record<string, unknown>[]) {
    const finding = str(w?.finding, 200);
    if (!finding) continue;
    const category = WEAKNESS_CATEGORIES.includes(
      w.category as WeaknessCategory,
    )
      ? (w.category as WeaknessCategory)
      : "other";
    weaknesses.push({
      category,
      finding,
      detail: str(w.detail, 600) ?? "",
      item: str(w.item, 120),
    });
    if (weaknesses.length >= 15) break;
  }
  const v =
    typeof parsed.cadIndicatedValue === "number"
      ? parsed.cadIndicatedValue
      : Number(String(parsed.cadIndicatedValue ?? "").replace(/[$,\s]/g, ""));
  return {
    summary: str(parsed.summary, 600) ?? "",
    weaknesses,
    hearingResponse: str(parsed.hearingResponse, 6000) ?? "",
    cadIndicatedValue: Number.isFinite(v) && v > 0 ? Math.round(v) : null,
  };
}

// "2 Comp location · 1 Comp size · 3 Cap-rate assumptions" — the dashboard line.
export function weaknessCounts(
  w: CadWeakness[],
): { category: WeaknessCategory; label: string; count: number }[] {
  const counts = new Map<WeaknessCategory, number>();
  for (const x of w) counts.set(x.category, (counts.get(x.category) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({
      category,
      label: WEAKNESS_LABEL[category],
      count,
    }));
}
