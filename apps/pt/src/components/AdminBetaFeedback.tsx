import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";
import {
  listFeedbackResponses,
  getFeedbackInsights,
  regenerateFeedbackInsights,
  type AdminFeedbackRow,
  type FeedbackInsightsRecord,
} from "@/lib/beta-feedback";
import { ALL_SECTIONS, type Answer, type Question } from "@/lib/beta-feedback-questions";
import { FORM_SECTIONS } from "@/lib/feedback-form";
import { CHART_COLORS, Kpi } from "@/components/AdminKpi";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

// ── % stats — each is a closed-form question chosen to match the request as
// literally as possible; documented here so a wrong mapping is one line to
// fix, not a guess buried in JSX.
//   understand purpose immediately  -> Q1 answered, and not "I wasn't sure"
//   identified property correctly   -> Q4 "Completely/Mostly confident" (of those who saw it)
//   AI helped understand tax sit.   -> Q7 selected something other than "I understood very little..."
//   would use for a real protest    -> Q39 "I could use this for a real property tax protest."
//   would return annually           -> Q50 "Once a year" / "Every tax/assessment cycle" / "Whenever I receive a notice"
//   trust automated alerts          -> Q32 "Absolutely" / "Probably"
//   want multi-property monitoring  -> Q52 "Yes" / "Probably"
function pct(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 100);
}

function answeredWith(rows: AdminFeedbackRow[], id: string, matches: (a: Answer) => boolean) {
  const withAnswer = rows.filter((r) => r.answers[id] !== undefined);
  const matching = withAnswer.filter((r) => matches(r.answers[id]));
  return { pct: pct(matching.length, withAnswer.length), n: withAnswer.length };
}

const isIn = (opts: string[]) => (a: Answer) =>
  typeof a === "string"
    ? opts.includes(a)
    : Array.isArray(a)
      ? a.some((v) => opts.includes(v))
      : false;
const notEq = (opt: string) => (a: Answer) => (typeof a === "string" ? a !== opt : true);
const includesSomethingBut = (excluded: string) => (a: Answer) =>
  Array.isArray(a) && a.length > 0 && a.some((v) => v !== excluded);

function computeHeadlineStats(rows: AdminFeedbackRow[]) {
  // Keyed to the current chat-style form (feedback-form.ts). Responses given to
  // the earlier form have none of these answers, so they simply don't count here.
  return [
    {
      label: "Learned something new about their property",
      ...answeredWith(rows, "f4", isIn(["Yes, significantly", "Yes, somewhat"])),
    },
    {
      label: "Found the reason to protest clear",
      ...answeredWith(rows, "f8", isIn(["Very clear", "Mostly clear"])),
    },
    {
      label: "Would use the AI analysis in a real protest",
      ...answeredWith(
        rows,
        "f6",
        isIn([
          "I would rely on it with normal review",
          "I would use it but verify important conclusions",
        ]),
      ),
    },
    {
      label: "Rarely or never unsure what to do next",
      ...answeredWith(rows, "f14", isIn(["Never", "Once"])),
    },
    {
      label: "Want Corvus to guide the entire process",
      ...answeredWith(rows, "f13", isIn(["The entire process"])),
    },
    {
      label: "Want Corvus to handle as much as possible",
      ...answeredWith(rows, "f15", isIn(["I would prefer Corvus to handle as much as possible"])),
    },
    {
      label: "Want yearly monitoring built first",
      ...answeredWith(rows, "f17", isIn(["Better yearly property monitoring"])),
    },
  ];
}

