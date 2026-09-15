import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import {
  getActiveDesignRequest,
  approveDesignBrief,
  requestDesignConsultation,
  DESIGN_STAGES,
  DESIGN_STAGE_LABEL,
  type DesignStage,
  type DesignRequestRow,
} from "@/lib/design-requests";
import { scopeLabel, type DesignBrief } from "@/lib/design";
import { currency, currencyRange, weeksLabel, dateShort, parseArea } from "@/lib/format";
import { Section, Stat, Loading, Pill, Field, inputCls } from "@/components/dp-ui";

export const Route = createFileRoute("/dashboard/_layout/design")({
  head: () => ({ meta: [{ title: "Design — CorvusDP" }] }),
  component: DesignDashboard,
});

function DesignDashboard() {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ["design-request", user?.id],
    queryFn: () => getActiveDesignRequest(user!.id),
    enabled: !!user?.id,
  });
  const [busy, setBusy] = useState<"approve" | "consult" | null>(null);

  if (q.isLoading) return <Loading />;

  const dr = q.data;
  if (!dr || !dr.brief) {
    return (
      <div className="card-elev p-8 text-center">
        <h2 className="font-serif text-lg font-semibold">No design brief yet</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Generate one and save it to track it here.
        </p>
        <Link to="/design/analyze" className="btn-accent mt-4 inline-flex">
          Start a Design Brief
        </Link>
      </div>
    );
  }

  const b = dr.brief;

  async function approve() {
    if (!dr) return;
    setBusy("approve");
    await approveDesignBrief(dr.id);
    await q.refetch();
    setBusy(null);
  }
  async function consult() {
    if (!dr) return;
    setBusy("consult");
    await requestDesignConsultation(dr.id);
    await q.refetch();
    setBusy(null);
  }

  // Design Proposal (PRD 2.2.19) — "a formal document shared with the client
  // including scope, fees, timeline, and deliverables." Same plain-text
  // Blob-download pattern as the permitting side's "Download site summary"
  // (dashboard/_layout.constraints.tsx).
  function downloadProposal() {
    if (!dr) return;
    const lines = [
      `CorvusDP — Design Proposal`,
      `Generated ${new Date().toLocaleString()}`,
      ``,
      `PROJECT`,
      `  Location: ${dr.address ?? dr.city ?? "—"}`,
      `  Scope: ${scopeLabel((dr.scope ?? undefined) as never)}`,
      `  Sector: ${dr.sector ?? "—"}`,
      `  Building area: ${dr.building_area ?? "—"} sf, ${dr.floors ?? "—"} floor(s)`,
      ``,
      `SCOPE — WHAT'S INCLUDED`,
      ...b.inclusions.map((i) => `  - ${i.title}: ${i.detail}`),
      ``,
      `FEES — DESIGN COST BY DISCIPLINE`,
      ...b.costBreakdown.map((c) => `  ${c.discipline}: ${currencyRange(c.low, c.high)}`),
      `  Total design fee: ${currencyRange(b.budgetLow, b.budgetHigh)}`,
      `  Estimated build cost (separate): ${currencyRange(b.buildCostLow, b.buildCostHigh)}`,
      ``,
      `TIMELINE`,
      ...b.timeline.map((t) => `  ${t.phase}: ${weeksLabel(t.weeksMin, t.weeksMax)} — ${t.note}`),
      ``,
      `DELIVERABLES — SUGGESTED APPROACH`,
      ...b.approaches.map((a) => `  ${a.name}: ${a.summary} (best when: ${a.bestWhen})`),
      ``,
      `Status: ${dr.approved_at ? `Approved ${dateShort(dr.approved_at)}` : "Pending approval"}`,
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `design-proposal-${(dr.address ?? "project").replace(/[^\w]+/g, "-").slice(0, 40)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid gap-5">
      <Section
        title={dr.address ?? dr.city ?? "Design project"}
        subtitle={`${scopeLabel((dr.scope ?? undefined) as never)} · ${dr.sector ?? "commercial"} · ${dr.building_area ?? "?"} sf`}
        right={
          <div className="flex items-center gap-2">
            {dr.approved_at && <Pill tone="green">Approved {dateShort(dr.approved_at)}</Pill>}
            <button className="btn-outline text-sm" onClick={() => window.print()}>
              Print
            </button>
            <button className="btn-outline text-sm" onClick={downloadProposal}>
              Download proposal
            </button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Design fee range" value={currencyRange(b.budgetLow, b.budgetHigh)} />
          <Stat label="Est. build cost" value={currencyRange(b.buildCostLow, b.buildCostHigh)} />
          <Stat label="Timeline" value={weeksLabel(b.totalWeeksMin, b.totalWeeksMax)} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {!dr.approved_at && (
            <button
              className="btn-accent disabled:opacity-60"
              disabled={busy === "approve"}
              onClick={approve}
            >
              {busy === "approve" ? "Saving…" : "Approve & start detailed design"}
            </button>
          )}
          <button
            className="btn-outline disabled:opacity-60"
            disabled={busy === "consult" || !!dr.consultation_requested_at}
            onClick={consult}
          >
            {dr.consultation_requested_at
              ? `Consultation requested ${dateShort(dr.consultation_requested_at)}`
              : busy === "consult"
                ? "Requesting…"
                : "Schedule initial consultation call"}
          </button>
        </div>
      </Section>

      {dr.stage !== "brief" && dr.stage !== "approved" && (
        <Section
          title="Design progress"
          subtitle="Staff-tracked as your design team moves through each stage (PRD 1.2.19)."
        >
          <DesignStageTracker stage={dr.stage as DesignStage} />
        </Section>
      )}

      <Section
        title="Cost breakdown"
        subtitle="Design fee by discipline (PRD 1.2.10.A)."
        right={
          <button className="btn-outline text-sm" onClick={() => downloadCostBreakdownCsv(dr, b)}>
            Export CSV
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <th className="px-2 py-2 font-medium">Discipline</th>
                <th className="px-2 py-2 font-medium">Estimated fee</th>
              </tr>
            </thead>
            <tbody>
              {b.costBreakdown.map((c) => (
                <tr key={c.discipline} className="row-hover border-b border-border/60">
                  <td className="px-2 py-2">{c.discipline}</td>
                  <td className="px-2 py-2 tabular-nums">{currencyRange(c.low, c.high)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="px-2 py-2">Total design fee</td>
                <td className="px-2 py-2 tabular-nums">
                  {currencyRange(b.budgetLow, b.budgetHigh)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <ul className="mt-3 grid gap-1 text-sm text-muted-foreground">
          {b.costDrivers.map((c) => (
            <li key={c}>• {c}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          Approximate constructed cost ({currency(b.buildCostLow)}–{currency(b.buildCostHigh)}) is
          separate from the design fee.
        </p>
      </Section>

      <InvestmentSnapshot buildCostLow={b.buildCostLow} buildCostHigh={b.buildCostHigh} buildingArea={dr.building_area} />

      <Section title="Suggested approach" subtitle="PRD 1.2.12.A.">
        <div className="grid gap-3 sm:grid-cols-3">
          {b.approaches.map((ap) => (
            <div key={ap.name} className="rounded-lg border border-border p-3 text-sm">
              <div className="font-medium">{ap.name}</div>
              <p className="mt-1 text-xs text-muted-foreground">{ap.summary}</p>
              <p className="mt-2 text-xs">
                <span className="text-muted-foreground">Best when: </span>
                {ap.bestWhen}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Phase breakdown & tracking">
        <ol className="grid gap-2">
          {b.timeline.map((t, i) => (
            <li key={i} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{t.phase}</span>
                <span className="text-muted-foreground">{weeksLabel(t.weeksMin, t.weeksMax)}</span>
              </div>
              <p className="text-xs text-muted-foreground">{t.note}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Full space planning">
        <div className="grid gap-2 sm:grid-cols-2">
          {b.spacePlan.map((z) => (
            <div key={z.zone} className="rounded-lg border border-border p-3 text-sm">
              <div className="font-medium">{z.zone}</div>
              <p className="text-xs text-muted-foreground">{z.note}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Recommendations & next steps">
        <ul className="grid gap-1 text-sm text-muted-foreground">
          {b.recommendations.map((r) => (
            <li key={r}>• {r}</li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

// Competitor-inspired (Zenerate/ArchiWise-style pro forma) — a real
// deterministic calculation from the user's OWN inputs, never an AI-guessed
// rent number. Purely client-side/ephemeral: nothing persisted, so it's
// safe to add with no schema change and free to recompute on every
// keystroke.
function InvestmentSnapshot({
  buildCostLow,
  buildCostHigh,
  buildingArea,
}: {
  buildCostLow: number;
  buildCostHigh: number;
  buildingArea: string | null;
}) {
  const [rentPerSf, setRentPerSf] = useState("");
  const [opexPct, setOpexPct] = useState("35");
  const [capRate, setCapRate] = useState("6");

  const area = parseArea(buildingArea);
  const rent = parseFloat(rentPerSf);
  const opex = parseFloat(opexPct);
  const cap = parseFloat(capRate);
  const ready = area != null && rent > 0 && opex >= 0 && opex < 100 && cap > 0;

  const gpi = ready ? rent * area! : null;
  const noi = ready ? gpi! * (1 - opex / 100) : null;
  const impliedValue = ready ? noi! / (cap / 100) : null;
  const avgCost = (buildCostLow + buildCostHigh) / 2;
  const yieldOnCost = ready && avgCost > 0 ? (noi! / avgCost) * 100 : null;

  return (
    <Section
      title="Investment snapshot"
      subtitle="A quick pro forma from your own rent assumption — a real calculation, not an AI guess at your market."
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Expected rent ($/sf/yr)" hint="Net operating rent for this market">
          <input
            type="number"
            min="0"
            step="0.5"
            className={inputCls}
            value={rentPerSf}
            onChange={(e) => setRentPerSf(e.target.value)}
            placeholder="e.g. 24"
          />
        </Field>
        <Field label="Operating expense ratio (%)">
          <input
            type="number"
            min="0"
            max="99"
            className={inputCls}
            value={opexPct}
            onChange={(e) => setOpexPct(e.target.value)}
          />
        </Field>
        <Field label="Target cap rate (%)">
          <input
            type="number"
            min="0.1"
            step="0.1"
            className={inputCls}
            value={capRate}
            onChange={(e) => setCapRate(e.target.value)}
          />
        </Field>
      </div>
      {ready ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <Stat label="Gross potential income" value={currency(gpi)} />
          <Stat label="Net operating income" value={currency(noi)} />
          <Stat label="Implied value" value={currency(impliedValue)} />
          <Stat label="Yield on cost" value={`${yieldOnCost!.toFixed(1)}%`} />
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          Enter an expected rent per square foot to see NOI, implied value at your target cap
          rate, and yield on the estimated build cost{area == null ? " (needs a building area on file)" : ""}.
        </p>
      )}
    </Section>
  );
}

function downloadCostBreakdownCsv(dr: DesignRequestRow, b: DesignBrief) {
  const rows = [
    ["Discipline", "Low", "High"],
    ...b.costBreakdown.map((c) => [c.discipline, String(c.low), String(c.high)]),
    ["Total design fee", String(b.budgetLow), String(b.budgetHigh)],
    ["Estimated build cost", String(b.buildCostLow), String(b.buildCostHigh)],
  ];
  const csv = rows.map((r) => r.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `design-cost-breakdown-${(dr.address ?? "project").replace(/[^\w]+/g, "-").slice(0, 40)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// PRD 1.2.19.B — "Timeline bar / milestones." Staff advance the underlying
// stage from the admin console; this just renders where the request
// currently sits among the same three phases PRD 1.2.11.A names.
const TRACKED_STAGES: DesignStage[] = ["concept", "development", "final_drawings", "completed"];

function DesignStageTracker({ stage }: { stage: DesignStage }) {
  const currentIndex = TRACKED_STAGES.indexOf(stage);
  return (
    <div>
      <div className="flex items-center">
        {TRACKED_STAGES.map((s, i) => {
          const done = currentIndex >= 0 && i <= currentIndex;
          return (
            <Fragment key={s}>
              {i > 0 && (
                <span className={`h-px flex-1 ${done ? "bg-accent" : "bg-border"}`} aria-hidden />
              )}
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  done ? "bg-accent text-accent-foreground" : "bg-secondary text-muted-foreground"
                }`}
              >
                {i + 1}
              </span>
            </Fragment>
          );
        })}
      </div>
      <div className="mt-2 flex">
        {TRACKED_STAGES.map((s, i) => (
          <span
            key={s}
            className={`flex-1 text-center text-xs ${
              currentIndex >= i ? "font-medium text-foreground" : "text-muted-foreground"
            } ${i === 0 ? "-ml-4 text-left" : i === TRACKED_STAGES.length - 1 ? "-mr-4 text-right" : ""}`}
          >
            {DESIGN_STAGE_LABEL[s]}
          </span>
        ))}
      </div>
    </div>
  );
}
