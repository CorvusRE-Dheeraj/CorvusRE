// Texas Property Tax Law & Updates — the weekly report (built server-side by the
// generate-tax-updates edge function from official pages only), plus the
// filtering, "May Affect Your Property" matching and PDF download used by the
// Tax Updates tab and the panels embedded in Property / Arbitration / Court /
// Case views. See the edge function for how each update is verified.
import { supabase } from "./supabase";
import type { PropertyRecord } from "./properties";
import type { ProtestRecord } from "./protests";
import { countyNameFromCad } from "./court-appeal";
import { buildAttorneyPackagePdf, type PackageSection } from "./court-appeal-package";

export type TaxUpdateStatus =
  | "enacted_law"
  | "adopted_rule"
  | "proposed_rule"
  | "pending_legislation"
  | "failed_legislation"
  | "notice_guidance";

export type TaxUpdateTag =
  | "commercial"
  | "protest"
  | "arb"
  | "arbitration"
  | "court"
  | "valuation"
  | "tax_rate"
  | "deadlines";

export type TaxUpdate = {
  id: string;
  chapter: number;
  title: string;
  whatChanged: string;
  effectiveDate: string | null;
  affects: string;
  whyItMatters: string;
  actionNeeded: string;
  status: TaxUpdateStatus;
  tags: TaxUpdateTag[];
  // Empty = statewide; otherwise the county names, e.g. "Dallas County".
  counties: string[];
  sourceName: string;
  sourceUrl: string;
  sourceCheckedAt: string;
  quote: string;
  // New since the last weekly check, vs. information that is simply posted now.
  isNew: boolean;
};

export type TaxReportSource = {
  name: string;
  url: string;
  county: string | null;
  ok: boolean;
  note: string;
};

export type TaxReport = {
  id: string;
  weekStart: string;
  title: string;
  summary: string;
  updates: TaxUpdate[];
  sources: TaxReportSource[];
  generatedAt: string;
};

export const CHAPTERS: { n: number; title: string }[] = [
  { n: 1, title: "Texas Statewide Updates" },
  { n: 2, title: "County Updates" },
  { n: 3, title: "Current-Year Rules & Law Changes" },
  { n: 4, title: "Commercial Property Updates" },
  { n: 5, title: "Protest, ARB & Appeals" },
  { n: 6, title: "Important Deadlines" },
  { n: 7, title: "What Property Owners Should Know / Do" },
];

export const STATUS_LABEL: Record<TaxUpdateStatus, string> = {
  enacted_law: "Enacted law",
  adopted_rule: "Adopted rule",
  proposed_rule: "Proposed rule",
  pending_legislation: "Pending legislation",
  failed_legislation: "Failed legislation",
  notice_guidance: "Official notice / guidance",
};

export const TAG_LABEL: Record<TaxUpdateTag, string> = {
  commercial: "Commercial Property",
  protest: "Protest",
  arb: "ARB",
  arbitration: "Arbitration",
  court: "Court",
  valuation: "Valuation",
  tax_rate: "Tax Rate",
  deadlines: "Deadlines",
};

export const ALL_TAGS = Object.keys(TAG_LABEL) as TaxUpdateTag[];

// Long-standing statutory deadlines, shown for reference under Chapter 6 — they
// are NOT "updates" and are labelled as standing rules. Verify against the
// source before relying on any date.
export const STANDING_DEADLINES: { label: string; detail: string }[] = [
  {
    label: "Protest deadline",
    detail:
      "Generally May 15, or 30 days after the notice of appraised value was delivered, whichever is later (Tax Code §41.44).",
  },
  {
    label: "ARB hearing notice",
    detail: "The ARB must give at least 15 days' written notice of a hearing (Tax Code §41.46).",
  },
  {
    label: "Binding arbitration",
    detail: "Request within 60 days after receiving the ARB's order (Tax Code Chapter 41A).",
  },
  {
    label: "District court appeal",
    detail:
      "Petition for review within 60 days after receiving the ARB's final order (Tax Code §42.21).",
  },
  {
    label: "Taxes delinquent",
    detail: "Property taxes are delinquent if unpaid after January 31 (Tax Code §31.02).",
  },
];
export const STANDING_SOURCE = {
  name: "Texas Comptroller — Protests & appeals",
  url: "https://comptroller.texas.gov/taxes/property-tax/protests/",
};

