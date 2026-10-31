import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  Camera,
  Check,
  FileSearch,
  Plus,
  Upload,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { getErrorMessage } from "@/lib/error-message";
import {
  BUILDING_DETAIL_FIELDS,
  CONDITIONS,
  IMPROVEMENT_TYPES,
  SAFETY_NOTE,
  detailValue,
  sectionsFor,
  type ItemCondition,
} from "@/lib/improvement-fields";
import {
  IMPROVEMENTS_CHANGED,
  decideItem,
  loadImprovementData,
  saveBuilding,
  saveOwnerItem,
  summarize,
  uploadImprovementEvidence,
  type Building,
  type ImprovementData,
  type ImprovementItem,
} from "@/lib/improvement-records";

// Improvement Condition (Module 5) — what's built, its condition, defects and
// repairs. Everything can be entered by hand; an inspection report, photos or
// videos are optional and only ever produce suggestions the owner confirms
// (lib/improvement-records.ts). Shared parking, drainage and fencing stay in
// Land Condition.
const COND_TONE: Record<ItemCondition, string> = {
  Good: "bg-success/15 text-success",
  Fair: "bg-warning/15 text-warning-foreground",
  Poor: "bg-destructive/10 text-destructive",
  "Not Assessed": "bg-secondary/70 text-muted-foreground",
  "Not Applicable": "bg-secondary/70 text-muted-foreground",
};
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const DETAIL_LABEL: Record<string, string> = Object.fromEntries(
  BUILDING_DETAIL_FIELDS.map((f) => [f.key, f.label]),
);

