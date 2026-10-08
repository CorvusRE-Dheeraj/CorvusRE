import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { DesignBrief } from "@/lib/design";
import type { DesignRequestRow } from "@/lib/design-requests";
import { currency, currencyRange, parseArea } from "@/lib/format";
import { Section, Stat, Loading, Field, inputCls } from "@/components/dp-ui";
import {
  useActiveDesignRequest,
  EmptyDesign,
  designSubtitle,
  downloadText,
  fileSlug,
} from "@/components/design-workspace";

export const Route = createFileRoute("/dashboard/_layout/design-fees")({
  head: () => ({ meta: [{ title: "Design Fees — CorvusDP" }] }),
  component: DesignFees,
});

function DesignFees() {
  const { loading, dr, brief: b } = useActiveDesignRequest();
  if (loading) return <Loading />;
  if (!dr || !b) return <EmptyDesign />;

  const feeShareLow = b.buildCostHigh > 0 ? (b.budgetLow / b.buildCostHigh) * 100 : null;
  const feeShareHigh = b.buildCostLow > 0 ? (b.budgetHigh / b.buildCostLow) * 100 : null;

  return (
    <div className="grid gap-5">
      <Section title="Fees" subtitle={designSubtitle(dr)}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Design fee range" value={currencyRange(b.budgetLow, b.budgetHigh)} />
          <Stat label="Est. build cost" value={currencyRange(b.buildCostLow, b.buildCostHigh)} />
          <Stat
            label="Design fee as % of build"
            value={
              feeShareLow != null && feeShareHigh != null
                ? `${feeShareLow.toFixed(1)}–${feeShareHigh.toFixed(1)}%`
                : "—"
            }
          />
        </div>
      </Section>

      <Section
        title="Cost breakdown"
        subtitle="Estimated design fee by discipline."
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
                <th className="px-2 py-2 font-medium">Share</th>
              </tr>
            </thead>
            <tbody>
              {b.costBreakdown.map((c) => (
                <tr key={c.discipline} className="row-hover border-b border-border/60">
                  <td className="px-2 py-2">{c.discipline}</td>
                  <td className="px-2 py-2 tabular-nums">{currencyRange(c.low, c.high)}</td>
                  <td className="px-2 py-2 tabular-nums text-muted-foreground">
                    {b.budgetLow > 0 ? `${Math.round((c.low / b.budgetLow) * 100)}%` : "—"}
                  </td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="px-2 py-2">Total design fee</td>
                <td className="px-2 py-2 tabular-nums">
                  {currencyRange(b.budgetLow, b.budgetHigh)}
                </td>
                <td className="px-2 py-2" />
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-4 text-sm font-semibold">What moves the fee</div>
        <ul className="mt-2 grid gap-1 text-sm text-muted-foreground">
          {b.costDrivers.map((c) => (
            <li key={c}>• {c}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          Approximate constructed cost ({currency(b.buildCostLow)}–{currency(b.buildCostHigh)}) is
          separate from the design fee. Both are order-of-magnitude estimates that tighten once a
          survey and a confirmed program are in hand.
        </p>
      </Section>

      <InvestmentSnapshot
        buildCostLow={b.buildCostLow}
        buildCostHigh={b.buildCostHigh}
        buildingArea={dr.building_area}
      />
    </div>
  );
}

// Competitor-inspired (Zenerate/ArchiWise-style pro forma) — a real
// deterministic calculation from the user's OWN inputs, never an AI-guessed
// rent number. Purely client-side/ephemeral: nothing persisted.
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
          Enter an expected rent per square foot to see NOI, implied value at your target cap rate,
          and yield on the estimated build cost
          {area == null ? " (needs a building area on file)" : ""}.
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
  const csv = rows
    .map((r) => r.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
    .join("\n");
  downloadText(`design-cost-breakdown-${fileSlug(dr)}.csv`, csv, "text/csv");
}