// ── Data ─────────────────────────────────────────────────────────────────
type ReportRow = {
  id: string;
  week_start: string;
  title: string;
  summary: string;
  updates: TaxUpdate[] | null;
  sources: TaxReportSource[] | null;
  generated_at: string;
};

const fromRow = (r: ReportRow): TaxReport => ({
  id: r.id,
  weekStart: r.week_start,
  title: r.title,
  summary: r.summary,
  updates: r.updates ?? [],
  sources: r.sources ?? [],
  generatedAt: r.generated_at,
});

// Newest first; the server keeps only the latest 5.
export async function listTaxReports(): Promise<TaxReport[]> {
  const { data, error } = await supabase
    .from("tax_update_reports")
    .select("id, week_start, title, summary, updates, sources, generated_at")
    .order("week_start", { ascending: false })
    .limit(5);
  if (error) throw error;
  return (data as ReportRow[]).map(fromRow);
}

// ── Generated reports (per person) ───────────────────────────────────────
export const MAX_SAVED_REPORTS = 10;

export type SavedTaxReport = {
  id: string;
  title: string;
  createdAt: string;
  taxYear: number;
  report: TaxReport;
};

type SavedRow = {
  id: string;
  title: string;
  created_at: string;
  payload: { taxYear: number; report: TaxReport };
};

export async function listSavedReports(): Promise<SavedTaxReport[]> {
  const { data, error } = await supabase
    .from("tax_update_user_reports")
    .select("id, title, created_at, payload")
    .order("created_at", { ascending: false })
    .limit(MAX_SAVED_REPORTS);
  if (error) throw error;
  return (data as SavedRow[]).map((r) => ({
    id: r.id,
    title: r.title,
    createdAt: r.created_at,
    taxYear: r.payload.taxYear,
    report: r.payload.report,
  }));
}

// Snapshots the given weekly report for this person, then drops anything past
// the newest 10.
export async function saveGeneratedReport(userId: string, report: TaxReport): Promise<void> {
  const taxYear = new Date().getFullYear();
  const { error } = await supabase.from("tax_update_user_reports").insert({
    user_id: userId,
    title: report.title,
    payload: { taxYear, report },
  });
  if (error) throw error;
  const { data: old } = await supabase
    .from("tax_update_user_reports")
    .select("id")
    .order("created_at", { ascending: false })
    .range(MAX_SAVED_REPORTS, MAX_SAVED_REPORTS + 50);
  const ids = (old ?? []).map((r: { id: string }) => r.id);
  if (ids.length) await supabase.from("tax_update_user_reports").delete().in("id", ids);
}

export async function deleteSavedReport(id: string): Promise<void> {
  const { error } = await supabase.from("tax_update_user_reports").delete().eq("id", id);
  if (error) throw error;
}

// A short list of what matters most this tax year: enacted laws and adopted
// rules, plus anything about deadlines. Proposals and failed bills are left out.
export function criticalUpdates(updates: TaxUpdate[], max = 5): TaxUpdate[] {
  const rank = (u: TaxUpdate) =>
    (u.tags.includes("deadlines") ? 0 : 2) + (u.status === "enacted_law" ? 0 : 1);
  return updates
    .filter(
      (u) =>
        u.status !== "failed_legislation" &&
        (u.status === "enacted_law" || u.status === "adopted_rule" || u.tags.includes("deadlines")),
    )
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, max);
}

const oneLine = (s: string, n = 150) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function criticalLines(updates: TaxUpdate[]): string[] {
  const items = criticalUpdates(updates);
  return [
    ...(items.length
      ? items.map((u) => `- ${u.title} (${STATUS_LABEL[u.status]}): ${oneLine(u.actionNeeded)}`)
      : ["- No enacted laws or adopted rules in this week's report."]),
    ...STANDING_DEADLINES.filter((d) =>
      ["Protest deadline", "Taxes delinquent"].includes(d.label),
    ).map((d) => `- ${d.label}: ${d.detail}`),
  ];
}

// ── Filtering ────────────────────────────────────────────────────────────
export type UpdateFilter = {
  scope: "all" | "texas" | "county";
  county: string;
  tags: TaxUpdateTag[];
  query: string;
};

export const NO_FILTER: UpdateFilter = { scope: "all", county: "", tags: [], query: "" };