function tally(rows: AdminFeedbackRow[], id: string): { name: string; value: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const a = r.answers[id];
    if (a === undefined) continue;
    const values = Array.isArray(a) ? a : [a];
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

// The current chat-style form first, then the earlier 57-question form (its
// answers stay on file and stay readable here).
const ALL_BANKS = [...FORM_SECTIONS, ...ALL_SECTIONS];

const QUESTION_BY_ID = new Map<string, Question>();
for (const section of ALL_BANKS) {
  for (const q of section.questions) {
    QUESTION_BY_ID.set(q.id, q);
    if (q.followUp) QUESTION_BY_ID.set(q.followUp.question.id, q.followUp.question);
  }
}

function formatAnswer(a: Answer): string {
  return Array.isArray(a) ? a.join(", ") : a;
}

function answeredCount(row: AdminFeedbackRow): number {
  return Object.keys(row.answers).filter((k) => QUESTION_BY_ID.has(k)).length;
}

function ResponseDetail({ row, onClose }: { row: AdminFeedbackRow; onClose: () => void }) {
  // Testers now get a per-person selection of questions, so what was "shown"
  // is whatever they actually answered, grouped by its original section.
  const shownSections = ALL_BANKS.filter((s) =>
    s.questions.some((q) => row.answers[q.id] !== undefined),
  );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {row.firstName ?? ""} {row.lastName ?? ""} — {row.email}
          </DialogTitle>
          <DialogDescription>
            {row.completedAt ? "Completed" : "In progress"} · {answeredCount(row)} answered ·
            updated {new Date(row.updatedAt).toLocaleDateString()}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6">
          {shownSections.map((section) => {
            const answered = section.questions.filter((q) => row.answers[q.id] !== undefined);
            if (answered.length === 0) return null;
            return (
              <div key={section.key}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {section.title}
                </h3>
                <div className="mt-2 grid gap-3">
                  {section.questions.map((q) => {
                    const a = row.answers[q.id];
                    if (a === undefined) return null;
                    const other = row.answers[`${q.id}__other`];
                    return (
                      <div key={q.id} className="border-b border-border pb-2 last:border-0">
                        <p className="text-xs text-muted-foreground">{q.label}</p>
                        <p className="text-sm font-medium">
                          {formatAnswer(a)}
                          {typeof other === "string" && other && ` — ${other}`}
                        </p>
                        {q.followUp && typeof row.answers[q.followUp.question.id] === "string" && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {q.followUp.question.label}{" "}
                            <span className="text-foreground">
                              {row.answers[q.followUp.question.id] as string}
                            </span>
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ThemeList({
  title,
  themes,
}: {
  title: string;
  themes: { theme: string; count: number; examples: string[] }[];
}) {
  return (
    <div className="card-elev p-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {themes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No data yet.</p>
      ) : (
        <ol className="grid gap-2">
          {themes.slice(0, 6).map((t, i) => (
            <li key={t.theme} className="text-sm">
              <span className="font-medium">
                {i + 1}. {t.theme}
              </span>{" "}
              <span className="text-muted-foreground">({t.count})</span>
              {t.examples[0] && (
                <p className="mt-0.5 text-xs italic text-muted-foreground">"{t.examples[0]}"</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function AdminBetaFeedback() {
  const [subTab, setSubTab] = useState<"responses" | "insights">("insights");
  const [rows, setRows] = useState<AdminFeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailRow, setDetailRow] = useState<AdminFeedbackRow | null>(null);
  const [insights, setInsights] = useState<FeedbackInsightsRecord | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    Promise.all([listFeedbackResponses(), getFeedbackInsights()])
      .then(([r, i]) => {
        setRows(r);
        setInsights(i);
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Could not load feedback."))
      .finally(() => setLoading(false));
  }, []);

  const completed = useMemo(() => rows.filter((r) => r.completedAt), [rows]);
  const headline = useMemo(() => computeHeadlineStats(completed), [completed]);
  const trustHesitation = useMemo(() => tally(completed, "f16"), [completed]);
  const howFar = useMemo(() => tally(completed, "f17"), [completed]);

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      const result = await regenerateFeedbackInsights();
      setInsights(result);
      toast.success("Insights regenerated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not regenerate insights.");
    } finally {
      setRegenerating(false);
    }
  }

  if (loading) {
    return <p className="mt-6 text-sm text-muted-foreground">Loading feedback…</p>;
  }

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-xl font-semibold">Beta Feedback</h2>
        <span className="badge-soft text-xs">
          {completed.length} completed · {rows.length - completed.length} in progress
        </span>
      </div>

      <div className="mt-3 flex gap-1">
        {(["insights", "responses"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
              subTab === t
                ? "bg-nav-highlight text-nav-highlight-foreground"
                : "text-muted-foreground hover:bg-secondary/60"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {subTab === "insights" && (
        <div className="mt-4 grid gap-6">
          {completed.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No completed responses yet — stats show up here once testers submit.
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {headline.map((h) => (
                  <Kpi key={h.label} label={h.label} value={`${h.pct}%`} sub={`n=${h.n}`} />
                ))}
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <div className="card-elev p-4">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    What would make them stop trusting Corvus
                  </div>
                  <ResponsiveContainer
                    width="100%"
                    height={Math.max(140, trustHesitation.length * 32)}
                  >
                    <BarChart
                      data={trustHesitation}
                      layout="vertical"
                      margin={{ top: 4, right: 24, bottom: 4, left: 4 }}
                    >
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" width={180} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                        {trustHesitation.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="card-elev p-4">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Which area to improve first
                  </div>
                  <ResponsiveContainer width="100%" height={Math.max(140, howFar.length * 32)}>
                    <BarChart
                      data={howFar}
                      layout="vertical"
                      margin={{ top: 4, right: 24, bottom: 4, left: 4 }}
                    >
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" width={180} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="value" fill="var(--accent)" radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">
                    AI-clustered themes (open-ended answers)
                  </h3>
                  <div className="flex items-center gap-2">
                    {insights && (
                      <span className="text-xs text-muted-foreground">
                        Last generated {new Date(insights.generatedAt).toLocaleString()} from{" "}
                        {insights.responseCount} responses
                      </span>
                    )}
                    <button
                      onClick={handleRegenerate}
                      disabled={regenerating}
                      className="btn-outline py-1.5 text-xs disabled:opacity-60"
                    >
                      {regenerating ? "Regenerating…" : "Regenerate insights"}
                    </button>
                  </div>
                </div>
                <div className="mt-3 grid gap-4 sm:grid-cols-3">
                  <ThemeList
                    title="Where testers felt unsure"
                    themes={insights?.insights.painPoints ?? []}
                  />
                  <ThemeList
                    title="Features testers ask us to add"
                    themes={insights?.insights.featureRequests ?? []}
                  />
                  <ThemeList
                    title="What would make them use Corvus every year"
                    themes={insights?.insights.wouldMiss ?? []}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {subTab === "responses" && (
        <div className="mt-4">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No beta testers have started the form yet.
            </p>
          ) : (
            <div className="card-elev overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left">Tester</th>
                    <th className="px-4 py-2 text-left">Status</th>
                    <th className="px-4 py-2 text-left">Answered</th>
                    <th className="px-4 py-2 text-left">Updated</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="px-4 py-2">
                        <div className="font-medium">
                          {r.firstName ?? ""} {r.lastName ?? ""}
                        </div>
                        <div className="text-xs text-muted-foreground">{r.email}</div>
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`badge-soft text-xs ${
                            r.completedAt ? "" : "bg-secondary text-muted-foreground"
                          }`}
                        >
                          {r.completedAt ? "Completed" : "In progress"}
                        </span>
                      </td>
                      <td className="px-4 py-2">{answeredCount(r)}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {new Date(r.updatedAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          onClick={() => setDetailRow(r)}
                          className="btn-outline py-1 text-xs"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {detailRow && <ResponseDetail row={detailRow} onClose={() => setDetailRow(null)} />}
    </section>
  );
}
