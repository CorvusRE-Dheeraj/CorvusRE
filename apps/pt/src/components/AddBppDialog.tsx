import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Building2, FileUp, PencilLine, Link2, Sheet, Sparkles, AlertTriangle } from "lucide-react";
import { WorkflowPopup, FileButton } from "@/components/case/workflow-ui";
import { addBppAccount, type BppAccountRecord } from "@/lib/bpp-accounts";
import type { PropertyRecord } from "@/lib/properties";
import {
  BPP_CSV_FIELD_LABEL,
  TX_COUNTIES,
  bppColumnMapping,
  cadForCounty,
  candidateIssues,
  candidatesFromGrid,
  countyOf,
  downloadBppCsvTemplate,
  extractJson,
  matchPropertyByAddress,
  newCandidate,
  normalizeCounty,
  type BppCandidate,
  type BppCsvField,
} from "@/lib/bpp-rendition";
import { askAboutDocument, classifyDocument } from "@/lib/document-ai";
import { fileToDataUrl } from "@/lib/intake-store";
import { readSpreadsheet, type SpreadsheetGrid } from "@/lib/spreadsheet-import";
import {
  connectPodio,
  podioItems,
  podioStatus,
  podioWorkspaces,
  type PodioWorkspace,
} from "@/lib/podio";
import { getErrorMessage } from "@/lib/error-message";

type Tab = "existing" | "document" | "manual" | "podio" | "csv";

const TABS: { id: Tab; label: string; icon: typeof Building2 }[] = [
  { id: "existing", label: "From my properties", icon: Building2 },
  { id: "document", label: "Upload documents", icon: FileUp },
  { id: "manual", label: "Enter manually", icon: PencilLine },
  { id: "podio", label: "Connect Podio", icon: Link2 },
  { id: "csv", label: "Upload CSV", icon: Sheet },
];

const input = "w-full rounded-md border border-input bg-background px-2 py-1 text-sm";