export function filterUpdates(updates: TaxUpdate[], f: UpdateFilter): TaxUpdate[] {
  const q = f.query.trim().toLowerCase();
  return updates.filter((u) => {
    if (f.scope === "texas" && u.counties.length > 0) return false;
    if (f.scope === "county") {
      if (u.counties.length === 0) return false;
      if (f.county && !u.counties.includes(f.county)) return false;
    }
    if (f.tags.length > 0 && !f.tags.some((t) => u.tags.includes(t))) return false;
    if (q) {
      const hay = [
        u.title,
        u.whatChanged,
        u.affects,
        u.whyItMatters,
        u.actionNeeded,
        u.sourceName,
        u.counties.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

export function countiesIn(updates: TaxUpdate[]): string[] {
  return [...new Set(updates.flatMap((u) => u.counties))].sort();
}

// ── "May Affect Your Property" ───────────────────────────────────────────
const RESIDENTIAL = /residence|homestead|single.?family|\bsfr\b|residential/i;

export type PropertyContext = { property: PropertyRecord; protest: ProtestRecord | null };

// The user's properties an update may affect — by county for county updates,
// and for statewide updates by what the update is about (property type, an open
// protest, a case in arbitration or court, upcoming deadlines).
export function propertiesAffected(
  update: TaxUpdate,
  contexts: PropertyContext[],
): PropertyRecord[] {
  return contexts
    .filter(({ property, protest }) => {
      if (update.counties.length > 0) {
        const county = countyNameFromCad(property.cad);
        return !!county && update.counties.includes(county);
      }
      const open = !!protest && protest.status !== "resolved";
      const t = update.tags;
      if (t.includes("commercial") && !RESIDENTIAL.test(property.propertyType ?? "")) return true;
      if ((t.includes("protest") || t.includes("arb")) && open) return true;
      if (t.includes("arbitration") && protest?.escalationPath === "arbitration") return true;
      if (t.includes("court") && protest?.escalationPath === "appeal") return true;
      if (t.includes("deadlines") && open) return true;
      if (t.includes("valuation") || t.includes("tax_rate")) return true;
      return false;
    })
    .map((c) => c.property);
}

// Updates relevant to ONE property/case, for the panels embedded in other views.
export function updatesForProperty(
  updates: TaxUpdate[],
  context: PropertyContext,
  topics?: TaxUpdateTag[],
): TaxUpdate[] {
  return updates.filter((u) => {
    if (topics && !topics.some((t) => u.tags.includes(t))) return false;
    return propertiesAffected(u, [context]).length > 0;
  });
}

// ── Download ─────────────────────────────────────────────────────────────
export async function buildReportPdf(
  report: TaxReport,
  taxYear = new Date().getFullYear(),
): Promise<Uint8Array> {
  const sections: PackageSection[] = [{ heading: "Summary", lines: [report.summary] }];
  for (const ch of CHAPTERS) {
    const items = report.updates.filter((u) => u.chapter === ch.n);
    const lines: string[] = [];
    for (const u of items) {
      lines.push(
        `${u.title} [${STATUS_LABEL[u.status]}${u.isNew ? ", new this week" : ", currently posted"}]${u.counties.length ? ` - ${u.counties.join(", ")}` : ""}`,
        `What changed: ${u.whatChanged}`,
        `Effective: ${u.effectiveDate ?? "Not stated"}   Affects: ${u.affects}`,
        `Why it matters: ${u.whyItMatters}`,
        `Action: ${u.actionNeeded}`,
        `Source: ${u.sourceName} - ${u.sourceUrl}`,
        "",
      );
    }
    if (ch.n === 6) {
      lines.push("Standing deadlines (for reference, not new):");
      for (const d of STANDING_DEADLINES) lines.push(`- ${d.label}: ${d.detail}`);
      lines.push(`Source: ${STANDING_SOURCE.name} - ${STANDING_SOURCE.url}`, "");
    }
    sections.push({
      heading: ch.title,
      lines: lines.length ? lines : ["No verified updates this week."],
    });
  }
  sections.push({
    heading: "Sources checked",
    lines: report.sources.map((s) => `${s.ok ? "Read" : "Could not read"}: ${s.name} - ${s.url}`),
  });
  sections.push({
    heading: `Critical updates for tax year ${taxYear}`,
    lines: [
      ...criticalLines(report.updates),
      "",
      "Generated from official sources and summarized by AI. Verify every item against its official source. Not legal or tax advice.",
    ],
  });
  return buildAttorneyPackagePdf({
    title: report.title,
    subtitle: `Generated ${new Date(report.generatedAt).toLocaleDateString()} by CorvusPT`,
    sections,
    evidence: [],
  });
}
