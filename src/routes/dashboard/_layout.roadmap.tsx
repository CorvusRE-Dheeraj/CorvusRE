import { createFileRoute } from "@tanstack/react-router";
import { useActiveProjectBundle } from "@/hooks/use-project";
import { roadmapStatus } from "@/lib/roadmap";
import { Section, Pill, EmptyProject, Loading } from "@/components/dp-ui";

export const Route = createFileRoute("/dashboard/_layout/roadmap")({
  head: () => ({ meta: [{ title: "Roadmap — CorvusDP" }] }),
  component: Roadmap,
});

function Roadmap() {
  const { loading, hasProject, project, bundle } = useActiveProjectBundle();
  if (loading) return <Loading />;
  if (!hasProject || !project?.analysis) return <EmptyProject />;

  const analysis = project.analysis;
  const approvedIds = (bundle?.permits ?? [])
    .filter((p) => p.status === "approved")
    .map((p) => p.permit_key);
  const approved = new Set(approvedIds);
  const status = roadmapStatus(analysis.roadmap, approvedIds);

  return (
    <div className="grid gap-5">
      <Section
        title="Permitting roadmap — current status"
        subtitle="Every permit phase for this project, in the order it needs to happen."
      >
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">{status.currentPhase}</span>
          <span className="text-muted-foreground">{status.percentComplete}% complete</span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary">
          <div
            className="progress-fill h-full rounded-full bg-accent"
            style={{ width: `${status.percentComplete}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Next required step: {status.nextStep}</p>
      </Section>

      <Section title="Dependency sequence">
        <ol className="relative grid gap-3 border-l border-border pl-6">
          {analysis.roadmap.map((phase) => {
            const done = phase.permits.every((p) => approved.has(p.id));
            const current =
              !done &&
              phase.permits.some((p) => !approved.has(p.id)) &&
              phase.order === status.completedPhases + 1;
            return (
              <li key={phase.order} className="relative">
                <span
                  className={`absolute -left-[1.65rem] mt-1 h-3 w-3 rounded-full border-2 ${
                    done
                      ? "border-accent bg-accent"
                      : current
                        ? "border-accent bg-background"
                        : "border-border bg-background"
                  }`}
                />
                <div className="rounded-lg border border-border p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase text-muted-foreground">
                      Phase {phase.order}
                    </span>
                    {phase.parallel && <Pill tone="blue">parallel</Pill>}
                    {done && <Pill tone="green">approved</Pill>}
                    {current && <Pill tone="amber">in progress</Pill>}
                  </div>
                  <div className="mt-1 font-medium">{phase.title}</div>
                  <ul className="mt-1 text-sm text-muted-foreground">
                    {phase.permits.map((p) => (
                      <li key={p.id}>• {p.name}</li>
                    ))}
                  </ul>
                  {phase.prerequisites.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Requires: {phase.prerequisites.join(", ")}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </Section>
    </div>
  );
}
