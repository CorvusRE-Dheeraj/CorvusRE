import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { checkIsAdmin } from "@/lib/admin";
import { listProperties, type PropertyRecord } from "@/lib/properties";
import { listProtests, type ProtestRecord } from "@/lib/protests";
import { askAboutDocument } from "@/lib/document-ai";
import { downloadPdf } from "@/lib/protest-documents";
import { getErrorMessage } from "@/lib/error-message";
import { MarkdownLite } from "@/components/MarkdownLite";
import { Skeleton } from "@/components/ui/skeleton";
import { TaxUpdateCard, updateAsText } from "@/components/TaxUpdateCard";
import {
  ALL_TAGS,
  CHAPTERS,
  NO_FILTER,
  STANDING_DEADLINES,
  STANDING_SOURCE,
  TAG_LABEL,
  buildReportPdf,
  countiesIn,
  filterUpdates,
  generateTaxReportNow,
  listTaxReports,
  propertiesAffected,
  type PropertyContext,
  type TaxReport,
  type TaxUpdateTag,
  type UpdateFilter,
} from "@/lib/tax-updates";

export const Route = createFileRoute("/dashboard/_layout/tax-updates")({
  head: () => ({ meta: [{ title: "Texas Tax Law & Updates — CorvusPT" }] }),
  component: TaxUpdates,
});

const chip = (active: boolean) =>
  `rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
    active
      ? "border-accent bg-accent/10 text-accent"
      : "border-input bg-background text-muted-foreground hover:bg-secondary/60"
  }`;

