import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  CalendarClock,
  Download,
  Gavel,
  Landmark,
  Lightbulb,
  MapPin,
  Scale,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { listProperties, type PropertyRecord } from "@/lib/properties";
import { listProtests, type ProtestRecord } from "@/lib/protests";
import { askAboutDocument } from "@/lib/document-ai";
import { downloadPdf } from "@/lib/protest-documents";
import { getErrorMessage } from "@/lib/error-message";
import { MarkdownLite } from "@/components/MarkdownLite";
import { Skeleton } from "@/components/ui/skeleton";
import { TaxUpdateCard, updateAsText } from "@/components/TaxUpdateCard";
import { ScheduleAppointment } from "@/components/ScheduleAppointment";
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
  criticalLines,
  deleteSavedReport,
  leadUpdate,
  listSavedReports,
  listTaxReports,
  MAX_SAVED_REPORTS,
  saveGeneratedReport,
  propertiesAffected,
  type PropertyContext,
  type SavedTaxReport,
  type TaxReport,
  type TaxUpdateTag,
  type UpdateFilter,
} from "@/lib/tax-updates";

export const Route = createFileRoute("/dashboard/_layout/tax-updates")({
  head: () => ({ meta: [{ title: "Texas Tax Law & Updates — CorvusPT" }] }),
  component: TaxUpdates,
});

const CHAPTER_ICON = [Landmark, MapPin, Scale, Building2, Gavel, CalendarClock, Lightbulb];

// Counts up to `to` once, so the hero numbers feel alive.
function CountUp({ to }: { to: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (to === 0) return setN(0);
    let frame = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 900);
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to]);
  return <>{n}</>;
}

const chip = (active: boolean) =>
  `rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
    active
      ? "border-accent bg-accent/10 text-accent"
      : "border-input bg-background text-muted-foreground hover:bg-secondary/60"
  }`;