// Add Business Personal Property: five ways in, one review. Every entry lands
// in the same review table — linked to a CorvusPT property where the address
// matches, flagged when it duplicates an account (or another row) or is
// incomplete — and nothing is saved until the owner confirms.
export function AddBppDialog({
  userId,
  existing,
  properties,
  onClose,
  onAdded,
}: {
  userId: string;
  existing: BppAccountRecord[];
  properties: PropertyRecord[];
  onClose: () => void;
  onAdded: (created: BppAccountRecord[]) => void;
}) {
  const [tab, setTab] = useState<Tab>("existing");
  const [rows, setRows] = useState<BppCandidate[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const issues = useMemo(() => candidateIssues(existing, rows), [existing, rows]);

  // Adds rows to the review, linking each to the property at its address and
  // leaving duplicates unticked.
  function stage(list: BppCandidate[]) {
    const linked = list.map((c) => ({
      ...c,
      propertyId: c.propertyId ?? matchPropertyByAddress(properties, c.locationAddress)?.id ?? null,
    }));
    setRows((prev) => {
      const next = [...prev, ...linked];
      const iss = candidateIssues(existing, next);
      return next.map((c) =>
        iss.get(c.key)?.duplicate && linked.includes(c) ? { ...c, include: false } : c,
      );
    });
    if (list.length) toast.success(`${list.length} added to the review below.`);
  }

  const patch = (key: string, p: Partial<BppCandidate>) =>
    setRows((prev) => prev.map((c) => (c.key === key ? { ...c, ...p } : c)));

  const toSave = rows.filter((c) => c.include && c.businessName.trim());

  async function save() {
    setBusy("save");
    const created: BppAccountRecord[] = [];
    const failed: string[] = [];
    for (const c of toSave) {
      try {
        created.push(
          await addBppAccount(userId, {
            businessName: c.businessName.trim(),
            locationAddress: c.locationAddress.trim() || undefined,
            cad: c.county.trim() ? cadForCounty(c.county) : undefined,
            accountNumber: c.accountNumber.trim() || undefined,
            taxYear: c.taxYear ?? undefined,
            propertyId: c.propertyId,
            source: c.source,
            podioItemId: c.podioItemId ?? null,
          }),
        );
      } catch {
        failed.push(c.businessName);
      }
    }
    setBusy(null);
    if (created.length) {
      toast.success(
        `Added ${created.length} business personal property account${created.length === 1 ? "" : "s"}.`,
      );
      onAdded(created);
    }
    if (failed.length) toast.error(`Couldn't add: ${failed.join(", ")}`);
    else onClose();
  }

  return (
    <WorkflowPopup
      open
      onClose={onClose}
      wide
      title="Add Business Personal Property"
      description="Pick how to add it — every option ends in the same review before anything is saved."
    >
      <div className="grid gap-4">
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${tab === t.id ? "border-accent bg-accent text-accent-foreground" : "border-border hover:bg-secondary"}`}
            >
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          ))}
        </div>

        <div className="rounded-md border border-border p-3">
          {tab === "existing" && (
            <FromProperties
              properties={properties}
              existing={existing}
              busy={busy}
              setBusy={setBusy}
              onStage={stage}
            />
          )}
          {tab === "document" && <FromDocuments busy={busy} setBusy={setBusy} onStage={stage} />}
          {tab === "manual" && <Manual onStage={stage} />}
          {tab === "podio" && <FromPodio busy={busy} setBusy={setBusy} onStage={stage} />}
          {tab === "csv" && <FromCsv busy={busy} setBusy={setBusy} onStage={stage} />}
        </div>

        {rows.length > 0 && (
          <div>
            <p className="text-sm font-semibold">Review ({toSave.length} to add)</p>
            <div className="mt-1 overflow-x-auto">
              <table className="w-full min-w-[820px] text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="p-1">Add</th>
                    <th className="p-1">Business name</th>
                    <th className="p-1">Property / business address</th>
                    <th className="p-1">County</th>
                    <th className="p-1">CAD account (optional)</th>
                    <th className="p-1">Tax year</th>
                    <th className="p-1">Linked property</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const iss = issues.get(c.key);
                    return (
                      <tr key={c.key} className="border-t border-border/60 align-top">
                        <td className="p-1">
                          <input
                            type="checkbox"
                            aria-label="Add this row"
                            checked={c.include}
                            onChange={(e) => patch(c.key, { include: e.target.checked })}
                          />
                        </td>
                        <td className="p-1">
                          <input
                            className={input}
                            value={c.businessName}
                            onChange={(e) => patch(c.key, { businessName: e.target.value })}
                          />
                          {(iss?.duplicate || (iss?.missing.length ?? 0) > 0 || c.note) && (
                            <div className="mt-0.5 grid gap-0.5">
                              {iss?.duplicate && (
                                <span className="flex items-center gap-1 text-warning-foreground">
                                  <AlertTriangle className="h-3 w-3" />
                                  {iss.duplicate === "saved"
                                    ? "Already in your accounts"
                                    : "Same as a row above"}
                                </span>
                              )}
                              {iss && iss.missing.length > 0 && (
                                <span className="text-muted-foreground">
                                  Missing: {iss.missing.join(", ")}
                                </span>
                              )}
                              {c.note && <span className="text-muted-foreground">{c.note}</span>}
                            </div>
                          )}
                        </td>
                        <td className="p-1">
                          <input
                            className={input}
                            value={c.locationAddress}
                            onChange={(e) => patch(c.key, { locationAddress: e.target.value })}
                          />
                        </td>
                        <td className="p-1">
                          <input
                            className={input}
                            list="bpp-counties"
                            value={c.county}
                            onChange={(e) => patch(c.key, { county: e.target.value })}
                            onBlur={(e) =>
                              patch(c.key, {
                                county: e.target.value ? normalizeCounty(e.target.value) : "",
                              })
                            }
                          />
                        </td>
                        <td className="p-1">
                          <input
                            className={input}
                            value={c.accountNumber}
                            onChange={(e) => patch(c.key, { accountNumber: e.target.value })}
                          />
                        </td>
                        <td className="p-1">
                          <input
                            className={`${input} w-16`}
                            inputMode="numeric"
                            value={c.taxYear ?? ""}
                            onChange={(e) =>
                              patch(c.key, {
                                taxYear: Number(e.target.value.replace(/\D/g, "")) || null,
                              })
                            }
                          />
                        </td>
                        <td className="p-1">
                          <select
                            className={input}
                            value={c.propertyId ?? ""}
                            onChange={(e) => patch(c.key, { propertyId: e.target.value || null })}
                          >
                            <option value="">— none —</option>
                            {properties.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.address}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <datalist id="bpp-counties">
                {TX_COUNTIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              A BPP account number is usually different from the real-property account at the same
              address — leave it blank if you don&apos;t have it.
            </p>
            <div className="mt-2 flex justify-end gap-2">
              <button onClick={() => setRows([])} className="btn-outline py-1.5 text-sm">
                Clear
              </button>
              <button
                onClick={() => void save()}
                disabled={!!busy || toSave.length === 0}
                className="btn-accent py-1.5 text-sm disabled:opacity-60"
              >
                {busy === "save" ? "Adding…" : `Confirm & Add ${toSave.length || ""}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </WorkflowPopup>
  );
}

type SourceProps = {
  busy: string | null;
  setBusy: (b: string | null) => void;
  onStage: (rows: BppCandidate[]) => void;
};

function FromProperties({
  properties,
  existing,
  busy,
  setBusy,
  onStage,
}: SourceProps & { properties: PropertyRecord[]; existing: BppAccountRecord[] }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [why, setWhy] = useState<Record<string, { businessName: string; reason: string }>>({});
  const linked = new Set(existing.map((e) => e.propertyId).filter(Boolean));

  async function suggest() {
    setBusy("suggest");
    try {
      const list = properties.map((p) => ({
        id: p.id,
        address: p.address,
        owner: p.ownerName,
        type: p.propertyType,
        county: countyOf(p.cad),
      }));
      const { answer } = await askAboutDocument({
        question: `Which of these Texas properties likely have a business operating at them that would own business personal property (furniture, fixtures, equipment, inventory) and need a BPP rendition? Typical: owner-occupied commercial, retail, office, restaurant, industrial, medical. Unlikely: vacant land, single-family rentals, residential. Reply with ONLY a JSON array of {"id", "businessName", "reason"} for the likely ones; businessName = the owner name as given (don't invent a business name). Base it only on the data given.`,
        context: JSON.stringify(list),
      });
      const r = extractJson<{ id: string; businessName?: string; reason?: string }[]>(answer) ?? [];
      const ids = new Set(properties.map((p) => p.id));
      const ok = r.filter((x) => ids.has(x.id));
      setWhy(
        Object.fromEntries(
          ok.map((x) => [x.id, { businessName: x.businessName ?? "", reason: x.reason ?? "" }]),
        ),
      );
      setPicked(new Set(ok.map((x) => x.id).filter((id) => !linked.has(id))));
      toast[ok.length ? "success" : "info"](
        ok.length
          ? `Corvus AI suggests ${ok.length} — confirm the ones that apply.`
          : "No likely BPP locations found — tick any that apply.",
      );
    } catch (err) {
      toast.error(getErrorMessage(err, "Corvus AI couldn't suggest right now."));
    } finally {
      setBusy(null);
    }
  }

  if (properties.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        You don&apos;t have any properties in CorvusPT yet — use another option.
      </p>
    );
  return (
    <div className="grid gap-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-muted-foreground">
          Businesses that operate at your properties usually render BPP there.
        </span>
        <button
          onClick={() => void suggest()}
          disabled={!!busy}
          className="btn-outline inline-flex items-center gap-1 py-1 text-xs disabled:opacity-60"
        >
          <Sparkles className="h-3.5 w-3.5" />{" "}
          {busy === "suggest" ? "Thinking…" : "Suggest with Corvus AI"}
        </button>
      </div>
      <ul className="grid max-h-60 gap-1 overflow-y-auto">
        {properties.map((p) => (
          <li key={p.id}>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={picked.has(p.id)}
                onChange={(e) =>
                  setPicked((prev) => {
                    const n = new Set(prev);
                    if (e.target.checked) n.add(p.id);
                    else n.delete(p.id);
                    return n;
                  })
                }
              />
              <span>
                {p.address}
                <span className="text-xs text-muted-foreground">
                  {" "}
                  · {countyOf(p.cad) || "county?"}
                  {p.propertyType ? ` · ${p.propertyType}` : ""}
                  {linked.has(p.id) ? " · already has a BPP account" : ""}
                </span>
                {why[p.id]?.reason && (
                  <span className="block text-xs text-accent">AI: {why[p.id].reason}</span>
                )}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <button
        disabled={picked.size === 0}
        onClick={() => {
          onStage(
            properties
              .filter((p) => picked.has(p.id))
              .map((p) =>
                newCandidate("existing", {
                  businessName: why[p.id]?.businessName || p.ownerName || "",
                  locationAddress: p.address,
                  county: countyOf(p.cad),
                  propertyId: p.id,
                  note: why[p.id] ? "Suggested by Corvus AI — confirm" : undefined,
                }),
              ),
          );
          setPicked(new Set());
        }}
        className="btn-accent w-fit py-1 text-xs disabled:opacity-60"
      >
        Add {picked.size || ""} to review
      </button>
    </div>
  );
}

function FromDocuments({ busy, setBusy, onStage }: SourceProps) {
  async function read(files: FileList | null) {
    if (!files?.length) return;
    setBusy("docs");
    const out: BppCandidate[] = [];
    for (const f of Array.from(files)) {
      try {
        const x = await classifyDocument({
          fileName: f.name,
          mimeType: f.type || "application/pdf",
          dataUrl: await fileToDataUrl(f),
        });
        out.push(
          newCandidate("document", {
            businessName: x.propertyName ?? x.ownerName ?? "",
            locationAddress: x.situsAddress ?? x.propertyAddress ?? "",
            county: normalizeCounty(x.county ?? x.cadName ?? ""),
            accountNumber: x.accountNumber ?? "",
            taxYear: x.taxYear ?? new Date().getFullYear(),
            note: `Read by Corvus AI from ${f.name} (${x.documentType}) — check it`,
          }),
        );
      } catch (err) {
        toast.error(`${f.name}: ${getErrorMessage(err, "couldn't be read")}`);
      }
    }
    setBusy(null);
    onStage(out);
  }
  return (
    <div className="grid gap-2 text-sm">
      <span className="text-muted-foreground">
        A prior rendition, BPP appraisal notice, BPP tax bill or county letter — Corvus AI reads the
        business name, address, county and account number.
      </span>
      <label
        className={`btn-outline inline-flex w-fit cursor-pointer py-1.5 text-xs ${busy ? "pointer-events-none opacity-60" : ""}`}
      >
        {busy === "docs" ? "Reading…" : "Choose files"}
        <input
          type="file"
          multiple
          accept="image/*,.pdf"
          className="hidden"
          onChange={(e) => {
            void read(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
    </div>
  );
}

function Manual({ onStage }: Pick<SourceProps, "onStage">) {
  const [c, setC] = useState(() => newCandidate("manual"));
  return (
    <form
      className="grid gap-2 text-sm sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!c.businessName.trim()) return;
        onStage([c]);
        setC(newCandidate("manual"));
      }}
    >
      <label className="text-xs">
        Business Name *
        <input
          required
          className={input}
          value={c.businessName}
          onChange={(e) => setC({ ...c, businessName: e.target.value })}
        />
      </label>
      <label className="text-xs">
        Property / Business Address
        <input
          className={input}
          value={c.locationAddress}
          onChange={(e) => setC({ ...c, locationAddress: e.target.value })}
        />
      </label>
      <label className="text-xs">
        County
        <select
          className={input}
          value={c.county}
          onChange={(e) => setC({ ...c, county: e.target.value })}
        >
          <option value="">Select…</option>
          {TX_COUNTIES.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </label>
      <label className="text-xs">
        CAD Account Number (optional)
        <input
          className={input}
          value={c.accountNumber}
          onChange={(e) => setC({ ...c, accountNumber: e.target.value })}
        />
      </label>
      <label className="text-xs">
        Tax Year
        <input
          className={input}
          inputMode="numeric"
          value={c.taxYear ?? ""}
          onChange={(e) =>
            setC({ ...c, taxYear: Number(e.target.value.replace(/\D/g, "")) || null })
          }
        />
      </label>
      <div className="flex items-end">
        <button type="submit" className="btn-accent py-1 text-xs">
          Add to review
        </button>
      </div>
    </form>
  );
}

function MappingGrid({
  grid,
  source,
  onStage,
}: {
  grid: SpreadsheetGrid;
  source: "csv" | "podio";
  onStage: (rows: BppCandidate[]) => void;
}) {
  const [mapping, setMapping] = useState<BppCsvField[]>(() => bppColumnMapping(grid.headers));
  return (
    <div className="grid gap-2 text-xs">
      <p className="text-muted-foreground">{grid.rows.length} rows. Match the columns:</p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {grid.headers.map((h, i) => (
          <label key={`${h}-${i}`} className="flex items-center gap-2">
            <span className="w-40 truncate font-medium" title={h}>
              {h || `Column ${i + 1}`}
            </span>
            <select
              className={input}
              value={mapping[i]}
              onChange={(e) =>
                setMapping((m) => m.map((x, j) => (j === i ? (e.target.value as BppCsvField) : x)))
              }
            >
              {(Object.keys(BPP_CSV_FIELD_LABEL) as BppCsvField[]).map((f) => (
                <option key={f} value={f}>
                  {BPP_CSV_FIELD_LABEL[f]}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <button
        disabled={!mapping.includes("businessName")}
        title={mapping.includes("businessName") ? undefined : "Pick the Business Name column"}
        onClick={() => onStage(candidatesFromGrid(grid, mapping, source))}
        className="btn-accent w-fit py-1 text-xs disabled:opacity-60"
      >
        Add {grid.rows.length} rows to review
      </button>
    </div>
  );
}

function FromCsv({ busy, setBusy, onStage }: SourceProps) {
  const [grid, setGrid] = useState<SpreadsheetGrid | null>(null);
  return (
    <div className="grid gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <FileButton
          label={busy === "csv" ? "Reading…" : "Upload CSV / Excel"}
          accept=".csv,.xlsx,.xls"
          disabled={!!busy}
          onFile={(f) => {
            setBusy("csv");
            readSpreadsheet(f)
              .then((g) => (g.rows.length ? setGrid(g) : toast.error("That file has no rows.")))
              .catch((err) => toast.error(getErrorMessage(err, "Could not read that file.")))
              .finally(() => setBusy(null));
          }}
        />
        <button onClick={downloadBppCsvTemplate} className="text-xs text-accent hover:underline">
          Download sample template
        </button>
      </div>
      <span className="text-xs text-muted-foreground">
        Columns: Business Name, Property/Business Address, County, CAD Account Number, Tax Year.
      </span>
      {grid && (
        <MappingGrid
          key={grid.headers.join("|")}
          grid={grid}
          source="csv"
          onStage={(r) => {
            onStage(r);
            setGrid(null);
          }}
        />
      )}
    </div>
  );
}

function FromPodio({ busy, setBusy, onStage }: SourceProps) {
  const [status, setStatus] = useState<{ configured: boolean; connected: boolean } | null>(null);
  const [spaces, setSpaces] = useState<PodioWorkspace[]>([]);
  const [grid, setGrid] = useState<SpreadsheetGrid | null>(null);

  useEffect(() => {
    podioStatus()
      .then((s) => {
        setStatus(s);
        if (s.connected) return podioWorkspaces().then(setSpaces);
      })
      .catch(() => setStatus({ configured: false, connected: false }));
  }, []);

  if (!status) return <p className="text-sm text-muted-foreground">Checking Podio…</p>;
  if (!status.configured)
    return (
      <p className="text-sm text-muted-foreground">
        Podio isn&apos;t set up for CorvusPT yet — use CSV instead.
      </p>
    );
  if (!status.connected)
    return (
      <div className="grid gap-2 text-sm">
        <span className="text-muted-foreground">
          Connect your Podio account, then pick the app that lists your businesses.
        </span>
        <button
          onClick={() => void connectPodio("dashboard/bpp-accounts")}
          className="btn-accent w-fit py-1 text-xs"
        >
          Connect Podio
        </button>
      </div>
    );
  return (
    <div className="grid gap-2 text-sm">
      <label className="text-xs">
        Podio app
        <select
          className={input}
          defaultValue=""
          disabled={!!busy}
          onChange={(e) => {
            const id = Number(e.target.value);
            if (!id) return;
            setBusy("podio");
            podioItems(id)
              .then((g) => {
                setGrid(g);
                if (g.truncated)
                  toast.info(`Showing the first ${g.rows.length} of ${g.total} items.`);
              })
              .catch((err) => toast.error(getErrorMessage(err, "Could not read that app.")))
              .finally(() => setBusy(null));
          }}
        >
          <option value="">Select…</option>
          {spaces.flatMap((s) =>
            s.apps.map((a) => (
              <option key={a.appId} value={a.appId}>
                {s.org} / {s.space} / {a.name}
              </option>
            )),
          )}
        </select>
      </label>
      {busy === "podio" && <p className="text-xs text-muted-foreground">Reading items…</p>}
      {grid && (
        <MappingGrid
          key={grid.headers.join("|")}
          grid={grid}
          source="podio"
          onStage={(r) => {
            onStage(r);
            setGrid(null);
          }}
        />
      )}
    </div>
  );
}
