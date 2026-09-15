import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useActiveProjectBundle } from "@/hooks/use-project";
import { weeksLabel, monthsFromWeeks, currencyRange } from "@/lib/format";
import { compareScenarios } from "@/lib/timeline";
import { Section, Stat, EmptyProject, Loading } from "@/components/dp-ui";

export const Route = createFileRoute("/dashboard/_layout/timeline")({
  head: () => ({ meta: [{ title: "Timeline — CorvusDP" }] }),
  component: Timeline,
});

function Timeline() {
  const { loading, hasProject, project } = useActiveProjectBundle();
  const [showCompare, setShowCompare] = useState(false);

  if (loading) return <Loading />;
  if (!hasProject || !project?.analysis) return <EmptyProject />;

  const { timeline, fees, complexity } = project.analysis;

  // Simple "smaller building" scenario: ~30% faster review, ~35% lower fees.
  const base = {
    label: "As entered",
    totalWeeksMin: timeline.totalWeeksMin,
    totalWeeksMax: timeline.totalWeeksMax,
    feeTotalLow: fees.totalLow,
    feeTotalHigh: fees.totalHigh,
    complexity: complexity.level,
  };
  const smaller = {
    label: "~30% smaller building",
    totalWeeksMin: Math.round(timeline.totalWeeksMin * 0.85),
    totalWeeksMax: Math.round(timeline.totalWeeksMax * 0.8),
    feeTotalLow: Math.round(fees.totalLow * 0.7),
    feeTotalHigh: Math.round(fees.totalHigh * 0.65),
    complexity: complexity.level === "Complex" ? "Moderate" : complexity.level,
  };
  const delta = compareScenarios(base, smaller);

  return (
    <div className="grid gap-5">
      <Section
        title="Estimated timeline"
        subtitle={`~${monthsFromWeeks(timeline.totalWeeksMin)} – ${monthsFromWeeks(timeline.totalWeeksMax)}`}
      >
        <div className="text-2xl font-semibold">
          {weeksLabel(timeline.totalWeeksMin, timeline.totalWeeksMax)}
        </div>
        <ol className="mt-4 grid gap-2">
          {timeline.phases.map((p, i) => (
            <li
              key={i}
              className="flex items-center justify-between rounded-lg border border-border p-3 text-sm"
            >
              <span className="font-medium">{p.name}</span>
              <span className="text-muted-foreground">{weeksLabel(p.weeksMin, p.weeksMax)}</span>
            </li>
          ))}
        </ol>
        <ul className="mt-3 grid gap-1 text-xs text-muted-foreground">
          {timeline.assumptions.map((a, i) => (
            <li key={i}>• {a}</li>
          ))}
        </ul>
      </Section>

      <Section
        title="Scenario comparison"
        right={
          <button className="btn-outline text-sm" onClick={() => setShowCompare((v) => !v)}>
            {showCompare ? "Hide" : "Compare options"}
          </button>
        }
      >
        {showCompare ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {[base, smaller].map((s) => (
              <div key={s.label} className="rounded-lg border border-border p-4">
                <div className="font-medium">{s.label}</div>
                <div className="mt-2 grid gap-2">
                  <Stat label="Timeline" value={weeksLabel(s.totalWeeksMin, s.totalWeeksMax)} />
                  <Stat label="Fees" value={currencyRange(s.feeTotalLow, s.feeTotalHigh)} />
                  <Stat label="Complexity" value={s.complexity} />
                </div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Going ~30% smaller: {Math.abs(delta.weeksDeltaMax)}–{Math.abs(delta.weeksDeltaMin)}{" "}
              weeks faster and roughly{" "}
              {currencyRange(Math.abs(delta.feeDeltaHigh), Math.abs(delta.feeDeltaLow))} less in
              fees (rough scaling — re-run the analysis for an exact figure).
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Compare a smaller building or a different use to see the effect on cost and time.
          </p>
        )}
      </Section>
    </div>
  );
}
