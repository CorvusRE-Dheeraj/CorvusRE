import { useMemo, useState } from "react";
import { CheckCircle2, Download, Search } from "lucide-react";
import { toast } from "sonner";
import { confirmDialog } from "@/components/ConfirmHost";
import { getErrorMessage } from "@/lib/error-message";
import { getCountyProtestInfo } from "@/lib/county-protest-info";
import {
  STAGE_LABEL,
  approveSegment,
  deleteSegment,
  relDays,
  saveSegment,
  type Lead,
  type MarketingData,
  type Segment,
  type Stage,
} from "@/lib/marketing";
import {
  applyFilters,
  countyTargets,
  deadlineInfo,
  describeFilters,
  leadCounties,
  leadsCsv,
  nextStatutoryDeadline,
  type LeadFilters,
} from "@/lib/marketing-crm";
import type { Go } from "./shared";

const fmt = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// Prospect lists by county: each county's protest deadline, the target groups
// Corvus AI recommends there, and saved lists that staff review, change,
// approve and export.
export function ProspectLists({
  data,
  reload,
  go,
  priorityOf,
  onOpen,
  onFind,
}: {
  data: MarketingData;
  reload: () => Promise<void>;
  go: Go;
  priorityOf: (l: Lead) => "high" | "medium" | "low";
  onOpen: (f: LeadFilters) => void;
  onFind: (county?: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; notes: string } | null>(null);
  const ctx = useMemo(
    () => ({ activities: data.activities, campaigns: data.campaigns, me: data.me, priorityOf }),
    [data, priorityOf],
  );
  const counties = useMemo(() => leadCounties(data.leads), [data.leads]);
  const lists = data.segments.filter((s) => s.kind === "list");
  const deadline = nextStatutoryDeadline();
  const cadFor = (county: string) =>
    data.properties.find((p) => p.county === county && p.cad)?.cad ??
    `${county} Central Appraisal District`;
  const members = (s: Pick<Segment, "filters">) => applyFilters(data.leads, s.filters, ctx);
  const labels = {
    stage: (s: Stage) => STAGE_LABEL[s],
    staff: (id: string) => data.staff.find((x) => x.id === id)?.name ?? "staff",
    campaign: (id: string) => data.campaigns.find((c) => c.id === id)?.name ?? "campaign",
  };

  const run = async (label: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(label);
    try {
      await fn();
      await reload();
      if (ok) toast.success(ok);
    } catch (err) {
      toast.error(getErrorMessage(err, "That didn't save."));
    } finally {
      setBusy(null);
    }
  };
  const saveList = (county: string, name: string, why: string, filters: LeadFilters) =>
    run(
      `save-${county}-${name}`,
      () =>
        saveSegment(null, {
          name: `${county} — ${name}`,
          description: why,
          filters,
          kind: "list",
          county,
          aiSuggested: true,
        }),
      "List saved as a draft — review and approve it below.",
    );
  const exportList = (s: Segment) => {
    const rows = members(s);
    download(`${s.name.replace(/[^\w-]+/g, "_")}.csv`, leadsCsv(rows, data, priorityOf));
    toast.success(`Exported ${rows.length} prospects.`);
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <section className="card-elev p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Saved prospect lists</h2>
          <button
            type="button"
            onClick={() => onFind()}
            className="btn-outline inline-flex items-center gap-1.5 text-xs"
          >
            <Search className="h-3.5 w-3.5" aria-hidden /> Find prospects by county
          </button>
        </div>
        {lists.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No lists yet — save one of the recommended groups below.
          </p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {lists.map((s) => {
              const n = members(s).length;
              return (
                <li
                  key={s.id}
                  className="grid gap-2 rounded-md border border-border p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    {editing?.id === s.id ? (
                      <form
                        className="grid gap-1.5"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void run(
                            "edit",
                            async () => {
                              await saveSegment(s.id, {
                                name: editing.name,
                                description: s.description,
                                filters: s.filters,
                                notes: editing.notes,
                                kind: "list",
                                county: s.county,
                              });
                              setEditing(null);
                            },
                            "Saved — approve it again before use.",
                          );
                        }}
                      >
                        <input
                          className="rounded border border-input bg-background px-2 py-1 text-sm"
                          value={editing.name}
                          onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                          aria-label="List name"
                        />
                        <input
                          className="rounded border border-input bg-background px-2 py-1 text-xs"
                          value={editing.notes}
                          placeholder="Notes for the team"
                          onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                          aria-label="List notes"
                        />
                        <span className="flex gap-2 text-xs">
                          <button type="submit" className="font-medium text-accent">
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditing(null)}
                            className="text-muted-foreground"
                          >
                            Cancel
                          </button>
                        </span>
                      </form>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-2 font-medium">
                          {s.name}
                          {s.status === "approved" ? (
                            <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-900">
                              <CheckCircle2 className="h-3 w-3" aria-hidden /> Approved{" "}
                              {relDays(s.approvedAt)}
                            </span>
                          ) : (
                            <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                              Draft
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {n} prospect{n === 1 ? "" : "s"} · {describeFilters(s.filters, labels)}
                          {s.notes && ` · ${s.notes}`}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      className="btn-outline py-1 text-xs"
                      onClick={() => onOpen(s.filters)}
                    >
                      Review
                    </button>
                    <button
                      type="button"
                      className="btn-outline py-1 text-xs"
                      onClick={() => setEditing({ id: s.id, name: s.name, notes: s.notes ?? "" })}
                    >
                      Edit
                    </button>
                    {s.status !== "approved" && (
                      <button
                        type="button"
                        disabled={!!busy || !n}
                        className="btn-primary btn-primary-hover py-1 text-xs disabled:opacity-60"
                        onClick={() =>
                          void run("approve", () => approveSegment(s.id), "List approved.")
                        }
                      >
                        Approve
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={s.status !== "approved"}
                      title={s.status !== "approved" ? "Approve the list first" : undefined}
                      className="btn-outline inline-flex items-center gap-1 py-1 text-xs disabled:opacity-50"
                      onClick={() => exportList(s)}
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden /> CSV
                    </button>
                    <button
                      type="button"
                      disabled={s.status !== "approved"}
                      className="btn-outline py-1 text-xs disabled:opacity-50"
                      onClick={() => {
                        const ids = members(s)
                          .filter(
                            (l) => l.email && !l.unsubscribedAt && l.stage !== "do_not_contact",
                          )
                          .map((l) => l.id);
                        if (!ids.length)
                          return toast.error("No one on this list can be emailed yet.");
                        go("campaigns", {
                          newCampaign: { leadIds: ids, name: s.name, segmentId: s.id },
                        });
                      }}
                    >
                      Email
                    </button>
                    <button
                      type="button"
                      className="px-1.5 text-xs text-muted-foreground hover:text-destructive"
                      onClick={async () => {
                        if (await confirmDialog(`Delete the list "${s.name}"? The leads stay.`))
                          void run("del", () => deleteSegment(s.id));
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          * Lists update as leads change. Editing a list returns it to draft until it's approved
          again; only approved lists export or go to a campaign.
        </p>
      </section>

      {counties.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No leads with a county yet — find prospects by county or import a list.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {counties.map(({ county, n }) => {
          const info = getCountyProtestInfo(cadFor(county));
          const inCounty = data.leads.filter(
            (l) => l.counties.includes(county) || l.county === county,
          );
          const fromNotice = inCounty.filter((l) => deadlineInfo(l).basis === "notice").length;
          const groups = countyTargets(data, county, priorityOf);
          return (
            <section key={county} className="card-elev p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold">{county} County</h3>
                  <p className="text-xs text-muted-foreground">
                    {n} prospect{n === 1 ? "" : "s"} ·{" "}
                    {inCounty.filter((l) => priorityOf(l) === "high").length} high priority
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onFind(county)}
                  className="text-xs text-accent hover:underline"
                >
                  Find more →
                </button>
              </div>
              <div className="mt-2 rounded-md bg-secondary/50 p-2 text-xs">
                <b>Protest deadline: {fmt(deadline)}</b> — or 30 days after the owner&apos;s notice
                of appraised value, if later (Texas Tax Code §41.44).
                {fromNotice > 0 &&
                  ` ${fromNotice} prospect${fromNotice === 1 ? " has" : "s have"} a deadline from their own notice.`}
                {info?.sourceUrl && (
                  <>
                    {" "}
                    <a
                      href={info.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent hover:underline"
                    >
                      County ARB page
                    </a>
                    {info.verifiedAt && (
                      <span className="text-muted-foreground"> (checked {info.verifiedAt})</span>
                    )}
                  </>
                )}
              </div>
              {groups.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No open prospects here.</p>
              ) : (
                <ul className="mt-2 grid gap-1">
                  {groups.map((g) => (
                    <li
                      key={g.key}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md px-1 py-1 text-sm hover:bg-secondary/40"
                    >
                      <button
                        type="button"
                        onClick={() => onOpen(g.filters)}
                        className="min-w-0 text-left"
                        title={g.why}
                      >
                        <span className="font-medium">{g.name}</span>{" "}
                        <span className="text-muted-foreground">({g.count})</span>
                        <span className="block text-xs text-muted-foreground">{g.why}</span>
                      </button>
                      <button
                        type="button"
                        disabled={!!busy || lists.some((s) => s.name === `${county} — ${g.name}`)}
                        onClick={() => void saveList(county, g.name, g.why, g.filters)}
                        className="text-xs text-accent hover:underline disabled:text-muted-foreground disabled:no-underline"
                      >
                        {lists.some((s) => s.name === `${county} — ${g.name}`)
                          ? "Saved"
                          : "Save as list"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
