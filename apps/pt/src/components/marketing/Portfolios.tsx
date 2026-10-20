import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  money,
  relDays,
  runAi,
  STAGE_LABEL,
  type AiRun,
  type Lead,
  type MarketingData,
} from "@/lib/marketing";
import { leadName, opportunity, portfolios } from "@/lib/marketing-crm";
import { AiBox, PriorityBadge, StageBadge } from "./shared";

// Every owner's properties in one place — biggest portfolios first, with the
// protest opportunities, co-owned parcels and possibly-related owners flagged.
export function Portfolios({
  data,
  leads,
  onOpen,
  onAiRun,
  priorityOf,
}: {
  data: MarketingData;
  /** the leads currently shown by the CRM filters */
  leads: Lead[];
  onOpen: (leadId: string) => void;
  onAiRun: (r: AiRun) => void;
  priorityOf?: (l: Lead) => "high" | "medium" | "low";
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [onlyHigh, setOnlyHigh] = useState(false);
  const rows = useMemo(() => {
    const ids = new Set(leads.map((l) => l.id));
    return portfolios(data).filter((r) => ids.has(r.lead.id) && (!onlyHigh || r.highValue));
  }, [data, leads, onlyHigh]);
  const brief = data.aiRuns.find((r) => r.scope === "portfolios") ?? null;
  const total = rows.reduce((s, r) => s + r.total, 0);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-muted-foreground">
          {rows.length} owner{rows.length === 1 ? "" : "s"} ·{" "}
          {rows.reduce((s, r) => s + r.props.length, 0)} properties · {money(total)} assessed
        </p>
        <label className="inline-flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={onlyHigh}
            onChange={(e) => setOnlyHigh(e.target.checked)}
          />
          High-value only ($5M+ or 5+ properties)
        </label>
      </div>

      <AiBox
        title="Corvus AI — which owners deserve priority"
        text={brief?.result ?? null}
        when={brief ? relDays(brief.createdAt) : null}
        runLabel="Rank portfolios"
        run={async () =>
          onAiRun(
            await runAi({
              scope: "portfolios",
              instruction:
                "Rank the 5 owners that deserve attention first and say why (portfolio size and value, protest opportunities, status, contactability). " +
                "Then name 2-3 specific properties worth leading with in outreach. Numbered list, under 180 words.",
              context: rows
                .slice(0, 30)
                .map(
                  (r) =>
                    `${leadName(r.lead)} | ${STAGE_LABEL[r.lead.stage]} | ${r.props.length} props | ${Math.round(r.total)} assessed | counties ${r.counties.join("/")} | strong opportunities ${r.strong} | contact: ${r.lead.email ? "email" : ""} ${r.lead.phone ? "phone" : ""} | top: ${r.props
                      .slice(0, 3)
                      .map(
                        (p) =>
                          `${p.address} ${p.assessedValue ?? "?"}${opportunity(p) ? ` (${opportunity(p)!.note})` : ""}`,
                      )
                      .join("; ")}`,
                )
                .join("\n"),
            }),
          )
        }
      />

      <div className="card-elev overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-border text-xs text-muted-foreground">
            <tr>
              <th className="w-8 px-2 py-2" />
              <th className="px-3 py-2 font-medium">Owner</th>
              <th className="px-3 py-2 text-right font-medium">Properties</th>
              <th className="px-3 py-2 text-right font-medium">Assessed</th>
              <th className="px-3 py-2 font-medium">Counties</th>
              <th className="px-3 py-2 text-right font-medium">Possible savings*</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  No portfolios match. Add properties to leads, import a file, or press Research on
                  a lead.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const isOpen = open === r.lead.id;
              return [
                <tr
                  key={r.lead.id}
                  className={`border-b border-border/60 ${r.highValue ? "bg-emerald-50/50" : ""}`}
                >
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      aria-label={isOpen ? "Hide properties" : "Show properties"}
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : r.lead.id)}
                      className="rounded p-1 hover:bg-secondary"
                    >
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4" aria-hidden />
                      ) : (
                        <ChevronRight className="h-4 w-4" aria-hidden />
                      )}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onOpen(r.lead.id)}
                      className="text-left font-medium hover:underline"
                    >
                      {leadName(r.lead)}
                    </button>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {r.highValue && (
                        <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                          High value
                        </span>
                      )}
                      <PriorityBadge priority={priorityOf ? priorityOf(r.lead) : r.lead.priority} />
                      {r.strong > 0 && (
                        <span className="text-emerald-800">
                          {r.strong} strong protest case{r.strong === 1 ? "" : "s"}
                        </span>
                      )}
                      {r.coOwned > 0 && <span>{r.coOwned} co-owned</span>}
                      {r.related.length > 0 && (
                        <span>
                          Same owner?{" "}
                          {r.related.slice(0, 2).map((x, i) => (
                            <span key={x.leadId}>
                              {i > 0 && ", "}
                              <button
                                type="button"
                                className="text-accent hover:underline"
                                onClick={() => onOpen(x.leadId)}
                              >
                                {x.name}
                              </button>
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.props.length}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {money(r.total)}
                  </td>
                  <td className="px-3 py-2 text-xs">{r.counties.join(", ") || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(r.savings)}</td>
                  <td className="px-3 py-2">
                    <StageBadge stage={r.lead.stage} />
                  </td>
                </tr>,
                isOpen && (
                  <tr
                    key={`${r.lead.id}-props`}
                    className="border-b border-border/60 bg-secondary/30"
                  >
                    <td />
                    <td colSpan={6} className="px-3 py-2">
                      <ul className="grid gap-1 text-xs">
                        {r.props
                          .slice()
                          .sort((a, b) => (b.assessedValue ?? 0) - (a.assessedValue ?? 0))
                          .map((p) => {
                            const o = opportunity(p);
                            return (
                              <li
                                key={p.id}
                                className="grid grid-cols-[minmax(0,1fr)_7rem_minmax(0,12rem)] gap-3"
                              >
                                <span className="truncate">
                                  {p.address ?? `Account ${p.accountNumber}`}
                                  <span className="text-muted-foreground">
                                    {" "}
                                    · {[p.county, p.propertyType].filter(Boolean).join(" · ")}
                                  </span>
                                </span>
                                <span className="text-right font-medium tabular-nums">
                                  {money(p.assessedValue)}
                                </span>
                                <span
                                  className={
                                    o?.level === "strong"
                                      ? "font-semibold text-emerald-800"
                                      : "text-muted-foreground"
                                  }
                                >
                                  {o?.note ?? ""}
                                </span>
                              </li>
                            );
                          })}
                      </ul>
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        * Possible yearly savings, for prioritising only (a 5% reduction at a ~2.2% tax rate) — not
        a quote or a guarantee.
      </p>
    </div>
  );
}