function TaxUpdates() {
  const { user } = useAuth();
  const [reports, setReports] = useState<TaxReport[]>([]);
  const [reportId, setReportId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [contexts, setContexts] = useState<PropertyContext[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [filter, setFilter] = useState<UpdateFilter>(NO_FILTER);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [showSources, setShowSources] = useState(false);

  function load() {
    return listTaxReports()
      .then((r) => {
        setReports(r);
        setReportId((cur) => cur ?? r[0]?.id ?? null);
      })
      .catch((err) => toast.error(getErrorMessage(err, "Could not load the updates.")));
  }

  useEffect(() => {
    if (!user) return;
    void load().finally(() => setLoading(false));
    checkIsAdmin(user.id)
      .then(setIsAdmin)
      .catch(() => {});
    Promise.all([listProperties(user.id), listProtests(user.id)])
      .then(([props, prots]) =>
        setContexts(
          props.map((p) => ({
            property: p as PropertyRecord,
            protest: (prots as ProtestRecord[]).find((x) => x.propertyId === p.id) ?? null,
          })),
        ),
      )
      .catch(() => {});
  }, [user]);

  const report = reports.find((r) => r.id === reportId) ?? reports[0] ?? null;
  const visible = useMemo(
    () => (report ? filterUpdates(report.updates, filter) : []),
    [report, filter],
  );
  const counties = useMemo(() => (report ? countiesIn(report.updates) : []), [report]);
  const filtering = filter.scope !== "all" || filter.tags.length > 0 || filter.query.trim() !== "";

  // A plain-text summary of the reader's properties and cases, for the AI.
  const myContext = contexts
    .map(
      ({ property, protest }) =>
        `${property.address} (${property.cad ?? "county n/a"}, ${property.propertyType ?? "type n/a"})` +
        (protest
          ? `; case status ${protest.status}${protest.escalationPath ? `, path ${protest.escalationPath}` : ""}`
          : "; no protest"),
    )
    .join("\n");

  function toggleTag(t: TaxUpdateTag) {
    setFilter((f) => ({
      ...f,
      tags: f.tags.includes(t) ? f.tags.filter((x) => x !== t) : [...f.tags, t],
    }));
  }

  async function ask() {
    const q = question.trim();
    if (!q || !report) return;
    setAsking(true);
    try {
      const { answer: a } = await askAboutDocument({
        question:
          `${q}\n\nAnswer using ONLY the Texas property-tax updates and my property summary below. ` +
          "If the updates don't cover it, say so. Mention which update you're using. Do not give legal advice; remind me to verify against the official source.",
        context: `UPDATES (${report.title}):\n${report.updates.map(updateAsText).join("\n---\n") || "(none this week)"}\n\nMY PROPERTIES AND CASES:\n${myContext || "(none)"}`,
      });
      setAnswer(a);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not answer that."));
    } finally {
      setAsking(false);
    }
  }

  async function download() {
    if (!report) return;
    setDownloading(true);
    try {
      downloadPdf(await buildReportPdf(report), `Texas-Tax-Updates-${report.weekStart}.pdf`);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not build the PDF."));
    } finally {
      setDownloading(false);
    }
  }

  async function generateNow() {
    setGenerating(true);
    try {
      const r = await generateTaxReportNow();
      toast.success(`Report generated — ${r.updates} update(s) from ${r.sourcesRead} sources.`);
      await load();
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not generate the report."));
    } finally {
      setGenerating(false);
    }
  }

  const exploreButton = (
    <Link to="/dashboard/properties" className="btn-primary btn-primary-hover text-sm">
      Explore Your Property
    </Link>
  );

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Texas Tax Law &amp; Updates</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            A short weekly brief of new or changed Texas property-tax information, built only from
            official sources (Comptroller, Legislature, Texas Register, appraisal districts). Not
            legal or tax advice — verify each item at its source.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {exploreButton}
          <button
            type="button"
            onClick={() => void download()}
            disabled={!report || downloading}
            className="btn-outline inline-flex items-center gap-1.5 text-sm disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            {downloading ? "Building…" : "Download PDF"}
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => void generateNow()}
              disabled={generating}
              className="btn-outline text-sm disabled:opacity-60"
            >
              {generating ? "Generating (about a minute)…" : "Generate now"}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="mt-6 grid gap-3">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : !report ? (
        <div className="card-elev mt-6 p-6 text-sm text-muted-foreground">
          No report has been generated yet. The first one is created automatically on the next
          Monday run{isAdmin ? " — or use Generate now." : "."}
        </div>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Report</span>
              <select
                value={report.id}
                onChange={(e) => setReportId(e.target.value)}
                className="rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
              >
                {reports.map((r, i) => (
                  <option key={r.id} value={r.id}>
                    Week of {new Date(`${r.weekStart}T00:00:00`).toLocaleDateString()}
                    {i === 0 ? " (latest)" : ""} — {r.updates.length} update
                    {r.updates.length === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-xs text-muted-foreground">
              Generated {new Date(report.generatedAt).toLocaleString()}
            </span>
          </div>
          <p className="mt-2 text-sm">{report.summary}</p>
          <button
            type="button"
            onClick={() => setShowSources((v) => !v)}
            className="mt-1 text-xs text-accent hover:underline"
          >
            {showSources ? "Hide" : "Show"} sources checked (
            {report.sources.filter((s) => s.ok).length} of {report.sources.length} read)
          </button>
          {showSources && (
            <ul className="mt-2 grid gap-0.5 text-xs">
              {report.sources.map((s) => (
                <li key={s.url} className={s.ok ? "text-muted-foreground" : "text-destructive"}>
                  {s.ok ? "✓" : "✗"}{" "}
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    {s.name}
                  </a>
                  {!s.ok && ` — could not be read (${s.note})`}
                </li>
              ))}
            </ul>
          )}

          {/* Filters + search */}
          <div className="mt-5 grid gap-3 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  ["all", "All"],
                  ["texas", "Texas"],
                  ["county", "County"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() =>
                    setFilter((f) => ({ ...f, scope: v, county: v === "county" ? f.county : "" }))
                  }
                  className={chip(filter.scope === v)}
                >
                  {label}
                </button>
              ))}
              {filter.scope === "county" && (
                <select
                  value={filter.county}
                  onChange={(e) => setFilter((f) => ({ ...f, county: e.target.value }))}
                  aria-label="County"
                  className="rounded-md border border-input bg-background px-2 py-1 text-xs"
                >
                  <option value="">All counties</option>
                  {counties.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
              <span className="mx-1 h-4 w-px bg-border" aria-hidden />
              {ALL_TAGS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTag(t)}
                  className={chip(filter.tags.includes(t))}
                >
                  {TAG_LABEL[t]}
                </button>
              ))}
              {filtering && (
                <button
                  type="button"
                  onClick={() => setFilter(NO_FILTER)}
                  className="text-xs text-muted-foreground hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                value={filter.query}
                onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
                placeholder="Search updates…"
                aria-label="Search updates"
                className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-sm"
              />
            </label>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void ask()}
                  placeholder="Ask AI about these updates, e.g. “What changed for ARB hearings?”"
                  aria-label="Ask AI about these updates"
                  className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => void ask()}
                  disabled={asking || !question.trim()}
                  className="btn-accent text-sm disabled:opacity-60"
                >
                  {asking ? "Thinking…" : "Ask AI"}
                </button>
              </div>
              {answer && (
                <MarkdownLite text={answer} className="mt-2 text-sm text-muted-foreground" />
              )}
            </div>
          </div>

          {/* Chapters */}
          <div className="mt-6 grid gap-8">
            {CHAPTERS.map((ch) => {
              const items = visible.filter((u) => u.chapter === ch.n);
              const showStanding = ch.n === 6 && !filtering;
              if (items.length === 0 && !showStanding && filtering) return null;
              return (
                <section key={ch.n}>
                  <h2 className="font-serif text-lg font-semibold">
                    {ch.title}
                  </h2>
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    {items.map((u) => (
                      <TaxUpdateCard
                        key={u.id}
                        update={u}
                        affected={propertiesAffected(u, contexts)}
                        myContext={myContext}
                      />
                    ))}
                  </div>
                  {items.length === 0 && !showStanding && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      No verified updates this week.
                    </p>
                  )}
                  {showStanding && (
                    <div className="mt-3 rounded-md border border-dashed border-border p-4 text-xs">
                      <div className="font-semibold uppercase tracking-wide text-muted-foreground">
                        Standing deadlines (for reference — not new)
                      </div>
                      <ul className="mt-2 grid gap-1">
                        {STANDING_DEADLINES.map((d) => (
                          <li key={d.label}>
                            <span className="font-medium">{d.label}:</span>{" "}
                            <span className="text-muted-foreground">{d.detail}</span>
                          </li>
                        ))}
                      </ul>
                      <a
                        href={STANDING_SOURCE.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-block text-accent hover:underline"
                      >
                        {STANDING_SOURCE.name} →
                      </a>
                    </div>
                  )}
                </section>
              );
            })}
            {filtering && visible.length === 0 && (
              <p className="text-sm text-muted-foreground">No updates match these filters.</p>
            )}
          </div>

          <div className="mt-8 flex justify-center">{exploreButton}</div>
        </>
      )}
    </div>
  );
}