function TaxUpdates() {
  const { user } = useAuth();
  const [reports, setReports] = useState<TaxReport[]>([]);
  const [saved, setSaved] = useState<SavedTaxReport[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [contexts, setContexts] = useState<PropertyContext[]>([]);
  const [filter, setFilter] = useState<UpdateFilter>(NO_FILTER);
  const [generating, setGenerating] = useState(false);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [showSources, setShowSources] = useState(false);

  function load() {
    return listTaxReports()
      .then((r) => {
        setReports(r);
      })
      .catch((err) => toast.error(getErrorMessage(err, "Could not load the updates.")));
  }

  useEffect(() => {
    if (!user) return;
    void load().finally(() => setLoading(false));
    listSavedReports()
      .then(setSaved)
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

  const report = reports[0] ?? null;
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

  async function generate() {
    if (!report || !user) return;
    setGenerating(true);
    try {
      await saveGeneratedReport(user.id, report);
      setSaved(await listSavedReports());
      toast.success("Report generated and saved below.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not generate the report."));
    } finally {
      setGenerating(false);
    }
  }

  async function downloadSaved(r: SavedTaxReport) {
    setDownloadingId(r.id);
    try {
      downloadPdf(
        await buildReportPdf(r.report, r.taxYear),
        `Texas-Tax-Updates-${r.report.weekStart}.pdf`,
      );
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not build the PDF."));
    } finally {
      setDownloadingId(null);
    }
  }

  async function removeSaved(id: string) {
    try {
      await deleteSavedReport(id);
      setSaved((cur) => cur.filter((r) => r.id !== id));
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not delete that report."));
    }
  }

  return (
    <div>
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 via-teal-600 to-sky-700 p-5 text-white sm:p-7">
        <div className="tu-glow pointer-events-none absolute -right-10 -top-10 h-56 w-56 rounded-full bg-white/25 blur-3xl" />
        <div className="tu-glow pointer-events-none absolute -bottom-16 left-1/3 h-48 w-48 rounded-full bg-sky-300/30 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="tu-float grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/20 ring-1 ring-white/30 backdrop-blur">
              <Scale className="h-7 w-7" />
            </div>
            <div>
              <h1 className="font-serif text-2xl font-semibold sm:text-3xl">
                Texas Tax Law &amp; Updates
              </h1>
              <p className="mt-1 max-w-xl text-sm text-white/85">
                What changed this week in Texas property tax — from official sources only. Not legal
                or tax advice.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void generate()}
            disabled={!report || generating}
            className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-emerald-800 shadow-sm transition-transform hover:scale-[1.03] disabled:opacity-60"
          >
            {generating ? "Generating…" : "Generate update report"}
          </button>
        </div>
        {report && (
          <div className="relative mt-5 grid grid-cols-3 gap-2 sm:max-w-md">
            {(
              [
                ["Updates", report.updates.length],
                ["New this week", report.updates.filter((u) => u.isNew).length],
                ["Counties", countiesIn(report.updates).length],
              ] as const
            ).map(([label, n]) => (
              <div key={label} className="rounded-xl bg-white/15 px-3 py-2 ring-1 ring-white/20">
                <div className="text-2xl font-semibold tabular-nums">
                  <CountUp to={n} />
                </div>
                <div className="text-[11px] uppercase tracking-wide text-white/80">{label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="mt-6 grid gap-3">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : !report ? (
        <div className="card-elev mt-6 p-6 text-sm text-muted-foreground">
          No report has been generated yet. The first one is created automatically on the next
          Monday run.
        </div>
      ) : (
        <>
          <p className="mt-5 flex items-center gap-2 text-sm font-medium">
            <Lightbulb className="h-4 w-4 shrink-0 text-amber-500" />
            Here are some rule changes and what they mean to you.{" "}
            <a href="#tax-update-cards" className="text-accent hover:underline">
              Find out more below ↓
            </a>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {report.title} · updated {new Date(report.generatedAt).toLocaleString()}
          </p>
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
          <div id="tax-update-cards" className="mt-6 grid scroll-mt-32 gap-8">
            {CHAPTERS.map((ch) => {
              const items = visible.filter((u) => u.chapter === ch.n);
              const showStanding = ch.n === 6 && !filtering;
              if (items.length === 0 && !showStanding && filtering) return null;
              return (
                <section key={ch.n}>
                  <h2 className="flex items-center gap-2 font-serif text-lg font-semibold">
                    {(() => {
                      const ChIcon = CHAPTER_ICON[ch.n - 1] ?? Scale;
                      return (
                        <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/10 text-accent">
                          <ChIcon className="h-4 w-4" />
                        </span>
                      );
                    })()}
                    {ch.title}
                    <span className="rounded-full bg-secondary px-2 py-0.5 font-sans text-[11px] font-medium text-muted-foreground">
                      {items.length}
                    </span>
                  </h2>
                  <div className="mt-3 grid gap-4 lg:grid-cols-2">
                    {items.map((u, i) => (
                      <TaxUpdateCard
                        key={u.id}
                        index={i}
                        update={u}
                        affected={propertiesAffected(u, contexts)}
                        myContext={myContext}
                      />
                    ))}
                  </div>
                  {items.length === 0 && !showStanding && (
                    <p className="mt-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                      Nothing verified here this week.
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

          <section className="mt-8 rounded-md border border-border bg-card p-4">
            <h2 className="font-serif text-lg font-semibold">
              Critical updates for tax year {new Date().getFullYear()}
            </h2>
            <ul className="mt-2 grid gap-1 text-sm">
              {criticalLines(report.updates).map((l) => (
                <li key={l} className="text-muted-foreground">
                  {l.replace(/^- /, "")}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <section className="tu-rise mt-10 overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-700 p-5 text-white sm:p-7">
        {(() => {
          const lead = report ? leadUpdate(report.updates) : null;
          return (
            <div className="grid max-w-3xl gap-4 text-sm leading-relaxed text-white/95">
              <p>
                <strong className="text-white">A recent change: </strong>
                {lead ? (
                  <>
                    {lead.title}. {lead.whatChanged.replace(/\.$/, "")}.{" "}
                    <a
                      href={lead.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2"
                    >
                      Read it at {lead.sourceName}
                    </a>
                    .
                  </>
                ) : (
                  <>
                    Texas property-tax rules, notices and deadlines change every year, and this
                    week&rsquo;s official sources are still being checked.
                  </>
                )}
              </p>
              <p>
                <strong className="text-white">What it means for you: </strong>
                Changes like this arrive as new notices, meetings and deadlines spread across the
                Comptroller, the Legislature and your appraisal district. Most owners never see them
                until a deadline has already passed, and the pain points are familiar: confusing
                valuation notices, hours spent piecing together which rules apply to your property,
                a protest window that closes without warning, and no clear idea what to do next.
              </p>
              <p>
                <strong className="text-white">How Corvus helps: </strong>
                CorvusPT reads the official sources every week, tells you which updates may affect
                your properties, and turns them into next steps &mdash; a protest opportunity
                analysis, deadline and hearing alerts, evidence and hearing preparation, and every
                stage of your case in one place. We&rsquo;re partnering with owners to shape it
                around real needs, and as a beta customer your concerns come first.
              </p>
            </div>
          );
        })()}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <ScheduleAppointment
            trigger="button"
            buttonLabel="Schedule a Google Meet"
            defaultType="virtual"
          />
          <span className="text-xs text-white/80">
            One-on-one, 60 minutes. Pick a time that works for you.
          </span>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-lg font-semibold">Your generated reports</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          The latest {MAX_SAVED_REPORTS} are kept. Each includes that week&rsquo;s updates and a
          short summary of critical updates for the tax year.
        </p>
        {saved.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Nothing yet — use Generate update report above.
          </p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {saved.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
              >
                <div className="text-sm">
                  <div className="font-medium">{r.title}</div>
                  <div className="text-xs text-muted-foreground">
                    Generated {new Date(r.createdAt).toLocaleString()} · {r.report.updates.length}{" "}
                    update{r.report.updates.length === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void downloadSaved(r)}
                    disabled={downloadingId === r.id}
                    className="btn-outline inline-flex items-center gap-1.5 text-xs disabled:opacity-60"
                  >
                    <Download className="h-3.5 w-3.5" />
                    {downloadingId === r.id ? "Building…" : "Download PDF"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeSaved(r.id)}
                    className="text-xs text-muted-foreground hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
