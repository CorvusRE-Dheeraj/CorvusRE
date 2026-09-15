import { createFileRoute } from "@tanstack/react-router";
import { useActiveProjectBundle } from "@/hooks/use-project";
import { currency, currencyRange } from "@/lib/format";
import { Section, Stat, EmptyProject, Loading } from "@/components/dp-ui";

export const Route = createFileRoute("/dashboard/_layout/fees")({
  head: () => ({ meta: [{ title: "Fees — CorvusDP" }] }),
  component: Fees,
});

function Fees() {
  const { loading, hasProject, project } = useActiveProjectBundle();
  if (loading) return <Loading />;
  if (!hasProject || !project?.analysis) return <EmptyProject />;

  const { fees } = project.analysis;

  return (
    <div className="grid gap-5">
      <Section
        title="Total fee estimation"
        subtitle="Estimates only — always confirm the final amount with the jurisdiction before paying."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="Permit & review fees"
            value={currencyRange(fees.subtotalLow, fees.subtotalHigh)}
          />
          <Stat
            label="Impact / capital recovery"
            value={`${currency(fees.impactFeesLow)} – ${currency(fees.impactFeesHigh)}`}
          />
          <Stat label="Estimated total" value={currencyRange(fees.totalLow, fees.totalHigh)} />
        </div>
      </Section>

      <Section title="Fee breakdown by permit">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <th className="px-2 py-2 font-medium">Permit</th>
                <th className="px-2 py-2 font-medium">Estimated fee</th>
                <th className="px-2 py-2 font-medium">Basis</th>
              </tr>
            </thead>
            <tbody>
              {fees.lines.map((l) => (
                <tr key={l.permitId} className="row-hover border-b border-border/60">
                  <td className="px-2 py-2 font-medium">{l.label}</td>
                  <td className="px-2 py-2 tabular-nums">{currencyRange(l.low, l.high)}</td>
                  <td className="px-2 py-2 text-muted-foreground">{l.basis}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Assumptions used">
        <ul className="grid gap-1 text-sm text-muted-foreground">
          {fees.assumptions.map((a, i) => (
            <li key={i}>• {a}</li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