export function ImprovementWorkspace({
  propertyId,
  userId,
  canEdit,
  address,
  propertyType,
  recordFacts,
  onApply,
  onEvidenceChange,
}: {
  propertyId: string;
  userId: string | null;
  canEdit: boolean;
  address: string | null;
  propertyType: string | null;
  // the county record's own facts, shown as placeholders (never copied over)
  recordFacts: { yearBuilt?: number | null; buildingSqft?: number | null };
  onApply: () => void;
  onEvidenceChange?: (hasEvidence: boolean) => void;
}) {
  const [data, setData] = useState<ImprovementData>({ buildings: [], items: [], media: [] });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  async function reload() {
    const d = await loadImprovementData(propertyId).catch(() => null);
    if (d) setData(d);
  }
  useEffect(() => {
    void reload();
    const on = () => void reload();
    window.addEventListener(IMPROVEMENTS_CHANGED, on);
    return () => window.removeEventListener(IMPROVEMENTS_CHANGED, on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);
  const reading = data.media.some((m) => m.status === "reading");
  useEffect(() => {
    if (!reading) return;
    const t = setInterval(() => void reload(), 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reading]);

  const building = data.buildings.find((b) => b.id === activeId) ?? data.buildings[0] ?? null;
  const summary = useMemo(() => summarize(building, data.items, data.media), [building, data]);
  useEffect(() => {
    onEvidenceChange?.(summary.hasAnyEvidence);
  }, [summary.hasAnyEvidence, onEvidenceChange]);

  const suggested = data.items.filter(
    (i) => i.status === "suggested" && (!building || !i.buildingId || i.buildingId === building.id),
  );
  // everything reviewed → re-run the module with the confirmed records
  useEffect(() => {
    if (dirty && suggested.length === 0 && !busy) {
      setDirty(false);
      onApply();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, suggested.length, busy]);

  const sections = sectionsFor(building?.types ?? [], building?.customFeatures ?? []);
  const allowed = sections.flatMap((s) =>
    s.components.map((c) => ({ section: s.key, sectionLabel: s.label, component: c })),
  );
  const mediaName = (id: string | null) => {
    const m = data.media.find((x) => x.id === id);
    return m ? m.title || m.fileName : "upload";
  };

  async function ensureBuilding(): Promise<Building> {
    if (building) return building;
    const b = await saveBuilding(propertyId, { name: "Main building" });
    setActiveId(b.id);
    await reload();
    return b;
  }

  async function upload(
    files: File[],
    opts: { asReport?: boolean; hint?: { section: string; component: string } },
  ) {
    if (!userId) return;
    const b = await ensureBuilding().catch(() => null);
    for (const file of files) {
      setBusy(`Reading ${file.name}…`);
      try {
        const res = await uploadImprovementEvidence({
          userId,
          propertyId,
          file,
          buildingId: b?.id ?? null,
          hint: opts.hint ?? null,
          asReport: opts.asReport,
          context: { address, propertyType, allowed },
        });
        if (res.duplicate)
          toast.info(`${file.name} was already uploaded — its findings are below.`);
        else
          toast.success(
            res.found
              ? `${file.name}: ${res.found} finding${res.found === 1 ? "" : "s"} to review.`
              : `${file.name} was read — nothing to record from it.`,
          );
      } catch (err) {
        toast.error(getErrorMessage(err, `Couldn't read ${file.name}.`));
      }
      await reload();
    }
    setBusy(null);
  }

  async function confirm(i: ImprovementItem, edits?: Parameters<typeof decideItem>[2]) {
    try {
      // a building fact from a report goes into the building's details
      if (i.section === "details") {
        const target =
          data.buildings.find((b) => b.id === (edits?.buildingId ?? i.buildingId)) ?? building;
        if (target && i.observation) {
          await saveBuilding(propertyId, {
            id: target.id,
            details: { ...target.details, [i.component]: detailValue(i.component, i.observation) },
          });
        }
      }
      await decideItem(i, "confirmed", edits);
      setDirty(true);
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't save that."));
    }
  }

  const ownerItem = (section: string, component: string) =>
    data.items.find(
      (i) =>
        i.source === "owner" &&
        i.section === section &&
        i.component === component &&
        i.buildingId === (building?.id ?? null),
    );
  const evidenceFor = (component: string) =>
    data.items.filter(
      (i) =>
        i.source !== "owner" &&
        i.status === "confirmed" &&
        i.component === component &&
        (!building || i.buildingId === building.id),
    );

  async function setOwner(
    section: string,
    component: string,
    patch: Omit<Parameters<typeof saveOwnerItem>[2], "buildingId" | "section" | "component">,
  ) {
    try {
      const b = await ensureBuilding();
      await saveOwnerItem(propertyId, ownerItem(section, component), {
        buildingId: b.id,
        section,
        component,
        ...patch,
      });
      setDirty(true);
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't save that."));
    }
  }

  async function updateBuilding(patch: Partial<Building>) {
    try {
      const b = await ensureBuilding();
      await saveBuilding(propertyId, { id: b.id, ...patch });
      setDirty(true);
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't save that."));
    }
  }

  const fileInput = (
    opts: { asReport?: boolean; hint?: { section: string; component: string } },
    accept: string,
  ) => (
    <input
      type="file"
      accept={accept}
      multiple
      className="hidden"
      disabled={!!busy || !canEdit}
      onChange={(e) => {
        const sel = Array.from(e.target.files ?? []);
        e.target.value = "";
        if (sel.length > 0) void upload(sel, opts);
      }}
    />
  );

  return (
    <div className="grid gap-4">
      {/* Uploads — optional */}
      <div id="improvement-uploads" className="scroll-mt-4 rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="min-w-0 max-w-xl text-xs text-muted-foreground">
            Optional — upload an inspection report to help fill in building details and condition
            findings, or photos / short videos of specific issues. You can also fill everything in
            by hand below.
          </p>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <label
                className={`btn-primary inline-flex cursor-pointer items-center gap-1.5 text-xs py-1.5 ${busy ? "pointer-events-none opacity-60" : ""}`}
              >
                <FileSearch className="h-3.5 w-3.5" />
                Upload Inspection Report
                {fileInput({ asReport: true }, ".pdf,image/*")}
              </label>
              <label
                className={`btn-outline inline-flex cursor-pointer items-center gap-1.5 text-xs py-1.5 ${busy ? "pointer-events-none opacity-60" : ""}`}
              >
                <Camera className="h-3.5 w-3.5" />
                Upload Photos / Videos
                {fileInput({}, "image/*,video/mp4,video/quicktime,video/webm")}
              </label>
            </div>
          )}
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">{SAFETY_NOTE}</p>
        {(busy || reading) && (
          <p className="mt-2 rounded-md bg-accent/5 p-2 text-xs text-accent">
            {busy ?? "Reading your upload…"} AI is reading it — a long report or a video can take a
            minute or two.
          </p>
        )}
        {data.media.length > 0 && (
          <ul className="mt-2 grid gap-1 text-xs">
            {data.media.map((m) => (
              <li key={m.id} className="rounded-md bg-secondary/40 px-2 py-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-medium">
                    {m.kind === "report" ? "Report" : m.kind === "video" ? "Video" : "Photo"}:{" "}
                    {m.title || m.fileName}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {m.status === "reading"
                      ? "Reading…"
                      : m.status === "failed"
                        ? "Couldn't read"
                        : [
                            m.reportDate && `Inspected ${m.reportDate}`,
                            m.captureDate && `Taken ${m.captureDate}`,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "Read"}
                  </span>
                </div>
                {m.summary && <p className="text-muted-foreground">{m.summary}</p>}
                {m.qualityNote && (
                  <p className="flex items-start gap-1 text-warning-foreground">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    {m.qualityNote}
                  </p>
                )}
                {m.error && <p className="text-destructive">{m.error}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Buildings */}
      <div className="grid gap-3 rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Building2 className="h-4 w-4 text-accent" />
          {data.buildings.length > 1 &&
            data.buildings.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setActiveId(b.id)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${b.id === building?.id ? "bg-accent/15 text-accent" : "bg-secondary/60 text-muted-foreground hover:bg-secondary"}`}
              >
                {b.name}
              </button>
            ))}
          {canEdit && building ? (
            <input
              key={building.id}
              defaultValue={building.name}
              aria-label="Building name"
              onBlur={(e) =>
                e.target.value.trim() !== building.name &&
                void updateBuilding({ name: e.target.value })
              }
              className="w-44 rounded-md border border-border bg-background px-2 py-1 text-sm font-semibold"
            />
          ) : (
            <span className="text-sm font-semibold">{building?.name ?? "Main building"}</span>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={async () => {
                const b = await saveBuilding(propertyId, {
                  name: `Building ${data.buildings.length + 1}`,
                  sort: data.buildings.length,
                }).catch((err) => {
                  toast.error(getErrorMessage(err, "Couldn't add a building."));
                  return null;
                });
                if (b) {
                  await reload();
                  setActiveId(b.id);
                }
              }}
              className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
            >
              <Plus className="h-3 w-3" /> Add building
            </button>
          )}
        </div>

        <div>
          <div className="text-xs font-semibold">Improvement type</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {IMPROVEMENT_TYPES.map((t) => {
              const on = building?.types.includes(t) ?? false;
              return (
                <button
                  key={t}
                  type="button"
                  disabled={!canEdit}
                  aria-pressed={on}
                  onClick={() => {
                    const cur = building?.types ?? [];
                    void updateBuilding({ types: on ? cur.filter((x) => x !== t) : [...cur, t] });
                  }}
                  className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-accent bg-accent/10 font-semibold text-accent" : "border-border text-muted-foreground hover:bg-secondary/60"}`}
                >
                  {t}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Pick more than one for a mixed-use building — the condition categories below adapt.
          </p>
          {building?.types.includes("Mixed-Use / Other") && canEdit && (
            <input
              key={`${building.id}-custom`}
              defaultValue={building.customFeatures.join(", ")}
              placeholder="Other features to track, comma-separated (e.g. car wash bay, chapel)"
              aria-label="Custom building features"
              onBlur={(e) =>
                void updateBuilding({
                  customFeatures: e.target.value
                    .split(",")
                    .map((x) => x.trim())
                    .filter(Boolean)
                    .slice(0, 20),
                })
              }
              className="mt-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            />
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {BUILDING_DETAIL_FIELDS.map((f) => {
            const val = building?.details[f.key];
            const fromRecord =
              f.key === "yearBuilt"
                ? recordFacts.yearBuilt
                : f.key === "buildingAreaSqft"
                  ? recordFacts.buildingSqft
                  : null;
            return (
              <label key={f.key} className="grid gap-0.5 text-[11px]">
                <span className="font-medium">{f.label}</span>
                <input
                  key={`${building?.id ?? "none"}-${f.key}-${val ?? ""}`}
                  type={f.type}
                  disabled={!canEdit}
                  defaultValue={val ?? ""}
                  placeholder={fromRecord ? `County record: ${fromRecord}` : "Not available"}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    const next = v === "" ? null : f.type === "number" ? Number(v) : v;
                    if (next !== (val ?? null))
                      void updateBuilding({
                        details: { ...(building?.details ?? {}), [f.key]: next },
                      });
                  }}
                  className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                />
              </label>
            );
          })}
        </div>
      </div>

      {/* Simple summary — replaces the condition matrix in the main view */}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg bg-secondary/40 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Overall Condition
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {canEdit ? (
              <select
                aria-label="Overall condition"
                value={building?.details.overallCondition ?? "Not Assessed"}
                onChange={(e) =>
                  void updateBuilding({
                    details: {
                      ...(building?.details ?? {}),
                      overallCondition: e.target.value as ItemCondition,
                    },
                  })
                }
                className="rounded-md border border-border bg-background px-2 py-1 text-sm font-semibold"
              >
                {["Not Assessed", "Good", "Fair", "Poor"].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            ) : (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${COND_TONE[summary.overall]}`}
              >
                {summary.overall}
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">{summary.overallBasis}</p>
        </div>
        <div className="rounded-lg bg-secondary/40 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Documented Issues — {summary.issues.length}
          </div>
          {summary.issues.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">None recorded yet.</p>
          ) : (
            <ul className="mt-1 grid gap-0.5 text-xs">
              {summary.issues.slice(0, 5).map((i) => (
                <li key={i.id}>
                  <span className="font-medium">{i.component}</span>
                  {i.issue ? ` — ${i.issue}` : ` — ${i.condition}`}
                </li>
              ))}
              {summary.issues.length > 5 && (
                <li className="text-muted-foreground">+{summary.issues.length - 5} more below</li>
              )}
            </ul>
          )}
        </div>
        <div className="rounded-lg bg-secondary/40 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Repair Estimates
          </div>
          {summary.estimates.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              No documented estimates yet. Add one to a component below (contractor bid, inspection
              report).
            </p>
          ) : (
            <>
              <div className="mt-1 text-lg font-bold">{usd(summary.estimateTotal)}</div>
              <ul className="grid gap-0.5 text-[11px] text-muted-foreground">
                {summary.estimates.map((e) => (
                  <li key={e.item.id}>
                    {e.item.component}: {usd(e.amount)}
                    {e.item.estimateSource ? ` — ${e.item.estimateSource}` : ""}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Documented repair costs, not a value reduction on their own.
              </p>
            </>
          )}
        </div>
        <div className="rounded-lg bg-secondary/40 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Missing Evidence — {summary.missing.length + (summary.missingDetails.length ? 1 : 0)}
          </div>
          <ul className="mt-1 grid gap-1 text-[11px]">
            {summary.missingDetails.length > 0 && (
              <li>
                <span className="font-medium">Building details:</span>{" "}
                <span className="text-muted-foreground">{summary.missingDetails.join(", ")}</span>
              </li>
            )}
            {summary.missing.map((m) => (
              <li key={m.section}>
                <span className="font-medium">{m.label}:</span>{" "}
                <span className="text-muted-foreground">{m.request}</span>
              </li>
            ))}
            {summary.missing.length === 0 && summary.missingDetails.length === 0 && (
              <li className="text-muted-foreground">Every category has a record.</li>
            )}
          </ul>
        </div>
      </div>

      {/* Review AI suggestions */}
      {suggested.length > 0 && (
        <div className="grid gap-2 rounded-lg border border-accent/30 p-3">
          <div className="text-xs font-bold uppercase tracking-wide text-accent">
            Review what AI found — {suggested.length}
          </div>
          <p className="-mt-1 text-[11px] text-muted-foreground">
            AI-assisted observations, not a professional inspection — nothing counts until you
            confirm it. “No visible issue” doesn&apos;t mean a component is defect-free.
          </p>
          {suggested.map((i) => (
            <SuggestionRow
              key={i.id}
              item={i}
              source={`${i.source === "report" ? "Report" : i.source === "video" ? "Video" : "Photo"}: ${mediaName(i.mediaId)}${i.page ? ` · p. ${i.page}` : ""}${i.videoTime ? ` · at ${i.videoTime}` : ""}`}
              buildings={data.buildings}
              allowed={allowed}
              current={
                i.section === "details"
                  ? ((data.buildings.find((b) => b.id === i.buildingId) ?? building)?.details[
                      i.component as keyof Building["details"]
                    ] ?? null)
                  : null
              }
              canEdit={canEdit}
              onConfirm={(edits) => void confirm(i, edits)}
              onReject={async () => {
                await decideItem(i, "rejected").catch(() => {});
                setDirty(true);
              }}
            />
          ))}
        </div>
      )}

      {/* Component sections */}
      <div className="grid gap-2">
        {sections.map((s) => {
          const recorded = s.components.filter((c) => {
            const o = ownerItem(s.key, c);
            return (o && (o.condition !== "Not Assessed" || o.issue)) || evidenceFor(c).length > 0;
          }).length;
          return (
            <details key={s.key} className="rounded-lg border border-border" open={recorded > 0}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                <span>{s.label}</span>
                <span className="text-[11px] font-normal text-muted-foreground">
                  {recorded} of {s.components.length} recorded
                </span>
              </summary>
              <div className="grid gap-1.5 border-t border-border/60 p-2">
                {s.components.map((c) => (
                  <ComponentRow
                    key={`${building?.id ?? "none"}-${c}`}
                    section={s.key}
                    component={c}
                    owner={ownerItem(s.key, c)}
                    evidence={evidenceFor(c)}
                    mediaName={mediaName}
                    canEdit={canEdit}
                    showFixed={s.key === "features"}
                    showEstimate
                    onChange={(patch) => void setOwner(s.key, c, patch)}
                    uploadInput={fileInput(
                      { hint: { section: s.key, component: c } },
                      "image/*,video/mp4,video/quicktime,video/webm,.pdf",
                    )}
                    busy={!!busy}
                  />
                ))}
              </div>
            </details>
          );
        })}
        <p className="text-[11px] text-muted-foreground">
          Shared parking, drainage, fencing and other site improvements are tracked under{" "}
          <Link
            to="/ai-report"
            search={{ openModule: "site" }}
            className="text-accent hover:underline"
          >
            Land Condition
          </Link>
          , not duplicated here.
        </p>
        {canEdit && dirty && suggested.length === 0 && (
          <button
            type="button"
            onClick={() => {
              setDirty(false);
              onApply();
            }}
            className="btn-outline w-fit text-xs py-1.5"
          >
            Update Improvement Condition with these records
          </button>
        )}
      </div>
    </div>
  );
}

function SuggestionRow({
  item,
  source,
  buildings,
  allowed,
  current,
  canEdit,
  onConfirm,
  onReject,
}: {
  // for a building fact: what the building already has on record
  current: string | number | null;
  item: ImprovementItem;
  source: string;
  buildings: Building[];
  allowed: { section: string; sectionLabel: string; component: string }[];
  canEdit: boolean;
  onConfirm: (edits: Parameters<typeof decideItem>[2]) => void;
  onReject: () => void;
}) {
  const isDetail = item.section === "details";
  const [condition, setCondition] = useState<ItemCondition>(item.condition);
  const [issue, setIssue] = useState(item.issue ?? "");
  const [buildingId, setBuildingId] = useState<string | null>(
    item.buildingId ?? buildings[0]?.id ?? null,
  );
  const [pair, setPair] = useState(`${item.section}|${item.component}`);
  return (
    <div className="rounded-md border border-border p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">
          {isDetail ? (DETAIL_LABEL[item.component] ?? item.component) : item.component}
        </span>
        {!isDetail && (
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${COND_TONE[item.condition]}`}
          >
            AI suggests: {item.condition}
          </span>
        )}
        {item.needsProfessional && (
          <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning-foreground">
            Needs a professional inspection
          </span>
        )}
      </div>
      {item.observation && <p className="mt-0.5">{item.observation}</p>}
      {isDetail &&
        current != null &&
        current !== "" &&
        item.observation &&
        String(current) !== String(detailValue(item.component, item.observation)) && (
          <p className="mt-0.5 flex items-start gap-1 text-warning-foreground">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            Your record says {String(current)} — confirming replaces it with the report&apos;s
            value.
          </p>
        )}
      {item.repairEstimate != null && (
        <p className="mt-0.5">
          Documented estimate: <strong>{usd(item.repairEstimate)}</strong>
          {item.estimateSource ? ` — ${item.estimateSource}` : ""}
        </p>
      )}
      <div className="mt-0.5 text-[10px] text-muted-foreground">{source}</div>
      {item.uncertain && (
        <p className="mt-0.5 flex items-start gap-1 text-warning-foreground">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          Check this: {item.uncertain}
        </p>
      )}
      {canEdit && (
        <div className="mt-1.5 grid gap-1.5">
          {!isDetail && (
            <div className="flex flex-wrap gap-1.5">
              <select
                aria-label="Category"
                value={pair}
                onChange={(e) => setPair(e.target.value)}
                className="rounded-md border border-border bg-background px-1.5 py-1"
              >
                {!allowed.some((a) => `${a.section}|${a.component}` === pair) && (
                  <option value={pair}>{item.component} (uncategorized)</option>
                )}
                {allowed.map((a) => (
                  <option key={`${a.section}|${a.component}`} value={`${a.section}|${a.component}`}>
                    {a.sectionLabel} — {a.component}
                  </option>
                ))}
              </select>
              <select
                aria-label="Condition"
                value={condition}
                onChange={(e) => setCondition(e.target.value as ItemCondition)}
                className="rounded-md border border-border bg-background px-1.5 py-1"
              >
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              {buildings.length > 1 && (
                <select
                  aria-label="Building"
                  value={buildingId ?? ""}
                  onChange={(e) => setBuildingId(e.target.value || null)}
                  className="rounded-md border border-border bg-background px-1.5 py-1"
                >
                  {buildings.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
          {!isDetail && (
            <input
              value={issue}
              onChange={(e) => setIssue(e.target.value.slice(0, 1000))}
              placeholder="Issue / next step (optional)"
              aria-label="Issue"
              className="rounded-md border border-border bg-background px-2 py-1"
            />
          )}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                const [section, component] = pair.split("|");
                onConfirm(
                  isDetail
                    ? { buildingId }
                    : {
                        condition,
                        issue: issue || null,
                        buildingId,
                        ...(section !== "uncategorized" ? { section, component } : {}),
                      },
                );
              }}
              className="inline-flex items-center gap-1 font-medium text-success hover:underline"
            >
              <Check className="h-3 w-3" /> Confirm
            </button>
            <button
              type="button"
              onClick={onReject}
              className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-destructive"
            >
              <X className="h-3 w-3" /> Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ComponentRow({
  component,
  owner,
  evidence,
  mediaName,
  canEdit,
  showFixed,
  showEstimate,
  onChange,
  uploadInput,
  busy,
}: {
  section: string;
  component: string;
  owner: ImprovementItem | undefined;
  evidence: ImprovementItem[];
  mediaName: (id: string | null) => string;
  canEdit: boolean;
  showFixed: boolean;
  showEstimate: boolean;
  onChange: (patch: {
    condition?: ItemCondition;
    issue?: string | null;
    repairEstimate?: number | null;
    estimateSource?: string | null;
    fixedOrMovable?: "fixed" | "movable" | null;
  }) => void;
  uploadInput: React.ReactNode;
  busy: boolean;
}) {
  const condition = owner?.condition ?? "Not Assessed";
  const [open, setOpen] = useState(!!owner?.issue || !!owner?.repairEstimate);
  return (
    <div className="rounded-md bg-secondary/30 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 font-medium">{component}</span>
        {canEdit ? (
          <select
            aria-label={`${component} condition`}
            value={condition}
            onChange={(e) => onChange({ condition: e.target.value as ItemCondition })}
            className={`rounded-full border-0 px-2 py-0.5 text-[11px] font-semibold ${COND_TONE[condition]}`}
          >
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        ) : (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${COND_TONE[condition]}`}
          >
            {condition}
          </span>
        )}
        {showFixed && canEdit && (
          <select
            aria-label={`${component} fixed or movable`}
            value={owner?.fixedOrMovable ?? ""}
            onChange={(e) =>
              onChange({ fixedOrMovable: (e.target.value || null) as "fixed" | "movable" | null })
            }
            className="rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px]"
          >
            <option value="">Fixed / movable?</option>
            <option value="fixed">Fixed improvement</option>
            <option value="movable">Movable equipment</option>
          </select>
        )}
        {canEdit && (
          <>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
            >
              <Wrench className="h-3 w-3" /> {owner?.issue ? "Edit issue" : "Add issue"}
            </button>
            <label
              title="Upload a photo, video or document for this component"
              className={`inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-accent hover:underline ${busy ? "pointer-events-none opacity-60" : ""}`}
            >
              <Upload className="h-3 w-3" /> Evidence
              {uploadInput}
            </label>
          </>
        )}
      </div>
      {owner?.issue && !open && <p className="mt-0.5 text-muted-foreground">{owner.issue}</p>}
      {open && canEdit && (
        <div className="mt-1.5 grid gap-1.5 sm:grid-cols-[1fr_8rem_1fr]">
          <input
            defaultValue={owner?.issue ?? ""}
            placeholder="Issue (e.g. active leak over suite B)"
            aria-label={`${component} issue`}
            onBlur={(e) =>
              e.target.value !== (owner?.issue ?? "") && onChange({ issue: e.target.value })
            }
            className="rounded-md border border-border bg-background px-2 py-1"
          />
          {showEstimate && (
            <>
              <input
                type="number"
                min={0}
                defaultValue={owner?.repairEstimate ?? ""}
                placeholder="Estimate $"
                aria-label={`${component} repair estimate`}
                onBlur={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  if (v !== (owner?.repairEstimate ?? null)) onChange({ repairEstimate: v });
                }}
                className="rounded-md border border-border bg-background px-2 py-1"
              />
              <input
                defaultValue={owner?.estimateSource ?? ""}
                placeholder="Estimate source (e.g. ABC Roofing bid, 6/2026)"
                aria-label={`${component} estimate source`}
                onBlur={(e) =>
                  e.target.value !== (owner?.estimateSource ?? "") &&
                  onChange({ estimateSource: e.target.value })
                }
                className="rounded-md border border-border bg-background px-2 py-1"
              />
            </>
          )}
        </div>
      )}
      {evidence.length > 0 && (
        <ul className="mt-1 grid gap-0.5 text-[11px]">
          {evidence.map((e) => (
            <li key={e.id} className="text-muted-foreground">
              <span
                className={`mr-1 rounded px-1 text-[10px] font-semibold ${COND_TONE[e.condition]}`}
              >
                {e.condition}
              </span>
              {e.observation ?? e.issue}
              <span className="ml-1 text-[10px]">
                ({e.source === "report" ? "report" : e.source}: {mediaName(e.mediaId)}
                {e.page ? `, p. ${e.page}` : ""}
                {e.videoTime ? `, at ${e.videoTime}` : ""} · AI suggestion you confirmed)
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
