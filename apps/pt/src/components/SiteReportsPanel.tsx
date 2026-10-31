import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, FileSearch, Pencil, RotateCcw, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/error-message";
import {
  decideSiteFinding,
  findingText,
  listSiteReports,
  retrySiteReport,
  SITE_REPORTS_CHANGED,
  uploadSiteReport,
  type SiteFinding,
  type SiteReport,
  type SiteReportFacts,
} from "@/lib/site-reports";

// Land Condition's optional "Upload Inspection Report" (see lib/site-reports.ts).
// The module works the same without it; with it, AI reads the whole report and
// suggests findings per land factor (with the page), which the owner confirms,
// edits or rejects. Confirmed findings are shown here by factor, marked as
// coming from the owner's documents (not the fetched FEMA / USGS records), and
// "Update Land Condition" re-runs the module with them.
export function SiteReportsPanel({
  propertyId,
  userId,
  facts,
  canEdit,
  onApply,
}: {
  propertyId: string;
  userId: string | null;
  facts: SiteReportFacts;
  canEdit: boolean;
  onApply: () => void;
}) {
  const [reports, setReports] = useState<SiteReport[]>([]);
  const [findings, setFindings] = useState<SiteFinding[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  async function reload() {
    const r = await listSiteReports(propertyId).catch(() => null);
    if (r) {
      setReports(r.reports);
      setFindings(r.findings);
    }
  }
  useEffect(() => {
    void reload();
    const onChange = () => void reload();
    window.addEventListener(SITE_REPORTS_CHANGED, onChange);
    return () => window.removeEventListener(SITE_REPORTS_CHANGED, onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);
  // a report still being read (e.g. uploaded before this panel re-mounted):
  // check back until it's done
  const reading = reports.some((r) => r.status === "reading");
  useEffect(() => {
    if (!reading) return;
    const t = setInterval(() => void reload(), 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reading, propertyId]);

  const suggested = findings.filter((f) => f.status === "suggested");
  const confirmed = findings.filter((f) => f.status === "confirmed");
  const reportName = useMemo(() => {
    const m = new Map(reports.map((r) => [r.id, r.title || r.fileName]));
    return (id: string) => m.get(id) ?? "Uploaded report";
  }, [reports]);

  async function upload(files: File[]) {
    if (!userId) return;
    for (const file of files) {
      setBusy(`Reading ${file.name}…`);
      try {
        const res = await uploadSiteReport({ userId, propertyId, file, facts });
        if (res.duplicateOf) {
          toast.info(`${file.name} was already read — its findings are below.`);
        } else {
          toast.success(
            res.found
              ? `${file.name}: ${res.found} finding${res.found === 1 ? "" : "s"} to review${res.added !== res.found ? ` (${(res.found ?? 0) - (res.added ?? 0)} already on file)` : ""}.`
              : `${file.name} was read, but no land facts were found in it.`,
          );
        }
      } catch (err) {
        toast.error(getErrorMessage(err, `Couldn't read ${file.name}.`));
      }
      await reload();
    }
    setBusy(null);
  }

  async function decide(f: SiteFinding, status: SiteFinding["status"], text?: string | null) {
    try {
      await decideSiteFinding(f.id, status, text);
      setDirty(true);
      setEditing(null);
      await reload();
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't save that."));
    }
  }

  async function confirmAllClear() {
    const clear = suggested.filter((f) => !f.needsReview && !f.conflict);
    for (const f of clear) await decideSiteFinding(f.id, "confirmed").catch(() => {});
    setDirty(true);
    await reload();
  }

  // everything reviewed → apply the confirmed findings to the module
  useEffect(() => {
    if (dirty && suggested.length === 0 && !busy) {
      setDirty(false);
      onApply();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, suggested.length, busy]);

  const byFactor = (list: SiteFinding[]) => {
    const m = new Map<string, SiteFinding[]>();
    for (const f of list) m.set(f.factor, [...(m.get(f.factor) ?? []), f]);
    return [...m.entries()];
  };

  const sourceLine = (f: SiteFinding) =>
    [reportName(f.reportId), f.page ? `p. ${f.page}` : null, f.sourceType]
      .filter(Boolean)
      .join(" · ");

  return (
    <div className="grid gap-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <FileSearch className="h-4 w-4 text-accent" />
            Inspection report
          </div>
          <p className="text-xs text-muted-foreground">
            Optional — upload an inspection report, survey or plat, FEMA flood determination,
            drainage, environmental, utility, traffic or soil report. AI reads every page and fills
            in the factors below; you confirm each finding first.
          </p>
        </div>
        {canEdit && (
          <label
            className={`btn-primary inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-xs py-1.5 ${busy ? "pointer-events-none opacity-60" : ""}`}
          >
            <Upload className="h-3.5 w-3.5" />
            {busy ? "Reading…" : "Upload Inspection Report"}
            <input
              type="file"
              accept=".pdf,image/*"
              multiple
              className="hidden"
              disabled={!!busy}
              onChange={(e) => {
                const sel = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (sel.length > 0) void upload(sel);
              }}
            />
          </label>
        )}
      </div>

      {busy && (
        <p className="rounded-md bg-accent/5 p-2 text-xs text-accent">
          {busy} AI is reading every page — a long report can take a minute or two.
        </p>
      )}

      {reports.length > 0 && (
        <ul className="grid gap-1.5 text-xs">
          {reports.map((r) => (
            <li key={r.id} className="rounded-md bg-secondary/40 p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 truncate font-medium">{r.title || r.fileName}</span>
                <span
                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    r.status === "read"
                      ? "bg-success/15 text-success"
                      : r.status === "failed"
                        ? "bg-destructive/10 text-destructive"
                        : "bg-accent/15 text-accent"
                  }`}
                >
                  {r.status === "read"
                    ? "Read"
                    : r.status === "failed"
                      ? "Couldn't read"
                      : "Reading"}
                </span>
              </div>
              <div className="text-muted-foreground">
                {[
                  r.reportType,
                  r.reportDate,
                  r.pages ? `${r.pages} pages` : null,
                  r.fileName !== (r.title || r.fileName) ? r.fileName : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              {r.summary && <p className="mt-0.5 text-muted-foreground">{r.summary}</p>}
              {r.unreadable && (
                <p className="mt-0.5 flex items-start gap-1 text-warning-foreground">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  Couldn&apos;t read clearly: {r.unreadable}
                </p>
              )}
              {r.status === "failed" && (
                <p className="mt-0.5 text-destructive">
                  {r.error}
                  {canEdit && (
                    <button
                      type="button"
                      className="ml-2 font-medium text-accent hover:underline"
                      onClick={async () => {
                        setBusy(`Reading ${r.fileName}…`);
                        await retrySiteReport(r.id, facts).catch((err) =>
                          toast.error(getErrorMessage(err, "Couldn't read it.")),
                        );
                        setBusy(null);
                        await reload();
                      }}
                    >
                      Try again
                    </button>
                  )}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {suggested.length > 0 && (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-bold uppercase tracking-wide text-accent">
              Review what AI found — {suggested.length}
            </div>
            {canEdit && suggested.some((f) => !f.needsReview && !f.conflict) && (
              <button
                type="button"
                onClick={() => void confirmAllClear()}
                className="text-xs font-medium text-accent hover:underline"
              >
                Confirm all without flags
              </button>
            )}
          </div>
          <p className="-mt-1 text-[11px] text-muted-foreground">
            Nothing here counts until you confirm it. Flagged items need a closer look.
          </p>
          {byFactor(suggested).map(([factor, list]) => (
            <div key={factor} className="grid gap-1.5">
              <div className="text-[11px] font-semibold text-muted-foreground">{factor}</div>
              {list.map((f) => (
                <div key={f.id} className="rounded-md border border-border p-2 text-xs">
                  {editing?.id === f.id ? (
                    <textarea
                      value={editing.text}
                      onChange={(e) =>
                        setEditing({ id: f.id, text: e.target.value.slice(0, 1000) })
                      }
                      rows={3}
                      aria-label="Your wording"
                      className="w-full rounded-md border border-border bg-background px-2 py-1.5"
                    />
                  ) : (
                    <p>{f.finding}</p>
                  )}
                  {f.details.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {f.details.map((d, i) => (
                        <span key={i} className="rounded bg-secondary/60 px-1.5 py-0.5 text-[10px]">
                          {d.name}: <strong>{d.value}</strong>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    From your document: {sourceLine(f)} · {f.confidence} confidence
                  </div>
                  {f.needsReview && (
                    <p className="mt-1 flex items-start gap-1 text-warning-foreground">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      Check this: {f.needsReview}
                    </p>
                  )}
                  {f.conflict && (
                    <p className="mt-1 flex items-start gap-1 text-destructive">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      Differs from the fetched record: {f.conflict} The record isn&apos;t changed —
                      confirming keeps both, side by side.
                    </p>
                  )}
                  {canEdit && (
                    <div className="mt-1.5 flex flex-wrap gap-3">
                      {editing?.id === f.id ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void decide(f, "confirmed", editing.text)}
                            className="inline-flex items-center gap-1 font-medium text-success hover:underline"
                          >
                            <Check className="h-3 w-3" /> Save &amp; confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditing(null)}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => void decide(f, "confirmed")}
                            className="inline-flex items-center gap-1 font-medium text-success hover:underline"
                          >
                            <Check className="h-3 w-3" /> Confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditing({ id: f.id, text: f.finding })}
                            className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
                          >
                            <Pencil className="h-3 w-3" /> Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void decide(f, "rejected")}
                            className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-destructive"
                          >
                            <X className="h-3 w-3" /> Reject
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {confirmed.length > 0 && (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              From your documents — confirmed — {confirmed.length}
            </div>
            {canEdit && dirty && (
              <button
                type="button"
                onClick={() => {
                  setDirty(false);
                  onApply();
                }}
                className="text-xs font-medium text-accent hover:underline"
              >
                Update Land Condition now
              </button>
            )}
          </div>
          {byFactor(confirmed).map(([factor, list]) => (
            <div key={factor} className="rounded-md bg-success/5 p-2 text-xs">
              <div className="font-semibold">{factor}</div>
              {list.map((f) => (
                <div key={f.id} className="mt-1">
                  <p>
                    {findingText(f)}
                    {f.editedFinding && (
                      <span className="ml-1 text-[10px] text-muted-foreground">(your wording)</span>
                    )}
                  </p>
                  <div className="text-[10px] text-muted-foreground">
                    {sourceLine(f)}
                    {f.matchesRecord && " · matches the fetched record"}
                  </div>
                  {f.conflict && (
                    <p className="text-[10px] text-destructive">
                      Differs from the fetched record: {f.conflict}
                    </p>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => void decide(f, "suggested", null)}
                      className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      <RotateCcw className="h-2.5 w-2.5" /> Undo
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
