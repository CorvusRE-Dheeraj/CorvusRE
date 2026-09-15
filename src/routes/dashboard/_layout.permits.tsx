import { createFileRoute } from "@tanstack/react-router";
import { useActiveProjectBundle } from "@/hooks/use-project";
import { updatePermit, nextPermitStatus } from "@/lib/projects";
import {
  Section,
  Pill,
  EmptyProject,
  Loading,
  humanize,
  permitStatusTone,
} from "@/components/dp-ui";

export const Route = createFileRoute("/dashboard/_layout/permits")({
  head: () => ({ meta: [{ title: "Permits — CorvusDP" }] }),
  component: Permits,
});

function Permits() {
  const { loading, hasProject, project, bundle, refetch } = useActiveProjectBundle();
  if (loading) return <Loading />;
  if (!hasProject || !project) return <EmptyProject />;

  const permits = bundle?.permits ?? [];
  const analysis = project.analysis;

  async function advance(id: string, status: string) {
    const next = nextPermitStatus(status);
    await updatePermit(id, {
      status: next,
      ...(next === "submitted" ? { submitted_at: new Date().toISOString() } : {}),
      ...(next === "approved" ? { approved_at: new Date().toISOString() } : {}),
      ...(next === "resubmitted"
        ? { review_round: (permits.find((p) => p.id === id)?.review_round ?? 0) + 1 }
        : {}),
    });
    refetch();
  }

  return (
    <div className="grid gap-5">
      {analysis && (
        <Section
          title="Complexity summary"
          subtitle="How many permits this project needs, and how they depend on each other."
        >
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-border p-4">
              <div className="text-xs uppercase text-muted-foreground">Overall</div>
              <div className="mt-1 text-lg font-semibold">{analysis.complexity.level}</div>
            </div>
            <div className="rounded-lg border border-border p-4">
              <div className="text-xs uppercase text-muted-foreground">Permits</div>
              <div className="mt-1 text-lg font-semibold">{analysis.complexity.permitCount}</div>
            </div>
            <div className="rounded-lg border border-border p-4">
              <div className="text-xs uppercase text-muted-foreground">Est. approvals</div>
              <div className="mt-1 text-lg font-semibold">
                {analysis.complexity.estimatedApprovals}
              </div>
            </div>
            <div className="rounded-lg border border-border p-4">
              <div className="text-xs uppercase text-muted-foreground">Review cycles</div>
              <div className="mt-1 text-lg font-semibold">
                {analysis.complexity.estimatedReviewCycles}
              </div>
            </div>
          </div>
        </Section>
      )}

      <Section title="Required permits & reviewing agencies">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <th className="px-2 py-2 font-medium">Permit</th>
                <th className="px-2 py-2 font-medium">Category</th>
                <th className="px-2 py-2 font-medium">Agency</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 font-medium">Round</th>
                <th className="px-2 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {permits.map((p, i) => (
                <tr
                  key={p.id}
                  className="list-item-enter row-hover border-b border-border/60"
                  style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
                >
                  <td className="px-2 py-2 font-medium">{p.name}</td>
                  <td className="px-2 py-2">{p.category}</td>
                  <td className="px-2 py-2 text-muted-foreground">{p.agency ?? "—"}</td>
                  <td className="px-2 py-2">
                    <Pill tone={permitStatusTone(p.status)}>{humanize(p.status)}</Pill>
                  </td>
                  <td className="px-2 py-2 tabular-nums">{p.review_round || "—"}</td>
                  <td className="px-2 py-2 text-right">
                    {p.status !== "approved" && (
                      <button
                        onClick={() => advance(p.id, p.status)}
                        className="text-xs text-accent underline underline-offset-2"
                      >
                        Advance →
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Status flow: identified → preparing → submitted → under review → comments → resubmitted →
          approved.
        </p>
      </Section>
    </div>
  );
}
