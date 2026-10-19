import { useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  Filter,
  Mail,
  Phone,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { confirmDialog } from "@/components/ConfirmHost";
import { getErrorMessage } from "@/lib/error-message";
import {
  PIPELINE,
  SIDE_STAGES,
  SOURCES,
  SOURCE_LABEL,
  STAGES,
  STAGE_LABEL,
  deleteSegment,
  money,
  monitor,
  relDays,
  runAi,
  saveSegment,
  scoreLead,
  setLeadStage,
  updateLead,
  type AiRun,
  type MarketingData,
  type Stage,
} from "@/lib/marketing";
import {
  applyFilters,
  autoSegments,
  describeFilters,
  isEmptyFilter,
  leadName,
  recommend,
  type LeadFilters,
} from "@/lib/marketing-crm";
import { addLeadWithProperty, researchMany } from "@/lib/marketing-research";
import { CrmRules } from "./CrmRules";
import { LeadForm, LeadProfile } from "./LeadProfile";
import { LeadImport } from "./LeadImport";
import { PodioSync } from "./PodioSync";
import { Portfolios } from "./Portfolios";
import {
  AlertRow,
  PriorityBadge,
  ScoreBadge,
  StageBadge,
  inputCls,
  type Focus,
  type Go,
} from "./shared";

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;
const sel = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";

// Leads & CRM: every prospect, organised by status, owner portfolio and
// segment. Filters, saved segments, bulk actions, import, Podio sync and AI
// research all start here; a lead opens as one page with everything about it.
export function LeadsCrm({
  data,
  focus,
  go,
  reload,
  onAiRun,
}: {
  data: MarketingData;
  focus: Focus;
  go: Go;
  reload: () => Promise<void>;
  onAiRun: (r: AiRun) => void;
}) {
  const [filters, setFilters] = useState<LeadFilters>(
    focus.filters ?? (focus.stages ? { stages: focus.stages } : {}),
  );
  const [view, setView] = useState<"list" | "portfolios">("list");
  const [showFilters, setShowFilters] = useState(false);
  const [openId, setOpenId] = useState<string | null>(focus.leadId ?? null);
  const [modal, setModal] = useState<"add" | "import" | "podio" | "rules" | null>(
    typeof window !== "undefined" && /[?&]podio=/.test(window.location.search) ? "podio" : null,
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [segName, setSegName] = useState<string | null>(null);
  const [aiSegs, setAiSegs] = useState<{ name: string; why: string; filters: LeadFilters }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (focus.leadId) setOpenId(focus.leadId);
    if (focus.filters) setFilters(focus.filters);
    else if (focus.stages) setFilters({ stages: focus.stages });
  }, [focus]);
  useEffect(() => {
    // came back from Podio's sign-in: tidy the URL
    if (modal === "podio" && /[?&]podio=/.test(window.location.search)) {
      const u = new URL(window.location.href);
      u.searchParams.delete("podio");
      window.history.replaceState(null, "", u.toString());
    }
  }, [modal]);

  const ctx = useMemo(
    () => ({ activities: data.activities, campaigns: data.campaigns, me: data.me }),
    [data],
  );
  const matched = useMemo(() => applyFilters(data.leads, filters, ctx), [data.leads, filters, ctx]);
  const rows = useMemo(
    () =>
      matched
        .map((l) => {
          const s = scoreLead(l, data.activities);
          const r = recommend(l, data, s.score);
          return { l, s, r, p: l.priority ?? r.priority };
        })
        .sort((a, b) => PRIORITY_RANK[a.p] - PRIORITY_RANK[b.p] || b.s.score - a.s.score),
    [matched, data],
  );
  const attention = useMemo(
    () =>
      monitor(data)
        .filter((a) => a.tab === "leads" && a.severity !== "info")
        .slice(0, 6),
    [data],
  );
  const suggested = useMemo(() => autoSegments(data), [data]);
  const options = useMemo(() => {
    const uniq = (xs: (string | null)[]) => [...new Set(xs.filter(Boolean) as string[])].sort();
    return {
      counties: uniq(data.leads.flatMap((l) => l.counties)),
      cities: uniq(data.leads.flatMap((l) => [l.city, ...l.cities])),
      types: uniq(data.leads.flatMap((l) => l.propertyTypes)),
    };
  }, [data.leads]);
  const needResearch = data.leads.filter(
    (l) => !l.researchedAt && ["new", "researching", "ready"].includes(l.stage),
  );
  const staffName = (id: string | null) => data.staff.find((s) => s.id === id)?.name ?? "—";
  const labels = {
    stage: (s: Stage) => STAGE_LABEL[s],
    staff: (id: string) => staffName(id),
    campaign: (id: string) => data.campaigns.find((c) => c.id === id)?.name ?? "campaign",
  };
  const setF = (patch: Partial<LeadFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const toggleStage = (s: Stage) =>
    setFilters((f) => {
      const cur = f.stages ?? [];
      return { ...f, stages: cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s] };
    });
  const activeCount = Object.entries(filters).filter(
    ([k, v]) =>
      k !== "q" && k !== "stages" && (Array.isArray(v) ? v.length : v != null && v !== ""),
  ).length;
  const open = data.leads.find((l) => l.id === openId) ?? null;

  const run = async (label: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(label);
    try {
      await fn();
      await reload();
      if (ok) toast.success(ok);
    } catch (err) {
      toast.error(getErrorMessage(err, "That didn't work."));
    } finally {
      setBusy(null);
    }
  };

  async function research(list: typeof data.leads) {
    if (!list.length) return;
    const id = toast.loading(
      `Corvus AI is researching ${list.length} lead${list.length === 1 ? "" : "s"}…`,
    );
    setBusy("research");
    try {
      const r = await researchMany(list.slice(0, 50), data, (n) =>
        toast.loading(`Researched ${n} of ${Math.min(50, list.length)}…`, { id }),
      );
      await reload();
      toast.success(
        `Researched ${r.ok} lead${r.ok === 1 ? "" : "s"}${r.failed ? `, ${r.failed} failed` : ""}.`,
        { id },
      );
    } catch (err) {
      toast.error(getErrorMessage(err, "Research stopped."), { id });
    } finally {
      setBusy(null);
    }
  }

  async function suggestSegments() {
    setBusy("aiseg");
    try {
      const count = (f: (l: (typeof data.leads)[number]) => string[]) => {
        const m = new Map<string, number>();
        for (const l of data.leads) for (const k of f(l)) m.set(k, (m.get(k) ?? 0) + 1);
        return [...m.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([k, n]) => `${k} ${n}`)
          .join(", ");
      };
      const r = await runAi({
        scope: "segments",
        instruction:
          "Suggest up to 5 useful lead segments for targeted campaigns. Reply with JSON only: " +
          '[{"name": "...", "why": "one line", "filters": {"stages": [...], "counties": [...], "propertyTypes": [...], "minValue": number, "minProperties": number, "deadlineWithinDays": number}}] ' +
          `— use only these stages: ${STAGES.join(", ")}; only counties and types listed below; omit filters you don't need.`,
        context: `Leads: ${data.leads.length}. By status: ${count((l) => [l.stage])}. Counties: ${count((l) => l.counties)}. Types: ${count((l) => l.propertyTypes)}. Portfolio sizes: ${count((l) => [l.portfolioCount >= 5 ? "5+" : l.portfolioCount >= 2 ? "2-4" : String(l.portfolioCount)])}. Values: ${count((l) => [(l.portfolioValue ?? 0) >= 5e6 ? "$5M+" : (l.portfolioValue ?? 0) >= 1e6 ? "$1-5M" : (l.portfolioValue ?? 0) > 0 ? "<$1M" : "unknown"])}.`,
      });
      onAiRun(r);
      const arr = JSON.parse((r.result ?? "").match(/\[[\s\S]*\]/)?.[0] ?? "[]") as {
        name?: string;
        why?: string;
        filters?: LeadFilters;
      }[];
      const clean = arr
        .filter((x) => x?.name && x.filters)
        .map((x) => {
          const f = x.filters!;
          const out: LeadFilters = {};
          if (Array.isArray(f.stages))
            out.stages = f.stages.filter((s): s is Stage =>
              (STAGES as readonly string[]).includes(s),
            );
          if (Array.isArray(f.counties))
            out.counties = f.counties.filter((c) => options.counties.includes(c));
          if (Array.isArray(f.propertyTypes))
            out.propertyTypes = f.propertyTypes.filter((t) => options.types.includes(t));
          for (const k of ["minValue", "minProperties", "deadlineWithinDays"] as const)
            if (typeof f[k] === "number") out[k] = f[k];
          return { name: x.name!, why: x.why ?? "", filters: out };
        })
        .filter((x) => !isEmptyFilter(x.filters));
      setAiSegs(clean);
      if (!clean.length) toast.info("Corvus AI didn't find new groups beyond the suggested ones.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Corvus AI couldn't suggest segments."));
    } finally {
      setBusy(null);
    }
  }

  const selIds = [...selected].filter((id) => matched.some((l) => l.id === id));
  const allOn = rows.length > 0 && rows.every(({ l }) => selected.has(l.id));

  return (
    <div className="grid gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-60">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <span className="sr-only">Search leads</span>
          <input
            value={filters.q ?? ""}
            onChange={(e) => setF({ q: e.target.value })}
            placeholder="Search name, company, email, phone, address, ZIP…"
            className={`${inputCls} pl-9`}
          />
        </label>
        <button
          type="button"
          onClick={() => setShowFilters((x) => !x)}
          aria-expanded={showFilters}
          className="btn-outline inline-flex items-center gap-1.5 text-sm"
        >
          <Filter className="h-4 w-4" aria-hidden /> Filters{activeCount ? ` (${activeCount})` : ""}
        </button>
        <button
          type="button"
          onClick={() => setModal("add")}
          className="btn-primary btn-primary-hover inline-flex items-center gap-1.5 text-sm"
        >
          <Plus className="h-4 w-4" aria-hidden /> Add lead
        </button>
        <button
          type="button"
          onClick={() => setModal("import")}
          className="btn-outline inline-flex items-center gap-1.5 text-sm"
        >
          <Upload className="h-4 w-4" aria-hidden /> Import
        </button>
        <button type="button" onClick={() => setModal("podio")} className="btn-outline text-sm">
          Podio sync
          {data.syncChanges.some((c) => c.status === "pending") && (
            <span className="ml-1.5 rounded-full bg-sky-600 px-1.5 text-[10px] font-bold text-white">
              {data.syncChanges.filter((c) => c.status === "pending").length}
            </span>
          )}
        </button>
        <button
          type="button"
          disabled={!!busy || !needResearch.length}
          onClick={() => void research(needResearch)}
          className="btn-outline inline-flex items-center gap-1.5 text-sm disabled:opacity-60"
          title="Fill in county records, find their other properties, and recommend next actions"
        >
          <Sparkles className="h-4 w-4" aria-hidden /> Research {needResearch.length || ""}
        </button>
        <button
          type="button"
          onClick={() => setModal("rules")}
          aria-label="Status rules"
          title="Status rules"
          className="btn-outline px-2.5 text-sm"
        >
          <Settings2 className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {/* Status pipeline */}
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by status">
        {PIPELINE.map((s, i) => (
          <span key={s} className="inline-flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden />}
            <StatusChip
              s={s}
              on={!!filters.stages?.includes(s)}
              n={data.leads.filter((l) => l.stage === s).length}
              onClick={() => toggleStage(s)}
            />
          </span>
        ))}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        {SIDE_STAGES.map((s) => (
          <StatusChip
            key={s}
            s={s}
            on={!!filters.stages?.includes(s)}
            n={data.leads.filter((l) => l.stage === s).length}
            onClick={() => toggleStage(s)}
          />
        ))}
      </div>

      {showFilters && (
        <div className="card-elev grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <FilterSelect
            label="County"
            value={filters.counties?.[0] ?? ""}
            onChange={(v) => setF({ counties: v ? [v] : [] })}
            options={options.counties}
          />
          <FilterSelect
            label="City"
            value={filters.cities?.[0] ?? ""}
            onChange={(v) => setF({ cities: v ? [v] : [] })}
            options={options.cities}
          />
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            ZIP code
            <input
              className={sel}
              value={(filters.zips ?? []).join(", ")}
              onChange={(e) =>
                setF({ zips: e.target.value.split(/[\s,]+/).filter((z) => /^\d{5}$/.test(z)) })
              }
              placeholder="75201, 75204"
              inputMode="numeric"
            />
          </label>
          <FilterSelect
            label="Property type"
            value={filters.propertyTypes?.[0] ?? ""}
            onChange={(v) => setF({ propertyTypes: v ? [v] : [] })}
            options={options.types}
          />
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Assessed value (portfolio)
            <span className="flex gap-1.5">
              <input
                className={`${sel} w-full`}
                inputMode="numeric"
                placeholder="Min $"
                value={filters.minValue ?? ""}
                onChange={(e) =>
                  setF({
                    minValue: e.target.value ? Number(e.target.value.replace(/\D/g, "")) : null,
                  })
                }
                aria-label="Minimum value"
              />
              <input
                className={`${sel} w-full`}
                inputMode="numeric"
                placeholder="Max $"
                value={filters.maxValue ?? ""}
                onChange={(e) =>
                  setF({
                    maxValue: e.target.value ? Number(e.target.value.replace(/\D/g, "")) : null,
                  })
                }
                aria-label="Maximum value"
              />
            </span>
          </label>
          <FilterSelect
            label="Portfolio size"
            value={filters.minProperties?.toString() ?? ""}
            onChange={(v) => setF({ minProperties: v ? Number(v) : null })}
            options={["2", "3", "5", "10"]}
            display={(v) => `${v}+ properties`}
          />
          <FilterSelect
            label="Campaign"
            value={filters.campaignId ?? ""}
            onChange={(v) => setF({ campaignId: v || null })}
            options={data.campaigns.map((c) => c.id)}
            display={(id) => data.campaigns.find((c) => c.id === id)?.name ?? id}
          />
          <FilterSelect
            label="Assigned to"
            value={filters.assignedTo ?? ""}
            onChange={(v) => setF({ assignedTo: v || null })}
            options={["me", "none", ...data.staff.map((s) => s.id)]}
            display={(v) => (v === "me" ? "Me" : v === "none" ? "Unassigned" : staffName(v))}
          />
          <FilterSelect
            label="Priority"
            value={filters.priority ?? ""}
            onChange={(v) => setF({ priority: (v || null) as LeadFilters["priority"] })}
            options={["high", "medium", "low"]}
            display={(v) => v[0].toUpperCase() + v.slice(1)}
          />
          <FilterSelect
            label="Protest deadline"
            value={filters.deadlineWithinDays?.toString() ?? ""}
            onChange={(v) => setF({ deadlineWithinDays: v ? Number(v) : null })}
            options={["7", "14", "30", "60"]}
            display={(v) => `Within ${v} days`}
          />
          <FilterSelect
            label="Source"
            value={filters.sources?.[0] ?? ""}
            onChange={(v) => setF({ sources: v ? [v as (typeof SOURCES)[number]] : [] })}
            options={[...SOURCES]}
            display={(v) => SOURCE_LABEL[v as (typeof SOURCES)[number]]}
          />
          <div className="flex items-end gap-2">
            <button type="button" onClick={() => setFilters({})} className="btn-outline text-sm">
              Clear all
            </button>
          </div>
        </div>
      )}

      {/* Segments */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="font-medium text-muted-foreground">Segments:</span>
        {data.segments.map((sg) => (
          <span
            key={sg.id}
            className="inline-flex items-center rounded-full border border-accent/40 bg-accent/5"
          >
            <button
              type="button"
              onClick={() => setFilters(sg.filters)}
              className="py-1 pl-2.5 pr-1 font-medium"
              title={sg.description ?? describeFilters(sg.filters, labels)}
            >
              {sg.name} ({applyFilters(data.leads, sg.filters, ctx).length})
            </button>
            <button
              type="button"
              aria-label={`Delete segment ${sg.name}`}
              className="rounded-full p-1 text-muted-foreground hover:text-foreground"
              onClick={async () => {
                if (await confirmDialog(`Delete the segment "${sg.name}"? The leads stay.`))
                  void run("delseg", () => deleteSegment(sg.id));
              }}
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </span>
        ))}
        {[
          ...aiSegs.map((x) => ({
            key: `ai-${x.name}`,
            ...x,
            count: applyFilters(data.leads, x.filters, ctx).length,
            ai: true,
          })),
          ...suggested.map((x) => ({ ...x, ai: false })),
        ]
          .filter((x) => !data.segments.some((sg) => sg.name === x.name))
          .map((x) => (
            <button
              key={x.key}
              type="button"
              onClick={() => setFilters(x.filters)}
              title={x.why}
              className="rounded-full border border-dashed border-border px-2.5 py-1 text-muted-foreground hover:text-foreground"
            >
              {x.ai && <Sparkles className="-mt-0.5 mr-1 inline h-3 w-3 text-accent" aria-hidden />}
              {x.name} ({x.count})
            </button>
          ))}
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void suggestSegments()}
          className="inline-flex items-center gap-1 px-1.5 text-accent hover:underline disabled:opacity-60"
        >
          <Sparkles className="h-3 w-3" aria-hidden />{" "}
          {busy === "aiseg" ? "Thinking…" : "Suggest more"}
        </button>
      </div>

      {!isEmptyFilter(filters) && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-secondary/60 px-3 py-2 text-xs">
          <span>
            <b>{matched.length}</b> of {data.leads.length} leads ·{" "}
            {describeFilters(filters, labels)}
          </span>
          {segName === null ? (
            <button
              type="button"
              onClick={() => setSegName("")}
              className="font-medium text-accent hover:underline"
            >
              Save as segment
            </button>
          ) : (
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (!segName.trim()) return;
                const ai =
                  aiSegs.find((x) => JSON.stringify(x.filters) === JSON.stringify(filters)) ??
                  suggested.find((x) => JSON.stringify(x.filters) === JSON.stringify(filters));
                void run(
                  "seg",
                  async () => {
                    await saveSegment(null, {
                      name: segName.trim(),
                      description: ai?.why ?? describeFilters(filters, labels),
                      filters,
                      aiSuggested: !!ai,
                    });
                    setSegName(null);
                  },
                  "Segment saved — pick it as a campaign audience.",
                );
              }}
            >
              <input
                className="rounded border border-input bg-background px-2 py-0.5 text-xs"
                placeholder="Segment name"
                value={segName}
                onChange={(e) => setSegName(e.target.value)}
                aria-label="Segment name"
              />
              <button type="submit" className="font-medium text-accent">
                Save
              </button>
              <button
                type="button"
                onClick={() => setSegName(null)}
                className="text-muted-foreground"
              >
                Cancel
              </button>
            </form>
          )}
          <button
            type="button"
            className="font-medium text-accent hover:underline"
            onClick={() => {
              const ids = matched
                .filter((l) => l.email && !l.unsubscribedAt && l.stage !== "do_not_contact")
                .map((l) => l.id);
              if (!ids.length) return toast.error("No one in this group can be emailed.");
              go("campaigns", {
                newCampaign: { leadIds: ids, name: describeFilters(filters, labels).slice(0, 60) },
              });
            }}
          >
            Email this group
          </button>
          <button
            type="button"
            onClick={() => setFilters({})}
            className="ml-auto text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}

      {attention.length > 0 && isEmptyFilter(filters) && (
        <section className="card-elev p-3">
          <h2 className="px-2 text-sm font-semibold">Needs attention now</h2>
          <ul className="mt-1 grid gap-0.5 md:grid-cols-2">
            {attention.map((a) => (
              <AlertRow key={a.id} alert={a} go={(_t, f) => f?.leadId && setOpenId(f.leadId)} />
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div
          className="inline-flex rounded-md border border-border p-0.5 text-sm"
          role="tablist"
          aria-label="View"
        >
          {(["list", "portfolios"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`rounded px-3 py-1 ${view === v ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}
            >
              {v === "list" ? "Leads" : "Portfolios"}
            </button>
          ))}
        </div>
        {selIds.length > 0 && view === "list" && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-accent/10 px-3 py-1.5 text-sm">
            <b>{selIds.length} selected</b>
            <select
              className="rounded border border-input bg-background px-1.5 py-0.5 text-xs"
              aria-label="Assign selected"
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                void run(
                  "bulk",
                  () =>
                    Promise.all(
                      selIds.map((id) => updateLead(id, { assignedTo: v === "none" ? null : v })),
                    ),
                  "Assigned.",
                );
              }}
            >
              <option value="">Assign to…</option>
              <option value="none">Unassigned</option>
              {data.staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              className="rounded border border-input bg-background px-1.5 py-0.5 text-xs"
              aria-label="Set status of selected"
              value=""
              onChange={async (e) => {
                const v = e.target.value as Stage;
                if (!v) return;
                if (
                  v === "do_not_contact" &&
                  !(await confirmDialog(`Mark ${selIds.length} leads Do Not Contact?`))
                )
                  return;
                void run(
                  "bulk",
                  () =>
                    Promise.all(
                      selIds.map((id) =>
                        setLeadStage(
                          data.leads.find((l) => l.id === id)!,
                          v,
                        ),
                      ),
                    ),
                  "Status updated.",
                );
              }}
            >
              <option value="">Set status…</option>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!!busy}
              className="text-xs font-medium text-accent hover:underline"
              onClick={() => void research(data.leads.filter((l) => selIds.includes(l.id)))}
            >
              Research
            </button>
            <button
              type="button"
              className="text-xs font-medium text-accent hover:underline"
              onClick={() => {
                const ids = data.leads
                  .filter(
                    (l) =>
                      selIds.includes(l.id) &&
                      l.email &&
                      !l.unsubscribedAt &&
                      l.stage !== "do_not_contact",
                  )
                  .map((l) => l.id);
                if (!ids.length) return toast.error("None of these can be emailed.");
                go("campaigns", {
                  newCampaign: { leadIds: ids, name: `${ids.length} selected leads` },
                });
              }}
            >
              Email them
            </button>
            <button
              type="button"
              className="text-xs text-muted-foreground"
              onClick={() => setSelected(new Set())}
            >
              Clear
            </button>
          </div>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {matched.length} lead{matched.length === 1 ? "" : "s"} ·{" "}
          {money(matched.reduce((s, l) => s + (l.portfolioValue ?? 0), 0))} in portfolios
        </span>
      </div>

      {view === "portfolios" ? (
        <Portfolios data={data} leads={matched} onOpen={setOpenId} onAiRun={onAiRun} />
      ) : (
        <div className="card-elev overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="border-b border-border text-xs text-muted-foreground">
              <tr>
                <th className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allOn}
                    onChange={() =>
                      setSelected(allOn ? new Set() : new Set(rows.map(({ l }) => l.id)))
                    }
                  />
                </th>
                <th className="px-2 py-2 font-medium">Priority</th>
                <th className="px-3 py-2 font-medium">Lead</th>
                <th className="px-3 py-2 font-medium">Portfolio</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Assigned</th>
                <th className="px-3 py-2 font-medium">Next action</th>
                <th className="px-3 py-2 font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                    No leads match. Add one, import a file, or sync Podio.
                  </td>
                </tr>
              )}
              {rows.slice(0, 500).map(({ l, s, r, p }) => {
                const last = data.activities.find((a) => a.leadId === l.id);
                const late = l.nextActionAt && new Date(l.nextActionAt) < new Date();
                return (
                  <tr
                    key={l.id}
                    onClick={() => setOpenId(l.id)}
                    className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-secondary/40"
                  >
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${leadName(l)}`}
                        checked={selected.has(l.id)}
                        onChange={() =>
                          setSelected((x) => {
                            const n = new Set(x);
                            if (n.has(l.id)) n.delete(l.id);
                            else n.add(l.id);
                            return n;
                          })
                        }
                      />
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1.5">
                        <ScoreBadge score={s.score} />
                        <PriorityBadge priority={p} />
                      </div>
                    </td>
                    <td className="max-w-[16rem] px-3 py-2">
                      <div className="truncate font-medium">{leadName(l)}</div>
                      <div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                        {l.company && l.fullName && <span className="truncate">{l.fullName}</span>}
                        {l.email && <Mail className="h-3 w-3 shrink-0" aria-label="Has email" />}
                        {l.phone && <Phone className="h-3 w-3 shrink-0" aria-label="Has phone" />}
                        <span className="truncate">{SOURCE_LABEL[l.source]}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {l.portfolioCount ? (
                        <>
                          <div className="font-medium">
                            {l.portfolioCount} propert{l.portfolioCount === 1 ? "y" : "ies"} ·{" "}
                            {money(l.portfolioValue)}
                          </div>
                          <div className="truncate text-muted-foreground">
                            {l.counties.join(", ")}
                          </div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">No property yet</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <StageBadge stage={l.stage} />
                      {l.suggestedStage && (
                        <div className="mt-0.5 text-[10px] text-sky-800">
                          → {STAGE_LABEL[l.suggestedStage]}?
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {l.assignedTo ? (
                        staffName(l.assignedTo)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="max-w-[15rem] px-3 py-2 text-xs">
                      <div className="truncate" title={l.nextAction ?? r.action}>
                        {l.nextAction ?? <span className="text-muted-foreground">{r.action}</span>}
                      </div>
                      {l.nextActionAt && (
                        <div
                          className={late ? "font-semibold text-rose-700" : "text-muted-foreground"}
                        >
                          {late ? "Overdue · " : ""}
                          {new Date(l.nextActionAt).toLocaleDateString()}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {relDays(last?.createdAt ?? l.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > 500 && (
            <p className="p-3 text-xs text-muted-foreground">
              Showing the top 500 — narrow the filters to see the rest.
            </p>
          )}
        </div>
      )}

      {open && (
        <LeadProfile
          lead={open}
          data={data}
          go={go}
          reload={reload}
          onClose={() => setOpenId(null)}
          onOpenLead={setOpenId}
        />
      )}
      {modal === "add" && (
        <Modal onClose={() => setModal(null)} wide>
          <LeadForm
            data={data}
            title="Add a lead"
            onCancel={() => setModal(null)}
            onSave={async (input, prop) => {
              const l = await addLeadWithProperty(input, prop);
              await reload();
              setModal(null);
              setOpenId(l.id);
              toast.success("Lead added — press Research to fill in the rest.");
            }}
          />
        </Modal>
      )}
      {modal === "import" && (
        <LeadImport
          data={data}
          reload={reload}
          onClose={() => setModal(null)}
          onPodio={() => setModal("podio")}
        />
      )}
      {modal === "podio" && (
        <PodioSync data={data} reload={reload} onClose={() => setModal(null)} />
      )}
      {modal === "rules" && <CrmRules data={data} reload={reload} onClose={() => setModal(null)} />}
    </div>
  );
}

function StatusChip({
  s,
  on,
  n,
  onClick,
}: {
  s: Stage;
  on: boolean;
  n: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${on ? "border-accent bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:text-foreground"} ${s === "do_not_contact" && !on ? "text-rose-800" : ""}`}
    >
      {STAGE_LABEL[s]} ({n})
    </button>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  display = (v) => v,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  display?: (v: string) => string;
}) {
  return (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <select className={sel} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {display(o)}
          </option>
        ))}
      </select>
    </label>
  );
}
