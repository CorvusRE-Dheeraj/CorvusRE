import { createFileRoute } from "@tanstack/react-router";
import { useActiveProjectBundle } from "@/hooks/use-project";
import { availabilityLabel } from "@/lib/constraints";
import { Section, Pill, EmptyProject, Loading } from "@/components/dp-ui";

export const Route = createFileRoute("/dashboard/_layout/constraints")({
  head: () => ({ meta: [{ title: "Site Data & Constraints — CorvusDP" }] }),
  component: Constraints,
});

const AVAIL_TONE = {
  likely_available: "green",
  verify: "amber",
  likely_constrained: "red",
} as const;

function Constraints() {
  const { loading, hasProject, project } = useActiveProjectBundle();
  if (loading) return <Loading />;
  if (!hasProject || !project?.analysis) return <EmptyProject />;

  const a = project.analysis;
  const c = a.constraints;
  const m = a.preAppMeeting;

  function downloadSiteSummary() {
    const lines = [
      `CorvusDP — Site Data Summary`,
      `Generated ${new Date().toLocaleString()}`,
      ``,
      `PROPERTY`,
      `  Address: ${project!.address ?? "—"}`,
      `  City / County: ${project!.city ?? "—"} / ${project!.county ?? "—"}, ${project!.state ?? ""}`,
      `  Jurisdiction: ${a.jurisdiction.authority} (${a.jurisdiction.level.toUpperCase()})`,
      `  Zoning: ${a.zoning.code || "not provided"} — ${a.zoning.label}`,
      `  Feasibility: ${a.feasibility.status}`,
      ``,
      `UTILITIES`,
      ...c.utilities.map((u) => `  ${u.name}: ${availabilityLabel(u.status)} — ${u.note}`),
      ``,
      `CONSTRAINTS`,
      ...c.constraints.map((x) => `  [${x.severity}] ${x.title}: ${x.detail}`),
      ``,
      `CRITICAL WARNINGS`,
      ...(c.criticalWarnings.length ? c.criticalWarnings.map((w) => `  - ${w}`) : ["  (none)"]),
      ``,
      c.disclaimer,
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `site-summary-${(project!.address ?? "project").replace(/[^\w]+/g, "-").slice(0, 40)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid gap-5">
      <Section
        title="Site Data"
        subtitle="Utility availability, easements, and off-site conditions for this property."
        right={
          <button className="btn-outline text-sm" onClick={downloadSiteSummary}>
            Download site summary
          </button>
        }
      >
        {c.criticalWarnings.length > 0 && (
          <div className="mb-4 rounded-lg border border-red-400/40 bg-red-400/10 p-3 text-sm">
            <div className="font-semibold">Critical warnings</div>
            <ul className="mt-1 grid gap-1">
              {c.criticalWarnings.map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="text-sm font-semibold">Utilities</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {c.utilities.map((u) => (
            <div key={u.name} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{u.name}</span>
                <Pill tone={AVAIL_TONE[u.status]}>{availabilityLabel(u.status)}</Pill>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{u.note}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 text-sm font-semibold">Property constraints</div>
        <ul className="mt-2 grid gap-2">
          {c.constraints.map((x) => (
            <li key={x.title} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex items-center gap-2">
                <Pill
                  tone={
                    x.severity === "critical" ? "red" : x.severity === "watch" ? "amber" : "gray"
                  }
                >
                  {x.severity}
                </Pill>
                <span className="font-medium">{x.title}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{x.detail}</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">{c.disclaimer}</p>
      </Section>

      <Section
        title="Pre-application meeting summary"
        subtitle="A ready-made agenda and what to bring, based on the same site data above."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="text-sm font-semibold">Suggested agenda</div>
            <ol className="mt-2 grid list-decimal gap-1.5 pl-5 text-sm">
              {m.agenda.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ol>
          </div>
          <div>
            <div className="text-sm font-semibold">Bring</div>
            <ul className="mt-2 grid gap-1.5 pl-5 text-sm list-disc">
              {m.bring.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
            <div className="mt-4 text-sm font-semibold">Questions to ask</div>
            <ul className="mt-2 grid gap-1.5 pl-5 text-sm list-disc">
              {m.questionsToAsk.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </div>
        </div>
      </Section>
    </div>
  );
}
