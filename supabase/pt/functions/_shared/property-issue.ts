// Pure helpers for analyze-property-issue: the categories the table allows,
// and the clamp that turns the model's JSON into fields the UI and the
// public.property_issues check constraints can trust. No Deno APIs, so the
// app's vitest suite imports it directly.

export const ISSUE_CATEGORY_IDS = [
  "dumping",
  "grass",
  "maintenance",
  "court_order",
  "code_offense",
  "inspection",
  "fine",
  "compliance_deadline",
  "other",
] as const;
export type IssueCategoryId = (typeof ISSUE_CATEGORY_IDS)[number];

export type IssueExtraction = {
  category: IssueCategoryId;
  title: string;
  description: string | null;
  issuedOn: string | null;
  deadline: string | null;
  inspectionDate: string | null;
  courtDate: string | null;
  fineAmount: number | null;
  fineDue: string | null;
  requiredAction: string | null;
  authority: string | null;
  authorityContact: string | null;
  consequences: string | null;
};

export type IssueGuidance = {
  whatHappened: string;
  whatToDo: string;
  byWhen: string;
  ifNotResolved: string;
  nextSteps: string[];
  whoToHire: string;
};

export type IssueAnalysis = {
  fields: IssueExtraction;
  guidance: IssueGuidance | null;
};

const str = (v: unknown, len: number): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s && !/^(null|n\/a|none|unknown|not specified)$/i.test(s)
    ? s.slice(0, len)
    : null;
};

// Accepts YYYY-MM-DD or MM/DD/YYYY and returns a real calendar date as
// YYYY-MM-DD — anything else (or an impossible date like 02/30) is null,
// since these land in Postgres date columns and drive reminders.
export function toIsoDate(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  let y: number, m: number, d: number;
  let match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)))
    [y, m, d] = [Number(match[3]), Number(match[1]), Number(match[2])];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  )
    return null;
  if (y < 2000 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function toAmount(v: unknown): number | null {
  const n =
    typeof v === "number"
      ? v
      : typeof v === "string"
        ? Number(v.replace(/[$,\s]/g, ""))
        : NaN;
  return Number.isFinite(n) && n > 0 && n < 10_000_000
    ? Math.round(n * 100) / 100
    : null;
}

export function sanitizeIssueAnalysis(
  parsed: Record<string, unknown>,
): IssueAnalysis {
  const f = (parsed.fields ?? parsed) as Record<string, unknown>;
  const category = ISSUE_CATEGORY_IDS.includes(f.category as IssueCategoryId)
    ? (f.category as IssueCategoryId)
    : "other";
  const fields: IssueExtraction = {
    category,
    title: str(f.title, 140) ?? "Property notice",
    description: str(f.description, 1500),
    issuedOn: toIsoDate(f.issuedOn),
    deadline: toIsoDate(f.deadline),
    inspectionDate: toIsoDate(f.inspectionDate),
    courtDate: toIsoDate(f.courtDate),
    fineAmount: toAmount(f.fineAmount),
    fineDue: toIsoDate(f.fineDue),
    requiredAction: str(f.requiredAction, 600),
    authority: str(f.authority, 200),
    authorityContact: str(f.authorityContact, 300),
    consequences: str(f.consequences, 600),
  };

  const g = parsed.guidance as Record<string, unknown> | undefined;
  const steps = Array.isArray(g?.nextSteps)
    ? g.nextSteps
        .map((s) => str(s, 240))
        .filter((s): s is string => !!s)
        .slice(0, 6)
    : [];
  const guidance: IssueGuidance | null =
    g && str(g.whatToDo, 800)
      ? {
          whatHappened: str(g.whatHappened, 800) ?? "",
          whatToDo: str(g.whatToDo, 800) ?? "",
          byWhen: str(g.byWhen, 300) ?? "No deadline is stated — act promptly.",
          ifNotResolved: str(g.ifNotResolved, 600) ?? "",
          nextSteps: steps,
          whoToHire: str(g.whoToHire, 300) ?? "",
        }
      : null;
  return { fields, guidance };
}
