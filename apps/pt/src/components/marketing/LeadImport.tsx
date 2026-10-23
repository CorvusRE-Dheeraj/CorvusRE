import { useMemo, useState } from "react";
import { FileSpreadsheet, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { MarkdownLite } from "@/components/MarkdownLite";
import { useFileDrop } from "@/hooks/use-file-drop";
import { askAboutDocument } from "@/lib/document-ai";
import { getErrorMessage } from "@/lib/error-message";
import { readSpreadsheet, type SpreadsheetGrid } from "@/lib/spreadsheet-import";
import {
  addProperties,
  createLead,
  logActivity,
  money,
  runRules,
  updateLead,
  type Lead,
  type MarketingData,
} from "@/lib/marketing";
import {
  LEAD_FIELDS,
  LEAD_FIELD_LABEL,
  buildImport,
  importProperties,
  mapLeadColumns,
  mergeAiMapping,
  mergePatch,
  type ImportAction,
  type ImportGroup,
  type LeadColumnMapping,
  type LeadColumnTarget,
} from "@/lib/marketing-crm";
import { researchMany } from "@/lib/marketing-research";

type Step = "source" | "map" | "review" | "running" | "done";

// Upload → map columns (AI fills the gaps) → review: one row per owner with
// their properties combined, duplicates matched to existing leads, missing
// details and corrections shown → import → optional AI research of new leads.
export function LeadImport({
  data,
  reload,
  onClose,
  onPodio,
}: {
  data: MarketingData;
  reload: () => Promise<void>;
  onClose: () => void;
  onPodio: () => void;
}) {
  const [step, setStep] = useState<Step>("source");
  const [fileName, setFileName] = useState("");
  const [grid, setGrid] = useState<SpreadsheetGrid | null>(null);
  const [mapping, setMapping] = useState<LeadColumnMapping[]>([]);
  const [fix, setFix] = useState(true);
  const [groups, setGroups] = useState<ImportGroup[]>([]);
  const [assignTo, setAssignTo] = useState<string>(data.me ?? "");
  const [research, setResearch] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<{
    added: number;
    merged: number;
    skipped: number;
    failed: string[];
    researched: number;
  } | null>(null);

  async function onFile(file: File) {
    setBusy("read");
    try {
      const g = await readSpreadsheet(file);
      if (!g.rows.length) throw new Error("That file has no rows under the header.");
      setFileName(file.name);
      setGrid(g);
      setMapping(mapLeadColumns(g.headers));
      setStep("map");
    } catch (err) {
      toast.error(
        getErrorMessage(err, "Couldn't read that file. Use .xlsx, .xls or .csv with a header row."),
      );
    } finally {
      setBusy(null);
    }
  }
  const { isDragging, dropHandlers } = useFileDrop((f) => void onFile(f), !!busy);

  async function aiMap() {
    if (!grid) return;
    const open = mapping.filter((m) => m.source === "unmapped").map((m) => m.header);
    if (!open.length) return toast.info("Every column is already mapped.");
    setBusy("aimap");
    try {
      const sample = grid.rows
        .slice(0, 3)
        .map((r) => grid.headers.map((h, i) => `${h}: ${r[i] ?? ""}`).join(" | "));
      const { answer } = await askAboutDocument({
        question:
          `Map these spreadsheet columns to CRM lead fields. Fields: ${LEAD_FIELDS.join(", ")}. ` +
          `Columns to map: ${JSON.stringify(open)}. Reply with JSON only: {"<column>": "<field>"} — leave out columns that fit none.`,
        context: `Sample rows:\n${sample.join("\n")}`,
      });
      const j = JSON.parse(answer.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as Record<string, string>;
      const next = mergeAiMapping(mapping, j);
      const n =
        next.filter((m) => m.source === "ai").length -
        mapping.filter((m) => m.source === "ai").length;
      setMapping(next);
      toast.success(
        n
          ? `Corvus AI mapped ${n} more column${n === 1 ? "" : "s"} — check them.`
          : "No other columns fit a lead field.",
      );
    } catch (err) {
      toast.error(getErrorMessage(err, "Corvus AI couldn't map the columns. Pick them by hand."));
    } finally {
      setBusy(null);
    }
  }

  const review = (f = fix) => {
    if (!grid) return;
    setGroups(buildImport(grid.rows, mapping, data.leads, data.properties, f));
    setStep("review");
  };

  const counts = useMemo(() => {
    const c = { add: 0, merge: 0, skip: 0, props: 0, missing: 0, dup: 0 };
    for (const g of groups) {
      c[g.action]++;
      if (g.action !== "skip") c.props += g.properties.length;
      if (g.missing.length) c.missing++;
      if (g.match || g.sharedWith.length) c.dup++;
    }
    return c;
  }, [groups]);
  const leadById = useMemo(() => new Map(data.leads.map((l) => [l.id, l])), [data.leads]);
  const setAction = (key: string, action: ImportAction) =>
    setGroups((gs) =>
      gs.map((g) =>
        g.key === key
          ? {
              ...g,
              action,
              mergeInto:
                action === "merge" ? (g.mergeInto ?? g.match?.leadId ?? null) : g.mergeInto,
            }
          : g,
      ),
    );

  async function aiReview() {
    setBusy("aireview");
    try {
      const lines = groups
        .slice(0, 80)
        .map(
          (g) =>
            `${g.lead.company || g.lead.fullName || g.lead.email || "?"} | ${g.action}${g.match ? ` (matches ${g.match.name}: ${g.match.reason})` : ""} | ${g.properties.length} props | missing: ${g.missing.join(", ") || "-"} | issues: ${g.issues.map((i) => i.message).join("; ") || "-"}`,
        );
      const { answer } = await askAboutDocument({
        question:
          "You are checking a lead import for a Texas property-tax CRM before it's saved. In under 150 words: flag rows that look wrong (likely duplicates, test data, mismatched owner vs company, missing contact info), say which merges look risky, and what to fix first. Use only the rows given.",
        context: `File: ${fileName}\n${lines.join("\n")}`,
      });
      setAiNote(answer);
    } catch (err) {
      toast.error(getErrorMessage(err, "Corvus AI couldn't review this import."));
    } finally {
      setBusy(null);
    }
  }

  async function run() {
    setStep("running");
    const res = { added: 0, merged: 0, skipped: 0, failed: [] as string[], researched: 0 };
    const fresh: Lead[] = [];
    const todo = groups.filter((g) => g.action !== "skip");
    res.skipped = groups.length - todo.length;
    let i = 0;
    for (const g of todo) {
      setProgress(`Saving ${++i} of ${todo.length}…`);
      const name = g.lead.company || g.lead.fullName || g.lead.email || "row";
      try {
        const src = {
          source: `Import: ${fileName}`,
          confidence: 0.8,
          verified: false,
          at: new Date().toISOString(),
        };
        if (g.action === "merge" && g.mergeInto && leadById.get(g.mergeInto)) {
          const ex = leadById.get(g.mergeInto)!;
          const patch = mergePatch(ex, g.lead);
          const fs = { ...ex.fieldSources };
          for (const k of Object.keys(patch)) if (k !== "notes") fs[k] = src;
          await updateLead(ex.id, {
            ...patch,
            fieldSources: fs,
            ...(!ex.assignedTo && assignTo ? { assignedTo: assignTo } : {}),
          });
          await addProperties(
            importProperties(ex.id, g.properties, "import", `Import: ${fileName}`),
          );
          await logActivity({
            leadId: ex.id,
            kind: "import",
            summary: `Merged from ${fileName}${g.properties.length ? ` · ${g.properties.length} propert${g.properties.length === 1 ? "y" : "ies"}` : ""}`,
          });
          await runRules(ex.id);
          res.merged++;
        } else {
          const fs = Object.fromEntries(
            Object.entries(g.lead)
              .filter(([, v]) => v)
              .map(([k]) => [k, src]),
          );
          const l = await createLead({
            ...g.lead,
            source: "import",
            assignedTo: assignTo || null,
            fieldSources: fs,
          });
          await addProperties(
            importProperties(l.id, g.properties, "import", `Import: ${fileName}`),
          );
          await logActivity({ leadId: l.id, kind: "import", summary: `Imported from ${fileName}` });
          await runRules(l.id);
          fresh.push(l);
          res.added++;
        }
      } catch (err) {
        res.failed.push(`${name}: ${getErrorMessage(err, "failed")}`);
      }
    }
    await reload();
    if (research && fresh.length) {
      setProgress(
        `Corvus AI is researching ${fresh.length} new lead${fresh.length === 1 ? "" : "s"}…`,
      );
      // research needs the freshly saved properties
      const { loadMarketing } = await import("@/lib/marketing");
      const latest = await loadMarketing();
      const leads = latest.leads.filter((l) => fresh.some((f) => f.id === l.id));
      const r = await researchMany(leads.slice(0, 50), latest, (n) =>
        setProgress(`Researched ${n} of ${Math.min(50, leads.length)}…`),
      );
      res.researched = r.ok;
      await reload();
    }
    setResult(res);
    setStep("done");
  }

  return (
    <Modal onClose={step === "running" ? () => undefined : onClose} xl>
      <div className="grid gap-4 p-5 sm:p-6">
        <div>
          <h2 className="font-serif text-2xl font-semibold">Import leads</h2>
          <p className="text-sm text-muted-foreground">
            {step === "source" &&
              "Excel or CSV with one row per contact or property. Rows for the same owner become one lead with a portfolio."}
            {step === "map" &&
              `${fileName} — ${grid?.rows.length} rows. Check which column is which.`}
            {step === "review" &&
              "Nothing is saved until you press Import. Existing leads are only ever filled in, never overwritten."}
            {(step === "running" || step === "done") && fileName}
          </p>
        </div>

        {step === "source" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label
              {...dropHandlers}
              className={`grid cursor-pointer place-items-center gap-2 rounded-lg border-2 border-dashed p-8 text-center ${isDragging ? "border-accent bg-accent/5" : "border-border"}`}
            >
              <Upload className="h-6 w-6 text-muted-foreground" aria-hidden />
              <span className="text-sm font-medium">
                {busy === "read" ? "Reading…" : "Drop a file or choose one"}
              </span>
              <span className="text-xs text-muted-foreground">.xlsx, .xls or .csv</span>
              <input
                type="file"
                className="sr-only"
                accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])}
              />
            </label>
            <button
              type="button"
              onClick={onPodio}
              className="grid place-items-center gap-2 rounded-lg border border-border p-8 text-center hover:bg-secondary/40"
            >
              <FileSpreadsheet className="h-6 w-6 text-muted-foreground" aria-hidden />
              <span className="text-sm font-medium">Import from Podio</span>
              <span className="text-xs text-muted-foreground">
                Matches your Podio contacts to leads and shows every change for approval
              </span>
            </button>
          </div>
        )}

        {step === "map" && grid && (
          <>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="border-b border-border text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Column in file</th>
                    <th className="px-3 py-2 font-medium">Example</th>
                    <th className="px-3 py-2 font-medium">Lead field</th>
                  </tr>
                </thead>
                <tbody>
                  {mapping.map((m, i) => (
                    <tr key={m.header + i} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-1.5 font-medium">{m.header}</td>
                      <td className="max-w-[16rem] truncate px-3 py-1.5 text-xs text-muted-foreground">
                        {grid.rows.find((r) => r[i])?.[i] ?? ""}
                      </td>
                      <td className="px-3 py-1.5">
                        <select
                          className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                          aria-label={`Field for ${m.header}`}
                          value={m.field}
                          onChange={(e) =>
                            setMapping((ms) =>
                              ms.map((x, j) =>
                                j === i
                                  ? {
                                      ...x,
                                      field: e.target.value as LeadColumnTarget,
                                      source: "user",
                                    }
                                  : x.field === e.target.value
                                    ? { ...x, field: "ignore", source: "user" }
                                    : x,
                              ),
                            )
                          }
                        >
                          <option value="ignore">— skip —</option>
                          {LEAD_FIELDS.map((f) => (
                            <option key={f} value={f}>
                              {LEAD_FIELD_LABEL[f]}
                            </option>
                          ))}
                        </select>
                        {m.source === "ai" && (
                          <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-900">
                            AI
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                disabled={!!busy}
                onClick={() => void aiMap()}
                className="btn-outline mr-auto inline-flex items-center gap-1.5 text-sm disabled:opacity-60"
              >
                <Sparkles className="h-4 w-4" aria-hidden />{" "}
                {busy === "aimap" ? "Mapping…" : "Map the rest with Corvus AI"}
              </button>
              <button
                type="button"
                onClick={() => setStep("source")}
                className="btn-outline text-sm"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => {
                  if (
                    !mapping.some((m) =>
                      ["email", "phone", "fullName", "company", "ownerNames", "address"].includes(
                        m.field,
                      ),
                    )
                  )
                    return toast.error("Map at least a name, email, phone or address column.");
                  review();
                }}
                className="btn-primary btn-primary-hover text-sm"
              >
                Review {grid.rows.length} rows
              </button>
            </div>
          </>
        )}

        {step === "review" && (
          <>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 font-semibold text-emerald-900">
                {counts.add} new
              </span>
              <span className="rounded-full bg-sky-100 px-2.5 py-1 font-semibold text-sky-900">
                {counts.merge} merge into existing
              </span>
              <span className="rounded-full bg-secondary px-2.5 py-1 font-semibold">
                {counts.skip} skip
              </span>
              <span className="rounded-full bg-secondary px-2.5 py-1">
                {counts.props} properties
              </span>
              {counts.dup > 0 && (
                <span className="rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-900">
                  {counts.dup} possible duplicates
                </span>
              )}
              {counts.missing > 0 && (
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-900">
                  {counts.missing} missing details
                </span>
              )}
            </div>
            <div className="max-h-[52vh] overflow-auto rounded-lg border border-border">
              <ul className="divide-y divide-border">
                {groups.map((g) => {
                  const total = g.properties.reduce((s, p) => s + (p.assessedValue ?? 0), 0);
                  return (
                    <li
                      key={g.key}
                      className={`grid gap-1.5 p-3 text-sm sm:grid-cols-[minmax(0,1fr)_14rem] ${g.action === "skip" ? "opacity-60" : ""}`}
                    >
                      <div className="min-w-0">
                        <div className="font-medium">
                          {g.lead.company || g.lead.fullName || g.lead.email || "(no name)"}
                          {g.lead.company && g.lead.fullName && (
                            <span className="font-normal text-muted-foreground">
                              {" "}
                              · {g.lead.fullName}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {[g.lead.email, g.lead.phone].filter(Boolean).join(" · ") ||
                            "no email or phone"}
                          {g.properties.length > 0 &&
                            ` · ${g.properties.length} propert${g.properties.length === 1 ? "y" : "ies"}${total ? ` · ${money(total)}` : ""}`}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {g.missing.map((m) => (
                            <span
                              key={m}
                              className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-900"
                            >
                              missing {m}
                            </span>
                          ))}
                          {g.corrections.map((c, i) => (
                            <span
                              key={i}
                              className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-900"
                              title={c.why}
                            >
                              {fix ? "fixed" : "suggest"}: {c.from} → {c.to}
                            </span>
                          ))}
                        </div>
                        {g.issues.map((iss, i) => (
                          <p
                            key={i}
                            className={`text-xs ${iss.level === "error" ? "text-rose-700" : iss.level === "warning" ? "text-amber-800" : "text-muted-foreground"}`}
                          >
                            {iss.message}
                          </p>
                        ))}
                        {g.match && (
                          <p className="text-xs text-sky-800">
                            Matches existing lead <b>{g.match.name}</b> — {g.match.reason} (
                            {Math.round(g.match.confidence * 100)}%)
                          </p>
                        )}
                      </div>
                      <select
                        className="self-start rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                        aria-label="What to do with this row"
                        value={g.action === "merge" ? `merge:${g.mergeInto}` : g.action}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v.startsWith("merge:"))
                            setGroups((gs) =>
                              gs.map((x) =>
                                x.key === g.key
                                  ? { ...x, action: "merge", mergeInto: v.slice(6) }
                                  : x,
                              ),
                            );
                          else setAction(g.key, v as ImportAction);
                        }}
                      >
                        <option value="add">Add as new lead</option>
                        {g.match && (
                          <option value={`merge:${g.match.leadId}`}>
                            Merge into {g.match.name}
                          </option>
                        )}
                        {g.sharedWith
                          .filter((s) => s.leadId !== g.match?.leadId)
                          .filter((s, i, a) => a.findIndex((x) => x.leadId === s.leadId) === i)
                          .map((s) => (
                            <option key={s.leadId} value={`merge:${s.leadId}`}>
                              Merge into {s.name}
                            </option>
                          ))}
                        <option value="skip">Skip</option>
                      </select>
                    </li>
                  );
                })}
              </ul>
            </div>
            {aiNote && (
              <MarkdownLite text={aiNote} className="rounded-lg bg-secondary/50 p-3 text-sm" />
            )}
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={fix}
                  onChange={(e) => {
                    setFix(e.target.checked);
                    review(e.target.checked);
                  }}
                />
                Apply suggested corrections
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={research}
                  onChange={(e) => setResearch(e.target.checked)}
                />
                Research new leads with Corvus AI after import
              </label>
              <label className="inline-flex items-center gap-2">
                Assign new leads to
                <select
                  className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                  value={assignTo}
                  onChange={(e) => setAssignTo(e.target.value)}
                >
                  <option value="">Nobody</option>
                  {data.staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
              <button
                type="button"
                disabled={!!busy}
                onClick={() => void aiReview()}
                className="btn-outline mr-auto inline-flex items-center gap-1.5 text-sm disabled:opacity-60"
              >
                <Sparkles className="h-4 w-4" aria-hidden />{" "}
                {busy === "aireview" ? "Checking…" : "Check with Corvus AI"}
              </button>
              <button type="button" onClick={() => setStep("map")} className="btn-outline text-sm">
                Back
              </button>
              <button
                type="button"
                disabled={counts.add + counts.merge === 0}
                onClick={() => void run()}
                className="btn-primary btn-primary-hover text-sm disabled:opacity-60"
              >
                Import {counts.add + counts.merge} lead{counts.add + counts.merge === 1 ? "" : "s"}
              </button>
            </div>
          </>
        )}

        {step === "running" && (
          <p className="py-10 text-center text-sm text-muted-foreground">{progress}</p>
        )}

        {step === "done" && result && (
          <div className="grid gap-3">
            <p className="text-sm">
              <b>{result.added}</b> added, <b>{result.merged}</b> merged into existing leads,{" "}
              {result.skipped} skipped
              {result.researched ? `, ${result.researched} researched by Corvus AI` : ""}.
            </p>
            {result.failed.length > 0 && (
              <ul className="list-disc pl-5 text-xs text-rose-700">
                {result.failed.slice(0, 10).map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="btn-primary btn-primary-hover text-sm"
              >
                Done
              </button>
            </div>
          </div>
        )}
        {step !== "running" && step !== "done" && step !== "source" && (
          <p className="text-[11px] text-muted-foreground">
            * Merges only fill empty fields — existing details are never overwritten.
          </p>
        )}
      </div>
    </Modal>
  );
}
